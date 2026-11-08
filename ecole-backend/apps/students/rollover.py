"""Passage à l'année suivante, en trois étapes (page « Nouvelle année ») :

1. Bilan : pour chaque classe, admis, redoublants, exclus. Un élève qui devrait redoubler un niveau qu'il a DÉJÀ redoublé est proposé
   à l'exclusion ; la direction peut confirmer le renvoi ou lui accorder un redoublement (décision de fin d'année).
2. Passage : la nouvelle année est créée ; chaque élève qui reste est inscrit à son nouveau niveau (supérieur, ou le même s'il redouble),
   « à placer », sans classe. Exclus, anciens élèves et départs sortent. Rien n'est modifié avant l'application, et l'opération s'annule
   tant que la nouvelle année est vide.
3. Réinscription : le secrétariat valide la réinscription de chacun (sur présentation du reçu, ou sans paiement avec un motif) ;
   ceux qui ne reviennent pas sont marqués partis.
4. Effectifs : par niveau, élèves validés et places des classes, pour décider s'il faut ouvrir une classe.
5. Répartition : par niveau, les élèves validés sont répartis équitablement (effectifs, filles et garçons) ; on ajuste à la main.

École à plusieurs cursus (franco-arabe…) : l'année scolaire est commune, le passage (étapes 1 et 2) se fait donc pour toute l'école
en une fois, chaque élève selon les règles de SON cursus (niveaux, classes, moyennes de passage, périodes). La réinscription et la
répartition (étapes 3 à 5) se font cursus par cursus.
"""
import re
from contextlib import nullcontext
from datetime import date

from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import ValidationError

from apps.academics.models import Cursus, SchoolClass, SchoolSettings, SchoolYear, Term, YearRollover
from apps.core.log import record
from apps.core.tenancy import cursus_context
from apps.grades import calc
from apps.grades.models import Decision

from .models import Enrollment, Student

ACTIONS = {"promote", "repeat", "exclude", "graduate", "leave"}
ACTION_LABEL = {"promote": "Classe supérieure", "repeat": "Redouble", "exclude": "Exclu(e)", "graduate": "Ancien élève (fin du cursus)", "leave": "Quitte l'école"}
DECISION_OF = {"promote": "admis", "graduate": "admis", "repeat": "redouble", "exclude": "exclu"}


def _in(cursus):
    """Les niveaux d'un cursus précis (passage de toute l'école) ; sans cursus, ceux du cursus courant."""
    return cursus_context(cursus) if cursus else nullcontext()


def next_level(level: str, cursus=None) -> str | None:
    """Niveau suivant dans l'ordre du cursus ; None pour le dernier niveau."""
    from apps.academics.models import next_level as nxt
    with _in(cursus):
        return nxt(level)


def is_last_level(level: str, cursus=None) -> bool:
    from apps.academics.models import level_names
    with _in(cursus):
        names = level_names()
    return bool(names) and level == names[-1]


def _has_series(level: str | None, cursus=None) -> bool:
    from apps.academics.models import Level
    with _in(cursus):
        return bool(level) and Level.objects.filter(name=level, has_series=True).exists()


def _settings_by_cursus() -> dict:
    """Réglages de passage de chaque cursus (moyennes d'admission, de redoublement…)."""
    out = {}
    for c in Cursus.objects.all():
        with cursus_context(c):
            out[c.pk] = SchoolSettings.load()
    return out


def _class_label(cl: SchoolClass, several: bool) -> str:
    """Nom de la classe ; précédé du cursus quand l'école en a plusieurs (deux « 6e A » ne se confondent pas)."""
    return f"{cl.cursus.nom} · {cl.name}" if several and cl.cursus_id else cl.name


def _close_accounts(users) -> None:
    """Bloque le compte des élèves sortis, sauf s'ils restent inscrits (ou à placer) dans un autre cursus."""
    for u in {u.pk: u for u in users}.values():
        with cursus_context(None):
            ailleurs = Student.objects.filter(user=u).filter(Q(active=True) | Q(sortie="placer")).exists()
        if not ailleurs:
            u.is_active = False
            u.save(update_fields=["is_active"])


