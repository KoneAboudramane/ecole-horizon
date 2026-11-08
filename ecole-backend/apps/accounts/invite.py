"""Envoi des accès par e-mail : identifiant et mot de passe provisoire (à changer à la première connexion)."""
import logging

from django.conf import settings
from django.core.mail import send_mail

log = logging.getLogger(__name__)


def _base(request) -> str:
    return settings.PUBLIC_BASE_URL or request.build_absolute_uri("/").rstrip("/")


def send_access(request, user, password: str, *, etab=None, new: bool = True) -> bool | None:
    """Envoie à la personne son identifiant et son mot de passe provisoire. Renvoie None s'il n'y a pas d'e-mail,
    vrai si le message est parti, faux sinon ; ne lève jamais d'erreur (la fiche d'accès reste la solution de secours)."""
    if not user.email:
        return None
    if etab is None:
        where, url = "l’administration de la plateforme", f"{_base(request)}/plateforme.html"
        login = f"Adresse de connexion : {url}\nIdentifiant : {user.username}\nMot de passe provisoire : {password}"
    else:
        where, url = etab.nom, f"{_base(request)}/?ecole={etab.code}"
        login = f"Adresse de connexion : {url}\nCode de l’école : {etab.code}\nIdentifiant : {user.username}\nMot de passe provisoire : {password}"
    intro = f"Un compte vient d’être créé pour vous sur l’espace en ligne de {where}." if new else f"Un nouveau mot de passe provisoire a été créé pour votre compte sur l’espace en ligne de {where}."
    body = (f"Bonjour {user.full_name},\n\n{intro}\n\nVoici vos accès :\n\n{login}\n\n"
            "À votre première connexion, il vous sera demandé de choisir votre propre mot de passe. Ne communiquez ce message à personne et supprimez-le ensuite.\n"
            "Si vous n’attendiez pas ce message, ignorez-le et prévenez l’administration.\n")
    try:
        send_mail(f"Vos accès – {where}", body, settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False)
        return True
    except Exception:  # noqa: BLE001 — serveur d'e-mail absent ou en panne : on le dit, sans bloquer la création
        log.warning("Accès non envoyés à %s", user.username, exc_info=True)
        return False
