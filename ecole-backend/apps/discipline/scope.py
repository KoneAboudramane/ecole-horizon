"""Classes confiées à un éducateur. Sans attribution, l'éducateur garde la vue de toute l'école (écoles qui n'utilisent pas la fonction)."""

from .models import EducatorClass


def educator_scope(user):
    """None : aucune restriction. Sinon l'ensemble des identifiants de classes de l'éducateur."""
    if getattr(user, "role", "") != "educateur":
        return None
    ids = set(EducatorClass.objects.filter(educateur=user).values_list("school_class_id", flat=True))
    return ids or None


def in_scope(user, class_id) -> bool:
    sc = educator_scope(user)
    return sc is None or class_id in sc


def educators_of(class_id):
    """Éducateurs à prévenir pour une classe : ceux qui l'ont reçue, sinon (aucune attribution) tous les éducateurs sans classes."""
    from django.contrib.auth import get_user_model
    U = get_user_model()
    mine = U.objects.filter(role="educateur", is_active=True, classes_educateur__school_class_id=class_id).distinct()
    if mine.exists():
        return mine
    return U.objects.filter(role="educateur", is_active=True, classes_educateur__isnull=True)
