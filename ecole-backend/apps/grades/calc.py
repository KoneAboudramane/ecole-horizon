"""Calcul des moyennes et des rangs. Même règles que le prototype (engine.ts) ; seul le serveur fait foi.

Chaque note est d'abord ramenée sur 20 (15 sur 30 → 10), puis : moyenne de matière = moyenne (pondérée par le coefficient de chaque évaluation) des interros/devoirs (mc) pondérée avec la moyenne des compositions :
mc × (1 − p) + compo × p ; s'il manque l'une des deux, on garde l'autre. Moyenne générale = Σ(moy × coef) / Σ(coef)
sur les matières notées, plus la note de conduite (si l'école la fait entrer dans la moyenne) avec son coefficient. Rang = 1 + nombre d'élèves strictement meilleurs (ex æquo = même rang).
"""
from collections import defaultdict

from apps.academics.models import Coefficient, SchoolClass, SchoolSettings, SchoolYear, Subject, Term
from apps.students.models import Enrollment, Student

from apps.discipline import conduct as conduite

from .models import Evaluation, Grade

EPS = 1e-9


def _avg(xs):
    return sum(xs) / len(xs) if xs else None


def _mean(xs):
    """Moyenne pondérée par le coefficient de chaque évaluation : xs = [(note, coef)]. Coefficients égaux : moyenne simple."""
    tot = sum(w for _, w in xs)
    return sum(v * w for v, w in xs) / tot if xs and tot else None


def sur20(value, bareme) -> float:
    """Note ramenée sur 20 depuis le barème de son évaluation (sur 10, 20, 30…)."""
    return float(value) * 20 / (bareme or 20)


def mention(avg, seuils) -> str:
    if avg is None:
        return "—"
    for s, label in zip(seuils, ("Très bien", "Bien", "Assez bien", "Passable")):
        if avg >= s:
            return label
    return "Insuffisant"


def roster(school_class: SchoolClass, year) -> list[Student]:
    """Élèves d'une classe pour une année : l'effectif actuel pour l'année en cours, l'effectif inscrit à l'époque pour une année passée
    (les élèves partis depuis, exclus ou anciens, y figurent donc toujours)."""
    cur = SchoolYear.get_current()
    if cur is not None and year.pk != cur.pk:
        ids = Enrollment.objects.filter(year=year, school_class=school_class).values("student_id")
        found = list(Student.objects.filter(pk__in=ids).order_by("nom", "prenoms"))
        if found or Enrollment.objects.filter(year=year).exists():
            return found
    return list(Student.objects.filter(school_class=school_class, active=True).order_by("nom", "prenoms"))


def class_in_year(student: Student, year) -> SchoolClass:
    """Classe de l'élève pendant une année donnée (sa classe actuelle si l'historique est absent)."""
    e = Enrollment.objects.filter(student=student, year=year).select_related("school_class").first()
    return e.school_class if e and e.school_class_id else student.school_class


def compute_class(school_class: SchoolClass, term: Term, *, only_published: bool, compo_weight: float | None = None) -> dict:
    """Renvoie {effectif, avg, max, min, results: {student_id: {...}}} pour une classe et un trimestre."""
    if compo_weight is None:
        compo_weight = float(SchoolSettings.load().compo_weight)
    students = roster(school_class, term.year)
    coefs = {c.subject_id: c.value for c in Coefficient.objects.filter(groupe=school_class.groupe, cursus_id=school_class.cursus_id)}   # coefficients du cursus de la classe
    subjects = list(Subject.objects.filter(pk__in=coefs).order_by("name"))
    evs = Evaluation.objects.filter(school_class=school_class, term=term)
    if only_published:
        evs = evs.filter(published=True)
    ev_info = {e.pk: (e.subject_id, e.type, float(e.coef), e.bareme) for e in evs}
    notes = defaultdict(lambda: ([], []))  # (student, subject) -> (notes de classe, compositions)
    for ev_id, st_id, val in Grade.objects.filter(evaluation_id__in=ev_info).values_list("evaluation_id", "student_id", "value"):
        subj, typ, w, bareme = ev_info[ev_id]
        notes[(st_id, subj)][1 if typ == "composition" else 0].append((sur20(val, bareme), w))

    cfg = SchoolSettings.load()
    show_conduct = (not only_published) or term.conduct_published      # la famille ne voit la conduite qu'une fois publiée
    removed = conduite.totals([s.pk for s in students], term) if show_conduct else {}
    cmax, ccoef = float(cfg.conduite_max), float(cfg.conduite_coef)

    results = {}
    for st in students:
        subs, points, tot = [], 0.0, 0
        for sb in subjects:
            cn, co = notes.get((st.pk, sb.pk), ([], []))
            mc, compo = _mean(cn), _mean(co)
            moy = mc * (1 - compo_weight) + compo * compo_weight if mc is not None and compo is not None else (mc if mc is not None else compo)
            if moy is not None:
                points += moy * coefs[sb.pk]
                tot += coefs[sb.pk]
            subs.append({"subject": sb.pk, "coef": coefs[sb.pk], "mc": mc, "compo": compo, "moy": moy,
                         "rang": None, "class_moy": None, "class_max": None, "class_min": None})
        cond = None
        if show_conduct:
            note = conduite.note_of(removed.get(st.pk), cfg)
            cond = {"note": note, "max": cmax, "coef": ccoef, "in_average": bool(cfg.conduite_in_average)}
            if cfg.conduite_in_average and tot:      # la conduite compte dans la moyenne dès que l'élève a au moins une note
                points += note * ccoef
                tot += ccoef
        results[st.pk] = {"student": st.pk, "subjects": subs, "moyenne": points / tot if tot else None,
                          "rang": None, "total_points": points, "total_coef": tot, "conduite": cond}

    for i, _sb in enumerate(subjects):
        vals = [r["subjects"][i]["moy"] for r in results.values() if r["subjects"][i]["moy"] is not None]
        cm, mx, mn = _avg(vals), (max(vals) if vals else None), (min(vals) if vals else None)
        for r in results.values():
            s = r["subjects"][i]
            s["class_moy"], s["class_max"], s["class_min"] = cm, mx, mn
            s["rang"] = None if s["moy"] is None else 1 + sum(v > s["moy"] + EPS for v in vals)
    avgs = [r["moyenne"] for r in results.values() if r["moyenne"] is not None]
    for r in results.values():
        r["rang"] = None if r["moyenne"] is None else 1 + sum(v > r["moyenne"] + EPS for v in avgs)
    return {"class": school_class.pk, "term": term.pk, "effectif": len(students), "avg": _avg(avgs),
            "max": max(avgs) if avgs else None, "min": min(avgs) if avgs else None, "results": results}


