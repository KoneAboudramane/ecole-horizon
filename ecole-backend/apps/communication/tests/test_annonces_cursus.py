"""Annonces d'une école à plusieurs cursus : une annonce vise toute l'école ou un cursus ; seules les familles, élèves et
membres du personnel de ce cursus la voient et sont notifiés. Un auteur limité à un cursus ne publie que pour celui-ci."""
import pytest

from apps.academics.models import Cursus, Level, SchoolClass, bootstrap_cursus
from apps.core.tenancy import cursus_context
from apps.notifications.models import Notification
from apps.students.models import Student

pytestmark = pytest.mark.django_db
A = "/api/v1/announcements/"


@pytest.fixture
def two(school, users, login):
    fr = Cursus.objects.get()
    ar = Cursus.objects.create(nom="Cursus arabe", langue="ar", ordre=1)
    bootstrap_cursus(ar)
    with cursus_context(ar):
        Level.objects.create(name="الأول", order=0)
        k = SchoolClass.objects.create(name="الأول أ", level="الأول", groupe="الأول", cycle="college")
    # B suit aussi le cursus arabe ; A seulement le cursus français
    assert login(users["admin"]).post(f"/api/v1/students/{school['B'].pk}/cursus/", {"cursus": ar.pk, "school_class": k.pk}, format="json").status_code == 201
    return {"fr": fr, "ar": ar}


def titles(c):
    return [a["title"] for a in c.get(A).json()]


def test_announcement_for_one_cursus_reaches_only_its_families(two, school, users, login):
    adm = login(users["admin"])
    r = adm.post(A, {"title": "Fête de l'Aïd", "body": "Pas de cours lundi.", "audience": ["parent", "eleve"], "cursus": [two["ar"].pk]}, format="json")
    assert r.status_code == 201 and r.json()["cursus"] == [two["ar"].pk] and r.json()["cursus_noms"] == ["Cursus arabe"]
    adm.post(A, {"title": "Réunion générale", "body": "Samedi.", "audience": ["parent"], "cursus": []}, format="json")
    assert titles(login(school["B"].parent.user)) == ["Réunion générale", "Fête de l'Aïd"]      # enfant inscrit dans le cursus arabe
    assert titles(login(school["A"].parent.user)) == ["Réunion générale"]                       # cursus français seulement
    assert titles(login(school["B"].user)) == ["Fête de l'Aïd"]
    notified = set(Notification.objects.filter(text__contains="Aïd").values_list("user_id", flat=True))
    assert school["B"].parent.user_id in notified and school["A"].parent.user_id not in notified


def test_author_limited_to_a_cursus_publishes_for_it_only(two, users, login):
    d = users["directeur"]                 # directeur du cursus français (périmètre par défaut)
    c = login(d)
    assert c.post(A, {"title": "X", "body": "x", "audience": ["parent"], "cursus": []}, format="json").status_code == 400
    assert c.post(A, {"title": "Y", "body": "y", "audience": ["parent"], "cursus": [two["ar"].pk]}, format="json").status_code == 400
    r = c.post(A, {"title": "Conseil de classe", "body": "z", "audience": ["parent"]}, format="json")
    assert r.status_code == 201 and r.json()["cursus"] == [two["fr"].pk]                        # par défaut : son cursus
    adm = login(users["admin"])
    adm.post(A, {"title": "Seulement arabe", "body": "w", "audience": ["parent"], "cursus": [two["ar"].pk]}, format="json")
    assert "Seulement arabe" not in titles(login(d))


def test_single_cursus_school_is_unchanged(school, users, login):
    r = login(users["admin"]).post(A, {"title": "Rentrée", "body": "Lundi.", "audience": ["parent"]}, format="json")
    assert r.status_code == 201 and r.json()["cursus"] == []
    assert "Rentrée" in titles(login(school["A"].parent.user))
