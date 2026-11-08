"""Résultats des examens blancs (port de MockExams.result du prototype). Moyenne calculée seulement quand toutes les
matières de la classe sont notées ; arrondie au centième ; admissible dès 10 ; ex æquo = même rang."""
from apps.academics.models import SchoolSettings, Subject
from apps.students.models import Student

from .models import MockMark

def column_of(per_serie: bool, school_class, coefs=None) -> str:
    """Colonne de coefficients d'une classe : sa série pour un examen « par série » (comme le BAC), sinon la colonne commune « * »
    (ou la série si l'école a prévu une colonne pour elle)."""
    if per_serie:
        return school_class.serie or "*"
    return school_class.serie if school_class.serie and coefs and school_class.serie in coefs else "*"


def eligible(exam_type, school_class) -> bool:
    """Classe concernée : l'un des niveaux du type d'examen ; « Autre examen » (pas de type) : toutes les classes."""
    return exam_type is None or not exam_type.levels or school_class.level in exam_type.levels


def subjects_for(session, school_class) -> list[dict]:
    co = session.coefs.get(column_of(session.per_serie, school_class, session.coefs), {})
    subs = Subject.objects.filter(code__in=[k for k, v in co.items() if v > 0]).order_by("id")
    return sorted(({"id": s.pk, "code": s.code, "name": s.name, "short": s.short, "coef": co[s.code]} for s in subs), key=lambda x: -x["coef"])


def mention(avg, seuils):
    if avg is None:
        return "—"
    for t, label in zip(seuils, ("Très bien", "Bien", "Assez bien", "Passable")):
        if avg >= t:
            return label
    return "Insuffisant"


def result(session, school_class) -> dict:
    subjects = subjects_for(session, school_class)
    seuils = SchoolSettings.load().seuils
    students = list(Student.objects.filter(school_class=school_class, active=True).order_by("nom", "prenoms"))
    marks = {(m.student_id, m.subject_id): float(m.value) for m in MockMark.objects.filter(session=session, student__in=students)}
    rows = []
    for st in students:
        ms = [marks.get((st.pk, sb["id"])) for sb in subjects]
        filled = sum(m is not None for m in ms)
        avg = None
        if subjects and filled == len(subjects):
            avg = round(sum(m * sb["coef"] for m, sb in zip(ms, subjects)) / sum(sb["coef"] for sb in subjects) + 1e-9, 2)
        rows.append({"student": st.pk, "name": st.full_name, "marks": ms, "filled": filled, "avg": avg, "mention": mention(avg, seuils),
                     "admissible": None if avg is None else avg >= 10, "rank": None})
    done = sorted((r for r in rows if r["avg"] is not None), key=lambda r: -r["avg"])
    for i, r in enumerate(done):
        r["rank"] = done[i - 1]["rank"] if i and done[i - 1]["avg"] == r["avg"] else i + 1
    avgs = [r["avg"] for r in done]
    admis = sum(1 for r in done if r["admissible"])
    return {"class": school_class.pk, "subjects": subjects, "rows": rows, "effectif": len(students), "complete": len(done),
            "avg": round(sum(avgs) / len(avgs), 2) if avgs else None, "max": max(avgs) if avgs else None,
            "min": min(avgs) if avgs else None, "admis": admis, "rate": round(100 * admis / len(done)) if done else None}


def progress(session, school_class, subject_id) -> dict:
    ids = Student.objects.filter(school_class=school_class, active=True).values_list("pk", flat=True)
    return {"done": MockMark.objects.filter(session=session, subject_id=subject_id, student__in=ids).count(), "total": len(ids)}
