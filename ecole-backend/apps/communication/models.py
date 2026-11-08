from django.conf import settings
from django.db import models

from apps.core.tenancy import TenantModel


class Announcement(TenantModel):
    title = models.CharField(max_length=120)
    body = models.TextField(max_length=3000)
    audience = models.JSONField(default=list)  # liste de rôles destinataires
    # École à plusieurs cursus : cursus concernés ; aucun = toute l'école
    cursus = models.ManyToManyField("academics.Cursus", blank=True, related_name="+", verbose_name="cursus concernés")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created", "-id"]


class Thread(TenantModel):
    subject = models.CharField(max_length=150)
    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    participants = models.ManyToManyField(settings.AUTH_USER_MODEL, through="Participant", related_name="threads")
    updated = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-updated", "-id"]


class Participant(TenantModel):
    thread = models.ForeignKey(Thread, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    read_count = models.PositiveIntegerField(default=0)  # nombre de messages déjà vus

    class Meta:
        constraints = [models.UniqueConstraint(fields=["thread", "user"], name="one_member")]


class Message(TenantModel):
    thread = models.ForeignKey(Thread, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    text = models.TextField(max_length=3000)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created", "id"]
