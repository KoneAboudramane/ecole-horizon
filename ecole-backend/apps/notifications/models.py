from django.conf import settings
from django.db import models

from apps.core.tenancy import TenantModel

KINDS = ["note", "absence", "paiement", "annonce", "compte", "systeme", "discipline"]


class Notification(TenantModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    text = models.CharField(max_length=300)
    kind = models.CharField(max_length=12, default="systeme")
    page = models.CharField(max_length=20, blank=True)  # page de l'interface à ouvrir
    read = models.BooleanField(default=False)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created", "-id"]
        indexes = [models.Index(fields=["user", "read"])]


class PushSubscription(models.Model):
    """Un appareil (téléphone, ordinateur) qui reçoit les notifications en alerte, même application fermée (Web Push).

    Rattaché au compte et non à l'établissement : l'envoi part de `notify`, parfois hors requête (tâche de fond).
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions")
    endpoint = models.URLField(max_length=500, unique=True)   # adresse fournie par le service d'alertes du navigateur
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    app_url = models.CharField(max_length=300, blank=True)    # page ouverte quand on touche l'alerte
    created = models.DateTimeField(auto_now_add=True)
