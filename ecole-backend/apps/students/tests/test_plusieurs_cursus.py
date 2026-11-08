"""Élève inscrit dans plusieurs cursus (école franco-arabe…) : une inscription par cursus, reliées à l'inscription principale.
Même personne : un seul compte, même matricule, même parent ; la famille voit ses inscriptions dans tous les cursus."""
import datetime

import pytest

from apps.academics.models import Cursus, Level, SchoolClass, bootstrap_cursus
from apps.core.tenancy import cursus_context
from apps.finance import fees
from apps.students.models import Student

pytestmark = pytest.mark.django_db


@pytest.fixture
def ar(school):
    c = Cursus.objects.create(nom="Cursus arabe", langue="ar", ordre=1)
    bootstrap_cursus(c)
    with cursus_context(c):
        Level.objects.create(name="الثالث", order=0)
        klass = SchoolClass.objects.create(name="3e arabe", level="الثالث", groupe="الثالث", cycle="college")
    return c, klass


def h(c):
    return {"HTTP_X_CURSUS": str(c.pk)}


@pytest.fixture
def both(school, ar, users, login):
    c, klass = ar
    r = login(users["admin"]).post(f"/api/v1/students/{school['A'].pk}/cursus/", {"cursus": c.pk, "school_class": klass.pk}, format="json")
    assert r.status_code == 201, r.json()
    return Student.all_objects.get(principal=school["A"])


def test_secretariat_enrolls_a_student_in_another_cursus(school, ar, both, users, login):
    c, klass = ar
    A = school["A"]
    assert (both.user_id, both.matricule, both.parent_id, both.cursus_id, both.school_class_id) == (A.user_id, A.matricule, A.parent_id, c.pk, klass.pk)
    adm = login(users["admin"])
    fiche = adm.get(f"/api/v1/students/{A.pk}/").json()
    assert [(i["cursus_nom"], i["class_name"]) for i in fiche["inscriptions"]] == [("Cursus arabe", "3e arabe")]
    assert [s["id"] for s in adm.get("/api/v1/students/", **h(c)).json()["results"]] == [both.pk]     # la classe arabe a son élève
    assert both.pk not in [s["id"] for s in adm.get("/api/v1/students/").json()["results"] if s["cursus"] != c.pk]
    again = adm.post(f"/api/v1/students/{A.pk}/cursus/", {"cursus": c.pk, "school_class": klass.pk}, format="json")
    assert again.status_code == 400                                                                    # déjà inscrit dans ce cursus


def test_family_sees_every_cursus(school, both, login):
    A = school["A"]
    for who in (A.parent.user, A.user):
        ids = {s["id"]: s["cursus_nom"] for s in login(who).get("/api/v1/students/").json()["results"]}
        assert ids == {A.pk: "Cursus français", both.pk: "Cursus arabe"}, who.role


def test_identity_is_kept_in_sync(school, both, users, login):
    r = login(users["admin"]).patch(f"/api/v1/students/{school['A'].pk}/", {"prenoms": "Léa Awa"}, format="json")
    assert r.status_code == 200
    both.refresh_from_db()
    assert both.prenoms == "Léa Awa"


def test_fees_are_carried_by_the_main_enrollment(school, both):
    today = datetime.date.today()
    acc = fees.account(both, today)
    assert acc["student"] == school["A"].pk and acc == fees.account(school["A"], today)   # un seul compte : celui de la personne
    assert acc["total"] > 0
    assert fees.sibling_pct(school["B"]) == 0                            # B n'a pas de frère ou sœur : la seconde inscription de A ne compte pas


def test_leaving_one_cursus_keeps_the_account_open(school, both, users, login):
    adm = login(users["admin"])
    assert adm.patch(f"/api/v1/students/{both.pk}/", {"active": False}, format="json", **h(both.cursus)).status_code == 200
    school["A"].user.refresh_from_db()
    assert school["A"].user.is_active


def test_plain_enrollment_of_someone_already_in_another_cursus_is_refused(school, ar, users, login):
    c, klass = ar
    A = school["A"]
    r = login(users["admin"]).post("/api/v1/students/", {"nom": A.nom, "prenoms": A.prenoms, "sexe": A.sexe, "naissance": str(A.naissance),
                                                         "school_class": klass.pk, "parent_name": "M. Aka", "parent_phone": "0101010101"}, format="json", **h(c))
    assert r.status_code == 400 and "autre cursus" in r.json()["detail"]