def next_label(label: str) -> str:
    m = re.fullmatch(r"(\d{4})-(\d{4})", label or "")
    return f"{int(m.group(1)) + 1}-{int(m.group(2)) + 1}" if m else ""


def shift(d: date) -> date:
    try:
        return d.replace(year=d.year + 1)
    except ValueError:      # 29 février
        return d.replace(year=d.year + 1, day=28)


def _suffix(name: str) -> str:
    return name.strip().split(" ")[-1].lower() if " " in name.strip() else ""


def already_repeated(student: Student) -> bool:
    """Vrai si l'élève a déjà redoublé le niveau de sa classe actuelle."""
    return student.school_class.level in (student.niveaux_redoubles or [])


def proposal_for(student: Student, annual, cfg) -> tuple[str | None, str]:
    """Proposition de fin d'année : celle des moyennes de l'école, sauf qu'un élève qui devrait redoubler un niveau
    qu'il a déjà redoublé est proposé à l'exclusion. Renvoie (proposition, motif à afficher)."""
    p = calc.propose_decision(annual, cfg, student.school_class.level)
    if p == "redouble" and already_repeated(student):
        return "exclu", f"A déjà redoublé la {student.school_class.level}"
    return p, ""


def suggested_action(student: Student, decision: str | None) -> str | None:
    if decision == "admis":
        return "graduate" if is_last_level(student.school_class.level, student.cursus_id) else "promote"
    return {"redouble": "repeat", "exclu": "exclude"}.get(decision or "")


def build_plan() -> dict:
    year = SchoolYear.get_current()
    if year is None:
        raise ValidationError("Aucune année scolaire n’est ouverte.")
    cfg = SchoolSettings.load()                      # règles affichées : celles du cursus courant
    with cursus_context(None):                       # le passage concerne toute l'école, tous cursus confondus
        return _build_plan(year, cfg)


def _build_plan(year, cfg) -> dict:
    cfgs = _settings_by_cursus()
    several = len(cfgs) > 1
    students = list(Student.objects.filter(active=True).select_related("school_class", "cursus").order_by("cursus__ordre", "school_class__name", "nom", "prenoms"))
    decisions = {d.student_id: d for d in Decision.objects.filter(year=year)}
    avgs = calc.annual_averages(Student.objects.filter(pk__in=[s.pk for s in students]), year)
    classes = list(SchoolClass.objects.select_related("cursus").order_by("cursus__ordre", "name"))
    load = {c.pk: 0 for c in classes}                # élèves attendus l'an prochain dans chaque classe (calculé au fil des suggestions)
    rows = []
    for s in students:
        a = avgs.get(s.pk)
        annual = a["moyenne"] if a else None
        d = decisions.get(s.pk)
        proposal, why = proposal_for(s, annual, cfgs.get(s.cursus_id, cfg))
        action = suggested_action(s, d.value if d else proposal)        # décision de la direction, sinon proposition d'après la moyenne ; « conseil » : à trancher
        target = None
        if action in ("promote", "repeat"):
            target = _suggest_class(s, action, classes, load)
            if target:
                load[target.pk] += 1
        rows.append({"student": s.pk, "name": s.full_name, "matricule": s.matricule, "class": s.school_class_id, "class_name": _class_label(s.school_class, several),
                     "cursus": s.cursus_id, "cursus_nom": s.cursus.nom if s.cursus_id else "",
                     "next_level": next_level(s.school_class.level, s.cursus_id), "last_level": is_last_level(s.school_class.level, s.cursus_id),   # niveaux de SON cursus
                     "level": s.school_class.level, "serie": s.school_class.serie, "annual_avg": annual,
                     "decision": d.value if d else None, "proposal": proposal, "reason": why, "already_repeated": already_repeated(s),
                     "sexe": s.sexe,
                     "action": action, "target": target.pk if target else None})
    return {"from_year": year.label, "to_year": next_label(year.label), "rows": rows,
            "classes": [{"id": c.pk, "name": _class_label(c, several), "level": c.level, "serie": c.serie, "max": c.max_students, "cursus": c.cursus_id} for c in classes],
            "actions": ACTION_LABEL, "settings": {"admission": float(cfg.passage_admission), "redoublement": float(cfg.passage_redoublement),
                                                  "exclusion": None if cfg.passage_exclusion is None else float(cfg.passage_exclusion),
                                                  "niveaux": cfg.passage_niveaux or {}}}


