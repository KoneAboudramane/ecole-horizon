"""Mot de passe oublié du personnel : lien par e-mail, à usage unique, sans révéler quels comptes existent."""
import re

import pytest
from django.core import mail

from apps.accounts.models import User
from apps.core.models import Etablissement
from apps.core.tenancy import tenant_context

pytestmark = pytest.mark.django_db
FORGOT, RESET, LOGIN = "/api/v1/auth/forgot-password/", "/api/v1/auth/reset-password/", "/api/v1/auth/login/"


def link_parts(body):
    m = re.search(r"#reinitialiser/([^/\s]+)/([^\s]+)", body)
    return m.group(1), m.group(2)


@pytest.fixture
def teacher(make_user):
    return make_user("enseignant", username="prof1", email="prof1@ecole.test")


def test_staff_gets_a_link_by_username_or_email(teacher, client):
    for ident in ("prof1", "PROF1@ecole.test"):
        mail.outbox.clear()
        r = client.post(FORGOT, {"identifier": ident}, format="json")
        assert r.status_code == 200
        assert len(mail.outbox) == 1 and mail.outbox[0].to == ["prof1@ecole.test"]
        assert "#reinitialiser/" in mail.outbox[0].body and "une heure" in mail.outbox[0].body


def test_same_answer_for_unknown_account_and_no_mail_sent(teacher, client):
    known = client.post(FORGOT, {"identifier": "prof1"}, format="json").json()
    mail.outbox.clear()
    unknown = client.post(FORGOT, {"identifier": "personne"}, format="json")
    assert unknown.status_code == 200 and unknown.json() == known and not mail.outbox


def test_parents_pupils_inactive_and_no_email_get_nothing(make_user, client):
    make_user("parent", username="par1", email="par1@x.test")
    make_user("eleve", username="el1", email="el1@x.test")
    make_user("comptable", username="cpt", email="cpt@x.test", is_active=False)
    make_user("educateur", username="edu")  # pas d'e-mail
    for ident in ("par1", "el1", "cpt", "edu"):
        assert client.post(FORGOT, {"identifier": ident}, format="json").status_code == 200
    assert not mail.outbox


def test_full_flow_password_changes_and_link_is_single_use(teacher, client):
    client.post(FORGOT, {"identifier": "prof1"}, format="json")
    uid, token = link_parts(mail.outbox[0].body)
    assert client.post(RESET, {"uid": uid, "token": token, "new": "x"}, format="json").status_code == 400  # trop court
    ok = client.post(RESET, {"uid": uid, "token": token, "new": "Nouveau123", "confirm": "Nouveau123"}, format="json")
    assert ok.status_code == 200
    assert client.post(LOGIN, {"username": "prof1", "password": "Nouveau123"}, format="json").status_code == 200
    assert client.post(LOGIN, {"username": "prof1", "password": "secret1"}, format="json").status_code == 401
    again = client.post(RESET, {"uid": uid, "token": token, "new": "Autre1234", "confirm": "Autre1234"}, format="json")
    assert again.status_code == 400  # lien déjà utilisé


def test_reset_unlocks_account_and_clears_temporary_flag(teacher, client):
    teacher.must_change_password = True
    teacher.failed_attempts = 9
    teacher.save()
    client.post(FORGOT, {"identifier": "prof1"}, format="json")
    uid, token = link_parts(mail.outbox[0].body)
    client.post(RESET, {"uid": uid, "token": token, "new": "Nouveau123", "confirm": "Nouveau123"}, format="json")
    teacher.refresh_from_db()
    assert teacher.must_change_password is False and teacher.failed_attempts == 0


def test_bad_or_tampered_link_is_refused(teacher, client):
    client.post(FORGOT, {"identifier": "prof1"}, format="json")
    uid, token = link_parts(mail.outbox[0].body)
    for body in ({"uid": uid, "token": token[:-2] + "zz"}, {"uid": "!!", "token": token}, {"uid": uid, "token": ""}):
        r = client.post(RESET, {**body, "new": "Nouveau123", "confirm": "Nouveau123"}, format="json")
        assert r.status_code == 400


