from decimal import Decimal

from django.conf import settings
from django.core import signing
from django.db import transaction
from django.db.models import Exists, OuterRef
from django.http import HttpResponse
from django.utils import timezone
from django.utils.html import escape
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import generics, permissions, serializers, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import Coefficient, SchoolClass, SchoolSettings, SchoolYear, Teacher, TeachingAssignment, Term
from apps.core.log import record
from apps.core.tenancy import cursus_context, tenant_context
from apps.core.permissions import has_perm, perm_required
from apps.finance.models import BulletinDerogation
from apps.finance.services import bulletin_access, bulletin_lock_message
from apps.notifications.services import family_users, notify
from apps.students.models import Student
from apps.students.views import visible_students

from . import bulletin_pdf, calc
from .models import BAREME_MAX, Appreciation, CouncilComment, Decision, Evaluation, Grade
from .serializers import (AppreciationInput, CouncilInput, DecisionInput, EvaluationSerializer, GradesInputSerializer,
                          PublishSerializer)

LOCK_MSG = "Cette période est verrouillée. Demandez à la direction de la déverrouiller pour corriger."


# --- Droits d'accès (tous appliqués ici, côté serveur) ---
def sees_everything(user) -> bool:
    """Direction et secrétariat voient toutes les classes, y compris les notes non publiées."""
    return has_perm(user, "grades.locked") or has_perm(user, "bulletins.gen")


def teaches(user, school_class_id, subject_id=None) -> bool:
    qs = TeachingAssignment.objects.filter(teacher__user=user, school_class_id=school_class_id)
    return qs.filter(subject_id=subject_id).exists() if subject_id else qs.exists()


def can_edit_grades(user, school_class_id, subject_id) -> bool:
    return has_perm(user, "grades.locked") or (user.role == "enseignant" and teaches(user, school_class_id, subject_id))


def is_evaluator(user, ev) -> bool:
    """L'enseignant qui fait passer l'évaluation : le seul à pouvoir saisir, modifier ou effacer ses notes (ni la direction,
    ni le secrétariat, ni un collègue). Évaluation sans enseignant (examen programmé avant l'affectation) : l'enseignant
    affecté à la classe et à la matière la reprend."""
    if ev.teacher_id:
        return ev.teacher.user_id == user.pk
    return user.role == "enseignant" and teaches(user, ev.school_class_id, ev.subject_id)


NOT_EVALUATOR = "Seul l’enseignant de cette évaluation peut saisir, modifier ou effacer ses notes."


def can_see_class(user, school_class_id) -> bool:
    return sees_everything(user) or (user.role == "enseignant" and teaches(user, school_class_id))


def current_term(code: str | None, year_label: str | None = None) -> Term:
    """Période demandée de l'année en cours, ou d'une année passée (`year_label`, consultation seulement)."""
    y = SchoolYear.objects.filter(label=year_label).first() if year_label else SchoolYear.get_current()
    if year_label and y is None:
        raise ValidationError({"year": "Année inconnue."})
    qs = Term.objects.filter(year=y) if y else Term.objects.none()
    t = qs.filter(code=code).first() if code else qs.filter(locked=False).first() or qs.first()
    if t is None:
        raise ValidationError({"term": "Période inconnue."})
    return t


def check_unlocked(user, term: Term):
    if term.locked and not has_perm(user, "grades.locked"):
        raise PermissionDenied(LOCK_MSG)


class EvaluationList(generics.ListCreateAPIView):
    """GET `?class=&subject=&term=` : évaluations visibles. POST : création (enseignant affecté, ou direction)."""

    serializer_class = EvaluationSerializer
    pagination_class = None

    def get_queryset(self):
        u, p = self.request.user, self.request.query_params
        qs = Evaluation.objects.select_related("teacher__user")
        if u.role in ("parent", "eleve"):
            ids = visible_students(u).values_list("school_class_id", flat=True)
            qs = qs.filter(school_class_id__in=ids, published=True)
        elif u.role == "enseignant" and not sees_everything(u):
            mine = TeachingAssignment.objects.filter(teacher__user=u, school_class_id=OuterRef("school_class_id"), subject_id=OuterRef("subject_id"))
            qs = qs.filter(Exists(mine))
        elif not sees_everything(u):
            return qs.none()
        for key, field in (("class", "school_class_id"), ("subject", "subject_id")):
            if p.get(key):
                qs = qs.filter(**{field: p[key]})
        if p.get("term"):
            qs = qs.filter(term__code=p["term"], term__year=SchoolYear.get_current())
        return qs

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if not can_edit_grades(request.user, d["school_class"].pk, d["subject"].pk):
            raise PermissionDenied("Vous n’enseignez pas cette matière dans cette classe.")
        check_unlocked(request.user, d["term"])
        if not d["subject"].coefficients.filter(groupe=d["school_class"].groupe).exists():
            raise ValidationError("Cette matière n’est pas enseignée à cette classe.")
        asg = TeachingAssignment.objects.filter(school_class=d["school_class"], subject=d["subject"]).select_related("teacher").first()
        teacher = Teacher.objects.filter(user=request.user).first() or (asg.teacher if asg else None)
        ev = ser.save(teacher=teacher)
        record("Évaluation", f"{ev.title} créée : {ev.school_class.name}, {ev.subject.name}", request=request)
        return Response(self.get_serializer(ev).data, status=status.HTTP_201_CREATED)


