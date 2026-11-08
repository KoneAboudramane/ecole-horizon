"""Échéancier d'un élève. Mêmes règles que le prototype (engine.ts) ; les montants sont des entiers en FCFA."""
from datetime import date
from math import floor

from apps.academics import tranches as tr
from apps.academics.models import SchoolSettings, SchoolYear
from apps.core.tenancy import cursus_context
from apps.students.models import ENROLLED, Enrollment, Student

from .models import FeeDate, Payment, Tarif


def js_round(x: float) -> int:
    """Arrondi « demi vers le haut » comme Math.round (Python arrondit au pair le plus proche)."""
    return floor(x + 0.5)


def sibling_pct(student: Student, pct: int | None = None) -> int:
    """Remise fratrie : à partir du 2e enfant (ordre d'inscription) d'un même parent ; l'inscription n'est pas remisée."""
    if pct is None:
        pct = SchoolSettings.load().remise_fratrie
    if not pct:
        return 0
    with cursus_context(None):     # les enfants de la famille, tous cursus confondus ; un enfant = une personne
        first = Student.objects.filter(ENROLLED, parent=student.parent_id, principal__isnull=True).order_by("id").values_list("id", flat=True).first()
    student = student.principal or student
    return min(100, pct) if first is not None and first != student.pk else 0


def school_tranches() -> list[dict]:
    return SchoolSettings.load().tranches or tr.default_tranches()


def fee_keys() -> list[tuple[str, str]]:
    return tr.keys(school_tranches())


def fee_dates() -> dict[str, date | None]:
    y = SchoolYear.get_current()
    found = {d.key: d.date for d in FeeDate.objects.filter(year=y)} if y else {}
    return {k: found.get(k) for k, _ in fee_keys()}


def split(sco: int, parts: list[int]) -> list[int]:
    """Partage la scolarité au prorata des parts ; la dernière tranche reçoit le reste."""
    total, out = sum(parts), []
    for p in parts[:-1]:
        out.append(js_round(sco * p / total))
    out.append(sco - sum(out))
    return out


def report_of(student: Student, year=None) -> int:
    """Solde reporté de l'année précédente (fixé au passage à l'année suivante)."""
    year = year or SchoolYear.get_current()
    return Enrollment.objects.filter(student=student, year=year).values_list("report", flat=True).first() or 0 if year else 0


def report_due(year=None) -> date | None:
    """Échéance du solde reporté : le début de la première période de la nouvelle année."""
    year = year or SchoolYear.get_current()
    t = year.terms.order_by("start").first() if year else None
    return t.start if t else None


def fee_items(tarif: Tarif | None, dates: dict, discount_pct: int = 0, tranches: list[dict] | None = None, report: int = 0, report_date: date | None = None,
              extra: int = 0) -> list[dict]:
    """Échéances de l'année. `extra` : compléments des autres cursus suivis (forfait global), répartis avec la scolarité."""
    ins, sco = (tarif.ins, tarif.sco) if tarif else (0, 0)
    if discount_pct > 0:
        sco = js_round(sco * (1 - discount_pct / 100) / 100) * 100
    sco += extra
    tranches = tranches if tranches is not None else school_tranches()
    amounts = [ins, *split(sco, [t["part"] for t in tranches])]
    items = [{"key": k, "label": label, "due": dates.get(k), "amount": a} for (k, label), a in zip(tr.keys(tranches), amounts)]
    if report > 0:   # la dette de l'an passé est réglée en premier (les versements couvrent les échéances dans l'ordre)
        items.insert(0, {"key": "REP", "label": "Solde de l’année précédente", "due": report_date or date.min, "amount": report})
    return items


def allocate(items: list[dict], paid_total: int, today: date) -> list[dict]:
    """Les paiements confirmés couvrent les échéances dans l'ordre, de la plus ancienne à la plus récente."""
    left, out = paid_total, []
    for it in items:
        paid = min(it["amount"], max(0, left))
        left -= paid
        rem = it["amount"] - paid
        out.append({**it, "paid": paid, "remaining": rem, "overdue": bool(rem > 0 and it["due"] and it["due"] <= today)})
    return out


def credit_of(student: Student, year=None) -> int:
    """Avance reportée de l'année précédente (paiement en trop gardé par la famille)."""
    year = year or SchoolYear.get_current()
    return Enrollment.objects.filter(student=student, year=year).values_list("credit", flat=True).first() or 0 if year else 0


def paid_total(student: Student, year=None) -> int:
    """Paiements confirmés de l'année scolaire (l'année en cours par défaut), avance de l'an passé comprise."""
    year = year or SchoolYear.get_current()
    return sum(Payment.objects.filter(student=student, year=year, status="confirme").values_list("amount", flat=True)) + credit_of(student, year)


def tarif_of(student: Student) -> Tarif | None:
    """Tarif du niveau de l'élève dans SON cursus."""
    with cursus_context(student.cursus_id):
        return Tarif.objects.filter(level=student.current_level).first()