def weighted_annual(periods: list[dict]) -> float | None:
    """Moyenne annuelle : moyenne des périodes pondérée par leur coefficient (par défaut 1er trimestre 1, les suivants 2).
    Une période sans moyenne est ignorée : la moyenne porte sur les périodes déjà notées."""
    done = [(p["moy"], p["coef"]) for p in periods if p["moy"] is not None]
    tot = sum(c for _, c in done)
    return sum(m * c for m, c in done) / tot if tot else None


def annual_class(school_class: SchoolClass, year, *, only_published: bool = False, compo_weight: float | None = None) -> dict:
    """Bilan annuel d'une classe : pour chaque élève, sa moyenne de chaque période, sa moyenne annuelle pondérée et son rang annuel ;
    et pour la classe, la moyenne, le maximum et le minimum des moyennes annuelles."""
    if compo_weight is None:
        compo_weight = float(SchoolSettings.load().compo_weight)
    terms = list(year.terms.order_by("start", "code"))
    per: dict[int, list[dict]] = {}
    for t in terms:
        res = compute_class(school_class, t, only_published=only_published, compo_weight=compo_weight)["results"]
        for sid, r in res.items():
            per.setdefault(sid, []).append({"code": t.code, "label": t.label, "coef": t.coef, "moy": r["moyenne"]})
    results = {sid: {"periodes": ps, "moyenne": weighted_annual(ps), "count": sum(p["moy"] is not None for p in ps), "rang": None} for sid, ps in per.items()}
    avgs = [r["moyenne"] for r in results.values() if r["moyenne"] is not None]
    for r in results.values():
        r["rang"] = None if r["moyenne"] is None else 1 + sum(v > r["moyenne"] + EPS for v in avgs)
    return {"terms": [{"code": t.code, "label": t.label, "coef": t.coef} for t in terms], "effectif": len(results),
            "avg": _avg(avgs), "max": max(avgs) if avgs else None, "min": min(avgs) if avgs else None, "results": results}


def annual_averages(students, year) -> dict[int, dict]:
    """Moyenne annuelle pondérée de chaque élève (`moyenne`, `count` : nombre de périodes notées), classe par classe."""
    out: dict[int, dict] = {}
    for cl in SchoolClass.objects.filter(pk__in=students.values("school_class_id")):
        out.update(annual_class(cl, year)["results"])
    return out


def is_last_term(term: Term) -> bool:
    """Dernière période de l'année : son bulletin porte le bilan annuel."""
    last = term.year.terms.order_by("-start", "-code").first()
    return last is not None and last.pk == term.pk


def propose_decision(avg, cfg=None, level=None):
    """Proposition de décision de fin d'année d'après les moyennes choisies par l'école (réglages `passage_*`).

    Moyenne d'admission : admis. Entre la moyenne de redoublement et celle d'admission : conseil de classe.
    En dessous : redouble. Si l'école a fixé une moyenne d'exclusion, l'exclusion est proposée en dessous (la direction décide).
    Une école peut prévoir une règle propre à un niveau (`passage_niveaux`) ; sinon la règle générale s'applique."""
    if avg is None:
        return None
    from apps.academics.passage import rule_for
    r = rule_for(cfg or SchoolSettings.load(), level)
    if r["exclusion"] is not None and avg < r["exclusion"]:
        return "exclu"
    if avg >= r["admission"]:
        return "admis"
    return "conseil" if avg >= r["redoublement"] else "redouble"