class ScheduleInput(serializers.Serializer):
    title = serializers.CharField(max_length=80)
    type = serializers.ChoiceField(choices=["interro", "devoir", "composition"])
    term = serializers.CharField(max_length=3)
    date = serializers.DateField()
    classes = serializers.ListField(child=serializers.IntegerField(), required=False)    # vide : toutes les classes
    subjects = serializers.ListField(child=serializers.IntegerField(), required=False)   # vide : toutes les matières de chaque classe
    coef = serializers.DecimalField(max_digits=4, decimal_places=1, min_value=Decimal("0.5"), max_value=10, required=False, default=1)
    bareme = serializers.IntegerField(min_value=1, max_value=BAREME_MAX, required=False, default=20)


class ScheduleView(APIView):
    """L'école programme un examen : une évaluation par classe et par matière, confiée à l'enseignant affecté, qui est prévenu
    et saisit les notes. Les évaluations déjà programmées sous le même titre sont conservées (on peut relancer sans doublon)."""

    permission_classes = [perm_required("examens.write")]

    @extend_schema(request=ScheduleInput, responses={200: {"type": "object"}})
    @transaction.atomic
    def post(self, request):
        ser = ScheduleInput(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        term = current_term(d["term"])
        check_unlocked(request.user, term)
        classes = SchoolClass.objects.filter(pk__in=d["classes"]) if d.get("classes") else SchoolClass.objects.all()
        asg = {(a.school_class_id, a.subject_id): a for a in TeachingAssignment.objects.select_related("teacher__user")}
        coefs = {(c.groupe, c.subject_id) for c in Coefficient.objects.all()}
        created, kept, orphans, per_teacher = 0, 0, [], {}
        for c in classes:
            for sid in sorted({s for (g, s) in coefs if g == c.groupe}):
                if d.get("subjects") and sid not in d["subjects"]:
                    continue
                if Evaluation.objects.filter(school_class=c, subject_id=sid, term=term, title=d["title"], scheduled=True).exists():
                    kept += 1
                    continue
                a = asg.get((c.pk, sid))
                Evaluation.objects.create(school_class=c, subject_id=sid, term=term, type=d["type"], title=d["title"], date=d["date"],
                                          teacher=a.teacher if a else None, scheduled=True, coef=d["coef"], bareme=d["bareme"])
                created += 1
                if a:
                    per_teacher.setdefault(a.teacher.user_id, []).append(c.name)
                else:
                    orphans.append({"school_class": c.pk, "subject": sid})
        for uid, names in per_teacher.items():
            notify([uid], f"Examen « {d['title']} » programmé le {d['date']:%d/%m/%Y} ({', '.join(sorted(set(names)))}) : saisissez vos notes.", "systeme", "notes")
        record("Examen programmé", f"{d['title']} : {created} évaluation(s) créée(s), {len(orphans)} sans enseignant", request=request)
        return Response({"created": created, "kept": kept, "teachers": len(per_teacher), "orphans": orphans})


class EvaluationDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = EvaluationSerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return Evaluation.objects.select_related("teacher__user", "school_class", "subject", "term")

    def get_object(self):
        ev = super().get_object()
        u = self.request.user
        if self.request.method in ("PATCH", "DELETE"):
            if not can_edit_grades(u, ev.school_class_id, ev.subject_id):
                raise PermissionDenied("Vous ne pouvez pas modifier cette évaluation.")
            # Seul l'enseignant qui fait passer l'évaluation peut la retirer : ni la direction, ni un collègue.
            if self.request.method == "DELETE" and not (ev.teacher_id and ev.teacher.user_id == u.pk):
                raise PermissionDenied("Seul l’enseignant de cette évaluation peut la supprimer.")
            if ev.scheduled and u.role == "enseignant" and not has_perm(u, "examens.write"):
                raise PermissionDenied("Cet examen est programmé par l’école : vous saisissez les notes, la direction gère le reste.")
            # Changer le barème, le coefficient ou le type change le sens des notes : réservé à l'enseignant de l'évaluation.
            # Un examen programmé reste réglé par l'école, mais seulement tant qu'aucune note n'y est saisie.
            if self.request.method == "PATCH":
                if ev.scheduled:
                    if not is_evaluator(u, ev) and ev.grades.exists():
                        raise PermissionDenied("Des notes sont déjà saisies : seul l’enseignant de cet examen peut encore le modifier.")
                elif not is_evaluator(u, ev):
                    raise PermissionDenied(NOT_EVALUATOR)
            check_unlocked(u, ev.term)
        elif u.role in ("parent", "eleve"):
            if not ev.published or not visible_students(u).filter(school_class_id=ev.school_class_id).exists():
                raise NotFound()
        elif not (sees_everything(u) or can_edit_grades(u, ev.school_class_id, ev.subject_id)):
            raise NotFound()
        return ev

    def perform_update(self, ser):
        ev = ser.save()
        record("Évaluation modifiée", f"{ev.title} · {ev.school_class.name}, {ev.subject.name}", request=self.request)

    def perform_destroy(self, ev):
        if ev.published:
            raise ValidationError("Retirez d’abord la publication avant de supprimer cette évaluation.")
        record("Évaluation supprimée", f"{ev.title} · {ev.school_class.name}, {ev.subject.name}", request=self.request)
        ev.delete()


@extend_schema(request=GradesInputSerializer, responses=inline_serializer("GradesOut", {"grades": serializers.DictField()}))
class EvaluationGrades(APIView):
    """GET : notes de la classe pour cette évaluation. PUT `{values: {id_élève: note|null}}` : saisie groupée."""

    def _eval(self, request, pk, write):
        ev = generics.get_object_or_404(Evaluation.objects.select_related("school_class", "subject", "term", "teacher"), pk=pk)
        u = request.user
        if write:
            if not is_evaluator(u, ev):
                raise PermissionDenied(NOT_EVALUATOR)
        elif not (sees_everything(u) or can_edit_grades(u, ev.school_class_id, ev.subject_id)):
            raise NotFound()
        return ev

    def get(self, request, pk):
        ev = self._eval(request, pk, write=False)
        return Response({"grades": {str(s): float(v) for s, v in ev.grades.values_list("student_id", "value")}})

    @transaction.atomic
    def put(self, request, pk):
        ev = self._eval(request, pk, write=True)
        check_unlocked(request.user, ev.term)
        ser = GradesInputSerializer(data=request.data, context={"bareme": ev.bareme})
        ser.is_valid(raise_exception=True)
        values = ser.validated_data["values"]
        valid_ids = set(Student.objects.filter(school_class=ev.school_class, active=True).values_list("pk", flat=True))
        stray = set(values) - valid_ids
        if stray:
            raise ValidationError({"values": "Certains élèves n’appartiennent pas à cette classe."})
        if ev.teacher_id is None:      # l'enseignant affecté reprend l'examen programmé sans enseignant : il en devient l'évaluateur
            ev.teacher = Teacher.objects.filter(user=request.user).first()
            ev.save(update_fields=["teacher"])
        for sid, v in values.items():
            if v is None:
                Grade.objects.filter(evaluation=ev, student_id=sid).delete()
            else:
                Grade.objects.update_or_create(evaluation=ev, student_id=sid, defaults={"value": v})
        record("Modification après verrouillage" if ev.term.locked else "Saisie de notes",
               f"{ev.school_class.name}, {ev.subject.name}, {ev.title}", request=request)
        return Response({"grades": {str(s): float(v) for s, v in ev.grades.values_list("student_id", "value")}})


@extend_schema(request=PublishSerializer, responses=inline_serializer("PublishOut", {"changed": serializers.IntegerField()}))
class PublishView(APIView):
    """Publie (ou retire) des évaluations : tant qu'elles ne sont pas publiées, parents et élèves ne voient rien."""

    permission_classes = [perm_required("publish")]

    def post(self, request):
        ser = PublishSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        evs = list(Evaluation.objects.filter(pk__in=d["ids"]).exclude(published=d["published"]).select_related("school_class", "subject"))
        Evaluation.objects.filter(pk__in=[e.pk for e in evs]).update(published=d["published"])
        if evs and d["published"]:
            for cid in {e.school_class_id for e in evs}:
                subs = ", ".join(sorted({e.subject.name for e in evs if e.school_class_id == cid}))
                for stu in Student.objects.filter(school_class_id=cid, active=True).select_related("parent__user", "user"):
                    notify(family_users(stu), f"Nouvelles notes publiées ({subs}) pour {stu.prenoms}.", "note", "notes")
        if evs:
            detail = f"{evs[0].school_class.name}, {evs[0].subject.name}, {evs[0].title}" if len(evs) == 1 else f"{len(evs)} évaluations"
            record("Publication" if d["published"] else "Retrait de publication", detail, request=request)
        return Response({"changed": len(evs)})


def _as_of(student: Student, term: Term) -> Student:
    """L'élève avec sa classe de l'année de la période (en mémoire seulement, rien n'est enregistré)."""
    student.school_class = calc.class_in_year(student, term.year)
    if student.school_class is None:           # élève à placer : pas encore de classe, donc ni notes ni bulletin cette année
        raise NotFound(f"{student.prenoms} n’a pas encore de classe pour cette année.")
    return student


def _bulletin(student: Student, term: Term, only_published: bool) -> dict:
    cfg = SchoolSettings.load()
    stats = calc.compute_class(student.school_class, term, only_published=only_published, compo_weight=float(cfg.compo_weight))
    res = stats["results"].get(student.pk)
    appr = dict(Appreciation.objects.filter(student=student, term=term).values_list("subject_id", "text"))
    cc = CouncilComment.objects.filter(student=student, term=term).first()
    dec = Decision.objects.filter(student=student, year=term.year).first()
    annual = None
    if calc.is_last_term(term):                  # bulletin de la dernière période : bilan de l'année
        an = calc.annual_class(student.school_class, term.year, only_published=only_published, compo_weight=float(cfg.compo_weight))
        r = an["results"].get(student.pk)
        annual = {"terms": an["terms"], "effectif": an["effectif"], "class_avg": an["avg"], "class_max": an["max"], "class_min": an["min"],
                  "periodes": r["periodes"] if r else [], "moyenne": r["moyenne"] if r else None, "rang": r["rang"] if r else None,
                  "mention": calc.mention(r["moyenne"] if r else None, cfg.seuils)}
    return {
        "student": student.pk, "class": student.school_class_id, "term": term.code, "term_label": term.label,
        "locked": term.locked, "only_published": only_published, "effectif": stats["effectif"],
        "class_avg": stats["avg"], "class_max": stats["max"], "class_min": stats["min"], "result": res,
        "mention": calc.mention(res["moyenne"] if res else None, cfg.seuils),
        "appreciations": appr, "council": cc.text if cc else "",
        "decision": {"value": dec.value, "comment": dec.comment} if dec and annual else None, "annual": annual,   # décision : bulletin de la dernière période
    }


def _family_gate(student: Student, term: Term):
    """Parents et élèves : le bulletin de l'année en cours n'est remis qu'aux familles à jour (réglage de l'école, sauf dérogation)."""
    if term.year_id != getattr(SchoolYear.get_current(), "pk", None):
        return
    acc = bulletin_access(student)
    if acc["locked"]:
        raise PermissionDenied({"detail": bulletin_lock_message(acc), "code": "bulletin_bloque", "amount": acc["amount"], "mode": acc["mode"]})


@extend_schema(responses=inline_serializer("Bulletin", {"result": serializers.DictField()}))
class BulletinView(APIView):
    """Bulletin d'un élève (`?term=T1`) : moyennes, rangs, appréciations, avis du conseil, mention.
    Parents et élèves : uniquement les notes publiées. Direction et secrétariat : tout (ou `?published=1`)."""

    def get(self, request, pk):
        u = request.user
        student = generics.get_object_or_404(Student.objects.select_related("school_class"), pk=pk)
        if u.role in ("parent", "eleve"):
            if not visible_students(u).filter(pk=pk).exists():
                raise NotFound()
            only_pub = True
        elif sees_everything(u):
            only_pub = request.query_params.get("published") == "1"
        else:
            raise PermissionDenied()
        term = current_term(request.query_params.get("term"), request.query_params.get("year"))
        if u.role in ("parent", "eleve"):
            _family_gate(student, term)
        return Response(_bulletin(_as_of(student, term), term, only_pub))


def _verify_base(request) -> str:
    return getattr(settings, "PUBLIC_BASE_URL", "") or request.build_absolute_uri("/")


def _pdf_response(pdf: bytes, filename: str) -> HttpResponse:
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = f'inline; filename="{filename}"'
    resp["Cache-Control"] = "private, no-store"
    return resp


def _slug(txt: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in txt.lower()).strip("-")


PDF_PARAMS = [OpenApiParameter("term", str, description="Code du trimestre (T1, T2, T3)"),
              OpenApiParameter("template", str, description="classique, moderne ou compact (défaut : modèle de l'école ; ignoré pour parents et élèves, le modèle de l'école s'impose)")]


class BulletinPdfView(APIView):
    """Bulletin d'un élève en PDF, avec QR code de vérification lorsqu'il repose sur des notes publiées.
    Mêmes droits que `bulletin/` : famille (notes publiées), direction et secrétariat (`?published=1` pour la version définitive)."""

    @extend_schema(parameters=PDF_PARAMS, responses={(200, "application/pdf"): OpenApiTypes.BINARY})
    def get(self, request, pk):
        u = request.user
        student = generics.get_object_or_404(Student.objects.select_related("school_class"), pk=pk)
        if u.role in ("parent", "eleve"):
            if not visible_students(u).filter(pk=pk).exists():
                raise NotFound()
            only_pub = True
        elif sees_everything(u):
            only_pub = request.query_params.get("published") == "1"
        else:
            raise PermissionDenied()
        term, cfg = current_term(request.query_params.get("term"), request.query_params.get("year")), SchoolSettings.load()
        if u.role in ("parent", "eleve"):
            _family_gate(student, term)
        _as_of(student, term)
        stats = calc.compute_class(student.school_class, term, only_published=only_pub, compo_weight=float(cfg.compo_weight))
        annual = calc.annual_class(student.school_class, term.year, only_published=only_pub, compo_weight=float(cfg.compo_weight)) if calc.is_last_term(term) else None
        pdf = bulletin_pdf.build_bulletins_pdf([student], term, stats, cfg, only_published=only_pub, annual=annual,
                                               tpl=cfg.template if u.role in ("parent", "eleve") else (request.query_params.get("template") or cfg.template), verify_base=_verify_base(request))
        return _pdf_response(pdf, f"bulletin-{_slug(student.nom)}-{_slug(student.prenoms)}-{term.code}.pdf")


class BulletinAccessView(APIView):
    """Le bulletin de l'année est-il remis à la famille (`locked`, `amount` restant dû, `mode` choisi par l'école, `derogation`) ?
    Lecture : la famille de l'élève et la direction. POST `{note}` : dérogation de la direction pour l'année ; DELETE : la retirer."""

    def _student(self, request, pk, write=False) -> Student:
        u = request.user
        student = generics.get_object_or_404(Student, pk=pk)
        if u.role in ("parent", "eleve") and not write:
            if not visible_students(u).filter(pk=pk).exists():
                raise NotFound()
        elif not has_perm(u, "bulletins.gen"):
            raise PermissionDenied()
        return student

    def get(self, request, pk):
        return Response(bulletin_access(self._student(request, pk)))

    def post(self, request, pk):
        student, year = self._student(request, pk, write=True), SchoolYear.get_current()
        if year is None:
            raise ValidationError({"year": "Aucune année scolaire en cours."})
        note = str(request.data.get("note") or "").strip()[:200]
        BulletinDerogation.objects.update_or_create(student=student, year=year, defaults={"note": note, "by": request.user})
        record("Bulletin débloqué", f"{student.full_name} · {year.label}{' · ' + note if note else ''}", request=request)
        return Response(bulletin_access(student))

    def delete(self, request, pk):
        student, year = self._student(request, pk, write=True), SchoolYear.get_current()
        if BulletinDerogation.objects.filter(student=student, year=year).delete()[0]:
            record("Dérogation de bulletin retirée", f"{student.full_name} · {year.label}", request=request)
        return Response(bulletin_access(student))


class ClassBulletinsPdfView(APIView):
    """Tous les bulletins d'une classe dans un seul PDF (direction et secrétariat)."""

    @extend_schema(parameters=PDF_PARAMS, responses={(200, "application/pdf"): OpenApiTypes.BINARY})
    def get(self, request, pk):
        if not sees_everything(request.user):
            raise PermissionDenied()
        cl = generics.get_object_or_404(SchoolClass, pk=pk)
        only_pub = request.query_params.get("published") == "1"
        term, cfg = current_term(request.query_params.get("term"), request.query_params.get("year")), SchoolSettings.load()
        students = [_as_of(s, term) for s in calc.roster(cl, term.year)]
        if not students:
            raise ValidationError("Cette classe n’a aucun élève inscrit.")
        stats = calc.compute_class(cl, term, only_published=only_pub, compo_weight=float(cfg.compo_weight))
        annual = calc.annual_class(cl, term.year, only_published=only_pub, compo_weight=float(cfg.compo_weight)) if calc.is_last_term(term) else None
        pdf = bulletin_pdf.build_bulletins_pdf(students, term, stats, cfg, only_published=only_pub, annual=annual,
                                               tpl=request.query_params.get("template") or cfg.template, verify_base=_verify_base(request))
        record("Bulletins", f"Bulletins PDF de {cl.name} ({term.label}, {'définitifs' if only_pub else 'provisoires'})", request=request)
        return _pdf_response(pdf, f"bulletins-{_slug(cl.name)}-{term.code}.pdf")


PAGE = """<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Vérification de bulletin</title><style>body{{font-family:system-ui,sans-serif;background:#f4f7f5;margin:0;padding:24px;color:#16211b}}
main{{max-width:460px;margin:0 auto;background:#fff;border:1px solid #c9d1cc;border-radius:12px;padding:22px}}h1{{font-size:18px;margin:0 0 4px}}
.badge{{display:inline-block;border-radius:6px;padding:4px 10px;font-weight:700;margin:10px 0}}.ok{{background:#e3f1ea;color:#006a40}}.ko{{background:#fbe6e3;color:#a02616}}
dl{{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:14px 0 0}}dt{{color:#55605a}}dd{{margin:0;font-weight:600}}p{{color:#55605a;font-size:13px}}</style></head>
<body><main><h1>{school}</h1><div>Vérification de bulletin</div><div class="badge {cls}">{status}</div>{details}<p>{note}</p></main></body></html>"""


class VerifyBulletinView(APIView):
    """Page publique ouverte par le QR code du bulletin : confirme que le document correspond aux notes publiées."""

    authentication_classes: list = []
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={(200, "text/html"): OpenApiTypes.STR})
    def get(self, request, token):
        def page(school_name, ok, status_, details="", note=""):
            r = HttpResponse(PAGE.format(school=escape(school_name), cls="ok" if ok else "ko", status=escape(status_), details=details, note=escape(note)), status=200 if ok else 404)
            r["Cache-Control"] = "no-store"
            r["X-Robots-Tag"] = "noindex"
            return r

        # Page publique : l'école est celle de l'élève désigné par le code signé (aucune donnée d'une autre école n'est lue).
        try:
            d = bulletin_pdf.read_token(token)
            student = Student.all_objects.select_related("school_class").get(pk=d["s"])
        except (signing.BadSignature, Student.DoesNotExist, KeyError):
            return page("Plateforme scolaire", False, "Code non reconnu", note="Ce code n’a pas été émis par l’école ou le document a été falsifié.")
        with tenant_context(student.etablissement_id), cursus_context(student.cursus_id):   # réglages et périodes du cursus de l'élève
            cfg = SchoolSettings.load()
            try:
                term = Term.objects.select_related("year").get(pk=d["t"])
            except (Term.DoesNotExist, KeyError):
                return page(cfg.name, False, "Code non reconnu", note="Ce code n’a pas été émis par l’école ou le document a été falsifié.")
            cl = calc.class_in_year(student, term.year)
            res = calc.compute_class(cl, term, only_published=True, compo_weight=float(cfg.compo_weight))["results"].get(student.pk)
            an = calc.annual_class(cl, term.year, only_published=True, compo_weight=float(cfg.compo_weight))["results"].get(student.pk) if "a" in d else None
        moy, rang = (res["moyenne"], res["rang"]) if res else (None, None)
        same = moy is not None and d["m"] is not None and round(moy, 2) == d["m"] and rang == d["r"]
        if "a" in d:          # bulletin de fin d'année : moyenne et rang annuels aussi
            same = same and an is not None and an["moyenne"] is not None and round(an["moyenne"], 2) == d["a"] and an["rang"] == d["ar"]
        details = (f"<dl><dt>Élève</dt><dd>{escape(student.nom)} {escape(student.prenoms)}</dd><dt>Classe</dt><dd>{escape(student.class_label)}</dd>"
                   f"<dt>Période</dt><dd>{escape(term.label)} · {escape(term.year.label)}</dd>"
                   + (f"<dt>Moyenne</dt><dd>{moy:.2f} / 20</dd><dt>Rang</dt><dd>{rang}</dd>".replace(".", ",") if moy is not None else "")
                   + (f"<dt>Moyenne annuelle</dt><dd>{an['moyenne']:.2f} / 20</dd><dt>Rang annuel</dt><dd>{an['rang']}</dd>".replace(".", ",") if an and an["moyenne"] is not None else "") + "</dl>")
        if same:
            return page(cfg.name, True, "Bulletin authentique", details, "Comparez ces informations avec le document : elles doivent être identiques.")
        return page(cfg.name, False, "Ne correspond plus aux données de l’école", details, "Les notes ont changé depuis l’édition de ce bulletin, ou le document est une ancienne version. Demandez un nouvel exemplaire au secrétariat.")