def _suggest_class(s: Student, action: str, classes, load) -> SchoolClass | None:
    cur = s.school_class
    want = cur.level if action == "repeat" else next_level(cur.level, s.cursus_id)
    pool = [c for c in classes if c.cursus_id == cur.cursus_id and c.level == want and load[c.pk] < c.max_students]   # classes de son cursus
    if not pool:
        return None
    if action == "promote" and cur.serie:                               # 2nde → 1ère → Tle : on garde la série
        same = [c for c in pool if c.serie == cur.serie]
        pool = same or pool
    elif action == "promote" and _has_series(want, s.cursus_id):                      # 3e → 2nde : la série est un choix de la direction
        return None
    if action == "repeat" and cur in pool:
        return cur
    friends = [c for c in pool if _suffix(c.name) and _suffix(c.name) == _suffix(cur.name)]     # « 6e A » → « 5e A » : on garde les camarades ensemble
    return min(friends or pool, key=lambda c: load[c.pk])


def _validate_moves(moves, students: dict[int, Student], classes: dict[int, SchoolClass]) -> dict[int, tuple[str, SchoolClass | None, str | None]]:
    if not isinstance(moves, list):
        raise ValidationError("Aperçu invalide.")
    out: dict[int, tuple[str, SchoolClass | None]] = {}
    count: dict[int, int] = {}
    for m in moves:
        m = m if isinstance(m, dict) else {}
        try:
            sid = int(m.get("student"))
        except (TypeError, ValueError):
            raise ValidationError("Élève invalide.") from None
        st = students.get(sid)
        if st is None or sid in out:
            raise ValidationError("Un élève est inconnu ou apparaît deux fois.")
        action = m.get("action")
        if action not in ACTIONS:
            raise ValidationError(f"{st.full_name} : choisissez ce qui lui arrive (classe supérieure, redoublement…).")
        level = st.school_class.level
        cl, want = None, None
        if action in ("promote", "repeat"):
            want = level if action == "repeat" else next_level(level, st.cursus_id)
            if want is None:
                raise ValidationError(f"{st.full_name} : un élève du dernier niveau ({level}) ne passe pas dans une classe supérieure.")
            if m.get("class") not in (None, ""):      # classe donnée tout de suite (sinon : à placer à l'étape « Répartition »)
                try:
                    cl = classes[int(m.get("class"))]
                except (KeyError, TypeError, ValueError):
                    raise ValidationError(f"{st.full_name} : classe inconnue.") from None
                if cl.cursus_id != st.school_class.cursus_id:
                    raise ValidationError(f"{st.full_name} : la classe {cl.name} n’est pas de son cursus.")
                if cl.level != want:
                    raise ValidationError(f"{st.full_name} : la classe {cl.name} n’est pas de niveau {want}.")
                count[cl.pk] = count.get(cl.pk, 0) + 1
                if count[cl.pk] > cl.max_students:
                    raise ValidationError(f"La classe {cl.name} dépasse sa capacité ({cl.max_students} places).")
        elif action == "graduate" and not is_last_level(level, st.cursus_id):
            raise ValidationError(f"{st.full_name} : seuls les élèves du dernier niveau deviennent anciens élèves.")
        out[sid] = (action, cl, want)
    missing = [s.full_name for sid, s in students.items() if sid not in out]
    if missing:
        raise ValidationError(f"{len(missing)} élève(s) n’ont pas encore de destination (par exemple {missing[0]}).")
    return out


