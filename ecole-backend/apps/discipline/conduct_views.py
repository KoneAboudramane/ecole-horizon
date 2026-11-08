from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import generics, serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import SchoolClass, SchoolSettings
from apps.core.log import record
from apps.core.permissions import perm_required
from apps.grades.views import check_unlocked, current_term
from apps.notifications.services import family_users, notify
from apps.students.models import Student

from . import conduct
from .models import ConductDeduction, EducatorClass
from .scope import educator_scope

User = get_user_model()


# ---------- classes de l'éducateur ----------
class EducatorsView(APIView):
    """Direction et secrétariat : les éducateurs et les classes qui leur sont confiées."""

    permission_classes = [perm_required("educateurs.write")]

    @extend_schema(responses=inline_serializer("EducatorRow", {"id": serializers.IntegerField(), "name": serializers.CharField(), "classes": serializers.ListField(child=serializers.IntegerField())}, many=True))
    def get(self, request):
        rows = {}
        for u in User.objects.filter(role="educateur", is_active=True).order_by("full_name"):
            rows[u.pk] = {"id": u.pk, "name": u.name, "classes": []}
        for uid, cid in EducatorClass.objects.values_list("educateur_id", "school_class_id"):
            if uid in rows:
                rows[uid]["classes"].append(cid)
        return Response(list(rows.values()))


class EducatorClassesInput(serializers.Serializer):
    classes = serializers.ListField(child=serializers.IntegerField())


class EducatorClassesView(APIView):
    permission_classes = [perm_required("educateurs.write")]

    @extend_schema(request=EducatorClassesInput, responses=inline_serializer("EducatorClassesOut", {"classes": serializers.ListField(child=serializers.IntegerField())}))
    @transaction.atomic
    def put(self, request, pk):
        u = generics.get_object_or_404(User, pk=pk, role="educateur")
        ser = EducatorClassesInput(data=request.data)
        ser.is_valid(raise_exception=True)
        ids = set(SchoolClass.objects.filter(pk__in=ser.validated_data["classes"]).values_list("pk", flat=True))
        EducatorClass.objects.filter(educateur=u).exclude(school_class_id__in=ids).delete()
        for cid in ids:
            EducatorClass.objects.get_or_create(educateur=u, school_class_id=cid)
        names = ", ".join(SchoolClass.objects.filter(pk__in=ids).order_by("name").values_list("name", flat=True)) or "aucune (vue de toute l’école)"
        notify([u.pk], f"Vos classes ont été mises à jour : {names}.", "systeme", "presences")
        record("Éducateur", f"{u.name} : {names}", request=request)
        return Response({"classes": sorted(ids)})


class MyClassesView(APIView):
    """Classes confiées à l'éducateur connecté (`null` : toute l'école)."""

    @extend_schema(responses=inline_serializer("MyEducatorClasses", {"classes": serializers.ListField(child=serializers.IntegerField(), allow_null=True)}))
    def get(self, request):
        sc = educator_scope(request.user)
        return Response({"classes": None if sc is None else sorted(sc)})


# ---------- note de conduite ----------
def _class_for(request, cid) -> SchoolClass:
    cl = generics.get_object_or_404(SchoolClass, pk=cid)
    sc = educator_scope(request.user)
    if sc is not None and cl.pk not in sc:
        raise PermissionDenied("Cette classe ne fait pas partie de vos classes.")
    return cl


def _row(st, term, cfg, ded, halfdays, removed):
    due = conduct.due_points(halfdays, cfg)
    applied = next((d for d in ded if d.kind == "absences"), None)
    return {
        "student": st.pk, "name": st.full_name, "max": float(cfg.conduite_max),
        "removed": float(removed), "note": conduct.note_of(removed, cfg),
        "halfdays": halfdays, "due": float(due), "applied": float(applied.points) if applied else 0,
        "deductions": [{"id": d.pk, "points": float(d.points), "reason": d.reason, "kind": d.kind, "date": d.date.isoformat(),
                        "by_name": d.by.name if d.by else "", "incident": d.incident_id,
                        "pending": bool(d.incident_id and d.incident.status != "valide"), "refused": bool(d.incident_id and d.incident.status == "refuse")} for d in ded],
    }


