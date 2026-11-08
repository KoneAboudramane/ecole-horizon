"""Alertes sur le téléphone (Web Push) : gratuites, envoyées par le service d'alertes du navigateur (Google, Apple, Mozilla).

Chaque notification créée par `notify` part aussi en alerte vers les appareils que la personne a activés.
Sans clés VAPID configurées (WEBPUSH_PUBLIC_KEY / WEBPUSH_PRIVATE_KEY), rien n'est envoyé.
"""
import json
import logging
import threading
from urllib.parse import urlsplit

from django.conf import settings
from django.db import connection, transaction

from .models import PushSubscription

log = logging.getLogger(__name__)

# Services d'alertes des navigateurs : le serveur n'envoie qu'à ces adresses (jamais à une adresse quelconque fournie par un client)
PUSH_HOSTS = ("fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com")


def enabled() -> bool:
    return bool(settings.WEBPUSH_PUBLIC_KEY and settings.WEBPUSH_PRIVATE_KEY)


def allowed_endpoint(url: str) -> bool:
    parts = urlsplit(url)
    host = parts.hostname or ""
    return parts.scheme == "https" and any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)


def send(user_ids, text: str, page: str = "", title: str = "") -> None:
    """Envoie l'alerte aux appareils de ces comptes, après validation de la transaction, sans faire attendre la requête."""
    if not enabled():
        return
    subs = list(PushSubscription.objects.filter(user_id__in=list(user_ids)).values("id", "endpoint", "p256dh", "auth", "app_url"))
    if subs:
        transaction.on_commit(lambda: _start(subs, text, page, title))


def _start(subs, text, page, title):
    def run():
        try:
            deliver(subs, text, page, title)
        finally:
            connection.close()   # connexion propre à ce fil
    threading.Thread(target=run, daemon=True).start()


def deliver(subs, text, page, title) -> None:
    from pywebpush import WebPushException, webpush

    dead = []
    for s in subs:
        data = json.dumps({"title": title or "Notification de l'école", "body": text, "page": page, "url": s["app_url"]})
        try:
            webpush(subscription_info={"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}},
                    data=data, vapid_private_key=settings.WEBPUSH_PRIVATE_KEY,
                    vapid_claims={"sub": settings.WEBPUSH_SUBJECT}, ttl=86400, timeout=10)
        except WebPushException as e:
            if getattr(e.response, "status_code", None) in (404, 410):   # appareil désabonné ou alerte désactivée
                dead.append(s["id"])
            else:
                log.warning("Alerte non envoyée : %s", e)
        except Exception as e:   # réseau indisponible : la notification reste visible dans l'application
            log.warning("Alerte non envoyée : %s", e)
    if dead:
        PushSubscription.objects.filter(pk__in=dead).delete()