def apply(*, moves, to_label: str | None, user=None, request=None) -> dict:
    with cursus_context(None):                       # toute l'école, tous cursus confondus
        return _apply(moves=moves, to_label=to_label, user=user, request=request)


@transaction.atomic
def _apply(*, moves, to_label: str | None, user=None, request=None) -> dict:
    from apps.finance import fees
    from apps.finance.models import FeeDate
    from django.utils import timezone

    old = SchoolYear.get_current()
    if old is None:
        raise ValidationError("Aucune année scolaire n’est ouverte.")
    label = (to_label or next_label(old.label)).strip()
    if not re.fullmatch(r"\d{4}-\d{4}", label):
        raise ValidationError("Indiquez l’année suivante sous la forme 2027-2028.")
    if SchoolYear.objects.filter(label=label).exists():
        raise ValidationError(f"L’année {label} existe déjà.")
    students = {s.pk: s for s in Student.objects.select_for_update().filter(active=True).select_related("school_class", "user")}
    classes = {c.pk: c for c in SchoolClass.objects.all()}
    plan = _validate_moves(moves, students, classes)
    today = timezone.localdate()
    accounts = {sid: fees.account(s, today) for sid, s in students.items()}
    balances = {sid: a["balance"] for sid, a in accounts.items()}       # dettes de l'année qui se termine
    credits = {sid: a["credit"] for sid, a in accounts.items()}         # avances (paiements en trop gardés)
    old_terms = list(old.terms.order_by("start", "code"))
    snapshot = {"students": [{"id": s.pk, "active": True, "sortie": s.sortie, "class": s.school_class_id, "solde_sortie": s.solde_sortie,
                              "redoubles": list(s.niveaux_redoubles or [])} for s in students.values()],
                "terms": [{"id": t.pk, "locked": t.locked} for t in old_terms], "decisions_created": []}
    new = SchoolYear.objects.create(label=label, current=True)
    for t in old_terms:
        Term.objects.create(year=new, cursus_id=t.cursus_id, code=t.code, label=t.label, start=shift(t.start), end=shift(t.end), locked=False, coef=t.coef)
    for fd in FeeDate.objects.filter(year=old):
        FeeDate.objects.create(year=new, key=fd.key, date=shift(fd.date))
    Term.objects.filter(year=old).update(locked=True)
    counts = {a: 0 for a in ACTIONS}
    to_place_n, leaving = 0, []
    for sid, (action, cl, want) in plan.items():
        s = students[sid]
        counts[action] += 1
        if action in DECISION_OF and not Decision.objects.filter(student=s, year=old).exists():
            d = Decision.objects.create(student=s, year=old, value=DECISION_OF[action], comment="Décidé à l’ouverture de l’année suivante.", by=user)
            snapshot["decisions_created"].append(d.pk)
        if action == "repeat" and s.school_class.level not in (s.niveaux_redoubles or []):
            s.niveaux_redoubles = [*(s.niveaux_redoubles or []), s.school_class.level]       # pour la règle « déjà redoublé ce niveau »
        if cl is not None:
            s.school_class = cl
            s.save(update_fields=["school_class", "niveaux_redoubles"])
            Enrollment.objects.create(student=s, year=new, school_class=cl, report=balances[sid], credit=credits[sid])
        elif action in ("promote", "repeat"):          # inscrit à son nouveau niveau, à placer dans une classe (étape « Répartition »)
            s.active, s.sortie, s.school_class = False, "placer", None
            s.save(update_fields=["active", "sortie", "school_class", "niveaux_redoubles"])
            Enrollment.objects.create(student=s, year=new, school_class=None, level=want, report=balances[sid], credit=credits[sid], reinscrit=False)
            to_place_n += 1
        else:
            s.active, s.solde_sortie = False, balances[sid]
            s.sortie = {"exclude": "exclu", "graduate": "ancien", "leave": "parti"}[action]
            s.save(update_fields=["active", "sortie", "solde_sortie"])
            leaving.append(s.user)
    _close_accounts(leaving)
    YearRollover.objects.create(from_year=old, to_year=new, snapshot=snapshot, by=user)
    record("Nouvelle année", f"{old.label} → {new.label} : {counts['promote']} en classe supérieure, {counts['repeat']} redoublants, "
                              f"{counts['exclude']} exclus, {counts['graduate']} anciens élèves, {counts['leave']} départs, {to_place_n} à placer",
           user=user, request=request)
    return {"year": new.label, "counts": counts, "to_place": to_place_n, "carried_over": sum(1 for sid in plan if balances[sid] > 0)}