@extend_schema(responses=inline_serializer("StudentGrades", {"grades": serializers.ListField()}))
class StudentGradesView(APIView):
    """Notes détaillées d'un élève pour un trimestre (publiées seulement pour la famille)."""

    def get(self, request, pk):
        u = request.user
        student = generics.get_object_or_404(Student, pk=pk)
        family = u.role in ("parent", "eleve")
        if family and not visible_students(u).filter(pk=pk).exists():
            raise NotFound()
        if not family and not can_see_class(u, student.school_class_id):
            raise PermissionDenied()
        term = current_term(request.query_params.get("term"), request.query_params.get("year"))
        _as_of(student, term)
        evs = Evaluation.objects.filter(school_class=student.school_class_id, term=term)
        if family:
            evs = evs.filter(published=True)
        elif u.role == "enseignant" and not sees_everything(u):
            evs = evs.filter(subject_id__in=TeachingAssignment.objects.filter(teacher__user=u, school_class_id=student.school_class_id).values("subject_id"))
        vals = dict(Grade.objects.filter(student=student, evaluation__in=evs).values_list("evaluation_id", "value"))
        return Response({"grades": [{"evaluation": e.pk, "subject": e.subject_id, "type": e.type, "title": e.title, "date": e.date,
                                      "published": e.published, "bareme": e.bareme,
                                      "value": float(vals[e.pk]) if e.pk in vals else None} for e in evs]})