def complement_of(t: Tarif | None) -> int:
    """Ce que coûte un cursus suivi en plus d'un autre : le complément fixé par l'école, sinon le tarif complet."""
    return 0 if t is None else t.complement if t.complement is not None else t.ins + t.sco


def forfait(student: Student) -> tuple[Student, Student, list[dict]]:
    """Forfait global d'une personne inscrite dans plusieurs cursus : (inscription qui porte le compte, inscription payée au tarif
    complet, compléments des autres cursus suivis). Le tarif complet est celui du cursus principal ; si l'élève l'a quitté mais
    suit encore un autre cursus, c'est celui de cet autre cursus."""
    root = student.principal or student
    ins = list(root.inscriptions())
    enrolled = [s for s in ins if s.active or s.sortie == "placer"]
    main = root if not enrolled or any(s.pk == root.pk for s in enrolled) else enrolled[0]
    extras = [{"cursus": s.cursus.nom if s.cursus_id else "", "level": s.current_level, "amount": complement_of(tarif_of(s))}
              for s in enrolled if s.pk != main.pk]
    return root, main, extras


def account(student: Student, today: date, *, paid: int | None = None, pct: int | None = None, tarif=None, dates=None, tranches=None, report: int | None = None, report_date=None) -> dict:
    """Situation financière d'un élève : lignes, total, payé, solde, retard, remise. École à plusieurs cursus : un seul compte par
    personne (porté par l'inscription principale), avec le forfait global de tous ses cursus (`cursus_detail`)."""
    root, main, extras = forfait(student)
    with cursus_context(root.cursus_id):
        tarif = tarif if tarif is not None else tarif_of(main)
        dates = dates if dates is not None else fee_dates()
        pct = sibling_pct(root) if pct is None else pct
        paid = paid_total(root) if paid is None else paid
        tranches = tranches if tranches is not None else school_tranches()
        report = report_of(root) if report is None else report
    report_date = report_date or (report_due() if report else None)
    extra = sum(e["amount"] for e in extras)
    lines = allocate(fee_items(tarif, dates, pct, tranches, report, report_date, extra), paid, today)
    total = sum(line["amount"] for line in lines)
    full = sum(line["amount"] for line in fee_items(tarif, dates, 0, tranches, report, report_date, extra))
    detail = []
    if extras:
        own = sum(i["amount"] for i in fee_items(tarif, dates, pct, tranches, 0, None)) if tarif else 0
        detail = [{"cursus": main.cursus.nom if main.cursus_id else "", "level": main.current_level, "label": "Scolarité", "amount": own},
                  *({**e, "label": "Complément"} for e in extras)]
    return {"student": root.pk, "lines": lines, "total": total, "paid": paid, "balance": max(0, total - paid), "credit": max(0, paid - total),
            "overdue": sum(line["remaining"] for line in lines if line["overdue"]),
            "discount_pct": pct, "discount_amount": full - total, "cursus_detail": detail}


def payment_detail(student: Student, paid_before: int, amount: int, today: date, **kw) -> dict:
    """Ce qu'un paiement a réglé, échéance par échéance (les versements couvrent les échéances de la plus ancienne à la plus récente),
    et ce qui reste ensuite. Figé sur le reçu au moment du paiement."""
    a0 = account(student, today, paid=paid_before, **kw)
    a1 = account(student, today, paid=paid_before + amount, **kw)
    lines = [{"key": l1["key"], "label": l1["label"], "due": l1["due"].isoformat() if l1["due"] and l1["due"] != date.min else None, "amount": l1["amount"],
              "paid_before": l0["paid"], "paid_now": l1["paid"] - l0["paid"], "remaining": l1["remaining"]} for l0, l1 in zip(a0["lines"], a1["lines"])]
    nxt = next(({"label": l["label"], "due": l["due"], "remaining": l["remaining"]} for l in lines if l["remaining"] > 0), None)
    return {"lines": lines, "total": a1["total"], "paid_before": paid_before, "paid_after": a1["paid"], "remaining": a1["balance"], "credit": a1["credit"],
            "discount_pct": a1["discount_pct"], "discount_amount": a1["discount_amount"], "next": nxt}


def detail_of(payment: Payment, today: date) -> dict | None:
    """Détail figé du reçu ; pour un paiement ancien sans détail, reconstitué (année en cours seulement) d'après les paiements précédents."""
    if payment.detail:
        return payment.detail
    if payment.year_id is None or payment.year_id != (SchoolYear.get_current() or payment.year).pk:
        return None
    before = Payment.objects.filter(student=payment.student, year=payment.year, status="confirme").filter(
        models_q(payment)).values_list("amount", flat=True)
    return {**payment_detail(payment.student, sum(before) + credit_of(payment.student, payment.year), payment.amount, today), "reconstructed": True}


def models_q(p: Payment):
    from django.db.models import Q
    return Q(date__lt=p.date) | Q(date=p.date, id__lt=p.id)