def last_rollover() -> YearRollover | None:
    cur = SchoolYear.get_current()
    return YearRollover.objects.filter(to_year=cur, undone=False).first() if cur else None


def undo_blockers(r: YearRollover) -> str | None:
    """Raison pour laquelle on ne peut plus annuler (None : on peut)."""
    from apps.finance.models import Payment
    from apps.grades.models import Evaluation
    if Evaluation.objects.filter(term__year=r.to_year).exists():
        return "Des évaluations ont déjà été créées dans la nouvelle année."
    if Payment.objects.filter(year=r.to_year).exists():
        return "Des paiements ont déjà été enregistrés dans la nouvelle année."
    known = [s["id"] for s in r.snapshot["students"]]
    if Enrollment.objects.filter(year=r.to_year).exclude(student_id__in=known).exists():
        return "De nouveaux élèves ont déjà été inscrits dans la nouvelle année."
    return None


def undo(*, user=None, request=None) -> dict:
    with cursus_context(None):                       # le passage a concerné toute l'école
        return _undo(user=user, request=request)


@transaction.atomic
def _undo(*, user=None, request=None) -> dict:
    from apps.finance.models import FeeDate
    r = last_rollover()
    if r is None:
        raise ValidationError("Aucun passage d’année à annuler.")
    why = undo_blockers(r)
    if why:
        raise ValidationError(f"Annulation impossible : {why}")
    snap = r.snapshot
    for row in snap["students"]:
        s = Student.objects.select_related("user").get(pk=row["id"])
        s.active, s.sortie, s.solde_sortie, s.school_class_id = row["active"], row["sortie"], row["solde_sortie"], row["class"]
        s.niveaux_redoubles = row.get("redoubles", s.niveaux_redoubles)
        s.save(update_fields=["active", "sortie", "solde_sortie", "school_class", "niveaux_redoubles"])
        s.user.is_active = True
        s.user.save(update_fields=["is_active"])
    Decision.objects.filter(pk__in=snap["decisions_created"]).delete()
    new, old = r.to_year, r.from_year
    Enrollment.objects.filter(year=new).delete()
    FeeDate.objects.filter(year=new).delete()
    Term.objects.filter(year=new).delete()
    r.delete()
    new.delete()
    for t in snap["terms"]:
        Term.objects.filter(pk=t["id"]).update(locked=t["locked"])
    old.current = True
    old.save()
    record("Passage d’année annulé", f"Retour à {old.label}", user=user, request=request)
    return {"year": old.label}


@transaction.atomic
def reintegrate(student: Student, school_class: SchoolClass, *, user=None, request=None) -> Student:
    """Remet un élève sorti (exclu, ancien élève, parti) dans une classe de l'année en cours ; son solde dû est reporté."""
    year = SchoolYear.get_current()
    if student.active:
        raise ValidationError("Cet élève est déjà inscrit.")
    cl = SchoolClass.objects.select_for_update().get(pk=school_class.pk)
    if cl.students.filter(active=True).count() >= cl.max_students:
        raise ValidationError({"school_class": f"La classe {cl.name} est complète ({cl.max_students} places)."})
    student.active, student.school_class, report = True, cl, student.solde_sortie
    student.sortie, student.solde_sortie = "", 0
    student.save(update_fields=["active", "school_class", "sortie", "solde_sortie"])
    student.user.is_active = True
    student.user.save(update_fields=["is_active"])
    Enrollment.objects.update_or_create(student=student, year=year, defaults={"school_class": cl, "report": report})
    record("Élève réintégré", f"{student.full_name} → {cl.name}", user=user, request=request)
    return student


