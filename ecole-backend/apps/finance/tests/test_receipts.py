"""v3.3 : reçu détaillé par échéance, surplus gardé en avance, historique des années, relevé élève, clôture de caisse, duplicata."""
import datetime

import pytest
from django.utils import timezone

from apps.academics.models import SchoolClass, SchoolYear
from apps.finance.models import CashClosing, Payment
from apps.grades.models import Decision
from apps.students.models import Enrollment

pytestmark = pytest.mark.django_db
URL = "/api/v1/finance/"
TODAY = datetime.date(2026, 12, 14)


@pytest.fixture(autouse=True)
def frozen_today(monkeypatch):
    monkeypatch.setattr(timezone, "localdate", lambda *a, **k: TODAY)


def pay(client, s, amount, mode="especes", **kw):
    return client.post(URL + "payments/", {"student": s.pk, "amount": amount, "mode": mode, **kw}, format="json")


def test_receipt_detail_is_per_echeance_and_frozen(school, users, login, client):
    login(users["comptable"])
    A = school["A"]                                  # échéances : 50 000 / 60 000 / 60 000 / 60 000
    r = pay(client, A, 80000).data
    d = r["detail"]
    assert [(l["paid_before"], l["paid_now"], l["remaining"]) for l in d["lines"]] == [(0, 50000, 0), (0, 30000, 30000), (0, 0, 60000), (0, 0, 60000)]
    assert d["total"] == 230000 and d["paid_after"] == 80000 and d["remaining"] == 150000 and d["next"]["remaining"] == 30000
    r2 = pay(client, A, 50000).data["detail"]
    assert [(l["paid_before"], l["paid_now"], l["remaining"]) for l in r2["lines"]] == [(50000, 0, 0), (30000, 30000, 0), (0, 20000, 40000), (0, 0, 60000)]
    assert r2["paid_before"] == 80000 and r2["paid_after"] == 130000 and r2["remaining"] == 100000
    # le reçu déjà émis ne bouge pas, même si les tarifs changent après
    from apps.finance.models import Tarif
    Tarif.objects.filter(level="6e").update(sco=300000)
    again = client.get(URL + f"payments/{Payment.objects.get(receipt_no=r['receipt_no']).pk}/receipt/").data
    assert again["detail"]["total"] == 230000 and again["detail"]["remaining"] == 150000 and again["duplicata"] is False


def test_old_payment_without_detail_is_reconstructed(school, users, login, client):
    login(users["comptable"])
    p1 = Payment.objects.get(pk=pay(client, school["A"], 50000).data["id"])
    p2 = Payment.objects.get(pk=pay(client, school["A"], 20000).data["id"])
    Payment.objects.filter(pk__in=[p1.pk, p2.pk]).update(detail=None)
    d = client.get(URL + f"payments/{p2.pk}/receipt/").data["detail"]
    assert d["reconstructed"] is True and d["paid_before"] == 50000 and d["paid_after"] == 70000 and d["remaining"] == 160000


def test_surplus_needs_confirmation_and_is_kept_as_advance(school, users, login, client):
    login(users["comptable"])
    A = school["A"]
    pay(client, A, 200000)
    r = pay(client, A, 50000)
    assert r.status_code == 400 and r.data["errors"]["code"] == "surplus" and str(r.data["errors"]["balance"]) == "30000"
    assert Payment.objects.filter(student=A).count() == 1
    ok = pay(client, A, 50000, advance=True)
    assert ok.status_code == 201 and ok.data["advance"] == 20000 and ok.data["detail"]["credit"] == 20000 and ok.data["detail"]["remaining"] == 0
    acc = client.get(URL + f"students/{A.pk}/account/").data
    assert acc["balance"] == 0 and acc["credit"] == 20000


