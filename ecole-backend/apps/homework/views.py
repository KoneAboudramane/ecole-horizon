from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import SchoolYear, Teacher, TeachingAssignment, Term
from apps.core.log import record
from apps.core.permissions import has_perm, perm_required
from apps.grades.models import Evaluation, Grade
from apps.grades.views import check_unlocked, current_term
from apps.notifications.services import family_users, notify
from apps.students.models import Student
from apps.students.views import visible_students

from . import logic
from .models import Assignment, Question, Submission

OBJ = {200: {"type": "object"}}


# ---------- Présentation ----------
def iso(d):
    return d.isoformat() if d else None


def sub_dict(s: Submission, a: Assignment) -> dict:
    return {"id": s.pk, "student": s.student_id, "status": s.status, "late": s.late, "manual": s.manual, "submitted_at": iso(s.submitted_at),
            "leaves": s.leaves, "started_at": iso(s.started_at), "finished_at": iso(s.finished_at), "deadline_at": iso(s.deadline_at),
            "score": float(s.score) if s.score is not None and s.graded_at else None, "feedback": s.feedback if s.graded_at else "",
            "file_name": s.file_name, "comment": s.comment, "graded": bool(s.graded_at)}


def assignment_dict(a: Assignment, user, mine: list[Submission] | None = None, counts: dict | None = None, detail=False) -> dict:
    qs = list(a.questions.all())
    d = {"id": a.pk, "school_class": a.school_class_id, "subject": a.subject_id, "subject_name": a.subject.name,
         "teacher": a.teacher_id, "teacher_name": a.teacher.user.name if a.teacher_id else "", "kind": a.kind, "title": a.title,
         "instructions": a.instructions, "opens_at": iso(a.opens_at), "due_at": iso(a.due_at), "allow_late": a.allow_late,
         "max_points": float(a.max_points), "duration_min": a.duration_min, "shuffle": a.shuffle, "correction": a.correction,
         "correction_open": a.correction_open, "max_leaves": a.max_leaves, "published": a.published, "has_attachment": bool(a.attachment), "attachment_name": a.attachment_name,
         "question_count": len(qs), "total_points": float(logic.total_points(a)), "window": logic.window(a), "evaluation": a.evaluation_id,
         "server_now": iso(timezone.now())}
    if user.role in ("parent", "eleve"):
        d["mine"] = [sub_dict(s, a) for s in (mine or [])]
        d["correction_visible"] = logic.correction_visible(a)
    elif counts is not None:
        d["counts"] = counts
    if detail and logic.can_read_results(user, a):
        d["questions"] = [{"id": q.pk, "kind": q.kind, "text": q.text, "choices": q.choices, "correct": q.correct, "points": float(q.points)} for q in qs]
    return d


def counts_of(a: Assignment, students: int) -> dict:
    subs = list(a.submissions.all())
    done = [s for s in subs if (s.submitted_at if a.kind == "fichier" else s.finished_at)]
    return {"students": students, "rendus": len(done), "corriges": sum(1 for s in subs if s.graded_at),
            "en_cours": sum(1 for s in subs if a.kind == "epreuve" and s.started_at and not s.finished_at)}


# ---------- Accès ----------
def base_qs():
    return Assignment.objects.select_related("subject", "teacher__user", "school_class").prefetch_related("questions", "submissions")


def get_visible(request, pk, write=False) -> Assignment:
    """Le devoir, s'il est visible par l'utilisateur ; `write` : il doit en être l'enseignant."""
    logic.check_module()
    a = base_qs().filter(pk=pk).first()
    u = request.user
    if a is None:
        raise NotFound()
    if write:
        if not logic.can_manage(u, a):
            raise PermissionDenied("Ce devoir n’est pas le vôtre.")
        return a
    if logic.can_manage(u, a):
        return a
    if not a.published:
        raise NotFound()
    if u.role in ("parent", "eleve"):
        if not visible_students(u).filter(school_class_id=a.school_class_id).exists():
            raise NotFound()
    elif not has_perm(u, "devoirs.read"):
        raise PermissionDenied()
    return a


