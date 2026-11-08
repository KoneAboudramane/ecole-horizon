"""Périmètre de cursus d'un compte (école à plusieurs cursus : français, arabe…).

Fondateur, secrétariat, comptable, informatique : tous les cursus par défaut. Directeur, éducateur et rôles créés par l'école :
un seul cursus par défaut (l'école peut l'élargir). Enseignant : les cursus où il a des classes. Parent et élève : ceux de leurs
enfants ou de leurs inscriptions. Un compte du personnel sans cursus attribué voit tous les cursus.
Personne ne donne un périmètre plus large que le sien, ni ne gère un compte qui sort de son périmètre.
"""
from django.db.models import Q

ONE_CURSUS_ROLES = ("directeur", "educateur", "personnel")


def allowed_cursus(user) -> set[int] | None:
    """Cursus où le compte travaille ; None = tous. Parent et élève : non limités ici (leurs données le sont déjà)."""
    if user.role in ("parent", "eleve") or not user.etablissement_id:
        return None
    if user.role == "enseignant":
        from apps.academics.models import TeachingAssignment
        ids = set(TeachingAssignment.all_objects.filter(teacher__user=user).values_list("school_class__cursus_id", flat=True)) - {None}
        return ids or None
    ids = set(user.cursus.values_list("pk", flat=True))
    return ids or None


def scope_of(user) -> set[int] | None:
    """Cursus que concerne un compte (pour savoir qui peut le gérer) ; None = toute l'école."""
    from apps.students.models import Student
    if user.role == "parent":
        return set(Student._base_manager.filter(parent__user=user).values_list("cursus_id", flat=True)) - {None} or None
    if user.role == "eleve":
        return set(Student._base_manager.filter(user=user).values_list("cursus_id", flat=True)) - {None} or None
    return allowed_cursus(user)


def all_cursus_ids() -> set[int]:
    from apps.academics.models import Cursus
    return set(Cursus.objects.values_list("pk", flat=True))


def sees_all_cursus(user) -> bool:
    a = allowed_cursus(user)
    return a is None or all_cursus_ids() <= a


def may_manage_scope(actor, target) -> bool:
    """Un compte limité à certains cursus ne gère que les comptes de ces cursus."""
    a = allowed_cursus(actor)
    if a is None or all_cursus_ids() <= a:
        return True
    t = scope_of(target)
    return t is not None and t <= a


def manageable(actor, qs):
    """Comptes qu'un compte limité à certains cursus peut voir dans la gestion des comptes."""
    a = allowed_cursus(actor)
    if a is None or all_cursus_ids() <= a:
        return qs
    outside = all_cursus_ids() - a
    staff = ~Q(role__in=("enseignant", "parent", "eleve")) & Q(cursus__in=a) & ~Q(cursus__in=outside)
    return qs.filter(staff | Q(role="enseignant", teacher__assignments__school_class__cursus__in=a)
                     | Q(role="parent", parent_profile__children__cursus__in=a) | Q(role="eleve", student_profiles__cursus__in=a)).distinct()


def default_cursus_for(role: str, actor) -> list[int]:
    """Périmètre d'un nouveau compte quand il n'est pas précisé : le cursus courant pour un directeur, un éducateur ou un rôle
    créé par l'école ; tous les cursus pour les autres."""
    if role not in ONE_CURSUS_ROLES:
        return []
    from apps.core.tenancy import UNSET, current_cursus, current_or_default, default_cursus_id
    cur = current_cursus()
    if cur is not UNSET:
        return [cur]
    a = allowed_cursus(actor)
    return [min(a)] if a else [default_cursus_id(current_or_default())]


def assign_error(actor, ids: list[int]) -> str | None:
    """Raison pour laquelle `actor` ne peut pas donner ce périmètre (None : il peut). Liste vide = tous les cursus."""
    known = all_cursus_ids()
    if not set(ids) <= known:
        return "Cursus inconnu dans votre école."
    a = allowed_cursus(actor)
    if a is None or known <= a:
        return None
    if not ids:
        return "Vous ne pouvez pas donner accès à tous les cursus : votre propre accès est limité."
    if not set(ids) <= a:
        return "Vous ne pouvez donner accès qu’aux cursus de votre propre périmètre."
    return None
