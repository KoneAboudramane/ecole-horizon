"""Forfait global d'un élève inscrit dans plusieurs cursus : tarif complet de son cursus principal + « tarif en complément »
de chaque autre cursus (fixé par niveau ; vide = tarif complet). Un seul compte, un seul échéancier, un seul reçu."""
import datetime

import pytest

from apps.academics.models import Cursus, Level, SchoolClass, bootstrap_cursus
from apps.core.tenancy import cursus_context
from apps.finance import fees
from apps.finance.models import Tarif
from apps.finance.services import record_payment
from apps.students.models import Student

pytestmark = pytest.mark.django_db
TODAY = datetime.date.today()


@pytest.fixture
def ar(school, users, login):
    c = Cursus.objects.create(nom="Cursus arabe", langue="ar", ordre=1)
    bootstrap_cursus(c)
    with cursus_context(c):
        Level.objects.create(name="الأول", order=0)
        k = SchoolClass.objects.create(name="الأول أ", level="الأول", groupe="الأول", cycle="college")
        t = Tarif.objects.create(level="الأول", ins=10000, sco=50000, complement=40000)
    r = login(users["admin"]).post(f"/api/v1/students/{school['A'].pk}/cursus/", {"cursus": c.pk, "school_class": k.pk}, format="json")
    assert r.status_code == 201
    return {"cursus": c, "class": k, "tarif": t, "second": Student.all_objects.get(principal=school["A"])}


def test_forfait_is_main_tariff_plus_complement(school, ar):
    alone = fees.account(school["B"], TODAY)["total"]                   # même classe que A, un seul cursus
    acc = fees.account(school["A"], TODAY)
    assert acc["total"] == alone + 40000
    assert [(d["cursus"], d["label"], d["amount"]) for d in acc["cursus_detail"]] == [("Cursus français", "Scolarité", alone), ("Cursus arabe", "Complément", 40000)]
    assert fees.account(ar["second"], TODAY) == acc                       # l'inscription arabe renvoie le compte de la personne


def test_without_complement_the_full_tariff_is_added(school, ar):
    alone = fees.account(school["B"], TODAY)["total"]
    Tarif.all_objects.filter(pk=ar["tarif"].pk).update(complement=None)
    assert fees.account(school["A"], TODAY)["total"] == alone + 60000     # inscription + scolarité du cursus arabe


def test_a_payment_on_any_enrollment_goes_to_the_single_account(school, ar):
    p = record_payment(student=ar["second"], amount=25000, mode="especes", silent=True)
    assert p.student_id == school["A"].pk and fees.account(ar["second"], TODAY)["paid"] == 25000


def test_leaving_the_main_cursus_switches_to_the_other_full_tariff(school, ar):
    Student.all_objects.filter(pk=school["A"].pk).update(active=False, sortie="parti")
    acc = fees.account(ar["second"], TODAY)
    assert acc["total"] == 60000 and acc["cursus_detail"] == []            # seul cursus suivi : tarif complet de l'arabe


def test_finance_lists_each_person_once_and_families_see_one_account(school, ar, users, login):
    c = login(users["comptable"])
    accounts = c.get("/api/v1/finance/accounts/").json()["accounts"]
    assert accounts[str(ar["second"].pk)] == accounts[str(school["A"].pk)]
    overview = c.get("/api/v1/finance/overview/").json()
    assert overview["expected"] == sum(fees.account(s, TODAY)["total"] for s in (school["A"], school["B"]))   # A compté une fois
    fam = login(school["A"].parent.user).get("/api/v1/finance/accounts/").json()["accounts"]
    assert set(fam) == {str(school["A"].pk), str(ar["second"].pk)} and fam[str(school["A"].pk)]["total"] == accounts[str(school["A"].pk)]["total"]


def test_complement_is_set_on_the_tariffs_page(school, ar, users, login):
    c = login(users["comptable"])
    r = c.put("/api/v1/finance/tarifs/", {"level": "الأول", "ins": 10000, "sco": 50000, "complement": 30000}, format="json", HTTP_X_CURSUS=str(ar["cursus"].pk))
    assert r.status_code == 200 and r.json()["complement"] == 30000
    assert [t["level"] for t in c.get("/api/v1/finance/tarifs/", HTTP_X_CURSUS=str(ar["cursus"].pk)).json()] == ["الأول"]
