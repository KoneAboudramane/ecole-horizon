"""Note de conduite : maximum de l'école − retraits de points de la période. Les retraits viennent des absences non justifiées
(règle de l'école, appliquée sur demande de l'éducateur) et des sanctions disciplinaires (à l'appréciation de l'éducateur)."""

from collections import defaultdict
from decimal import Decimal

from django.db.models import Q
from django.utils import timezone

from apps.academics.models import SchoolSettings

from .models import ConductDeduction

DEFAULT_BAREMES = {"observation": 0.5, "avertissement": 1, "retenue": 1, "travail": 1, "convocation": 1.5, "exclusion_cours": 1.5, "exclusion_temp": 3}


def baremes(cfg=None) -> dict:
    cfg = cfg or SchoolSettings.load()
    return {**DEFAULT_BAREMES, **(cfg.conduite_baremes or {})}


def _half(slot: str, hr) -> str:
    if slot == "Matin":
        return "M"
    if slot == "Après-midi":
        return "A"
    from apps.schedule.lessons import slot_of
    i = slot_of(slot)
    if i is not None and i < len(hr.slots):
        return "M" if hr.slots[i][0] < "12:00" else "A"
    return "M"


def unjustified_halfdays(student_ids, term) -> dict:
    """Nombre de demi-journées d'absence non justifiée (sans justificatif ou refusé) par élève sur la période.
    Plusieurs cours manqués la même demi-journée comptent pour une seule absence."""
    from apps.attendance.models import Absence
    from apps.schedule.views import current_horaires
    hr = current_horaires()
    seen = defaultdict(set)
    rows = Absence.objects.filter(student_id__in=student_ids, status="A", justif__in=("aucune", "refusee"), date__gte=term.start, date__lte=term.end)
    for sid, d, slot in rows.values_list("student_id", "date", "slot"):
        seen[sid].add((d, _half(slot, hr)))
    return {sid: len(v) for sid, v in seen.items()}


def due_points(halfdays: int, cfg) -> Decimal:
    t = cfg.absence_tranche
    return Decimal(halfdays // t) * cfg.absence_points if t else Decimal(0)


def sync_absences(student, term, halfdays: int, cfg, user=None, create: bool = True) -> bool:
    """Aligne le retrait « absences » de l'élève sur la règle de l'école. Sans `create`, ne touche qu'un retrait déjà appliqué
    (la règle s'applique depuis la page Conduite). Renvoie True si quelque chose a changé."""
    due = due_points(halfdays, cfg)
    cur = ConductDeduction.objects.filter(student=student, term=term, kind="absences").first()
    if due <= 0:
        if cur:
            cur.delete()
        return cur is not None
    reason = f"{halfdays} demi-journée(s) d’absence non justifiée(s)"
    if cur is None:
        if not create:
            return False
        ConductDeduction.objects.create(student=student, term=term, points=due, reason=reason, kind="absences", date=min(timezone.localdate(), term.end), by=user)
        return True
    if cur.points == due and cur.reason == reason:
        return False
    cur.points, cur.reason = due, reason
    if user is not None:
        cur.by = user
    cur.save(update_fields=["points", "reason", "by"])
    return True


def refresh_absences(student, term, user=None) -> bool:
    """Après une décision sur un justificatif : met à jour le retrait déjà appliqué à l'élève (sans en créer)."""
    cfg = SchoolSettings.load()
    if not cfg.absence_tranche:
        return False
    return sync_absences(student, term, unjustified_halfdays([student.pk], term).get(student.pk, 0), cfg, user, create=False)


def counted(qs):
    """Retraits qui comptent : ceux d'une sanction refusée ou encore à valider par la direction ne comptent pas."""
    return qs.filter(Q(incident__isnull=True) | Q(incident__status="valide"))


def totals(student_ids, term) -> dict:
    out = defaultdict(Decimal)
    for sid, pts in counted(ConductDeduction.objects.filter(term=term, student_id__in=student_ids)).values_list("student_id", "points"):
        out[sid] += pts
    return out


def note_of(removed, cfg) -> float:
    return max(0.0, float(cfg.conduite_max) - float(removed or 0))
