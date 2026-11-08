"""Règles des devoirs : accès, fichiers, chrono des épreuves, notation automatique. Tout est décidé ici, côté serveur."""
import random
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.academics.models import SchoolSettings
from apps.core.permissions import has_perm
from apps.students.views import visible_students

from .models import Assignment, Submission

MAX_FILE = 5 * 1024 * 1024
FILE_TYPES = {"pdf", "jpg", "jpeg", "png", "doc", "docx", "odt", "txt"}
GRACE = timedelta(seconds=5)   # marge réseau pour la dernière sauvegarde / le dépôt à la seconde près


def check_module():
    if not SchoolSettings.load().devoirs_actifs:
        raise PermissionDenied("Les devoirs et épreuves en ligne ne sont pas ouverts par l’école.")


def check_file(f):
    ext = f.name.rsplit(".", 1)[-1].lower() if "." in f.name else ""
    if ext not in FILE_TYPES:
        raise ValidationError("Type de fichier refusé. Formats acceptés : PDF, images (JPG, PNG), Word, texte.")
    if f.size > MAX_FILE:
        raise ValidationError(f"Fichier trop lourd ({f.size // 1024} Ko). Maximum : {MAX_FILE // 1024 // 1024} Mo.")
    if f.size == 0:
        raise ValidationError("Le fichier est vide.")


def is_owner(user, a: Assignment) -> bool:
    return bool(a.teacher_id and a.teacher.user_id == user.pk)


def can_manage(user, a: Assignment) -> bool:
    return user.role == "enseignant" and is_owner(user, a)


def can_read_results(user, a: Assignment) -> bool:
    return can_manage(user, a) or has_perm(user, "devoirs.read")


def my_student(user, a: Assignment):
    """L'élève connecté, s'il est bien dans la classe du devoir."""
    if user.role != "eleve":
        raise PermissionDenied("Réservé aux élèves.")
    st = visible_students(user).first()
    if st is None or st.school_class_id != a.school_class_id or not a.published:
        raise PermissionDenied("Ce devoir ne concerne pas votre classe.")
    return st


def window(a: Assignment, now=None) -> str:
    now = now or timezone.now()
    return "a_venir" if now < a.opens_at else "ouvert" if now <= a.due_at else "ferme"


def total_points(a: Assignment) -> Decimal:
    if a.kind == "fichier":
        return a.max_points
    return sum((q.points for q in a.questions.all()), Decimal("0"))


def correction_visible(a: Assignment, now=None) -> bool:
    now = now or timezone.now()
    return a.correction == "fin" and now > a.due_at or a.correction == "manuel" and a.correction_open


def clean_answers(a: Assignment, raw) -> dict:
    """Ne garde que des indices valides pour des questions de ce devoir."""
    if not isinstance(raw, dict):
        raise ValidationError("Réponses invalides.")
    out = {}
    for q in a.questions.all():
        v = raw.get(str(q.pk))
        if v is None:
            continue
        if not isinstance(v, list) or any(not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < len(q.choices) for i in v):
            raise ValidationError("Réponses invalides.")
        v = sorted(set(v))
        if q.kind == "vf" and len(v) > 1:
            raise ValidationError("Une seule réponse est possible pour une question vrai ou faux.")
        out[str(q.pk)] = v
    return out


def score_answers(a: Assignment, answers: dict) -> Decimal:
    """Une question rapporte ses points si l'ensemble des réponses cochées est exactement l'ensemble des bonnes réponses."""
    total = Decimal("0")
    for q in a.questions.all():
        if sorted(answers.get(str(q.pk), [])) == sorted(q.correct):
            total += q.points
    return total


def finish(sub: Submission, when=None):
    """Clôt la tentative et la note automatiquement."""
    if sub.finished_at:
        return sub
    sub.finished_at = min(when or timezone.now(), sub.deadline_at or timezone.now())
    sub.score = score_answers(sub.assignment, sub.answers)
    sub.graded_at = sub.finished_at
    sub.save()
    return sub


