import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def _login(u):
    c = APIClient()
    r = c.post("/api/v1/auth/login/", {"username": u, "password": "demo"}, format="json")
    assert r.status_code == 200, (u, r.content)
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    return c


def test_demo_complete_loads_and_links_family(settings):
    settings.DEBUG = True
    call_command("seed_demo", complet=True, verbosity=0)
    for u in ("directeur", "secretariat", "fondateur", "enseignant", "educateur", "comptable", "informatique", "parent", "eleve"):
        _login(u)
    kids = _login("parent").get("/api/v1/students/").data
    kids = kids.get("results", kids)
    assert len(kids) == 2 and {k["nom"] for k in kids} == {"BROU"}
    eleve = _login("eleve").get("/api/v1/students/").data
    assert len(eleve.get("results", eleve)) == 1
    assert _login("parent").get(f"/api/v1/students/{kids[0]['id']}/bulletin.pdf?term=T1").status_code == 200
    call_command("seed_demo", complet=True, verbosity=0)  # rejouable sans doublon
