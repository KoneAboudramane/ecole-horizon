"""Service informatique : gère les comptes du personnel et l'habillage, sans voir les données scolaires ni financières."""
import pytest

from apps.core.permissions import PERMS

pytestmark = pytest.mark.django_db
U = "/api/v1/users/"


@pytest.mark.parametrize("url", [
    "/api/v1/students/", "/api/v1/finance/payments/", "/api/v1/finance/overview/", "/api/v1/finance/statement/",
    "/api/v1/evaluations/", "/api/v1/results/", "/api/v1/incidents/", "/api/v1/absences/", "/api/v1/mock-exams/",
    "/api/v1/council/", "/api/v1/decisions/", "/api/v1/timetable/", "/api/v1/textbook/",
])
def test_it_sees_no_school_or_financial_data(users, login, url):
    assert login(users["informatique"]).get(url).status_code in (403, 404), url


def test_it_cannot_write_school_data(users, login):
    c = login(users["informatique"])
    assert c.post("/api/v1/students/", {"nom": "A", "prenoms": "B"}, format="json").status_code == 403
    assert c.post("/api/v1/evaluations/publish/", {}, format="json").status_code == 403
    assert c.post("/api/v1/finance/payments/", {}, format="json").status_code == 403
    assert c.post("/api/v1/plateforme/etablissements/", {"code": "x", "nom": "X"}, format="json").status_code in (403, 404)


def test_it_reads_journal_but_other_roles_unchanged(users, login):
    assert login(users["informatique"]).get("/api/v1/journal/").status_code == 200
    assert PERMS["informatique"] == {"accounts", "journal.sys", "settings.tech"}


def test_it_manages_staff_accounts(users, login, make_user):
    c = login(users["informatique"])
    r = c.post(U, {"name": "Nouvel Agent", "role": "enseignant", "username": "ag1", "email": "ag1@ecole.test"}, format="json")
    assert r.status_code == 201
    uid = r.data["user"]["id"]
    assert c.post(f"{U}{uid}/reset-password/").status_code == 200
    assert c.post(f"{U}{uid}/toggle-active/").status_code == 200
    assert c.patch(f"{U}{uid}/", {"name": "Agent Renommé"}, format="json").status_code == 200
    assert c.post(U, {"name": "Aide Info", "role": "informatique", "username": "info2", "email": "info2@ecole.test"}, format="json").status_code == 201


@pytest.mark.parametrize("target", ["directeur", "fondateur"])
def test_it_cannot_touch_direction_or_founder(users, login, target):
    c = login(users["informatique"])
    assert c.post(U, {"name": "Faux Chef", "role": target, "username": "faux1", "email": "faux1@ecole.test"}, format="json").status_code == 403
    pk = users[target].pk
    assert c.post(f"{U}{pk}/reset-password/").status_code == 403
    assert c.post(f"{U}{pk}/toggle-active/").status_code == 403
    assert c.patch(f"{U}{pk}/", {"name": "Pirate"}, format="json").status_code == 403


def test_it_cannot_promote_someone_to_direction(users, login, make_user):
    c = login(users["informatique"])
    t = make_user("enseignant", username="ens9")
    assert c.patch(f"{U}{t.pk}/", {"role": "directeur"}, format="json").status_code == 403
    t.refresh_from_db()
    assert t.role == "enseignant"


def test_secretariat_can_still_manage_direction(users, login):
    c = login(users["admin"])
    assert c.post(f"{U}{users['directeur'].pk}/reset-password/").status_code == 200


def test_it_only_changes_branding(users, login):
    c = login(users["informatique"])
    assert c.patch("/api/v1/settings/", {"hue": 200}, format="json").status_code == 200
    assert c.patch("/api/v1/settings/", {"name": "Collège Test"}, format="json").status_code == 200
    for bad in ({"compo_weight": 3}, {"seuils": [5, 10, 12, 15]}, {"hue": 100, "remise_fratrie": 50}):
        assert c.patch("/api/v1/settings/", bad, format="json").status_code == 403


def test_other_roles_still_blocked_from_settings(users, login):
    assert login(users["comptable"]).patch("/api/v1/settings/", {"hue": 10}, format="json").status_code == 403
