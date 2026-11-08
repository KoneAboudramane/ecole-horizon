from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import generics, serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import SchoolClass
from apps.accounts.perimetre import sees_all_cursus
from apps.core.permissions import perm_required


class AllCursus(BasePermission):
    """Le passage d'année concerne toute l'école : réservé à qui voit tous les cursus (école à plusieurs cursus)."""

    message = "Le passage d’année concerne tous les cursus de l’école : il est réservé à un compte qui les voit tous."

    def has_permission(self, request, view):
        return sees_all_cursus(request.user)

from . import rollover
from .models import Student
from .serializers import StudentSerializer


class RolloverPlanView(APIView):
    """Aperçu du passage à l'année suivante : une proposition par élève (direction). Rien n'est modifié."""

    permission_classes = [perm_required("rollover"), AllCursus]

    @extend_schema(responses=inline_serializer("RolloverPlan", {"rows": serializers.ListField()}))
    def get(self, request):
        plan = rollover.build_plan()
        last = rollover.last_rollover()
        plan["last"] = None if last is None else {"from_year": last.from_year.label, "to_year": last.to_year.label, "date": last.date,
                                                  "can_undo": rollover.undo_blockers(last) is None, "reason": rollover.undo_blockers(last)}
        return Response(plan)


class RolloverApplyView(APIView):
    permission_classes = [perm_required("rollover"), AllCursus]

    @extend_schema(request=inline_serializer("RolloverIn", {"moves": serializers.ListField(), "to_year": serializers.CharField(required=False)}),
                   responses=inline_serializer("RolloverOut", {"year": serializers.CharField()}))
    def post(self, request):
        return Response(rollover.apply(moves=request.data.get("moves"), to_label=request.data.get("to_year"), user=request.user, request=request), status=201)


class RolloverUndoView(APIView):
    permission_classes = [perm_required("rollover"), AllCursus]

    @extend_schema(request=None, responses=inline_serializer("RolloverUndoOut", {"year": serializers.CharField()}))
    def post(self, request):
        return Response(rollover.undo(user=request.user, request=request))


class PlacementView(APIView):
    """GET : élèves à placer par niveau, avec les classes et leurs places. POST `{assignments: [{student, class}]}` : enregistre.
    Direction (et secrétariat : il compose les classes)."""

    permission_classes = [perm_required("rollover", "classes.write")]

    @extend_schema(responses=inline_serializer("PlacementState", {"levels": serializers.ListField()}))
    def get(self, request):
        return Response(rollover.placement_state())

    @extend_schema(request=inline_serializer("PlacementIn", {"assignments": serializers.ListField()}),
                   responses=inline_serializer("PlacementOut", {"placed": serializers.IntegerField()}))
    def post(self, request):
        return Response(rollover.place(request.data.get("assignments"), user=request.user, request=request))


class PlacementSuggestView(APIView):
    """POST `{level}` : répartition proposée pour un niveau (rien n'est enregistré)."""

    permission_classes = [perm_required("rollover", "classes.write")]

    @extend_schema(request=inline_serializer("SuggestIn", {"level": serializers.CharField()}),
                   responses=inline_serializer("SuggestOut", {"assignments": serializers.DictField()}))
    def post(self, request):
        return Response(rollover.suggest(str(request.data.get("level", ""))))


class ReinscriptionView(APIView):
    """POST `{students: [ids], confirmed: true|false, motif?}` : le secrétariat valide (sur reçu) ou annule la réinscription ;
    sans paiement, le motif est obligatoire."""

    permission_classes = [perm_required("rollover", "classes.write", "students.write")]

    @extend_schema(request=inline_serializer("ReinscriptionIn", {"students": serializers.ListField(), "confirmed": serializers.BooleanField()}),
                   responses=inline_serializer("ReinscriptionOut", {"updated": serializers.IntegerField()}))
    def post(self, request):
        return Response(rollover.set_reinscription(request.data.get("students"), bool(request.data.get("confirmed", True)),
                                                   motif=str(request.data.get("motif", "")), user=request.user, request=request))


class DepartedView(APIView):
    """POST `{students?: [ids]}` : marque comme partis les élèves non réinscrits (tous, ou ceux indiqués)."""

    permission_classes = [perm_required("rollover", "classes.write")]

    @extend_schema(request=inline_serializer("DepartedIn", {"students": serializers.ListField(required=False)}),
                   responses=inline_serializer("DepartedOut", {"departed": serializers.IntegerField()}))
    def post(self, request):
        return Response(rollover.mark_departed(request.data.get("students") or None, user=request.user, request=request))


class ReintegrateView(APIView):
    """Réintègre un élève exclu, ancien élève ou parti dans une classe de l'année en cours (direction, secrétariat)."""

    permission_classes = [perm_required("rollover", "students.write")]

    @extend_schema(request=inline_serializer("ReintegrateIn", {"school_class": serializers.IntegerField()}), responses=StudentSerializer)
    def post(self, request, pk):
        student = generics.get_object_or_404(Student.objects.select_related("user", "school_class", "parent__user"), pk=pk)
        cl = SchoolClass.objects.filter(pk=request.data.get("school_class")).first()
        if cl is None:
            raise ValidationError({"school_class": "Choisissez la classe d’accueil."})
        return Response(StudentSerializer(rollover.reintegrate(student, cl, user=request.user, request=request)).data)
