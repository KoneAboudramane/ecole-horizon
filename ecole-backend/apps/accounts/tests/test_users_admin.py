import pytest

from apps.core.models import ActivityLog

pytestmark = pytest.mark.django_db
URL = "/api/v1/users/"


@pytest.mark.parametrize("role,allowed", [
    ("admin", True), ("informatique", True), ("directeur", False), ("fondateur", False), ("comptable", False),
    ("enseignant", False), ("educateur", False), ("parent", False), ("eleve", False),
])
def test_only_secretariat_manages_accounts(users, login, role, allowed):
    c = login(users[role])
    assert (c.get(URL).status_code == 200) is allowed
    r = c.post(URL, {"name": "Nouvel Agent", "role": "enseignant", "username": "agent1", "email": "agent1@ecole.test"}, format="json")
    assert (r.status_code == 201) is allowed


def test_create_staff_returns_temporary_password_once(users, login, client):
    c = login(users["admin"])
    r = c.post(URL, {"name": "Koffi Yao", "role": "comptable", "username": "kyao", "email": "kyao@ecole.test", "phone": "05 00 00 00 00"}, format="json")
    assert r.status_code == 201
    pwd = r.data["credentials"]["password"]
    assert len(pwd) >= 8 and r.data["user"]["must_change_password"] is True
    assert "password" not in r.data["user"]
    client.credentials()
    assert client.post("/api/v1/auth/login/", {"username": "kyao", "password": pwd}, format="json").status_code == 200
    assert ActivityLog.objects.filter(action="Compte créé").exists()


def test_create_rejects_parent_eleve_roles_and_duplicates(users, login):
    c = login(users["admin"])
    assert c.post(URL, {"name": "Xx Yy", "role": "parent", "username": "pp1", "email": "pp1@ecole.test"}, format="json").status_code == 400
    assert c.post(URL, {"name": "Xx Yy", "role": "enseignant", "username": "ENSEIGNANT", "email": "enseignant@ecole.test"}, format="json").status_code == 400
    assert c.post(URL, {"name": "Xx Yy", "role": "enseignant", "username": "a b"}, format="json").status_code == 400


def test_reset_password_forces_change_and_unlocks(users, login, make_user, client):
    victim = make_user("enseignant", username="ens2")
    victim.failed_attempts = 4
    victim.save()
    c = login(users["admin"])
    r = c.post(f"{URL}{victim.pk}/reset-password/")
    assert r.status_code == 200
    pwd = r.data["credentials"]["password"]
    victim.refresh_from_db()
    assert victim.must_change_password and victim.failed_attempts == 0
    client.credentials()
    assert client.post("/api/v1/auth/login/", {"username": "ens2", "password": "secret1"}, format="json").status_code == 401
    assert client.post("/api/v1/auth/login/", {"username": "ens2", "password": pwd}, format="json").status_code == 200


def test_reset_password_requires_permission(users, login, make_user):
    victim = make_user("enseignant", username="ens2")
    assert login(users["directeur"]).post(f"{URL}{victim.pk}/reset-password/").status_code == 403


def test_toggle_active_but_never_self(users, login, make_user):
    victim = make_user("educateur", username="edu2")
    c = login(users["admin"])
    r = c.post(f"{URL}{victim.pk}/toggle-active/")
    assert r.status_code == 200 and r.data["is_active"] is False
    assert c.post(f"{URL}{victim.pk}/toggle-active/").data["is_active"] is True
    assert c.post(f"{URL}{users['admin'].pk}/toggle-active/").status_code == 400


def test_admin_update_cannot_change_own_role_or_pupil_role(users, login, make_user):
    kid = make_user("eleve", username="kid")
    c = login(users["admin"])
    assert c.patch(f"{URL}{users['admin'].pk}/", {"role": "directeur"}, format="json").status_code == 400
    assert c.patch(f"{URL}{kid.pk}/", {"role": "enseignant"}, format="json").status_code == 400
    ens = make_user("enseignant", username="ens3")
    r = c.patch(f"{URL}{ens.pk}/", {"role": "educateur", "name": "Nouveau Nom"}, format="json")
    assert r.status_code == 200 and r.data["role"] == "educateur" and r.data["name"] == "Nouveau Nom"


def test_list_filters(users, login, make_user):
    make_user("enseignant", username="ens9", full_name="Zoumana Ali")
    c = login(users["admin"])
    assert {u["username"] for u in c.get(URL, {"q": "zoumana"}).data["results"]} == {"ens9"}
    assert all(u["role"] == "enseignant" for u in c.get(URL, {"role": "enseignant"}).data["results"])


def test_journal_visibility(users, login):
    login(users["enseignant"])
    c = login(users["enseignant"])
    assert c.get("/api/v1/journal/").status_code == 403
    for role in ("admin", "directeur", "fondateur"):
        assert login(users[role]).get("/api/v1/journal/").status_code == 200
