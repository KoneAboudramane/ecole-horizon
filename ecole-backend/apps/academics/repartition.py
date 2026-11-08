"""Répartition des enseignants d'une même matière entre les classes (ex. plusieurs professeurs de maths).
Équilibre la charge en heures par semaine, respecte le maximum d'heures de chacun et garde, autant que possible,
un enseignant sur un même niveau."""

from .models import Coefficient, SchoolClass, Subject, Teacher, TeachingAssignment


def weekly_hours(subject_code: str, coef: int) -> int:
    """Heures par semaine d'une matière dans une classe (coefficient, 5 au plus ; EPS : 2) — comme pour l'emploi du temps."""
    return min(5, 2 if subject_code == "eps" else coef)


def loads():
    """Charge actuelle de chaque enseignant : {teacher_id: {"hours", "classes"}} d'après les affectations."""
    coef = {(c.groupe, c.subject_id): c.value for c in Coefficient.objects.all()}
    out = {t.pk: {"hours": 0, "classes": 0} for t in Teacher.objects.all()}
    for a in TeachingAssignment.objects.select_related("school_class", "subject"):
        h = weekly_hours(a.subject.code, coef.get((a.school_class.groupe, a.subject_id), 0))
        out.setdefault(a.teacher_id, {"hours": 0, "classes": 0})
        out[a.teacher_id]["hours"] += h
        out[a.teacher_id]["classes"] += 1
    return out


def plan(subject_ids=None, reset=False):
    """Propose (sans rien enregistrer) qui enseigne quoi où. Renvoie (affectations, sans_enseignant)
    – affectations : [{"school_class", "subject", "teacher", "hours"}] ; sans_enseignant : [{"school_class", "subject", "why"}]."""
    coef = {(c.groupe, c.subject_id): c.value for c in Coefficient.objects.all()}
    current = {(a.school_class_id, a.subject_id): a.teacher_id for a in TeachingAssignment.objects.all()}
    teachers = {t.pk: t for t in Teacher.objects.prefetch_related("subjects").filter(user__is_active=True)}
    load = {tid: 0 for tid in teachers}
    levels: dict[int, set] = {tid: set() for tid in teachers}
    classes = {c.pk: c for c in SchoolClass.objects.all()}
    subjects = {s.pk: s for s in Subject.objects.all()}
    wanted = {s for (_, s) in coef}
    if subject_ids:
        wanted &= set(subject_ids)
    # charge de départ : ce qui reste en place (hors matières qu'on redistribue entièrement)
    todo = []
    for c in classes.values():
        for sid in wanted:
            if (c.groupe, sid) not in coef:
                continue
            keep = current.get((c.pk, sid)) if not reset else None
            if keep in teachers:
                continue
            todo.append((c, sid))
    todo_keys = {(c.pk, s) for c, s in todo}
    for (cid, sid), tid in current.items():
        if tid in teachers and (cid, sid) not in todo_keys:
            if cid in classes:
                load[tid] += weekly_hours(subjects[sid].code, coef.get((classes[cid].groupe, sid), 0))
                levels[tid].add(classes[cid].level)
    by_code = subjects
    todo.sort(key=lambda x: (-weekly_hours(by_code[x[1]].code, coef[(x[0].groupe, x[1])]), x[0].level, x[0].name))
    out, missing = [], []
    for c, sid in todo:
        sub = by_code[sid]
        h = weekly_hours(sub.code, coef[(c.groupe, sid)])
        able = [t for t in teachers.values() if sid in {s.pk for s in t.subjects.all()}]
        if not able:
            missing.append({"school_class": c.pk, "subject": sid, "why": "aucun_enseignant"})
            continue
        room = [t for t in able if t.max_hours is None or load[t.pk] + h <= t.max_hours]
        if not room:
            missing.append({"school_class": c.pk, "subject": sid, "why": "max_heures"})
            continue
        # le moins chargé d'abord ; à charge égale, celui qui a déjà ce niveau
        best = min(room, key=lambda t: (load[t.pk], c.level not in levels[t.pk], t.pk))
        load[best.pk] += h
        levels[best.pk].add(c.level)
        out.append({"school_class": c.pk, "subject": sid, "teacher": best.pk, "hours": h})
    return out, missing
