import pytest

from apps.discipline.models import Incident
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db


def body(w, **kw):
    return {"student": w["A"].pk, "date": "2026-10-01", "type": "bavardage", "gravite": "legere", "sanction": "observation",
            "description": "Bavarde en cours", **kw}


def test_rights(school, users, login, client):
    for r in ("enseignant", "comptable", "admin", "eleve", "parent"):
        login(users[r])
        assert client.post("/api/v1/incidents/", body(school), format="json").status_code == 403, r
    for r in ("enseignant", "comptable", "eleve"):
        login(users[r])
        assert client.get("/api/v1/incidents/").status_code == 403, r
    login(users["educateur"])
    assert client.post("/api/v1/incidents/", body(school), format="json").status_code == 201


def test_light_incident_is_validated_and_family_warned(school, users, login, client):
    login(users["educateur"])
    r = client.post("/api/v1/incidents/", body(school, sanction="convocation"), format="json")
    assert r.data["status"] == "valide"
    n = Notification.objects.get(user=school["A"].parent.user, kind="discipline")
    assert "convocation des parents" in n.text
    assert not Notification.objects.filter(user=school["A"].user, kind="discipline").exists()  # l'élève n'est pas prévenu


def test_grave_needs_direction(school, users, login, client):
    login(users["educateur"])
    r = client.post("/api/v1/incidents/", body(school, gravite="grave", type="bagarre", sanction="exclusion_cours"), format="json")
    r2 = client.post("/api/v1/incidents/", body(school, sanction="exclusion_temp"), format="json")
    assert r.data["status"] == r2.data["status"] == "a_valider"
    assert Notification.objects.filter(user=users["directeur"]).count() == 2
    assert not Notification.objects.filter(user=school["A"].parent.user).exists()   # rien à la famille avant validation
    login(school["A"].parent.user)
    assert client.get("/api/v1/incidents/").data["results"] == []                   # invisible pour la famille
    login(users["educateur"])
    assert client.post(f"/api/v1/incidents/{r.data['id']}/decide/", {"accept": True}, format="json").status_code == 403
    login(users["directeur"])
    d = client.post(f"/api/v1/incidents/{r.data['id']}/decide/", {"accept": True, "note": "Confirmé"}, format="json")
    assert d.data["status"] == "valide" and d.data["decision_note"] == "Confirmé"
    assert Notification.objects.filter(user=school["A"].parent.user, kind="discipline").count() == 1
    assert Notification.objects.filter(user=users["educateur"], text__contains="validée").exists()
    assert client.post(f"/api/v1/incidents/{r.data['id']}/decide/", {"accept": False}, format="json").status_code == 400
    client.post(f"/api/v1/incidents/{r2.data['id']}/decide/", {"accept": False}, format="json")
    assert Incident.objects.get(pk=r2.data["id"]).status == "refuse"


def test_direction_own_grave_is_directly_valid(school, users, login, client):
    login(users["directeur"])
    r = client.post("/api/v1/incidents/", body(school, gravite="grave", sanction="exclusion_temp"), format="json")
    assert r.data["status"] == "valide"


def test_parent_sees_only_validated_of_own_children(school, users, login, client):
    login(users["educateur"])
    client.post("/api/v1/incidents/", body(school), format="json")
    client.post("/api/v1/incidents/", body(school, student=school["B"].pk), format="json")
    client.post("/api/v1/incidents/", body(school, gravite="grave"), format="json")   # à valider
    login(school["A"].parent.user)
    rows = client.get("/api/v1/incidents/").data["results"]
    assert len(rows) == 1 and rows[0]["student"] == school["A"].pk and rows[0]["status"] == "valide"


def test_validation(school, users, login, client):
    login(users["educateur"])
    assert client.post("/api/v1/incidents/", body(school, description=" "), format="json").status_code == 400
    assert client.post("/api/v1/incidents/", body(school, date="2999-01-01"), format="json").status_code == 400
    assert client.post("/api/v1/incidents/", body(school, type="inconnu"), format="json").status_code == 400
