from django.conf import settings

from .models import ActivityLog
from .tenancy import NO_SCHOOL, UNSET, current, tenant_context


def client_ip(request) -> str | None:
    """Adresse du visiteur. X-Forwarded-For n'est lu que si des mandataires de confiance sont déclarés (NUM_PROXIES) :
    on prend alors l'adresse ajoutée par le dernier d'entre eux, jamais la première (écrite librement par le client).
    Même règle que les limites de débit de Django REST framework."""
    if request is None:
        return None
    n = getattr(settings, "NUM_PROXIES", 0)
    fwd = request.META.get("HTTP_X_FORWARDED_FOR")
    if n > 0 and fwd:
        addrs = [a.strip() for a in fwd.split(",") if a.strip()]
        if addrs:
            return addrs[-min(n, len(addrs))]
    return request.META.get("REMOTE_ADDR") or None


def record(action: str, detail: str = "", *, user=None, request=None) -> ActivityLog:
    """Ajoute une ligne au journal d'activité. `user` par défaut : l'utilisateur de la requête."""
    if user is None and request is not None and getattr(request.user, "is_authenticated", False):
        user = request.user
    if user is None and request is not None and current() is UNSET:
        return None  # appel public (sans école identifiée) : rien à journaliser dans une école
    # L'entrée est rangée dans l'école de la personne ; le super-administrateur hors école n'est pas journalisé ici.
    etab = getattr(user, "etablissement_id", None)
    if etab is None and (current() == NO_SCHOOL or (getattr(user, "is_superuser", False) and current() is UNSET)):
        return None
    with tenant_context(etab if etab else (None if current() is UNSET else current())):
        return ActivityLog.objects.create(user=user, action=action[:80], detail=detail[:300], ip=client_ip(request))


def plog(request, action: str, detail: str = "", *, user=None, etab=None):
    """Journal de la plateforme (actions des administrateurs de la plateforme)."""
    from .models import PlatformLog
    if user is None and request is not None and getattr(request.user, "is_authenticated", False):
        user = request.user
    return PlatformLog.objects.create(user=user, etablissement=etab, action=action[:80], detail=detail[:300], ip=client_ip(request))