# ---------- Étape 3 : répartition des élèves à placer dans les classes ----------


def to_place(level: str | None = None) -> list[Enrollment]:
    """Inscriptions de l'année en cours encore sans classe (élèves passés « à placer »)."""
    qs = Enrollment.objects.filter(year=SchoolYear.get_current(), school_class__isnull=True, student__sortie="placer") \
        .select_related("student").order_by("student__nom", "student__prenoms")
    return list(qs.filter(level=level) if level else qs)


def _class_rows(level: str) -> list[dict]:
    """Classes d'un niveau avec leur occupation actuelle (élèves inscrits, filles, garçons)."""
    from django.db.models import Count, Q
    qs = SchoolClass.objects.filter(level=level).order_by("name").annotate(
        n=Count("students", filter=Q(students__active=True)),
        nf=Count("students", filter=Q(students__active=True, students__sexe="F")),
        nm=Count("students", filter=Q(students__active=True, students__sexe="M")))
    return [{"id": c.pk, "name": c.name, "serie": c.serie, "max": c.max_students, "count": c.n, "f": c.nf, "m": c.nm} for c in qs]


def _previous_classes(student_ids, year) -> dict[int, SchoolClass]:
    """Classe de l'année précédente de chaque élève (dernière inscription avec une classe, hors année en cours)."""
    out: dict[int, SchoolClass] = {}
    for e in Enrollment.objects.filter(student_id__in=student_ids, school_class__isnull=False).exclude(year=year) \
            .select_related("school_class", "year").order_by("year__label"):
        out[e.student_id] = e.school_class          # la plus récente l'emporte
    return out


def placement_state() -> dict:
    """Ce qu'il reste à placer, niveau par niveau, avec les classes de chaque niveau et leurs places. Un élève sans classe
    l'an passé est un nouvel élève (inscrit « à répartir »)."""
    cur = SchoolYear.get_current()
    enr = to_place()
    prev = _previous_classes([e.student_id for e in enr], cur)
    pays = _payments_of([e.student_id for e in enr], cur)
    from apps.academics.models import level_names
    order = level_names()
    levels = sorted({e.level for e in enr}, key=lambda lv: order.index(lv) if lv in order else 99)
    out = []
    for lv in levels:
        rows = []
        for e in (x for x in enr if x.level == lv):
            p = prev.get(e.student_id)
            rows.append({"student": e.student_id, "name": e.student.full_name, "matricule": e.student.matricule, "sexe": e.student.sexe,
                         "from_class": p.pk if p else None, "from_name": p.name if p else "Nouvel élève", "from_level": p.level if p else "",
                         "from_serie": p.serie if p else "", "repeat": bool(p) and p.level == lv, "new": p is None, "reinscrit": e.reinscrit,
                         "state": "valide" if e.reinscrit else ("paye" if pays.get(e.student_id) else "attente"), "note": e.reinscription_note,
                         "paid": sum(x["amount"] for x in pays.get(e.student_id, [])), "receipts": pays.get(e.student_id, [])})
        out.append({"level": lv, "classes": _class_rows(lv), "students": rows})
    states = [r["state"] for lv in out for r in lv["students"]]
    return {"year": cur.label if cur else "", "total": len(enr), "confirmed": states.count("valide"), "paid": states.count("paye"),
            "waiting": states.count("attente"), "levels": out}


def _payments_of(student_ids, year) -> dict[int, list[dict]]:
    """Paiements confirmés de l'année en cours, par élève, avec leur reçu (pour que le secrétariat vérifie avant de valider)."""
    from apps.finance.models import Payment
    out: dict[int, list[dict]] = {}
    for p in Payment.objects.filter(student_id__in=student_ids, year=year, status="confirme").order_by("date", "id"):
        out.setdefault(p.student_id, []).append({"id": p.pk, "receipt_no": p.receipt_no, "amount": p.amount, "date": p.date, "mode": p.mode})
    return out