def _class_payload(cl, term, only_pub, cfg, *, students=None, subjects=None, general=True):
    """Statistiques d'une classe, restreintes à ce que la personne a le droit de voir."""
    out = calc.compute_class(cl, term, only_published=only_pub, compo_weight=float(cfg.compo_weight))
    res = {}
    for sid, r in out["results"].items():
        if students is not None and sid not in students:
            continue
        r = dict(r)
        if subjects is not None:
            r["subjects"] = [x for x in r["subjects"] if x["subject"] in subjects]
        if not general:
            r["moyenne"], r["rang"], r["total_points"], r["total_coef"] = None, None, 0, 0
        res[str(sid)] = r
    return {"effectif": out["effectif"], "avg": out["avg"] if general else None, "max": out["max"] if general else None,
            "min": out["min"] if general else None, "results": res}


@extend_schema(responses=inline_serializer("GradesOverview", {"evaluations": serializers.ListField()}))
class OverviewView(APIView):
    """Tout ce qu'il faut pour afficher un trimestre (`?term=T1`), en un seul appel et selon les droits :
    évaluations, notes, appréciations, avis du conseil et statistiques calculées par le serveur.
    Famille : ses enfants et les notes publiées. Enseignant : ses classes et ses matières. Direction : tout."""

    def get(self, request):
        u = request.user
        term = current_term(request.query_params.get("term"), request.query_params.get("year"))
        cfg = SchoolSettings.load()
        family = u.role in ("parent", "eleve")
        full = sees_everything(u)
        if family:
            kids = list(visible_students(u).select_related("school_class"))
            class_ids = {k.school_class_id for k in kids}
            kid_ids = {k.pk for k in kids}
            evs = Evaluation.objects.filter(school_class_id__in=class_ids, term=term, published=True)
            subj_of = {}
        elif full:
            class_ids, kid_ids = set(SchoolClass.objects.values_list("pk", flat=True)), None
            evs = Evaluation.objects.filter(term=term)
            subj_of = {}
        elif u.role == "enseignant":
            asg = list(TeachingAssignment.objects.filter(teacher__user=u).values_list("school_class_id", "subject_id"))
            class_ids, kid_ids = {c for c, _ in asg}, None
            subj_of = {}
            for c, sb in asg:
                subj_of.setdefault(c, set()).add(sb)
            evs = Evaluation.objects.none()
            for c, sbs in subj_of.items():
                evs = evs | Evaluation.objects.filter(school_class_id=c, subject_id__in=sbs, term=term)
        else:
            raise PermissionDenied()
        evs = list(evs.select_related("teacher__user").order_by("date", "pk"))
        ev_ids = [e.pk for e in evs]
        gq = Grade.objects.filter(evaluation_id__in=ev_ids)
        if kid_ids is not None:
            gq = gq.filter(student_id__in=kid_ids)
        grades = {f"{e}|{s}": float(v) for e, s, v in gq.values_list("evaluation_id", "student_id", "value")}

        aq = Appreciation.objects.filter(term=term, student__school_class_id__in=class_ids)
        if kid_ids is not None:
            aq = aq.filter(student_id__in=kid_ids)
        if u.role == "enseignant" and not full:
            aq = aq.filter(subject_id__in={sb for sbs in subj_of.values() for sb in sbs})
        appreciations = [{"student": st, "subject": sb, "text": t} for st, sb, t in aq.values_list("student_id", "subject_id", "text")]
        council = []
        if family or full:
            cq = CouncilComment.objects.filter(term=term, student__school_class_id__in=class_ids)
            if kid_ids is not None:
                cq = cq.filter(student_id__in=kid_ids)
            council = [{"student": st, "text": t} for st, t in cq.values_list("student_id", "text")]

        stats = {}
        for cl in SchoolClass.objects.filter(pk__in=class_ids):
            entry = {"pub": _class_payload(cl, term, True, cfg, students=kid_ids)}
            if not family:
                restrict = None if full else subj_of.get(cl.pk, set())
                entry["all"] = _class_payload(cl, term, False, cfg, subjects=restrict, general=full)
                if not full:
                    entry["pub"] = _class_payload(cl, term, True, cfg, subjects=restrict, general=False)
            stats[str(cl.pk)] = entry
        return Response({"term": term.code, "locked": term.locked, "evaluations": EvaluationSerializer(evs, many=True).data,
                         "grades": grades, "appreciations": appreciations, "council": council, "stats": stats})


