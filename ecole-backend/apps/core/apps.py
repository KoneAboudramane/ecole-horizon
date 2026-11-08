from django.apps import AppConfig
from django.db.models.signals import post_migrate


def _create_cache_table(sender, using="default", **kwargs):
    """Crée la table du cache partagé (DatabaseCache) après `migrate` : aucune commande à retenir en production."""
    from django.conf import settings
    from django.core.management import call_command
    if any(c.get("BACKEND", "").endswith("DatabaseCache") for c in settings.CACHES.values()):
        call_command("createcachetable", database=using, verbosity=0)


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    verbose_name = "Noyau"

    def ready(self):
        from . import schema  # noqa: F401  (enregistre l'extension OpenAPI)
        post_migrate.connect(_create_cache_table, sender=self, dispatch_uid="ecole_create_cache_table")
