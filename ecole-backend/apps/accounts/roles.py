"""Rôles d'une école : création à partir des rôles par défaut."""
from apps.core.permissions import DEFAULT_PERMS, LOCKED_ROLES, ROLE_LABELS, ROLES


def ensure_roles(etab_id: int) -> None:
    """Crée les rôles par défaut manquants d'une école (ceux déjà présents, éventuellement modifiés, ne sont jamais touchés)."""
    from .models import Role
    have = set(Role.all_objects.filter(etablissement_id=etab_id).values_list("key", flat=True))
    new = [Role(etablissement_id=etab_id, key=r, label=ROLE_LABELS[r], base=r, perms=sorted(DEFAULT_PERMS.get(r, set())),
                locked=r in LOCKED_ROLES, builtin=True) for r in ROLES if r not in have]
    if new:
        Role.all_objects.bulk_create(new)