@extend_schema(responses=inline_serializer("ClassResults", {"results": serializers.DictField()}))
class ClassResultsView(APIView):
    """Résultats d'une classe (`?class=&term=`) : moyennes de matière, générale, rangs, statistiques."""

    def get(self, request):
        cid = request.query_params.get("class")
        if not cid:
            raise ValidationError({"class": "Indiquez la classe."})
        school_class = generics.get_object_or_404(SchoolClass, pk=cid)
        if not can_see_class(request.user, school_class.pk):
            raise PermissionDenied()
        only_pub = request.query_params.get("published") == "1"
        out = calc.compute_class(school_class, current_term(request.query_params.get("term"), request.query_params.get("year")), only_published=only_pub)
        out["results"] = {str(k): v for k, v in out["results"].items()}
        return Response(out)


@extend_schema(request=AppreciationInput, responses=inline_serializer("Ok", {"ok": serializers.BooleanField()}))
class AppreciationView(APIView):
    """Appréciation d'un enseignant (sa matière, sa classe) ; texte vide = suppression."""

    def put(self, request):
        ser = AppreciationInput(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if not can_edit_grades(request.user, d["student"].school_class_id, d["subject"].pk):
            raise PermissionDenied("Vous n’enseignez pas cette matière dans cette classe.")
        check_unlocked(request.user, d["term"])
        if d["text"].strip():
            Appreciation.objects.update_or_create(student=d["student"], term=d["term"], subject=d["subject"], defaults={"text": d["text"].strip()})
        else:
            Appreciation.objects.filter(student=d["student"], term=d["term"], subject=d["subject"]).delete()
        return Response({"ok": True})


@extend_schema(request=CouncilInput, responses=inline_serializer("Ok2", {"ok": serializers.BooleanField()}))
class CouncilView(APIView):
    """Avis du conseil de classe sur un trimestre : la direction, ou le professeur principal pour les élèves de sa classe."""

    def put(self, request):
        from .principal import council_allowed
        ser = CouncilInput(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if not council_allowed(request.user, d["student"]):
            raise PermissionDenied("L’avis du conseil revient à la direction ou au professeur principal de la classe.")
        check_unlocked(request.user, d["term"])
        if d["text"].strip():
            CouncilComment.objects.update_or_create(student=d["student"], term=d["term"], defaults={"text": d["text"].strip()})
        else:
            CouncilComment.objects.filter(student=d["student"], term=d["term"]).delete()
        record("Avis du conseil", f"{d['student'].full_name} · {d['term'].code}", request=request)
        return Response({"ok": True})


class ArchiveView(APIView):
    """Années passées en consultation (`?year=2026-2027`) : une ligne par élève inscrit cette année-là, avec sa classe d'alors,
    sa moyenne annuelle et la décision prise. Direction et secrétariat : toute l'école ; parents et élèves : leurs propres dossiers
    (notes publiées seulement). Les bulletins se téléchargent ensuite avec `?year=` sur les routes de bulletin."""

    @extend_schema(parameters=[OpenApiParameter("year", str, description="Année passée, par exemple 2026-2027")],
                   responses=inline_serializer("Archive", {"years": serializers.ListField(), "rows": serializers.ListField()}))
    def get(self, request):
        from apps.students.models import Enrollment
        u = request.user
        family = u.role in ("parent", "eleve")
        if not family and not sees_everything(u):
            raise PermissionDenied()
        cur = SchoolYear.get_current()
        past = list(SchoolYear.objects.exclude(pk=cur.pk if cur else None).order_by("-label"))
        years = [y.label for y in past]
        label = request.query_params.get("year") or (years[0] if years else None)
        if label is None:
            return Response({"years": [], "year": None, "terms": [], "rows": []})
        year = next((y for y in past if y.label == label), None)
        if year is None:
            raise ValidationError({"year": "Cette année n’est pas une année passée."})
        terms = list(year.terms.order_by("start", "code"))
        enr = Enrollment.objects.filter(year=year, school_class__isnull=False).select_related("student", "school_class")
        if family:
            enr = enr.filter(student__in=visible_students(u))
        by_class: dict[int, list] = {}
        for e in enr:
            by_class.setdefault(e.school_class_id, []).append(e)
        rows = []
        for cid, lst in by_class.items():
            cl = lst[0].school_class
            avgs = calc.annual_class(cl, year, only_published=family)["results"]
            decs = dict(Decision.objects.filter(year=year, student__in=[e.student_id for e in lst]).values_list("student_id", "value"))
            for e in lst:
                a = avgs.get(e.student_id)
                rows.append({"student": e.student_id, "name": e.student.full_name, "matricule": e.student.matricule, "class": cid, "class_name": cl.name,
                             "annual_avg": a["moyenne"] if a else None, "decision": decs.get(e.student_id),
                             "sortie": "" if e.student.active else e.student.sortie})
        rows.sort(key=lambda r: (r["class_name"], r["name"]))
        return Response({"years": years, "year": label, "terms": [{"code": t.code, "label": t.label} for t in terms], "rows": rows})


def year_closed(year) -> bool:
    """L'année est terminée quand sa dernière période est verrouillée (notes figées) ou que sa date de fin est passée."""
    last = Term.objects.filter(year=year).order_by("end", "start").last()
    return last is not None and (last.locked or last.end < timezone.localdate())


class DecisionView(APIView):
    """GET `?class=` : décisions de fin d'année avec moyenne annuelle et proposition automatique.
    PUT : enregistre la décision (direction), une fois l'année terminée. Famille : sa propre décision uniquement.
    DELETE `?class=` : annule les décisions de la classe validées en lot (« Valider les propositions de la classe »)."""

    @extend_schema(responses=inline_serializer("DecisionRow", {"student": serializers.IntegerField()}, many=True))
    def get(self, request):
        u = request.user
        year = SchoolYear.get_current()
        cfg = SchoolSettings.load()
        if u.role in ("parent", "eleve"):
            students = visible_students(u)
        elif has_perm(u, "decisions.write") or has_perm(u, "bulletins.gen"):
            students = Student.objects.filter(active=True)
            if request.query_params.get("class"):
                students = students.filter(school_class_id=request.query_params["class"])
        else:
            raise PermissionDenied()
        students = students.filter(school_class__isnull=False)      # un élève à placer n'a pas de décision cette année
        decs = {d.student_id: d for d in Decision.objects.filter(year=year, student__in=students)}
        avgs: dict[int, list[float]] = {}
        if u.role not in ("parent", "eleve"):
            avgs = calc.annual_averages(students, year)
        rows = []
        from apps.students.rollover import already_repeated, proposal_for
        for s in students.select_related("school_class"):
            a = avgs.get(s.pk)
            annual = a["moyenne"] if a else None
            d = decs.get(s.pk)
            proposal, why = proposal_for(s, annual, cfg)
            rows.append({"student": s.pk, "name": s.full_name, "class": s.school_class_id, "annual_avg": annual, "terms": a["count"] if a else 0,
                         "proposal": proposal, "reason": why, "already_repeated": already_repeated(s),
                         "decision": {"value": d.value, "comment": d.comment, "batch": d.batch} if d else None})
        return Response(rows)

    @extend_schema(request=DecisionInput, responses=inline_serializer("DecisionOut", {"value": serializers.CharField()}))
    def put(self, request):
        if not has_perm(request.user, "decisions.write"):
            raise PermissionDenied()
        ser = DecisionInput(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        year = SchoolYear.get_current()
        if not year_closed(year):
            raise ValidationError({"detail": "Les décisions de fin d’année pourront être enregistrées quand la dernière période sera verrouillée ou terminée."})
        Decision.objects.update_or_create(student=d["student"], year=year,
                                          defaults={"value": d["value"], "comment": d["comment"].strip(), "batch": d["batch"], "by": request.user})
        record("Décision de fin d’année", f"{d['student'].full_name} : {d['value']}", request=request)
        return Response({"value": d["value"]})

    @extend_schema(parameters=[OpenApiParameter("class", int, required=True)], responses=inline_serializer("DecisionUndo", {"deleted": serializers.IntegerField()}))
    def delete(self, request):
        if not has_perm(request.user, "decisions.write"):
            raise PermissionDenied()
        cl = SchoolClass.objects.filter(pk=request.query_params.get("class") or 0).first()
        if cl is None:
            raise ValidationError({"detail": "Classe introuvable."})
        n, _ = Decision.objects.filter(year=SchoolYear.get_current(), batch=True, student__school_class=cl).delete()
        if n:
            record("Décisions de fin d’année", f"Validation des propositions annulée pour {cl.name} ({n} élève(s))", request=request)
        return Response({"deleted": n})
