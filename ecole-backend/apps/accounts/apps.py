from django.apps import AppConfig
from django.db.models.signals import post_save


def _school_created(sender, instance, created, **kw):
    if created:
        from .roles import ensure_roles
        ensure_roles(instance.pk)


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"
    verbose_name = "Comptes"

    def ready(self):
        from apps.core.models import Etablissement
        post_save.connect(_school_created, sender=Etablissement, dispatch_uid="roles_for_new_school")