def test_old_link_dies_when_password_changes_otherwise(teacher, client):
    client.post(FORGOT, {"identifier": "prof1"}, format="json")
    uid, token = link_parts(mail.outbox[0].body)
    teacher.set_password("Autre1234")
    teacher.save()
    assert client.post(RESET, {"uid": uid, "token": token, "new": "Nouveau123", "confirm": "Nouveau123"}, format="json").status_code == 400


def test_link_is_per_school(teacher, client):
    other = Etablissement.objects.create(code="autre", nom="Autre école", prefixe="AU")
    home = Etablissement.objects.exclude(pk=other.pk).get()
    client.post(FORGOT, {"identifier": "prof1", "ecole": home.code}, format="json")
    uid, token = link_parts(mail.outbox[0].body)
    assert f"ecole={home.code}" in mail.outbox[0].body
    r = client.post(RESET, {"ecole": "autre", "uid": uid, "token": token, "new": "Nouveau123", "confirm": "Nouveau123"}, format="json")
    assert r.status_code == 400
    with tenant_context(other):
        assert not User.objects.filter(username="prof1").exists()


def test_limits_mails_per_account_per_hour(teacher, client):
    for _ in range(6):
        client.post(FORGOT, {"identifier": "prof1"}, format="json")
    assert len(mail.outbox) == 3


def test_smtp_failure_is_silent_for_user_but_logged(teacher, client, settings):
    settings.EMAIL_BACKEND = "apps.accounts.tests.test_forgot_password.BrokenBackend"
    r = client.post(FORGOT, {"identifier": "prof1"}, format="json")
    assert r.status_code == 200
    from apps.core.models import ActivityLog
    assert ActivityLog.objects.filter(action="E-mail non envoyé").exists()


from django.core.mail.backends.base import BaseEmailBackend  # noqa: E402


class BrokenBackend(BaseEmailBackend):
    def send_messages(self, msgs):
        raise OSError("SMTP indisponible")


def test_reset_cuts_open_sessions(teacher, client):
    login = client.post(LOGIN, {"username": "prof1", "password": "secret1"}, format="json").json()
    client.post(FORGOT, {"identifier": "prof1"}, format="json")
    uid, token = link_parts(mail.outbox[0].body)
    client.post(RESET, {"uid": uid, "token": token, "new": "Nouveau123", "confirm": "Nouveau123"}, format="json")
    assert client.post("/api/v1/auth/refresh/", {"refresh": login["refresh"]}, format="json").status_code == 401


# --- e-mail obligatoire et protégé ---
def test_email_required_unique_and_admin_managed(users, login, make_user):
    c = login(users["admin"])
    base = {"name": "Agent Un", "role": "enseignant", "username": "agent1"}
    assert c.post("/api/v1/users/", base, format="json").status_code == 400
    assert c.post("/api/v1/users/", {**base, "email": "agent1@ecole.test"}, format="json").status_code == 201
    dup = c.post("/api/v1/users/", {**base, "username": "agent2", "email": "AGENT1@ecole.test"}, format="json")
    assert dup.status_code == 400
    pk = User.objects.get(username="agent1").pk
    assert c.patch(f"/api/v1/users/{pk}/", {"email": ""}, format="json").status_code == 400
    assert c.patch(f"/api/v1/users/{pk}/", {"email": "nouveau@ecole.test"}, format="json").status_code == 200


def test_staff_cannot_change_own_email_but_family_can(users, login):
    c = login(users["enseignant"])
    assert c.patch("/api/v1/me/", {"email": "pirate@x.test"}, format="json").status_code == 400
    assert c.patch("/api/v1/me/", {"phone": "07 00 00 00 00"}, format="json").status_code == 200
    c = login(users["parent"])
    assert c.patch("/api/v1/me/", {"email": "parent@x.test"}, format="json").status_code == 200