def _interleave(group: list[dict]) -> list[dict]:
    """Filles et garçons alternés (pour qu'un débordement reste équilibré)."""
    f = [x for x in group if x["sexe"] == "F"]
    m = [x for x in group if x["sexe"] != "F"]
    out = []
    for i in range(max(len(f), len(m))):
        out += ([f[i]] if i < len(f) else []) + ([m[i]] if i < len(m) else [])
    return out


def distribute(level: str, students: list[dict], classes: list[dict]) -> dict[int, int | None]:
    """Répartition équitable : chaque classe reçoit autant d'élèves que possible (sans dépasser ses places), filles et garçons
    mélangés. Rien d'autre : la direction ajuste ensuite à la main (série en 2nde, cas particuliers)."""
    if not classes:
        return {s["student"]: None for s in students}
    load = {c["id"]: c["count"] for c in classes}
    girls = {c["id"]: c["f"] for c in classes}
    boys = {c["id"]: c["m"] for c in classes}
    cap = {c["id"]: c["max"] for c in classes}
    out: dict[int, int | None] = {}
    for st in _interleave(sorted(students, key=lambda x: x.get("name", ""))):
        pool = [c["id"] for c in classes if load[c["id"]] < cap[c["id"]]]
        if not pool:
            out[st["student"]] = None
            continue
        girl = st["sexe"] == "F"
        cid = min(pool, key=lambda c: (load[c], abs((girls[c] + girl) - (boys[c] + (not girl)))))
        out[st["student"]] = cid
        load[cid] += 1
        (girls if girl else boys)[cid] += 1
    return out


def suggest(level: str) -> dict:
    state = next((x for x in placement_state()["levels"] if x["level"] == level), None)
    if state is None:
        return {"level": level, "assignments": {}, "unplaced": 0}
    res = distribute(level, [s for s in state["students"] if s["reinscrit"]], state["classes"])   # les non-réinscrits ne prennent pas de place
    return {"level": level, "assignments": {str(k): v for k, v in res.items()}, "unplaced": sum(1 for v in res.values() if v is None),
            "waiting": sum(1 for s in state["students"] if not s["reinscrit"])}


@transaction.atomic
def place(assignments, *, user=None, request=None) -> dict:
    """Enregistre la classe des élèves à placer : [{student, class}]. Vérifie le niveau et les places ; prévient la famille."""
    from django.db.models import Count, Q

    from apps.notifications.services import notify
    if not isinstance(assignments, list) or not assignments:
        raise ValidationError("Aucune classe choisie.")
    pending = {e.student_id: e for e in Enrollment.objects.select_for_update().filter(
        year=SchoolYear.get_current(), school_class__isnull=True, student__sortie="placer").select_related("student__user", "student__parent__user")}
    classes = {c.pk: c for c in SchoolClass.objects.annotate(n=Count("students", filter=Q(students__active=True)))}
    chosen: dict[int, SchoolClass] = {}
    for a in assignments:
        a = a if isinstance(a, dict) else {}
        try:
            sid, cid = int(a.get("student")), int(a.get("class"))
        except (TypeError, ValueError):
            raise ValidationError("Choix invalide.") from None
        e = pending.get(sid)
        if e is None or sid in chosen:
            raise ValidationError("Un élève n’est pas à placer ou apparaît deux fois.")
        cl = classes.get(cid)
        if cl is None:
            raise ValidationError("Classe inconnue.")
        if cl.level != e.level:
            raise ValidationError(f"{e.student.full_name} est inscrit(e) en {e.level} : la classe {cl.name} ne convient pas.")
        chosen[sid] = cl
    for cl in set(chosen.values()):
        if cl.n + sum(1 for c in chosen.values() if c.pk == cl.pk) > cl.max_students:
            raise ValidationError(f"La classe {cl.name} dépasse sa capacité ({cl.max_students} places).")
    year = SchoolYear.get_current()
    for sid, cl in chosen.items():
        e = pending[sid]
        s = e.student
        s.school_class, s.active, s.sortie = cl, True, ""
        s.save(update_fields=["school_class", "active", "sortie"])
        e.school_class = cl
        e.save(update_fields=["school_class"])
        if not s.user.is_active:
            s.user.is_active = True
            s.user.save(update_fields=["is_active"])
        notify([s.parent.user_id, s.user_id], f"{s.prenoms} est en {cl.name} pour l’année {year.label}.", "systeme", "dashboard")
    record("Répartition des élèves", f"{len(chosen)} élève(s) placé(s) : " + ", ".join(sorted({c.name for c in chosen.values()})), user=user, request=request)
    return {"placed": len(chosen), "remaining": len(to_place())}


