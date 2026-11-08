"""Bulletin réservé aux familles à jour : selon le réglage de l'école, échéances échues réglées (« retard », par défaut)
ou toute la scolarité (« total ») ; la direction peut accorder une dérogation pour l'année."""
import datetime

import pytest

from apps.academics.models import SchoolSettings, SchoolYear
from apps.finance import fees
from apps.finance.models import FeeDate
from apps.finance.services import record_payment

pytestmark = pytest.mark.django_db


def _mode(mode):
    cfg = SchoolSettings.load(); cfg.bulletin_blocage = mode; cfg.save()


@pytest.fixture
def overdue(school):
    """Inscription et 1re tranche échues, tranches suivantes à venir."""
    y = SchoolYear.get_current()
    past, future = datetime.date(2020, 1, 1), datetime.date(2099, 1, 1)
    for i, (k, _) in enumerate(fees.fee_keys()):
        FeeDate.objects.update_or_create(year=y, key=k, defaults={"date": past if i < 2 else future})
    _mode("retard")
    acc = fees.account(school["A"], datetime.date.today())
    assert 0 < acc["overdue"] < acc["balance"]
    return acc


def url(st, pdf=False):
    return f"/api/v1/students/{st.pk}/bulletin{'.pdf' if pdf else '/'}"


def test_family_with_overdue_fees_cannot_get_the_bulletin(school, overdue, users, login, client):
    A = school["A"]
    for who in (A.parent.user, A.user):
        login(who)
        for pdf in (False, True):
            r = client.get(url(A, pdf))
            assert r.status_code == 403, who.role
            assert r.json()["errors"]["code"] == "bulletin_bloque" and r.json()["errors"]["amount"] == str(overdue["overdue"])
        acc = client.get(f"/api/v1/students/{A.pk}/bulletin-access/").json()
        assert acc["locked"] and acc["mode"] == "retard" and acc["amount"] == overdue["overdue"]
    login(users["directeur"])
    assert client.get(url(A)).status_code == 200 and client.get(url(A, True)).status_code == 200


def test_paying_what_is_overdue_unlocks_it(school, overdue, login, client):
    A = school["A"]
    record_payment(student=A, amount=overdue["overdue"], mode="especes", silent=True)
    login(A.parent.user)
    assert client.get(url(A)).status_code == 200
    assert client.get(f"/api/v1/students/{A.pk}/bulletin-access/").json()["locked"] is False


def test_total_mode_requires_the_whole_year(school, overdue, login, client):
    A = school["A"]
    _mode("total")
    record_payment(student=A, amount=overdue["overdue"], mode="especes", silent=True)
    login(A.parent.user)
    r = client.get(url(A))
    assert r.status_code == 403 and r.json()["errors"]["amount"] == str(overdue["balance"] - overdue["overdue"])
    record_payment(student=A, amount=overdue["balance"] - overdue["overdue"], mode="especes", silent=True)
    assert client.get(url(A)).status_code == 200


def test_school_can_turn_it_off(school, overdue, users, login, client):
    login(users["directeur"])
    assert client.patch("/api/v1/settings/", {"bulletin_blocage": "aucun"}, format="json").status_code == 200
    login(school["A"].parent.user)
    assert client.get(url(school["A"])).status_code == 200


def test_direction_grants_and_withdraws_a_derogation(school, overdue, users, login, client):
    A = school["A"]
    login(A.parent.user)
    assert client.post(f"/api/v1/students/{A.pk}/bulletin-access/", {"note": "x"}, format="json").status_code == 403
    login(users["directeur"])
    r = client.post(f"/api/v1/students/{A.pk}/bulletin-access/", {"note": "Arrangement avec la famille"}, format="json")
    assert r.status_code == 200 and r.json()["locked"] is False and r.json()["derogation"]["note"] == "Arrangement avec la famille"
    login(A.parent.user)
    assert client.get(url(A)).status_code == 200
    assert client.get(url(school["B"])).status_code == 404       # la dérogation ne concerne que cet élève
    login(users["directeur"])
    assert client.delete(f"/api/v1/students/{A.pk}/bulletin-access/").json()["locked"] is True
    login(A.parent.user)
    assert client.get(url(A)).status_code == 403
