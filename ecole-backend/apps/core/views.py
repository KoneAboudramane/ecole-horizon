from apps.core.pagination import BigPages
from django.db import connection
from drf_spectacular.utils import extend_schema
from rest_framework import generics, serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ActivityLog
from .permissions import perm_required


class HealthView(APIView):
    """Sonde pour Docker et la supervision : répond 200 si l'application et la base fonctionnent."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes: list = []

    @extend_schema(responses={200: {"type": "object", "properties": {"status": {"type": "string"}}}})
    def get(self, request):
        with connection.cursor() as c:
            c.execute("SELECT 1")
        return Response({"status": "ok"})


class ActivityLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = ActivityLog
        fields = ["id", "ts", "user", "user_name", "action", "detail"]

    def get_user_name(self, obj) -> str:
        return obj.user.name if obj.user else "Système"


class JournalView(generics.ListAPIView):
    """Journal d'activité (direction, fondateur, secrétariat). Filtre `?q=` sur l'action, le détail ou la personne."""

    permission_classes = [perm_required("journal", "journal.sys")]
    serializer_class = ActivityLogSerializer
    pagination_class = BigPages

    def get_queryset(self):
        qs = ActivityLog.objects.select_related("user")
        q = self.request.query_params.get("q", "").strip()
        if q:
            from django.db.models import Q
            qs = qs.filter(Q(action__icontains=q) | Q(detail__icontains=q) | Q(user__full_name__icontains=q))
        return qs
