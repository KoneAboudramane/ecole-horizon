import pytest

from apps.core.models import ActivityLog

pytestmark = pytest.mark.django_db
LOGIN = "/api/v1/auth/login/"


def test_login_ok_returns_tokens_and_profile(client, make_user):
    make_user("directeur", password="secret1")
    r = client.post(LOGIN, {"username": "directeur", "password": "secret1"}, format="json")
    assert r.status_code == 200
    assert {"access", "refresh", "user"} <= set(r.data)
    assert r.data["user"]["role"] == "directeur"
    assert "publish" in r.data["user"]["permissions"]
    assert ActivityLog.objects.filter(action="Connexion").exists()


def test_login_username_is_case_insensitive(client, make_user):
    make_user("comptable", username="Soro")
    assert client.post(LOGIN, {"username": "soro", "password": "secret1"}, format="json").status_code == 200


def test_wrong_password_and_unknown_user_give_same_message(client, make_user):
    make_user("eleve")
    a = client.post(LOGIN, {"username": "eleve", "password": "nope"}, format="json")
    b = client.post(LOGIN, {"username": "inconnu", "password": "nope"}, format="json")
    assert a.status_code == b.status_code == 401
    assert a.data["detail"] == b.data["detail"]  # on ne révèle pas si l'identifiant existe


def test_inactive_account_cannot_login(client, make_user):
    make_user("parent", is_active=False)
    r = client.post(LOGIN, {"username": "parent", "password": "secret1"}, format="json")
    assert r.status_code == 403 and "désactivé" in r.data["detail"]


def test_inactive_account_does_not_leak_without_password(client, make_user):
    make_user("parent", is_active=False)
    r = client.post(LOGIN, {"username": "parent", "password": "wrong"}, format="json")
    assert r.status_code == 401


def test_lockout_after_repeated_failures(client, make_user, settings):
    settings.LOGIN_MAX_ATTEMPTS = 3
    make_user("eleve")
    for _ in range(3):
        assert client.post(LOGIN, {"username": "eleve", "password": "bad"}, format="json").status_code == 401
    r = client.post(LOGIN, {"username": "eleve", "password": "secret1"}, format="json")  # même le bon mot de passe
    assert r.status_code == 429


def test_success_resets_failure_counter(client, make_user, settings):
    settings.LOGIN_MAX_ATTEMPTS = 3
    u = make_user("eleve")
    client.post(LOGIN, {"username": "eleve", "password": "bad"}, format="json")
    client.post(LOGIN, {"username": "eleve", "password": "bad"}, format="json")
    assert client.post(LOGIN, {"username": "eleve", "password": "secret1"}, format="json").status_code == 200
    u.refresh_from_db()
    assert u.failed_attempts == 0


def test_protected_endpoint_requires_token(client):
    assert client.get("/api/v1/me/").status_code == 401


def test_refresh_rotates_and_logout_blacklists(client, make_user):
    make_user("directeur")
    tokens = client.post(LOGIN, {"username": "directeur", "password": "secret1"}, format="json").data
    r = client.post("/api/v1/auth/refresh/", {"refresh": tokens["refresh"]}, format="json")
    assert r.status_code == 200 and r.data["refresh"] != tokens["refresh"]
    # l'ancien jeton de rafraîchissement ne peut plus servir (rotation + liste noire)
    assert client.post("/api/v1/auth/refresh/", {"refresh": tokens["refresh"]}, format="json").status_code == 401
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    assert client.post("/api/v1/auth/logout/", {"refresh": r.data["refresh"]}, format="json").status_code == 204
    assert client.post("/api/v1/auth/refresh/", {"refresh": r.data["refresh"]}, format="json").status_code == 401


def test_deactivated_user_token_stops_working(client, make_user, login):
    u = make_user("comptable")
    login(u)
    u.is_active = False
    u.save()
    assert client.get("/api/v1/me/").status_code == 401


def test_health_is_public(client):
    r = client.get("/api/v1/health/")
    assert r.status_code == 200 and r.data == {"status": "ok"}
