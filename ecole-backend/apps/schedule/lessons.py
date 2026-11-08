"""Cours d'une journée, déduits de l'emploi du temps des classes (jamais saisis à la main) :
l'emploi du temps d'un enseignant, ses appels et son cahier de textes en découlent."""

import re

from apps.academics.models import TeachingAssignment

from .models import Cell, Replacement

CODE = re.compile(r"^C([1-9])$")


def code_of(slot: int) -> str:
    return f"C{slot + 1}"


def slot_of(code: str):
    m = CODE.match(code or "")
    return int(m.group(1)) - 1 if m else None


def lessons(date, hr, teacher_id=None, class_id=None):
    """Cours du jour, groupés par heures consécutives d'une même matière dans une même classe.
    Chaque cours : classe, matière, créneaux, enseignant effectif (le remplaçant s'il y en a un) et titulaire."""
    cells = Cell.objects.filter(day=date.weekday()).select_related("school_class", "subject")
    if class_id:
        cells = cells.filter(school_class_id=class_id)
    owner = {(a.school_class_id, a.subject_id): a.teacher_id for a in TeachingAssignment.objects.all()}
    repl = {(r.school_class_id, r.slot): r for r in Replacement.objects.filter(date=date).select_related("teacher__user")}
    rows = []
    for c in sorted(cells, key=lambda c: (c.school_class_id, c.slot)):
        if not hr.is_open(c.day, c.slot):
            continue
        titular = owner.get((c.school_class_id, c.subject_id))
        r = repl.get((c.school_class_id, c.slot))
        eff = r.teacher_id if r else titular
        last = rows[-1] if rows else None
        if last and last["school_class"] == c.school_class_id and last["subject"] == c.subject_id and last["slots"][-1] == c.slot - 1 \
                and last["teacher"] == eff and last["titular"] == titular and last["room"] == c.room:
            last["slots"].append(c.slot)
            continue
        rows.append({"school_class": c.school_class_id, "class_name": c.school_class.name, "subject": c.subject_id, "subject_name": c.subject.name,
                     "slots": [c.slot], "room": c.room, "teacher": eff, "titular": titular,
                     "replacement": r.pk if r else None, "replacement_name": r.teacher.user.name if r else ""})
    if teacher_id:
        rows = [x for x in rows if teacher_id in (x["teacher"], x["titular"])]
    for x in rows:
        x["slot"] = x["slots"][0]
        x["code"] = code_of(x["slot"])
        x["start"], x["end"] = hr.slots[x["slots"][0]][0], hr.slots[x["slots"][-1]][1]
        x["replaced_out"] = bool(x["replacement"]) and x["titular"] == teacher_id and x["teacher"] != teacher_id
    return rows


def may_teach(user, school_class_id, date, code) -> bool:
    """Cet enseignant tient-il cette classe à ce créneau (titulaire du cours ou remplaçant) ?"""
    slot = slot_of(code)
    if slot is None:
        return False
    cell = Cell.objects.filter(school_class_id=school_class_id, day=date.weekday(), slot=slot).first()
    if not cell:
        return False
    r = Replacement.objects.filter(school_class_id=school_class_id, date=date, slot=slot).first()
    if r:
        return r.teacher.user_id == user.pk
    return TeachingAssignment.objects.filter(teacher__user=user, school_class_id=school_class_id, subject_id=cell.subject_id).exists()