# ---------- Liste et création ----------
class AssignmentInput(serializers.ModelSerializer):
    class Meta:
        model = Assignment
        fields = ["school_class", "subject", "kind", "title", "instructions", "opens_at", "due_at", "allow_late", "max_points",
                  "duration_min", "shuffle", "correction", "max_leaves"]
        extra_kwargs = {"title": {"min_length": 3}, "instructions": {"max_length": 3000}, "max_points": {"min_value": Decimal("1"), "max_value": Decimal("100")},
                        "duration_min": {"min_value": 1, "max_value": 480}, "max_leaves": {"max_value": 20}}

    def validate(self, a):
        cur = self.instance
        opens = a.get("opens_at", cur.opens_at if cur else timezone.now())
        due = a.get("due_at", cur.due_at if cur else None)
        if due and due <= opens:
            raise serializers.ValidationError({"due_at": "La date limite doit suivre l’ouverture."})
        kind = a.get("kind", cur.kind if cur else None)
        if kind == "epreuve" and not a.get("duration_min", cur.duration_min if cur else None):
            raise serializers.ValidationError({"duration_min": "Indiquez la durée de l’épreuve en minutes."})
        return a


class AssignmentList(APIView):
    """GET `?class=&kind=` : enseignant, ses devoirs ; direction, tous les devoirs envoyés ; parent et élève, ceux de leur classe.
    POST : l'enseignant crée un devoir (brouillon) pour une classe et une matière qu'il enseigne."""

    parser_classes = [JSONParser]

    def get_permissions(self):
        return [perm_required("devoirs.write")()] if self.request.method == "POST" else [IsAuthenticated()]

    @extend_schema(responses=OBJ)
    def get(self, request):
        logic.check_module()
        u, p = request.user, request.query_params
        qs = base_qs()
        if u.role in ("parent", "eleve"):
            qs = qs.filter(published=True, school_class_id__in=visible_students(u).values("school_class_id"))
        elif u.role == "enseignant":
            qs = qs.filter(teacher__user=u)
        elif has_perm(u, "devoirs.read"):
            qs = qs.filter(published=True)
        else:
            raise PermissionDenied()
        for k, f in (("class", "school_class_id"), ("kind", "kind"), ("subject", "subject_id")):
            if p.get(k):
                qs = qs.filter(**{f: p[k]})
        rows = list(qs[:300])
        if u.role in ("parent", "eleve"):
            logic.settle(Submission.objects.filter(assignment__in=rows, student__in=visible_students(u)))
            kids = list(visible_students(u))
            subs = {}
            for s in Submission.objects.filter(assignment__in=rows, student__in=kids).select_related("assignment"):
                subs.setdefault(s.assignment_id, []).append(s)
            return Response([assignment_dict(a, u, [s for s in subs.get(a.pk, []) if s.student_id in {k.pk for k in kids}]) for a in rows])
        logic.settle(Submission.objects.filter(assignment__in=rows))
        sizes = {c["school_class_id"]: c["n"] for c in _class_sizes({a.school_class_id for a in rows})}
        rows = list(base_qs().filter(pk__in=[a.pk for a in rows]))
        return Response([assignment_dict(a, u, counts=counts_of(a, sizes.get(a.school_class_id, 0))) for a in rows])

    @extend_schema(request=AssignmentInput, responses=OBJ)
    def post(self, request):
        logic.check_module()
        ser = AssignmentInput(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if not TeachingAssignment.objects.filter(teacher__user=request.user, school_class=d["school_class"], subject=d["subject"]).exists():
            raise PermissionDenied("Vous n’enseignez pas cette matière dans cette classe.")
        a = ser.save(teacher=Teacher.objects.get(user=request.user))
        record("Devoir", f"{a.title} créé : {a.school_class.name}, {a.subject.name}", request=request)
        return Response(assignment_dict(base_qs().get(pk=a.pk), request.user, counts=counts_of(a, 0), detail=True), status=status.HTTP_201_CREATED)


def _class_sizes(ids):
    from django.db.models import Count
    return Student.objects.filter(school_class_id__in=ids, active=True).values("school_class_id").annotate(n=Count("id"))


def _size(a: Assignment) -> int:
    return Student.objects.filter(school_class_id=a.school_class_id, active=True).count()


class AssignmentDetail(APIView):
    parser_classes = [JSONParser]

    @extend_schema(responses=OBJ)
    def get(self, request, pk):
        a = get_visible(request, pk)
        u = request.user
        logic.settle(assignment=a)
        a = base_qs().get(pk=pk)
        if u.role in ("parent", "eleve"):
            mine = [s for s in a.submissions.all() if s.student_id in set(visible_students(u).values_list("pk", flat=True))]
            return Response(assignment_dict(a, u, mine))
        return Response(assignment_dict(a, u, counts=counts_of(a, _size(a)), detail=True))

    @extend_schema(request=AssignmentInput, responses=OBJ)
    def patch(self, request, pk):
        a = get_visible(request, pk, write=True)
        ser = AssignmentInput(a, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if a.submissions.exists() and any(k in d and d[k] != getattr(a, k) for k in ("kind", "school_class", "subject", "duration_min", "max_points")):
            raise ValidationError("Des élèves ont déjà commencé ou rendu : la classe, la matière, la durée et le barème ne peuvent plus changer.")
        a = ser.save()
        return Response(assignment_dict(base_qs().get(pk=a.pk), request.user, counts=counts_of(a, _size(a)), detail=True))

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        a = get_visible(request, pk, write=True)
        if a.submissions.exists():
            raise ValidationError("Des élèves ont déjà commencé ou rendu ce devoir : il ne peut plus être supprimé.")
        record("Devoir", f"{a.title} supprimé : {a.school_class.name}", request=request)
        a.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class QuestionsView(APIView):
    """PUT `{questions: [...]}` : remplace toutes les questions de l'épreuve (impossible une fois qu'un élève a commencé)."""

    parser_classes = [JSONParser]

    @extend_schema(request=inline_serializer("QuestionsIn", {"questions": serializers.ListField()}), responses=OBJ)
    @transaction.atomic
    def put(self, request, pk):
        a = get_visible(request, pk, write=True)
        if a.kind != "epreuve":
            raise ValidationError("Seules les épreuves en ligne ont des questions.")
        if a.submissions.exists():
            raise ValidationError("Des élèves ont déjà commencé : les questions ne peuvent plus changer.")
        items = logic.validate_questions(request.data.get("questions"))
        a.questions.all().delete()
        Question.objects.bulk_create([Question(assignment=a, **it) for it in items])
        return Response(assignment_dict(base_qs().get(pk=pk), request.user, counts=counts_of(a, _size(a)), detail=True))


class SendView(APIView):
    @extend_schema(request=None, responses=OBJ)
    def post(self, request, pk):
        a = get_visible(request, pk, write=True)
        if a.published:
            raise ValidationError("Ce devoir est déjà envoyé.")
        if a.due_at <= timezone.now():
            raise ValidationError("La date limite est déjà passée : modifiez-la avant d’envoyer.")
        if a.kind == "epreuve":
            if not a.questions.exists():
                raise ValidationError("Ajoutez au moins une question avant d’envoyer l’épreuve.")
            if not a.duration_min:
                raise ValidationError("Indiquez la durée de l’épreuve.")
        a.published = True
        a.save(update_fields=["published"])
        studs = Student.objects.filter(school_class=a.school_class, active=True).select_related("parent__user", "user")
        who = [x for s in studs for x in family_users(s)]
        what = "épreuve en ligne" if a.kind == "epreuve" else "devoir"
        notify(who, f"Nouveau {what} en {a.subject.name} ({a.school_class.name}) : « {a.title} », à rendre avant le {timezone.localtime(a.due_at):%d/%m/%Y à %H:%M}.", "annonce", "devoirs")
        record("Devoir", f"{a.title} envoyé : {a.school_class.name}", request=request)
        return Response(assignment_dict(base_qs().get(pk=pk), request.user, counts=counts_of(a, studs.count()), detail=True))


# ---------- Fichiers ----------
def file_response(f, name):
    r = FileResponse(f.open("rb"), as_attachment=True, filename=name or "fichier")
    r["X-Content-Type-Options"] = "nosniff"
    return r


class AttachmentView(APIView):
    """GET : télécharge la pièce jointe du sujet. POST (multipart `file`) / DELETE : l'enseignant la remplace ou la retire."""

    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(responses={200: {"type": "string", "format": "binary"}})
    def get(self, request, pk):
        a = get_visible(request, pk)
        if not a.attachment:
            raise NotFound()
        return file_response(a.attachment, a.attachment_name)

    @extend_schema(request={"multipart/form-data": inline_serializer("AttachIn", {"file": serializers.FileField()})}, responses=OBJ)
    def post(self, request, pk):
        a = get_visible(request, pk, write=True)
        f = request.FILES.get("file")
        if not f:
            raise ValidationError("Choisissez un fichier.")
        logic.check_file(f)
        if a.attachment:
            a.attachment.delete(save=False)
        a.attachment.save(f.name, f, save=False)
        a.attachment_name = f.name[:200]
        a.save()
        return Response(assignment_dict(base_qs().get(pk=pk), request.user, counts=counts_of(a, _size(a)), detail=True))

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        a = get_visible(request, pk, write=True)
        if a.attachment:
            a.attachment.delete(save=False)
        a.attachment_name = ""
        a.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


def student_ids_of(user) -> set:
    return set(visible_students(user).values_list("pk", flat=True))


def get_sub(request, pk) -> Submission:
    logic.check_module()
    s = Submission.objects.select_related("assignment__teacher__user", "student").filter(pk=pk).first()
    if s is None:
        raise NotFound()
    u = request.user
    if not (logic.can_read_results(u, s.assignment) or (u.role in ("parent", "eleve") and s.student_id in student_ids_of(u))):
        raise NotFound()
    return s


class SubmissionFile(APIView):
    @extend_schema(responses={200: {"type": "string", "format": "binary"}})
    def get(self, request, pk):
        s = get_sub(request, pk)
        if not s.file:
            raise NotFound()
        return file_response(s.file, s.file_name)


# ---------- Côté élève ----------
class SubmitView(APIView):
    """POST multipart `file` (+ `comment`) : l'élève rend sa copie ; il peut la remplacer tant que la porte est ouverte et qu'elle n'est pas corrigée."""

    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(request={"multipart/form-data": inline_serializer("SubmitIn", {"file": serializers.FileField(), "comment": serializers.CharField(required=False)})}, responses=OBJ)
    @transaction.atomic
    def post(self, request, pk):
        logic.check_module()
        a = base_qs().filter(pk=pk).first()
        if a is None:
            raise NotFound()
        st = logic.my_student(request.user, a)
        if a.kind != "fichier":
            raise ValidationError("Cette épreuve se passe en ligne : utilisez « Démarrer ».")
        now = timezone.now()
        if now < a.opens_at:
            raise ValidationError("Ce devoir n’est pas encore ouvert.")
        late = now > a.due_at + logic.GRACE
        if late and not a.allow_late:
            raise ValidationError("La date limite est passée : ce devoir n’accepte plus de copie.")
        f = request.FILES.get("file")
        if not f:
            raise ValidationError("Choisissez le fichier de votre copie.")
        logic.check_file(f)
        sub = Submission.objects.select_for_update().filter(assignment=a, student=st).first() or Submission(assignment=a, student=st)
        if sub.graded_at:
            raise ValidationError("Votre copie est déjà corrigée : elle ne peut plus être remplacée.")
        if sub.file:
            sub.file.delete(save=False)
        sub.file.save(f.name, f, save=False)
        sub.file_name, sub.comment = f.name[:200], str(request.data.get("comment", ""))[:500]
        sub.submitted_at, sub.late, sub.manual = now, late, False
        sub.save()
        teacher = a.teacher.user if a.teacher_id else None
        if teacher:
            notify([teacher], f"{st.prenoms} {st.nom} a rendu « {a.title} » ({a.school_class.name}){' en retard' if late else ''}.", "systeme", "devoirs")
        return Response(sub_dict(sub, a))


class AttemptView(APIView):
    """POST : l'élève démarre l'épreuve (ou la reprend après une coupure) ; le temps est compté par le serveur depuis le premier démarrage."""

    @extend_schema(request=None, responses=OBJ)
    def post(self, request, pk):
        logic.check_module()
        a = base_qs().filter(pk=pk).first()
        if a is None:
            raise NotFound()
        st = logic.my_student(request.user, a)
        if a.kind != "epreuve":
            raise ValidationError("Ce devoir se rend en fichier.")
        now = timezone.now()
        problem = None
        with transaction.atomic():   # la clôture d'une tentative expirée doit être enregistrée même quand on répond par une erreur
            sub = Submission.objects.select_for_update().filter(assignment=a, student=st).first()
            if sub is None:
                if now < a.opens_at:
                    problem = "L’épreuve n’est pas encore ouverte."
                elif now > a.due_at:
                    problem = "L’épreuve est fermée."
                else:
                    sub = Submission.objects.create(assignment=a, student=st, started_at=now, deadline_at=min(now + timedelta(minutes=a.duration_min), a.due_at))
            if sub is not None:
                logic.settle(Submission.objects.filter(pk=sub.pk))
                sub.refresh_from_db()
                if sub.finished_at:
                    problem = "Vous avez déjà terminé cette épreuve."
        if problem:
            raise ValidationError(problem)
        return Response({**sub_dict(sub, a), "questions": logic.question_payload(a, sub, False), "answers": sub.answers,
                         "remaining": max(0, int((sub.deadline_at - now).total_seconds())), "server_now": iso(now)})


class AnswersView(APIView):
    """PUT `{answers: {id_question: [indices]}}` : sauvegarde les réponses cochées tant que le temps n'est pas écoulé."""

    @extend_schema(request=inline_serializer("AnswersIn", {"answers": serializers.DictField()}), responses=OBJ)
    def put(self, request, pk):
        logic.check_module()
        a = base_qs().filter(pk=pk).first()
        if a is None:
            raise NotFound()
        st = logic.my_student(request.user, a)
        with transaction.atomic():
            sub = Submission.objects.select_for_update().filter(assignment=a, student=st).first()
            if sub is None or not sub.started_at:
                raise ValidationError("Démarrez d’abord l’épreuve.")
            if sub.finished_at or timezone.now() > sub.deadline_at + logic.GRACE:
                logic.finish(sub)
                over = True
            else:
                over = False
                sub.answers = logic.clean_answers(a, request.data.get("answers"))
                sub.save(update_fields=["answers"])
        if over:
            raise ValidationError("Le temps est écoulé : votre copie a été rendue automatiquement.")
        return Response({"saved": True, "remaining": max(0, int((sub.deadline_at - timezone.now()).total_seconds()))})


class LeaveView(APIView):
    """POST : le navigateur de l'élève signale qu'il a quitté la page de l'épreuve. Au-delà du seuil fixé par l'enseignant, la copie est rendue d'office."""

    @extend_schema(request=None, responses=OBJ)
    def post(self, request, pk):
        logic.check_module()
        a = base_qs().filter(pk=pk).first()
        if a is None:
            raise NotFound()
        st = logic.my_student(request.user, a)
        with transaction.atomic():
            sub = Submission.objects.select_for_update().filter(assignment=a, student=st).first()
            if sub is None or not sub.started_at or sub.finished_at:
                raise ValidationError("Aucune épreuve en cours.")
            sub.leaves += 1
            sub.save(update_fields=["leaves"])
            over = bool(a.max_leaves) and sub.leaves >= a.max_leaves
            if over:
                logic.finish(sub)
        return Response({"leaves": sub.leaves, "max_leaves": a.max_leaves, "finished": over})


class FinishView(APIView):
    @extend_schema(request=inline_serializer("FinishIn", {"answers": serializers.DictField(required=False)}), responses=OBJ)
    @transaction.atomic
    def post(self, request, pk):
        logic.check_module()
        a = base_qs().filter(pk=pk).first()
        if a is None:
            raise NotFound()
        st = logic.my_student(request.user, a)
        sub = Submission.objects.select_for_update().filter(assignment=a, student=st).first()
        if sub is None or not sub.started_at:
            raise ValidationError("Démarrez d’abord l’épreuve.")
        if not sub.finished_at:
            if "answers" in request.data and timezone.now() <= sub.deadline_at + logic.GRACE:
                sub.answers = logic.clean_answers(a, request.data["answers"])
            logic.finish(sub)
        return Response(sub_dict(sub, a))


# ---------- Résultats et corrections (enseignant) ----------
def detail_for(sub: Submission, a: Assignment, show_correct: bool) -> dict:
    return {**sub_dict(sub, a), "answers": logic.review(a, sub, show_correct) if a.kind == "epreuve" else []}


class SubmissionsView(APIView):
    """GET : un élève par ligne (rendu ou non), les notes et, pour une épreuve, le taux de réussite par question."""

    @extend_schema(responses=OBJ)
    def get(self, request, pk):
        a = get_visible(request, pk)
        if not logic.can_read_results(request.user, a):
            raise PermissionDenied()
        logic.settle(assignment=a)
        subs = {s.student_id: s for s in Submission.objects.filter(assignment=a)}
        rows = []
        for st in Student.objects.filter(school_class_id=a.school_class_id, active=True).order_by("nom", "prenoms"):
            s = subs.get(st.pk)
            rows.append({"student": st.pk, "name": f"{st.nom} {st.prenoms}", **(sub_dict(s, a) if s else {"id": None, "status": "a_faire", "score": None, "graded": False,
                         "late": False, "feedback": "", "file_name": "", "comment": "", "submitted_at": None, "started_at": None, "finished_at": None, "manual": False})})
        scores = [r["score"] for r in rows if r["score"] is not None]
        out = {"rows": rows, "max": float(logic.total_points(a)), "average": round(sum(scores) / len(scores), 2) if scores else None}
        if a.kind == "epreuve":
            done = [s for s in subs.values() if s.finished_at]
            out["questions"] = [{"id": q.pk, "text": q.text, "success": round(100 * sum(1 for s in done if sorted(s.answers.get(str(q.pk), [])) == sorted(q.correct)) / len(done)) if done else None}
                                for q in a.questions.all()]
        return Response(out)


class SubmissionDetail(APIView):
    """GET : la copie d'un élève avec ses réponses. L'enseignant voit toujours le corrigé ; l'élève et ses parents seulement quand l'école/enseignant l'a ouvert."""

    @extend_schema(responses=OBJ)
    def get(self, request, pk):
        s = get_sub(request, pk)
        a = s.assignment
        logic.settle(Submission.objects.filter(pk=s.pk))
        s.refresh_from_db()
        staff = logic.can_read_results(request.user, a)
        if not staff:
            if not s.finished_at:
                raise PermissionDenied("Copie non terminée.")
            if not logic.correction_visible(a):
                raise PermissionDenied("Le corrigé n’est pas encore ouvert.")
        return Response(detail_for(s, a, True))


class GradeInput(serializers.Serializer):
    student = serializers.IntegerField()
    score = serializers.DecimalField(max_digits=6, decimal_places=2, allow_null=True, min_value=0)
    feedback = serializers.CharField(max_length=500, allow_blank=True, required=False, default="")


class GradesView(APIView):
    """PUT `{grades: [{student, score|null, feedback}]}` : l'enseignant note les copies, y compris celle d'un élève qui a rendu sur papier."""

    @extend_schema(request=inline_serializer("GradesIn", {"grades": GradeInput(many=True)}), responses=OBJ)
    @transaction.atomic
    def put(self, request, pk):
        a = get_visible(request, pk, write=True)
        ser = GradeInput(data=request.data.get("grades", []), many=True)
        ser.is_valid(raise_exception=True)
        top = logic.total_points(a)
        valid = set(Student.objects.filter(school_class_id=a.school_class_id, active=True).values_list("pk", flat=True))
        newly = []
        now = timezone.now()
        for g in ser.validated_data:
            if g["student"] not in valid:
                raise ValidationError("Certains élèves n’appartiennent pas à cette classe.")
            if g["score"] is not None and g["score"] > top:
                raise ValidationError(f"Une note ne peut pas dépasser {top:g}.")
            s = Submission.objects.filter(assignment=a, student_id=g["student"]).first()
            if g["score"] is None:
                if s and s.manual and not s.submitted_at and not s.file:
                    s.delete()
                elif s:
                    s.score, s.graded_at, s.feedback = None, None, ""
                    s.save()
                continue
            s = s or Submission(assignment=a, student_id=g["student"], manual=True)
            first = not s.graded_at
            if a.kind == "epreuve" and not s.finished_at:
                s.finished_at = s.started_at or now   # note saisie à la main pour une épreuve passée sur papier
            s.score, s.feedback, s.graded_at = g["score"], g["feedback"], now
            s.save()
            if first:
                newly.append(s.student_id)
        if newly:
            studs = Student.objects.filter(pk__in=newly).select_related("parent__user", "user")
            notify([x for st in studs for x in family_users(st)], f"« {a.title} » ({a.subject.name}) est corrigé : consultez la note.", "note", "devoirs")
        return Response({"changed": len(ser.validated_data)})


class CorrectionView(APIView):
    @extend_schema(request=inline_serializer("CorrectionIn", {"open": serializers.BooleanField()}), responses=OBJ)
    def post(self, request, pk):
        a = get_visible(request, pk, write=True)
        a.correction_open = bool(request.data.get("open"))
        a.save(update_fields=["correction_open"])
        return Response({"correction_open": a.correction_open})


class ToGradesView(APIView):
    """Reporte les notes corrigées dans le carnet de notes de la classe (une évaluation « devoir », notes ramenées sur 20)."""

    @extend_schema(request=inline_serializer("ToGradesIn", {"type": serializers.CharField(required=False)}), responses=OBJ)
    @transaction.atomic
    def post(self, request, pk):
        a = get_visible(request, pk, write=True)
        if not TeachingAssignment.objects.filter(teacher__user=request.user, school_class_id=a.school_class_id, subject_id=a.subject_id).exists():
            raise PermissionDenied("Vous n’enseignez plus cette matière dans cette classe.")
        logic.settle(assignment=a)
        subs = list(Submission.objects.filter(assignment=a, graded_at__isnull=False, score__isnull=False))
        if not subs:
            raise ValidationError("Aucune copie n’est encore notée.")
        day = timezone.localtime(a.due_at).date()
        term = Term.objects.filter(year=SchoolYear.get_current(), start__lte=day, end__gte=day).first()
        term = term or current_term(None)
        check_unlocked(request.user, term)
        typ = request.data.get("type") if request.data.get("type") in ("interro", "devoir", "composition") else "devoir"
        ev = a.evaluation
        if ev is None:
            ev = Evaluation.objects.create(school_class=a.school_class, subject=a.subject, term=term, type=typ, title=a.title[:80], date=day, teacher=a.teacher)
            a.evaluation = ev
            a.save(update_fields=["evaluation"])
        else:
            check_unlocked(request.user, ev.term)
            if ev.teacher_id and ev.teacher.user_id != request.user.pk:
                raise PermissionDenied("Ces notes appartiennent à l’enseignant de l’évaluation : lui seul peut les modifier.")
        top = logic.total_points(a)
        for s in subs:
            Grade.objects.update_or_create(evaluation=ev, student_id=s.student_id, defaults={"value": (s.score / top * ev.bareme).quantize(Decimal("0.01"))})
        record("Devoir", f"{a.title} : {len(subs)} note(s) reportée(s) dans le carnet ({a.school_class.name})", request=request)
        return Response({"evaluation": ev.pk, "grades": len(subs), "published": ev.published})
