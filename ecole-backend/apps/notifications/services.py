from apps.accounts.models import User

from . import push
from .models import Notification


def notify(users, text: str, kind: str = "systeme", page: str = "") -> int:
    """Crée une notification par destinataire actif (doublons ignorés). `users` : comptes ou identifiants."""
    ids = {getattr(u, "pk", u) for u in users}
    targets = User.objects.filter(pk__in=ids, is_active=True)
    Notification.objects.bulk_create([Notification(user=u, text=text[:300], kind=kind, page=page) for u in targets])
    if push.enabled():   # alerte sur le téléphone, au nom de l'école
        by_school: dict[str, list[int]] = {}
        for pk, nom in targets.values_list("pk", "etablissement__nom"):
            by_school.setdefault(nom or "", []).append(pk)
        for nom, pks in by_school.items():
            push.send(pks, text[:300], page, nom)
    return targets.count()


def family_users(student) -> list:
    """Comptes à prévenir pour un élève : le parent et l'élève lui-même."""
    return [student.parent.user, student.user]


def users_with_role(role: str):
    return User.objects.filter(role=role, is_active=True)
