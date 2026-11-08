"""Moyenne annuelle pondérée par période (usage ivoirien par défaut : 1er trimestre coefficient 1, les suivants 2),
réglable par l'école, et bilan de l'année sur le bulletin de la dernière période."""
import pytest

from apps.academics.models import Term
from apps.grades import calc
from apps.grades.models import Evaluation, Grade

from .test_grades import world  # noqa: F401  (fixture)

pytestmark = pytest.mark.django_db


def note(w, code, **vals):
    """Un devoir publié dans la période `code`, noté pour les élèves donnés."""
    t = Term.objects.get(code=code)
    ev = Evaluation.objects.create(school_class=w["c"], subject=w["ma"], term=t, type="devoir", title=f"D {code}", date=t.start, published=True)
    for k, v in vals.items():
        Grade.objects.create(evaluation=ev, student=w[k], value=v)


@pytest.fixture
def year(world):  # noqa: F811
    note(world, "T1", A=8, B=14)
    note(world, "T2", A=12, B=12)
    note(world, "T3", A=14, B=10)
    return world


def test_default_coefficients_follow_ivorian_usage(world):  # noqa: F811
    assert [(t.code, t.coef) for t in Term.objects.order_by("start")] == [("T1", 1), ("T2", 2), ("T3", 2)]


def test_annual_average_is_weighted(year):
    r = calc.annual_class(year["c"], year["T1"].year)["results"]
    assert r[year["A"].pk]["moyenne"] == pytest.approx((8 + 12 * 2 + 14 * 2) / 5)     # 12,0
    assert r[year["B"].pk]["moyenne"] == pytest.approx((14 + 12 * 2 + 10 * 2) / 5)    # 11,6
    assert (r[year["A"].pk]["rang"], r[year["B"].pk]["rang"]) == (1, 2)               # une moyenne simple aurait classé B premier


def test_periods_without_grades_are_left_out(world):  # noqa: F811
    note(world, "T1", A=8)
    note(world, "T2", A=14)
    assert calc.annual_class(world["c"], world["T1"].year)["results"][world["A"].pk]["moyenne"] == pytest.approx((8 + 14 * 2) / 3)


def test_school_changes_the_coefficients(year, users, login, client):
    login(users["directeur"])
    terms = client.get("/api/v1/calendar/").json()["terms"]
    rows = [{"label": t["label"], "start": t["start"], "end": t["end"], "coef": 1} for t in terms]
    r = client.put("/api/v1/calendar/periodes/", {"periodes": rows}, format="json")
    assert r.status_code == 200 and [t["coef"] for t in r.json()] == [1, 1, 1]
    assert calc.annual_class(year["c"], year["T1"].year)["results"][year["B"].pk]["moyenne"] == pytest.approx(12)
    rows[0]["coef"] = 0
    assert client.put("/api/v1/calendar/periodes/", {"periodes": rows}, format="json").status_code == 400


def test_decisions_use_the_weighted_average(year, users, login, client):
    login(users["directeur"])
    rows = {r["student"]: r for r in client.get("/api/v1/decisions/").json()}
    assert rows[year["A"].pk]["annual_avg"] == pytest.approx(12) and rows[year["A"].pk]["terms"] == 3


def test_last_bulletin_carries_the_year_summary(year, login, client):
    login(year["A"].parent.user)
    an = client.get(f"/api/v1/students/{year['A'].pk}/bulletin/?term=T3").json()["annual"]
    assert an["moyenne"] == pytest.approx(12) and an["rang"] == 1 and an["mention"]
    assert [(p["code"], p["coef"], p["moy"]) for p in an["periodes"]] == [("T1", 1, 8), ("T2", 2, 12), ("T3", 2, 14)]
    assert client.get(f"/api/v1/students/{year['A'].pk}/bulletin/?term=T2").json()["annual"] is None
    r = client.get(f"/api/v1/students/{year['A'].pk}/bulletin.pdf?term=T3")
    assert r.status_code == 200 and r["Content-Type"] == "application/pdf"


def test_verification_checks_the_annual_average(year):
    from apps.grades import bulletin_pdf
    from rest_framework.test import APIClient
    t3 = Term.objects.get(code="T3")
    res = calc.compute_class(year["c"], t3, only_published=True)["results"][year["A"].pk]
    an = calc.annual_class(year["c"], t3.year, only_published=True)["results"][year["A"].pk]
    c = APIClient()
    ok = c.get(f"/api/v1/public/verify/{bulletin_pdf.make_token(year['A'].pk, t3.pk, res['moyenne'], res['rang'], an)}/")
    assert ok.status_code == 200 and "Moyenne annuelle" in ok.content.decode()
    forged = dict(an, moyenne=an["moyenne"] + 1)
    assert c.get(f"/api/v1/public/verify/{bulletin_pdf.make_token(year['A'].pk, t3.pk, res['moyenne'], res['rang'], forged)}/").status_code == 404


def test_school_sets_the_bulletin_header(year, users, login, client):
    from apps.academics.models import SchoolSettings
    cfg = SchoolSettings.load()
    assert (cfg.entete_pays, cfg.entete_devise) == ("République de Côte d’Ivoire", "Union – Discipline – Travail")
    login(users["directeur"])
    r = client.patch("/api/v1/settings/", {"entete_pays": "République du Sénégal", "entete_devise": ""}, format="json")
    assert r.status_code == 200 and r.json()["entete_pays"] == "République du Sénégal"
    assert client.get(f"/api/v1/students/{year['A'].pk}/bulletin.pdf?term=T1&template=classique").status_code == 200
