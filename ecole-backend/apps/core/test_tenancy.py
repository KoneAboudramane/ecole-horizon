"""Plusieurs écoles sur une seule base : aucune donnée ne doit passer d'une école à l'autre."""
import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.academics.models import SchoolClass, SchoolSettings
from apps.accounts.models import User
from apps.core.models import ActivityLog, Etablissement
from apps.core.schools import create_school
from apps.core.tenancy import NO_SCHOOL, tenant_context
from apps.students.models import Student
from apps.students.services import enroll_student

pytestmark = pytest.mark.django_db
LOGIN = "/api/v1/auth/login/"


def _school(code, nom, prefixe, parent_phone, student):
    etab, creds = create_school(code=code, nom=nom, prefixe=prefixe, director=f"Directeur {nom}", secretary=f"Secrétaire {nom}")
    with tenant_context(etab):
        for u in User.objects.all():
            u.set_password("secret1")
            u.must_change_password = False
            u.save()
        c = SchoolClass.objects.get(name="6e A")
        e = enroll_student(nom=student, prenoms="Léa", sexe="F", naissance="2013-01-01", lieu="", school_class=c, parent_name=f"Parent {student}", parent_phone=parent_phone)
        e.student.user.set_password("secret1")
        e.student.user.save()
    return etab, c, e.student


@pytest.fixture
def two():
    a = _school("alpha", "Collège Alpha", "AL", "0101010101", "AKA")
    b = _school("beta", "Lycée Beta", "BE", "0101010101", "BAH")  # même téléphone de parent : deux familles distinctes
    return a, b


def client_for(code, username="directeur"):
    c = APIClient()
    r = c.post(LOGIN, {"ecole": code, "username": username, "password": "secret1"}, format="json")
    assert r.status_code == 200, r.content
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    return c


def test_same_usernames_and_matricules_live_in_each_school(two):
    (ea, ca, sa), (eb, cb, sb) = two
    assert sa.matricule == "AL26-0001" and sb.matricule == "BE26-0001"
    assert User.all_objects.filter(username="directeur").count() == 2
    assert Student.all_objects.count() == 2
    assert sa.parent.user_id != sb.parent.user_id


def test_login_needs_the_school_code_when_several(two):
    c = APIClient()
    r = c.post(LOGIN, {"username": "directeur", "password": "secret1"}, format="json")
    assert r.status_code == 400 and "code" in r.data["detail"].lower()
    assert c.post(LOGIN, {"ecole": "nope", "username": "directeur", "password": "secret1"}, format="json").status_code == 401
    r = c.post(LOGIN, {"ecole": "beta", "username": "directeur", "password": "secret1"}, format="json")
    assert r.status_code == 200 and r.data["user"]["etablissement"]["code"] == "beta"
    assert c.post(LOGIN, {"ecole": "ALPHA", "username": "directeur", "password": "mauvais"}, format="json").status_code == 401


def test_lists_and_details_are_isolated(two):
    (ea, ca, sa), (eb, cb, sb) = two
    a, b = client_for("alpha"), client_for("beta")
    ids_a = {r["id"] for r in a.get("/api/v1/students/?page_size=100").data["results"]}
    ids_b = {r["id"] for r in b.get("/api/v1/students/?page_size=100").data["results"]}
    assert ids_a == {sa.pk} and ids_b == {sb.pk}
    assert b.get(f"/api/v1/students/{sa.pk}/").status_code == 404
    assert b.patch(f"/api/v1/students/{sa.pk}/", {"nom": "PIRATE"}, format="json").status_code in (403, 404)
    assert {c["id"] for c in b.get("/api/v1/classes/").data} == set(SchoolClass.all_objects.filter(etablissement=eb).values_list("pk", flat=True))
    sec = client_for("beta", "secretariat")
    r = sec.get("/api/v1/users/?page_size=100")
    listed = {u["id"] for u in (r.data["results"] if isinstance(r.data, dict) else r.data)}
    assert listed and listed == set(User.all_objects.filter(etablissement=eb).values_list("pk", flat=True))
    assert sec.patch(f"/api/v1/users/{ea.pk and User.all_objects.filter(etablissement=ea, username='directeur').first().pk}/", {"name": "X"}, format="json").status_code == 404


def test_cannot_reference_another_schools_objects(two):
    (ea, ca, sa), (eb, cb, sb) = two
    b = client_for("beta", "secretariat")
    # inscrire un élève dans la classe d'une autre école
    r = b.post("/api/v1/students/", {"nom": "ZED", "prenoms": "Ali", "sexe": "M", "naissance": "2012-02-02", "school_class": ca.pk,
                                     "parent_name": "P", "parent_phone": "0303030303"}, format="json")
    assert r.status_code == 400
    # encaisser pour un élève d'une autre école
    fin = client_for("beta", "directeur")
    r = fin.post("/api/v1/finance/payments/", {"student": sa.pk, "amount": 1000, "mode": "especes"}, format="json")
    assert r.status_code in (400, 403, 404)
    assert Student.all_objects.filter(etablissement=ea).count() == 1


