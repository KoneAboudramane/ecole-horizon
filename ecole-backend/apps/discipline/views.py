from django.utils import timezone
from drf_spectacular.utils import extend_schema_serializer, extend_schema
from rest_framework import generics, serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import SchoolYear, Term
from apps.core.log import record
from apps.core.permissions import has_perm, perm_required
from apps.notifications.services import notify, users_with_role
from apps.grades.views import check_unlocked
from apps.students.views import visible_students

from .models import SANCTIONS, TYPES, ConductDeduction, Incident
from .scope import educator_scope, in_scope


class IncidentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    class_name = serializers.CharField(source="student.school_class.name", read_only=True)
    by_name = serializers.SerializerMethodField()
    retrait = serializers.DecimalField(max_digits=4, decimal_places=1, min_value=0, max_value=20, write_only=True, required=False)
    points = serializers.SerializerMethodField()

    class Meta:
        model = Incident
        fields = ["id", "student", "student_name", "class_name", "date", "type", "gravite", "sanction", "description",
                  "status", "by", "by_name", "decided_by", "decision_note", "retrait", "points"]
        read_only_fields = ["status", "by", "decided_by", "decision_note"]

    def get_points(self, obj) -> float:
        """Points retirés de la note de conduite pour cette sanction (réservé au personnel)."""
        u = self.context["request"].user if "request" in self.context else None
        if u is None or u.role in ("parent", "eleve"):
            return 0
        return float(sum(d.points for d in obj.deductions.all()))

    def get_by_name(self, obj) -> str:
        return obj.by.name if obj.by else ""

    def validate_date(self, d):
        if d > timezone.localdate():
            raise serializers.ValidationError("La date ne peut pas être dans le futur.")
        return d

    def validate_description(self, v):
        if len(v.strip()) < 3:
            raise serializers.ValidationError("Décrivez brièvement les faits.")
        return v.strip()


def needs_validation(user, gravite, sanction) -> bool:
    return (gravite == "grave" or sanction == "exclusion_temp") and not has_perm(user, "discipline.validate")


def notify_family(inc: Incident):
    msg = ("convocation des parents" if inc.sanction == "convocation" else "voir le détail dans l’espace Absences")
    notify([inc.student.parent.user], f"Mesure disciplinaire pour {inc.student.prenoms} : {msg}.", "discipline", "presences")


class IncidentList(generics.ListCreateAPIView):
    """GET : éducateur et direction voient tout ; un parent voit uniquement les mesures **validées** de ses enfants.
    POST : enregistre un incident ; grave ou exclusion temporaire → « à valider » par la direction."""

    serializer_class = IncidentSerializer

    def get_permissions(self):
        if self.request.method == "GET":
            return [] if getattr(self.request.user, "role", "") == "parent" else [perm_required("discipline")()]
        return [perm_required("discipline")()]

    def get_queryset(self):
        u, p = self.request.user, self.request.query_params
        qs = Incident.objects.select_related("student__school_class", "by").prefetch_related("deductions")
        if u.role == "parent":
            qs = qs.filter(student__in=visible_students(u), status="valide")
        sc = educator_scope(u)
        if sc is not None:
            qs = qs.filter(student__school_class_id__in=sc)
        for key, field in (("student", "student_id"), ("status", "status"), ("class", "student__school_class_id")):
            if p.get(key):
                qs = qs.filter(**{field: p[key]})
        return qs

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if not d["student"].active:
            raise ValidationError({"student": "Cet élève n’est plus inscrit."})
        if not in_scope(request.user, d["student"].school_class_id):
            raise PermissionDenied("Cet élève n’est pas dans vos classes.")
        retrait = d.pop("retrait", None)
        term = None
        if retrait:
            term = Term.objects.filter(year=SchoolYear.get_current(), start__lte=d["date"], end__gte=d["date"]).first()
            if term is None:
                raise ValidationError({"retrait": "Aucune période ne couvre cette date : le retrait de points n’est pas possible."})
            check_unlocked(request.user, term)
        needs = needs_validation(request.user, d["gravite"], d["sanction"])
        inc = ser.save(by=request.user, status="a_valider" if needs else "valide")
        if retrait:
            lab = dict(SANCTIONS)[inc.sanction]
            ConductDeduction.objects.create(student=inc.student, term=term, points=retrait, kind="discipline", incident=inc, date=inc.date,
                                            reason=f"{dict(TYPES)[inc.type]} · {lab}", by=request.user)
        if needs:
            notify(users_with_role("directeur"), f"Une sanction grave ({inc.student.school_class.name}) attend votre validation.", "discipline", "discipline")
        else:
            notify_family(inc)
        record("Discipline", f"{inc.student.full_name} : {inc.type}, {'à valider' if needs else 'validé'}", request=request)
        return Response(self.get_serializer(inc).data, status=status.HTTP_201_CREATED)


@extend_schema_serializer(component_name="IncidentDecideInput")
class DecideInput(serializers.Serializer):
    accept = serializers.BooleanField()
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class DecideIncidentView(APIView):
    """La direction valide ou refuse une sanction en attente ; l'auteur et, si validée, la famille sont prévenus."""

    permission_classes = [perm_required("discipline.validate")]

    @extend_schema(request=DecideInput, responses=IncidentSerializer)
    def post(self, request, pk):
        inc = generics.get_object_or_404(Incident.objects.select_related("student__school_class", "student__parent__user", "by"), pk=pk)
        if inc.status != "a_valider":
            raise ValidationError("Cette sanction n’est pas en attente de validation.")
        ser = DecideInput(data=request.data)
        ser.is_valid(raise_exception=True)
        ok = ser.validated_data["accept"]
        inc.status, inc.decided_by, inc.decision_note = ("valide" if ok else "refuse"), request.user, ser.validated_data["note"].strip()
        inc.save(update_fields=["status", "decided_by", "decision_note"])
        if ok:
            notify_family(inc)
        if inc.by_id:
            notify([inc.by_id], f"Votre sanction concernant {inc.student.full_name} a été {'validée' if ok else 'refusée'} par la direction.", "discipline", "discipline")
        record("Discipline", f"{'Validation' if ok else 'Refus'} : {inc.student.full_name}", request=request)
        return Response(IncidentSerializer(inc).data)
