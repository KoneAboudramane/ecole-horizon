from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.accounts.models import User

from .models import Teacher


@receiver(post_save, sender=User)
def ensure_teacher_profile(sender, instance, **kwargs):
    """Tout compte au rôle « enseignant » dispose d'une fiche enseignant (créée automatiquement)."""
    if instance.role == "enseignant":
        Teacher.objects.get_or_create(user=instance)