def test_credit_and_balance_are_carried_to_the_new_year(school, users, login, client):
    from apps.students.tests.test_rollover import APPLY, PLAN, moves
    A, B = school["A"], school["B"]
    year = SchoolYear.get_current()
    for st in (A, B):
        Decision.objects.create(student=st, year=year, value="admis")
    login(users["comptable"])
    pay(client, A, 230000)
    pay(client, A, 15000, advance=True)                      # 15 000 d'avance
    pay(client, B, 100000)                                    # 130 000 de dette
    login(users["directeur"])
    seconde = SchoolClass.objects.get(name="5e A") if SchoolClass.objects.filter(name="5e A").exists() else SchoolClass.objects.exclude(pk=A.school_class_id).first()
    plan = client.get(PLAN).data
    assert client.post(APPLY, {"moves": moves(plan, **{n: {"action": "promote", "class": seconde.pk} for n in ("AKA", "BAH")})}, format="json").status_code == 201
    new = SchoolYear.get_current()
    assert Enrollment.objects.get(student=A, year=new).credit == 15000 and Enrollment.objects.get(student=B, year=new).report == 130000
    login(users["comptable"])
    acc = client.get(URL + f"students/{A.pk}/account/").data
    assert acc["paid"] == 15000 and acc["lines"][0]["paid"] == 15000
    # historique des années
    years = {y["label"]: y for y in client.get(URL + "years/").data}
    old = years[year.label]
    assert old["collected"] == 230000 + 15000 + 100000 and old["advances"] == 15000 and old["carried_over"] == 130000 and old["carried_credit"] == 15000
    assert years[new.label]["carried_over"] is None
    assert len(client.get(URL + f"payments/?year={year.label}").data["results"]) == 3
    assert client.get(URL + "payments/").data["results"] == []
    st = client.get(URL + f"students/{B.pk}/statement/").data
    assert st["years"][0]["label"] == year.label and st["years"][0]["paid"] == 100000 and st["account"]["lines"][0]["key"] == "REP"


def test_statement_rights(school, users, login, client):
    login(users["comptable"])
    pay(client, school["A"], 50000)
    for who, code in (("directeur", 200), ("enseignant", 403), ("eleve", 403)):
        login(users[who])
        assert client.get(URL + f"students/{school['A'].pk}/statement/").status_code == code, who


def test_cash_closing(school, users, login, client):
    login(users["comptable"])
    pay(client, school["A"], 50000)
    pay(client, school["B"], 20000, mode="wave", ref="W1")
    p = Payment.objects.get(student=school["B"])
    client.post(URL + f"payments/{p.pk}/cancel/", {"reason": "erreur"}, format="json")
    day = client.get(URL + "cash/").data
    assert day["expected_cash"] == 50000 and day["total"] == 50000 and day["count"] == 1 and len(day["cancelled"]) == 1 and day["closing"] is None
    assert client.post(URL + "cash/close/", {"counted": 48000}, format="json").status_code == 400          # écart sans explication
    assert client.post(URL + "cash/close/", {"counted": -1}, format="json").status_code == 400
    r = client.post(URL + "cash/close/", {"counted": 48000, "note": "2 000 rendus en monnaie"}, format="json")
    assert r.status_code == 201 and r.data["gap"] == -2000 and CashClosing.objects.count() == 1
    assert client.post(URL + "cash/close/", {"counted": 50000}, format="json").status_code == 400          # une seule clôture par jour
    assert client.get(URL + "cash/").data["closing"]["counted"] == 48000
    login(users["directeur"])
    assert client.get(URL + "cash/").status_code == 200
    assert client.post(URL + "cash/close/", {"date": "2026-12-13", "counted": 0}, format="json").status_code == 403


def test_duplicata_is_marked_and_logged(school, users, login, client):
    from apps.core.models import ActivityLog
    login(users["comptable"])
    pid = pay(client, school["A"], 50000).data["id"]
    assert client.get(URL + f"payments/{pid}/receipt/").data["duplicata"] is False
    assert client.get(URL + f"payments/{pid}/receipt/?duplicata=1").data["duplicata"] is True
    assert ActivityLog.objects.filter(action="Duplicata de reçu").count() == 1
    r = client.get(URL + f"payments/{pid}/receipt.pdf?duplicata=1")
    assert r.status_code == 200 and r.content.startswith(b"%PDF") and ActivityLog.objects.filter(action="Duplicata de reçu").count() == 2
    assert client.get(URL + f"payments/{pid}/receipt.pdf").status_code == 200


def test_overdue_lists_the_late_echeances(school, users, login, client):
    login(users["comptable"])
    row = next(r for r in client.get(URL + "overdue/").data if r["student"] == school["A"].pk)
    assert row["overdue_keys"] == ["INS", "T1"] and len(row["overdue_labels"]) == 2