def test_settings_journal_and_sequences_are_per_school(two):
    (ea, ca, sa), (eb, cb, sb) = two
    a, b = client_for("alpha"), client_for("beta")
    assert a.patch("/api/v1/settings/", {"name": "Alpha Renommé"}, format="json").status_code == 200
    assert b.get("/api/v1/settings/").data["name"] == "Lycée Beta"
    names = {e["detail"] for e in b.get("/api/v1/journal/").data["results"]}
    assert not any("Alpha" in n for n in names)
    assert ActivityLog.all_objects.filter(etablissement=eb, action="Connexion").count() >= 1
    assert SchoolSettings.all_objects.count() == 2


def test_platform_admin_has_no_school_data(two):
    call_command("create_platform_admin", username="root", name="Root", password="secret1")
    c = APIClient()
    r = c.post(LOGIN, {"ecole": "plateforme", "username": "root", "password": "secret1"}, format="json")
    assert r.status_code == 200 and r.data["user"]["platform_admin"] is True
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    assert c.get("/api/v1/students/").status_code == 403  # aucun rôle d'école
    rows = c.get("/api/v1/plateforme/etablissements/").data
    assert {x["code"] for x in rows} >= {"alpha", "beta"} and all("eleves" in x for x in rows)
    # un compte d'école n'accède pas à la plateforme
    assert client_for("alpha").get("/api/v1/plateforme/etablissements/").status_code == 403


def test_platform_creates_and_suspends_schools(two):
    call_command("create_platform_admin", username="root", name="Root", password="secret1")
    c = APIClient()
    tok = c.post(LOGIN, {"ecole": "plateforme", "username": "root", "password": "secret1"}, format="json").data["access"]
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {tok}")
    r = c.post("/api/v1/plateforme/etablissements/", {"code": "gamma", "nom": "Groupe Gamma", "prefixe": "gg", "director": "M. Gamma", "email": "contact@gamma.test", "director_email": "g@gamma.test"}, format="json")
    assert r.status_code == 201, r.content
    cred = r.data["comptes_crees"][0]
    assert c.post("/api/v1/plateforme/etablissements/", {"code": "gamma", "nom": "x", "director": "y"}, format="json").status_code == 400
    assert c.post("/api/v1/plateforme/etablissements/", {"code": "plateforme", "nom": "x", "director": "y"}, format="json").status_code == 400
    d = APIClient()
    r = d.post(LOGIN, {"ecole": "gamma", "username": cred["username"], "password": cred["password"]}, format="json")
    assert r.status_code == 200 and r.data["user"]["must_change_password"] is True
    d.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    assert d.get("/api/v1/students/").data["count"] == 0
    # suspension : connexion refusée et jeton déjà émis rejeté
    pk = Etablissement.objects.get(code="gamma").pk
    assert c.patch(f"/api/v1/plateforme/etablissements/{pk}/", {"actif": False}, format="json").status_code == 200
    assert APIClient().post(LOGIN, {"ecole": "gamma", "username": cred["username"], "password": cred["password"]}, format="json").status_code == 403
    assert d.get("/api/v1/students/").status_code == 401
    # les autres écoles ne sont pas touchées
    assert client_for("alpha").get("/api/v1/students/").status_code == 200


def test_public_school_and_bulletin_verification(two):
    (ea, ca, sa), (eb, cb, sb) = two
    c = APIClient()
    r = c.get("/api/v1/public/school/")
    assert r.data["multi"] is True and r.data["logo"] == ""
    assert c.get("/api/v1/public/school/?ecole=beta").data["name"] == "Lycée Beta"
    # le code de vérification d'un bulletin désigne l'école de l'élève
    from apps.grades import bulletin_pdf
    with tenant_context(ea):
        term = SchoolSettings and __import__("apps.academics.models", fromlist=["Term"]).Term.objects.first()
    token = bulletin_pdf.make_token(sa.pk, term.pk, 12.0, 1)
    page = c.get(f"/api/v1/public/verify/{token}/")
    assert b"Coll\xc3\xa8ge Alpha" in page.content and b"Lyc\xc3\xa9e Beta" not in page.content


def test_requests_do_not_leak_context_between_calls(two):
    a = client_for("alpha")
    a.get("/api/v1/students/")
    from apps.core.tenancy import UNSET, current
    assert current() is UNSET
    assert Student.objects.count() == 2  # hors requête : pas de filtre
    with tenant_context(NO_SCHOOL):
        assert Student.objects.count() == 0


def test_mobile_money_webhook_credits_the_right_school(two, settings):
    import json
    import time

    from apps.finance import services
    from apps.finance.models import Payment, PaymentIntent
    (ea, ca, sa), (eb, cb, sb) = two
    settings.MOBILE_MONEY_WEBHOOK_SECRET = "s3cret"
    with tenant_context(eb):
        intent = PaymentIntent.objects.create(student=sb, amount=5000, mode="wave", by=None)
    body = json.dumps({"event": "payment.succeeded", "reference": str(intent.reference), "provider_ref": "TX1", "amount": 5000}).encode()
    ts = str(int(time.time()))
    r = APIClient().post("/api/v1/webhooks/mobile-money/", data=body, content_type="application/json",
                         HTTP_X_TIMESTAMP=ts, HTTP_X_SIGNATURE=services.webhook_signature("s3cret", ts, body))
    assert r.status_code == 200 and r.data["status"] == "succeeded", r.content
    p = Payment.all_objects.get(ref="TX1")
    assert p.etablissement_id == eb.pk and p.student_id == sb.pk
    assert Payment.all_objects.filter(etablissement=ea).count() == 0
