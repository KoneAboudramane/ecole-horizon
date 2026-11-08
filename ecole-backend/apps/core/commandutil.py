from contextlib import contextmanager

from django.core.management.base import CommandError

from .models import Etablissement
from .tenancy import UNSET, current, default_etablissement_id, tenant_context


def add_ecole_option(parser):
    parser.add_argument("--ecole", default="", help="Code de l'établissement visé (par défaut : l'établissement principal).")


@contextmanager
def in_school(code: str = ""):
    """Exécute une commande dans un établissement : celui du code donné, sinon celui déjà en cours, sinon le premier."""
    code = (code or "").strip().lower()
    if code:
        etab = Etablissement.objects.filter(code=code).first()
        if etab is None:
            raise CommandError(f"Établissement « {code} » introuvable. Créez-le avec : python manage.py init_school --ecole {code} ...")
        with tenant_context(etab):
            yield etab
    elif current() is not UNSET:
        yield Etablissement.objects.filter(pk=current()).first()
    else:
        etab = Etablissement.objects.get(pk=default_etablissement_id())
        with tenant_context(etab):
            yield etab
