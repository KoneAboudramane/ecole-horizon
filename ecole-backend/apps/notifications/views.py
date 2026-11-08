from django.conf import settings
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import generics, serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from . import push
from .models import Notification, PushSubscription


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "text", "kind", "page", "read", "created"]


class NotificationList(generics.ListAPIView):
    """Notifications de la personne connectée (`?unread=1` pour les non lues)."""

    serializer_class = NotificationSerializer

    def get_queryset(self):
        qs = Notification.objects.filter(user=self.request.user)
        return qs.filter(read=False) if self.request.query_params.get("unread") == "1" else qs


@extend_schema(responses=inline_serializer("UnreadCount", {"unread": serializers.IntegerField()}))
class UnreadCount(APIView):
    def get(self, request):
        return Response({"unread": Notification.objects.filter(user=request.user, read=False).count()})


@extend_schema(request=inline_serializer("MarkRead", {"ids": serializers.ListField(child=serializers.IntegerField(), required=False)}),
               responses=inline_serializer("MarkedRead", {"updated": serializers.IntegerField()}))
class MarkRead(APIView):
    """Marque comme lues les notifications données (`ids`), ou toutes si `ids` est absent."""

    def post(self, request):
        qs = Notification.objects.filter(user=request.user, read=False)
        if request.data.get("ids"):
            qs = qs.filter(pk__in=request.data["ids"])
        return Response({"updated": qs.update(read=True)})


@extend_schema(responses=inline_serializer("PushConfig", {"enabled": serializers.BooleanField(), "public_key": serializers.CharField()}))
class PushConfig(APIView):
    """Alertes sur le téléphone : disponibles sur ce serveur ? Clé publique à donner au navigateur."""

    def get(self, request):
        return Response({"enabled": push.enabled(), "public_key": settings.WEBPUSH_PUBLIC_KEY if push.enabled() else ""})


class PushSubscriptionSerializer(serializers.Serializer):
    endpoint = serializers.URLField(max_length=500)
    keys = inline_serializer("PushKeys", {"p256dh": serializers.CharField(max_length=200), "auth": serializers.CharField(max_length=100)})
    app_url = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")

    def validate_endpoint(self, v):
        if not push.allowed_endpoint(v):
            raise serializers.ValidationError("Adresse d'alerte non reconnue.")
        return v

    def validate_app_url(self, v):
        return v if v.startswith(("https://", "http://localhost", "http://127.0.0.1")) else ""


@extend_schema(request=PushSubscriptionSerializer, responses=inline_serializer("PushSubscribed", {"ok": serializers.BooleanField()}))
class PushSubscribe(APIView):
    """Active les alertes sur cet appareil pour la personne connectée (un appareil = un seul compte : le dernier connecté)."""

    def post(self, request):
        if not push.enabled():
            return Response({"detail": "Les alertes ne sont pas configurées sur ce serveur."}, status=503)
        s = PushSubscriptionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        PushSubscription.objects.update_or_create(endpoint=d["endpoint"], defaults={
            "user": request.user, "p256dh": d["keys"]["p256dh"], "auth": d["keys"]["auth"], "app_url": d["app_url"]})
        return Response({"ok": True})


@extend_schema(request=inline_serializer("PushUnsubscribe", {"endpoint": serializers.CharField()}),
               responses=inline_serializer("PushUnsubscribed", {"deleted": serializers.IntegerField()}))
class PushUnsubscribe(APIView):
    """Désactive les alertes de cet appareil (désactivation ou déconnexion)."""

    def post(self, request):
        n, _ = PushSubscription.objects.filter(user=request.user, endpoint=request.data.get("endpoint", "")).delete()
        return Response({"deleted": n})
