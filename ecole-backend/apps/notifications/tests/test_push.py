import json
from types import SimpleNamespace

import pytest

from apps.notifications import push
from apps.notifications.models import PushSubscription
from apps.notifications.services import notify

pytestmark = pytest.mark.django_db
P = "/api/v1/notifications/push/"
FCM = "https://fcm.googleapis.com/fcm/send/abc123"
KEYS = {"p256dh": "BPkey", "auth": "authkey"}


@pytest.fixture
def push_on(settings):
    settings.WEBPUSH_PUBLIC_KEY, settings.WEBPUSH_PRIVATE_KEY, settings.WEBPUSH_SUBJECT = "PUB", "PRIV", "mailto:test@ecole.test"


@pytest.fixture
def push_off(settings):
    settings.WEBPUSH_PUBLIC_KEY = settings.WEBPUSH_PRIVATE_KEY = ""


@pytest.fixture
def sent(monkeypatch):
    """Alertes envoyées (sans réseau ni fil d'exécution) : liste de (adresse, contenu)."""
    out = []

    def fake_webpush(subscription_info, data, **kw):
        if subscription_info["endpoint"].endswith("/parti"):
            from pywebpush import WebPushException
            raise WebPushException("gone", response=SimpleNamespace(status_code=410))
        out.append((subscription_info["endpoint"], json.loads(data)))

    monkeypatch.setattr("pywebpush.webpush", fake_webpush)
    monkeypatch.setattr(push, "_start", push.deliver)
    return out


def test_config_without_keys(push_off, users, login, client):
    login(users["parent"])
    assert client.get(P).data == {"enabled": False, "public_key": ""}
    r = client.post(P + "subscribe/", {"endpoint": FCM, "keys": KEYS}, format="json")
    assert r.status_code == 503


def test_subscribe_and_unsubscribe(push_on, users, login, client):
    login(users["parent"])
    assert client.get(P).data == {"enabled": True, "public_key": "PUB"}
    r = client.post(P + "subscribe/", {"endpoint": FCM, "keys": KEYS, "app_url": "https://ecole.ci/"}, format="json")
    assert r.status_code == 200
    s = PushSubscription.objects.get()
    assert (s.user, s.app_url) == (users["parent"], "https://ecole.ci/")
    login(users["eleve"])                                       # même appareil, autre compte : l'appareil change de compte
    client.post(P + "subscribe/", {"endpoint": FCM, "keys": KEYS}, format="json")
    assert PushSubscription.objects.get().user == users["eleve"]
    login(users["parent"])
    assert client.post(P + "unsubscribe/", {"endpoint": FCM}, format="json").data == {"deleted": 0}   # plus le sien
    login(users["eleve"])
    assert client.post(P + "unsubscribe/", {"endpoint": FCM}, format="json").data == {"deleted": 1}


def test_refuses_unknown_push_service(push_on, users, login, client):
    login(users["parent"])
    for bad in ("https://evil.example.com/x", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.com/x"):
        r = client.post(P + "subscribe/", {"endpoint": bad, "keys": KEYS}, format="json")
        assert r.status_code == 400, bad
    assert not PushSubscription.objects.exists()


def test_requires_login(client):
    assert client.get(P).status_code == 401


def test_notify_sends_alert(push_on, sent, users, django_capture_on_commit_callbacks):
    parent = users["parent"]
    PushSubscription.objects.create(user=parent, endpoint=FCM, p256dh="k", auth="a", app_url="https://ecole.ci/")
    PushSubscription.objects.create(user=parent, endpoint="https://fcm.googleapis.com/fcm/send/parti", p256dh="k", auth="a")
    with django_capture_on_commit_callbacks(execute=True):
        notify([parent, users["comptable"]], "Awa absente ce matin", kind="absence", page="presences")
    assert len(sent) == 1
    endpoint, data = sent[0]
    assert endpoint == FCM
    assert data["body"] == "Awa absente ce matin" and data["page"] == "presences" and data["url"] == "https://ecole.ci/"
    assert data["title"] == parent.etablissement.nom
    assert list(PushSubscription.objects.values_list("endpoint", flat=True)) == [FCM]   # appareil désabonné retiré


def test_notify_without_keys_sends_nothing(push_off, sent, users, django_capture_on_commit_callbacks):
    PushSubscription.objects.create(user=users["parent"], endpoint=FCM, p256dh="k", auth="a")
    with django_capture_on_commit_callbacks(execute=True):
        notify([users["parent"]], "Bulletin disponible")
    assert sent == []