class ConductView(APIView):
    """GET `?class=&term=` : note de conduite de chaque élève, retraits, absences non justifiées et retrait dû selon la règle de l'école."""

    permission_classes = [perm_required("conduite")]

    @extend_schema(responses=inline_serializer("ConductClass", {"students": serializers.ListField(), "published": serializers.BooleanField()}))
    def get(self, request):
        p = request.query_params
        cl = _class_for(request, p.get("class"))
        term = current_term(p.get("term"))
        cfg = SchoolSettings.load()
        students = list(Student.objects.filter(school_class=cl, active=True).order_by("nom", "prenoms"))
        ids = [s.pk for s in students]
        by = {}
        for d in ConductDeduction.objects.filter(term=term, student_id__in=ids).select_related("by", "incident"):
            by.setdefault(d.student_id, []).append(d)
        tot = conduct.totals(ids, term)
        half = conduct.unjustified_halfdays(ids, term)
        rows = [_row(s, term, cfg, by.get(s.pk, []), half.get(s.pk, 0), tot.get(s.pk, 0)) for s in students]
        return Response({"class": cl.pk, "term": term.code, "locked": term.locked, "published": term.conduct_published, "max": float(cfg.conduite_max),
                         "in_average": cfg.conduite_in_average, "coef": float(cfg.conduite_coef), "rule": {"tranche": cfg.absence_tranche, "points": float(cfg.absence_points)},
                         "students": rows})


class DeductionInput(serializers.Serializer):
    student = serializers.IntegerField()
    term = serializers.CharField(max_length=3)
    points = serializers.DecimalField(max_digits=4, decimal_places=1, min_value=Decimal("0.1"), max_value=Decimal("20"))
    reason = serializers.CharField(min_length=3, max_length=200)
    date = serializers.DateField(required=False)


class DeductionCreate(APIView):
    permission_classes = [perm_required("conduite")]

    @extend_schema(request=DeductionInput, responses={201: {"type": "object"}})
    def post(self, request):
        ser = DeductionInput(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        st = generics.get_object_or_404(Student, pk=d["student"], active=True)
        _class_for(request, st.school_class_id)
        term = current_term(d["term"])
        check_unlocked(request.user, term)
        ded = ConductDeduction.objects.create(student=st, term=term, points=d["points"], reason=d["reason"].strip(), kind="autre",
                                              date=d.get("date") or timezone.localdate(), by=request.user)
        record("Conduite", f"{st.full_name} : −{d['points']} ({ded.reason})", request=request)
        return Response({"id": ded.pk}, status=status.HTTP_201_CREATED)


class DeductionDelete(APIView):
    permission_classes = [perm_required("conduite")]

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        ded = generics.get_object_or_404(ConductDeduction.objects.select_related("student", "term"), pk=pk)
        _class_for(request, ded.student.school_class_id)
        check_unlocked(request.user, ded.term)
        record("Conduite", f"Retrait annulé : {ded.student.full_name} (−{ded.points}, {ded.reason})", request=request)
        ded.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ApplyInput(serializers.Serializer):
    school_class = serializers.IntegerField()
    term = serializers.CharField(max_length=3)


class ApplyAbsencesView(APIView):
    """Applique à la classe le retrait dû aux absences non justifiées (règle de l'école). Relançable : le retrait « absences »
    de chaque élève est recalculé, jamais ajouté deux fois ; un justificatif accepté entre-temps le diminue."""

    permission_classes = [perm_required("conduite")]

    @extend_schema(request=ApplyInput, responses=inline_serializer("ApplyOut", {"updated": serializers.IntegerField()}))
    @transaction.atomic
    def post(self, request):
        ser = ApplyInput(data=request.data)
        ser.is_valid(raise_exception=True)
        cl = _class_for(request, ser.validated_data["school_class"])
        term = current_term(ser.validated_data["term"])
        check_unlocked(request.user, term)
        cfg = SchoolSettings.load()
        if not cfg.absence_tranche:
            raise ValidationError("L’école n’a pas fixé de règle pour les absences (Paramètres > Conduite).")
        students = list(Student.objects.filter(school_class=cl, active=True))
        half = conduct.unjustified_halfdays([s.pk for s in students], term)
        n = sum(conduct.sync_absences(s, term, half.get(s.pk, 0), cfg, request.user) for s in students)
        record("Conduite", f"{cl.name} : retraits pour absences appliqués ({n} élève(s))", request=request)
        return Response({"updated": n})


class PublishInput(serializers.Serializer):
    term = serializers.CharField(max_length=3)
    published = serializers.BooleanField()


class PublishConductView(APIView):
    """La direction publie (ou retire) les notes de conduite de la période : les familles les voient alors sur le bulletin."""

    permission_classes = [perm_required("publish")]

    @extend_schema(request=PublishInput, responses=inline_serializer("PublishConductOut", {"published": serializers.BooleanField()}))
    def post(self, request):
        ser = PublishInput(data=request.data)
        ser.is_valid(raise_exception=True)
        term = current_term(ser.validated_data["term"])
        check_unlocked(request.user, term)
        term.conduct_published = ser.validated_data["published"]
        term.save(update_fields=["conduct_published"])
        if term.conduct_published:
            for stu in Student.objects.filter(active=True).select_related("parent__user", "user"):
                notify(family_users(stu), f"La note de conduite de {stu.prenoms} ({term.label}) est disponible sur le bulletin.", "note", "bulletins")
        record("Conduite", f"Notes de conduite {'publiées' if term.conduct_published else 'retirées'} : {term.label}", request=request)
        return Response({"published": term.conduct_published})