# ---------- Réinscription : confirmer, ou clore ceux qui ne sont pas revenus ----------
@transaction.atomic
def set_reinscription(student_ids, confirmed: bool, *, motif: str = "", user=None, request=None) -> dict:
    """Le secrétariat valide (ou annule) la réinscription d'élèves à placer. Sur présentation du reçu : l'élève a payé dans la
    nouvelle année. Sans paiement (boursier, enfant du personnel…) : un motif est obligatoire. Tout est tracé au journal."""
    if not isinstance(student_ids, list) or not student_ids:
        raise ValidationError("Aucun élève choisi.")
    try:
        ids = list(dict.fromkeys(int(x) for x in student_ids))
    except (TypeError, ValueError):
        raise ValidationError("Élève invalide.") from None
    year = SchoolYear.get_current()
    rows = list(Enrollment.objects.select_for_update().filter(year=year, school_class__isnull=True, student__sortie="placer", student_id__in=ids)
                .select_related("student"))
    if len(rows) != len(ids):
        raise ValidationError("Un élève n’est pas en attente de classe.")
    pays = _payments_of(ids, year)
    motif = (motif or "").strip()
    for e in rows:
        if confirmed:
            p = pays.get(e.student_id)
            if not p and len(motif) < 3:
                raise ValidationError(f"{e.student.full_name} n’a rien payé pour la nouvelle année : indiquez le motif de la validation.")
            e.reinscrit = True
            e.reinscription_note = (f"Reçu {p[-1]['receipt_no']}" if p else f"Sans paiement : {motif}")[:200]
        else:
            e.reinscrit, e.reinscription_note = False, ""
        e.save(update_fields=["reinscrit", "reinscription_note"])
        record("Réinscription validée" if confirmed else "Validation de réinscription annulée", f"{e.student.full_name} · {e.reinscription_note or e.level}",
               user=user, request=request)
    return {"updated": len(rows)}


@transaction.atomic
def mark_departed(student_ids=None, *, user=None, request=None) -> dict:
    """Élèves passés qui ne se sont pas réinscrits : ils quittent l'école (« Parti(e) »), compte bloqué, dette de l'an passé gardée
    comme solde de sortie. Leur dossier reste dans « Anciens élèves et exclus » et ils peuvent être réintégrés."""
    from apps.finance.models import Payment
    year = SchoolYear.get_current()
    paid = Payment.objects.filter(year=year, status="confirme").values("student_id")
    qs = Enrollment.objects.select_for_update().filter(year=year, school_class__isnull=True, student__sortie="placer",
                                                       reinscrit=False).exclude(student_id__in=paid).select_related("student__user")
    if student_ids:
        qs = qs.filter(student_id__in=[int(x) for x in student_ids])
    rows = list(qs)
    for e in rows:
        s = e.student
        s.active, s.sortie, s.solde_sortie = False, "parti", e.report
        s.save(update_fields=["active", "sortie", "solde_sortie"])
        e.delete()                                  # pas d'inscription dans une année où il n'est pas venu
    _close_accounts([e.student.user for e in rows])
    if rows:
        record("Non réinscrits", f"{len(rows)} élève(s) marqué(s) comme partis", user=user, request=request)
    return {"departed": len(rows), "remaining": len(to_place())}