def settle(qs=None, assignment: Assignment | None = None):
    """Clôt les tentatives dont le temps est écoulé (appelé à chaque lecture : le serveur fait foi, pas le téléphone de l'élève)."""
    qs = qs if qs is not None else Submission.objects.filter(assignment=assignment)
    for s in qs.filter(started_at__isnull=False, finished_at__isnull=True, deadline_at__lt=timezone.now()).select_related("assignment"):
        finish(s)


def question_payload(a: Assignment, sub: Submission, with_answers: bool) -> list[dict]:
    """Questions telles que l'élève les voit : ordre mélangé (le même à chaque reprise), bonnes réponses jamais incluses."""
    qs = list(a.questions.all())
    rng = random.Random(f"{a.pk}-{sub.student_id}")
    if a.shuffle:
        rng.shuffle(qs)
    out = []
    for q in qs:
        idx = list(range(len(q.choices)))
        if a.shuffle and q.kind == "qcm":
            rng.shuffle(idx)
        d = {"id": q.pk, "kind": q.kind, "text": q.text, "points": float(q.points), "multiple": q.kind == "qcm" and len(q.correct) > 1,
             "choices": [{"i": i, "text": q.choices[i]} for i in idx]}
        if with_answers:
            d["correct"] = q.correct
        out.append(d)
    return out


def review(a: Assignment, sub: Submission, show_correct: bool) -> list[dict]:
    """Détail question par question d'une copie (réponses cochées ; bonnes réponses si on a le droit de les montrer)."""
    out = []
    for q in a.questions.all():
        chosen = sub.answers.get(str(q.pk), [])
        ok = sorted(chosen) == sorted(q.correct)
        d = {"id": q.pk, "text": q.text, "kind": q.kind, "points": float(q.points), "choices": q.choices, "chosen": chosen}
        if show_correct:
            d.update(correct=q.correct, ok=ok, earned=float(q.points) if ok else 0.0)
        out.append(d)
    return out


def validate_questions(items) -> list[dict]:
    if not isinstance(items, list) or not items:
        raise ValidationError("Ajoutez au moins une question.")
    if len(items) > 100:
        raise ValidationError("Cent questions au maximum.")
    out = []
    for n, it in enumerate(items, 1):
        if not isinstance(it, dict):
            raise ValidationError(f"Question {n} invalide.")
        kind, text = it.get("kind"), str(it.get("text", "")).strip()
        if kind not in ("qcm", "vf"):
            raise ValidationError(f"Question {n} : type inconnu.")
        if len(text) < 3 or len(text) > 600:
            raise ValidationError(f"Question {n} : l’énoncé est vide ou trop long.")
        choices = ["Vrai", "Faux"] if kind == "vf" else [str(c).strip() for c in it.get("choices", [])]
        if kind == "qcm" and (len(choices) < 2 or len(choices) > 8 or any(not c or len(c) > 200 for c in choices)):
            raise ValidationError(f"Question {n} : proposez de 2 à 8 réponses non vides.")
        correct = it.get("correct", [])
        if not isinstance(correct, list) or not correct or any(not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < len(choices) for i in correct):
            raise ValidationError(f"Question {n} : indiquez la bonne réponse.")
        correct = sorted(set(correct))
        if kind == "vf" and len(correct) != 1:
            raise ValidationError(f"Question {n} : une seule bonne réponse pour un vrai ou faux.")
        try:
            points = Decimal(str(it.get("points", 1)))
        except Exception:
            raise ValidationError(f"Question {n} : points invalides.") from None
        if not Decimal("0.25") <= points <= 20:
            raise ValidationError(f"Question {n} : les points doivent être compris entre 0,25 et 20.")
        out.append(dict(position=n, kind=kind, text=text, choices=choices, correct=correct, points=points))
    return out
