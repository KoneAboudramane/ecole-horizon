"""Cloisonnement par cursus (école franco-arabe…) : chaque cursus a ses niveaux, classes, matières, périodes et réglages.
L'interface précise le cursus par l'en-tête `X-Cursus` ; sans en-tête, aucune restriction de cursus (école à un seul cursus)."""
import pytest

from apps.academics.models import Cursus, Level, SchoolClass, SchoolSettings, Subject, Term, bootstrap_cursus, cursus_usage
from apps.core.tenancy import cursus_context

pytestmark = pytest.mark.django_db


@pytest.fixture
def ar(school, users):
    users["directeur"].cursus.clear()            # directeur de toute l'école (par défaut, un directeur travaille dans un cursus)
    c = Cursus.objects.create(nom="Cursus arabe", langue="ar", ordre=1)
    bootstrap_cursus(c)
    with cursus_context(c):
        Level.objects.create(name="الأول", order=0)
        SchoolClass.objects.create(name="6e A", level="الأول", groupe="الأول", cycle="college")      # même nom qu'une classe du cursus français
        Subject.objects.create(code="ma", name="الرياضيات", short="رياضيات")                       # même code qu'une matière du cursus français
    return c


def h(c):
    return {"HTTP_X_CURSUS": str(c.pk)}


def test_each_cursus_sees_only_its_own_classes_levels_and_subjects(school, ar, users, login):
    fr = Cursus.objects.exclude(pk=ar.pk).get()
    c = login(users["directeur"])
    classes_ar = [x["name"] for x in c.get("/api/v1/classes/", **h(ar)).json()]
    classes_fr = [x["name"] for x in c.get("/api/v1/classes/", **h(fr)).json()]
    assert classes_ar == ["6e A"] and "6e A" in classes_fr and len(classes_fr) > 1
    assert [x["name"] for x in c.get("/api/v1/levels/", **h(ar)).json()] == ["الأول"]
    assert [x["name"] for x in c.get("/api/v1/subjects/", **h(ar)).json()] == ["الرياضيات"]
    assert "الرياضيات" not in [x["name"] for x in c.get("/api/v1/subjects/", **h(fr)).json()]


def test_creations_go_to_the_chosen_cursus(school, ar, users, login):
    c = login(users["admin"])
    r = c.post("/api/v1/classes/", {"name": "6e B", "level": "الأول", "max_students": 30}, format="json", **h(ar))
    assert r.status_code == 201 and SchoolClass.objects.get(pk=r.json()["id"]).cursus_id == ar.pk
    assert c.post("/api/v1/classes/", {"name": "6e B", "level": "الأول", "max_students": 30}, format="json", **h(ar)).status_code == 400   # déjà pris dans ce cursus


def test_periods_and_settings_belong_to_each_cursus(school, ar, users, login):
    fr = Cursus.objects.exclude(pk=ar.pk).get()
    assert Term.objects.filter(cursus=ar).count() == Term.objects.filter(cursus=fr).count() == 3      # périodes reprises du premier cursus
    c = login(users["directeur"])
    assert c.patch("/api/v1/settings/", {"template": "moderne", "name": "Groupe scolaire Horizon"}, format="json", **h(ar)).status_code == 200
    with cursus_context(ar):
        s_ar = SchoolSettings.load()
    with cursus_context(fr):
        s_fr = SchoolSettings.load()
    assert s_ar.template == "moderne" and s_fr.template != "moderne"            # propre au cursus
    assert s_ar.name == s_fr.name == "Groupe scolaire Horizon"                    # commun à l'école


def test_unknown_cursus_header_is_ignored(school, ar, users, login):
    c = login(users["directeur"])
    names = [x["name"] for x in c.get("/api/v1/classes/", HTTP_X_CURSUS="999999").json()]
    assert names.count("6e A") == 2                                              # aucun filtre de cursus


def test_cursus_with_data_cannot_be_removed(school, ar):
    assert cursus_usage(ar) > 0
    empty = Cursus.objects.create(nom="Cursus anglophone", langue="en", ordre=2)
    bootstrap_cursus(empty)
    assert cursus_usage(empty) == 0                                               # ses périodes ne comptent pas
    empty.delete()
    assert not Term.objects.filter(cursus_id=empty.pk).exists()
