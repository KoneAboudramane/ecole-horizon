"""Cursus d'une école : chaque école naît avec le cursus français ; l'administrateur de la plateforme en ajoute d'autres
(arabe ou autre) à la demande de l'école, les modifie et retire un cursus vide."""
import pytest

from apps.academics.models import Cursus
from apps.core.models import PlatformLog
from apps.core.tenancy import tenant_context

from .test_platform_portal import ecole, root  # noqa: F401  (fixtures)

pytestmark = pytest.mark.django_db
P = "/api/v1/plateforme/etablissements/"


def test_a_new_school_starts_with_the_french_cursus(ecole):  # noqa: F811
    assert [(c.nom, c.langue) for c in Cursus.all_objects.filter(etablissement=ecole)] == [("Cursus français", "fr")]


def test_platform_admin_adds_edits_and_removes_a_cursus(root, ecole):  # noqa: F811
    r = root.post(f"{P}{ecole.pk}/cursus/", {"nom": "Cursus arabe", "langue": "ar", "nom_ecole": "مدرسة الأفق"}, format="json")
    assert r.status_code == 201 and [c["nom"] for c in r.json()] == ["Cursus français", "Cursus arabe"]
    ar = r.json()[1]
    assert ar["langue"] == "ar" and ar["nom_ecole"] == "مدرسة الأفق" and ar["donnees"] == 0
    assert root.post(f"{P}{ecole.pk}/cursus/", {"nom": "cursus ARABE", "langue": "ar"}, format="json").status_code == 400   # nom déjà pris
    assert root.post(f"{P}{ecole.pk}/cursus/", {"nom": "Cursus anglophone", "langue": "xx"}, format="json").status_code == 400
    r = root.patch(f"{P}{ecole.pk}/cursus/{ar['id']}/", {"nom": "Cursus franco-arabe"}, format="json")
    assert r.status_code == 200 and r.json()[1]["nom"] == "Cursus franco-arabe"
    assert root.get(f"{P}{ecole.pk}/").json()["cursus"][1]["nom"] == "Cursus franco-arabe"     # visible sur la fiche école
    r = root.post(f"{P}{ecole.pk}/cursus/{ar['id']}/retirer/")
    assert r.status_code == 200 and len(r.json()) == 1
    assert PlatformLog.objects.filter(action__in=["Cursus ajouté", "Cursus modifié", "Cursus retiré"]).count() == 3


def test_a_school_always_keeps_one_cursus(root, ecole):  # noqa: F811
    fr = Cursus.all_objects.get(etablissement=ecole)
    r = root.post(f"{P}{ecole.pk}/cursus/{fr.pk}/retirer/")
    assert r.status_code == 400 and Cursus.all_objects.filter(etablissement=ecole).exists()


def test_cursus_of_another_school_is_out_of_reach(root, ecole):  # noqa: F811
    from apps.core.schools import create_school
    other, _ = create_school(code="autre", nom="Autre", director="M. X")
    c = Cursus.all_objects.get(etablissement=other)
    assert root.patch(f"{P}{ecole.pk}/cursus/{c.pk}/", {"nom": "Piraté"}, format="json").status_code == 404
    assert root.post(f"{P}{ecole.pk}/cursus/{c.pk}/retirer/").status_code == 404


def test_only_platform_admins_manage_cursus(ecole, make_user):  # noqa: F811
    from rest_framework.test import APIClient
    c = APIClient()
    with tenant_context(ecole):
        boss = make_user("directeur", "boss2")
    c.force_authenticate(boss)
    assert c.post(f"{P}{ecole.pk}/cursus/", {"nom": "X", "langue": "fr"}, format="json").status_code == 403


def test_school_users_read_their_cursus(users, login):
    r = login(users["directeur"]).get("/api/v1/cursus/")
    assert r.status_code == 200 and [c["nom"] for c in r.json()] == ["Cursus français"] and r.json()[0]["rtl"] is False
