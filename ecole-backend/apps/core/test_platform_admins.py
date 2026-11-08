"""Administrateurs de la plateforme : profil personnel, invitation par un administrateur, validation par le principal."""
import io

import pytest
from django.core.management import call_command
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.models import Etablissement, PlatformLog

pytestmark = pytest.mark.django_db
P = "/api/v1/plateforme/"


def login(username, password):
    c = APIClient()
    r = c.post("/api/v1/auth/login/", {"ecole": "plateforme", "username": username, "password": password}, format="json")
    assert r.status_code == 200, r.content
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    return c


@pytest.fixture
def principal():
    call_command("create_platform_admin", username="root", name="Root", password="secret1")
    User.all_objects.filter(username="root").update(email="root@plat.test")
    return login("root", "secret1")


@pytest.fixture
def second(principal):
    principal.post(P + "administrateurs/", {"username": "awa", "name": "Awa", "email": "awa@plat.test"}, format="json")
    u = User.all_objects.get(username="awa")
    u.set_password("secret2")
    u.must_change_password = False
    u.save()
    return login("awa", "secret2")


def test_first_admin_is_principal_and_next_ones_are_not():
    call_command("create_platform_admin", username="a", name="A", password="secret1")
    call_command("create_platform_admin", username="b", name="B", password="secret1")
    assert User.all_objects.get(username="a").platform_owner and not User.all_objects.get(username="b").platform_owner
    call_command("create_platform_admin", username="c", name="C", password="secret1", principal=True)
    assert User.all_objects.get(username="c").platform_owner


def test_principal_adds_directly(principal):
    r = principal.post(P + "administrateurs/", {"username": "Awa", "name": "Awa", "email": "awa@plat.test"}, format="json")
    assert r.status_code == 201 and r.json()["pending"] is False and r.json()["credentials"]["password"]
    u = User.all_objects.get(username="awa")
    assert u.is_active and not u.platform_pending and not u.platform_owner and u.invited_by.username == "root"


def test_other_admin_only_invites_and_principal_validates(principal, second):
    r = second.post(P + "administrateurs/", {"username": "ben", "name": "Ben", "email": "ben@plat.test"}, format="json")
    assert r.status_code == 201 and r.json()["pending"] is True and "credentials" not in r.json()
    ben = User.all_objects.get(username="ben")
    assert ben.platform_pending and not ben.is_active and not ben.has_usable_password() and ben.invited_by.username == "awa"
    # En attente : aucune connexion possible
    assert APIClient().post("/api/v1/auth/login/", {"ecole": "plateforme", "username": "ben", "password": "x"}, format="json").status_code in (400, 401, 403)
    rows = {a["username"]: a for a in principal.get("/api/v1/plateforme/administrateurs/").json()}
    assert rows["ben"]["pending"] and rows["ben"]["invited_by"] == "Awa" and rows["root"]["owner"] and rows["awa"]["is_me"] is False
    # Un autre administrateur ne valide pas
    assert second.post(f"{P}administrateurs/{ben.pk}/valider/").status_code == 403
    ok = principal.post(f"{P}administrateurs/{ben.pk}/valider/")
    assert ok.status_code == 200
    pwd = ok.json()["credentials"]["password"]
    c = APIClient()
    log = c.post("/api/v1/auth/login/", {"ecole": "plateforme", "username": "ben", "password": pwd}, format="json")
    assert log.status_code == 200 and log.json()["user"]["must_change_password"]
    assert principal.post(f"{P}administrateurs/{ben.pk}/valider/").status_code == 400
    acts = list(PlatformLog.objects.values_list("action", flat=True))
    assert "Administrateur proposé" in acts and "Administrateur validé" in acts


def test_refuse_pending_and_only_pending(principal, second):
    second.post(P + "administrateurs/", {"username": "ben", "name": "Ben", "email": "ben@plat.test"}, format="json")
    ben = User.all_objects.get(username="ben")
    awa = User.all_objects.get(username="awa")
    assert principal.post(f"{P}administrateurs/{awa.pk}/refuser/").status_code == 400
    assert principal.post(f"{P}administrateurs/{ben.pk}/refuser/").status_code == 200
    assert not User.all_objects.filter(username="ben").exists()
    assert "Invitation refusée" in PlatformLog.objects.values_list("action", flat=True)


def test_principal_manages_others_but_not_himself(principal, second):
    awa = User.all_objects.get(username="awa")
    root = User.all_objects.get(username="root")
    assert principal.post(f"{P}administrateurs/{awa.pk}/basculer/").json()["actif"] is False
    assert APIClient().post("/api/v1/auth/login/", {"ecole": "plateforme", "username": "awa", "password": "secret2"}, format="json").status_code != 200
    assert principal.post(f"{P}administrateurs/{awa.pk}/basculer/").json()["actif"] is True
    assert principal.post(f"{P}administrateurs/{root.pk}/basculer/").status_code == 400
    r = principal.post(f"{P}administrateurs/{awa.pk}/reinitialiser/")
    assert r.status_code == 200 and login("awa", r.json()["credentials"]["password"])
    assert principal.post(f"{P}administrateurs/{awa.pk}/retirer-2fa/").status_code == 200
    assert principal.post(f"{P}administrateurs/99999/basculer/").status_code == 404
    # un administrateur ordinaire ne gère personne
    for act in ("basculer", "reinitialiser", "retirer-2fa", "refuser"):
        assert second.post(f"{P}administrateurs/{root.pk}/{act}/").status_code == 403


def test_school_accounts_cannot_reach_admin_actions(principal, db):
    from apps.core.schools import create_school
    etab, _ = create_school(code="horizon", nom="Horizon", director="Mme Kone", director_email="d@h.test")
    d = User.all_objects.filter(etablissement=etab, role="directeur").first()
    c = APIClient()
    c.force_authenticate(d)
    root = User.all_objects.get(username="root")
    assert c.post(f"{P}administrateurs/{root.pk}/basculer/").status_code == 403
    assert c.get(P + "administrateurs/").status_code == 403


def png():
    b = io.BytesIO()
    Image.new("RGB", (20, 20), "red").save(b, "PNG")
    b.seek(0)
    b.name = "me.png"
    return b


def test_profile_photo_info_and_password(principal, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    me = principal.get("/api/v1/me/").json()
    assert me["platform_admin"] and me["username"] == "root"
    r = principal.patch("/api/v1/me/", {"name": "Root Principal", "phone": "0700000000", "email": "new@plat.test"}, format="json")
    assert r.status_code == 200 and r.json()["name"] == "Root Principal" and r.json()["phone"] == "0700000000"
    ph = principal.post("/api/v1/me/photo/", {"photo": png()}, format="multipart")
    assert ph.status_code == 200 and ph.json()["photo"]
    rows = {a["username"]: a for a in principal.get(P + "administrateurs/").json()}
    assert rows["root"]["photo"] and rows["root"]["phone"] == "0700000000"
    assert principal.delete("/api/v1/me/photo/").json()["photo"] is None
    bad = principal.post("/api/v1/me/password/", {"current": "faux", "new": "NouveauMdp#2026x", "confirm": "NouveauMdp#2026x"}, format="json")
    assert bad.status_code == 400
    ok = principal.post("/api/v1/me/password/", {"current": "secret1", "new": "NouveauMdp#2026x", "confirm": "NouveauMdp#2026x"}, format="json")
    assert ok.status_code in (204, 200), ok.content
    assert login("root", "NouveauMdp#2026x")
    assert "Profil modifié" in PlatformLog.objects.values_list("action", flat=True)


def test_profile_email_is_required_and_unique(principal, second):
    assert principal.patch("/api/v1/me/", {"email": ""}, format="json").status_code == 400
    assert principal.patch("/api/v1/me/", {"email": "AWA@plat.test"}, format="json").status_code == 400
    assert principal.patch("/api/v1/me/", {"email": "root@plat.test"}, format="json").status_code == 200


def test_create_school_form_rules(principal):
    base = {"code": "ecole1", "nom": "École Un", "director": "M. Dir", "email": "contact@e.test"}
    r = principal.post(P + "etablissements/", base, format="json")
    assert r.status_code == 400 and "director_email" in r.json()["errors"]  # e-mail de la direction obligatoire
    r = principal.post(P + "etablissements/", {**base, "director_email": "d@e.test", "founder": "Mme Fond"}, format="json")
    assert r.status_code == 400 and "founder_email" in r.json()["errors"]  # un nom sans e-mail est refusé
    r = principal.post(P + "etablissements/", {**base, "director_email": "d@e.test", "informatique_email": "i@e.test"}, format="json")
    assert r.status_code == 400 and "informatique" in r.json()["errors"]


def test_create_school_with_all_people_and_contact(principal):
    from apps.academics.models import SchoolSettings
    from apps.accounts.models import Role
    from apps.core.tenancy import tenant_context
    r = principal.post(P + "etablissements/", {"code": "ecole2", "nom": "École Deux", "director": "M. Dir", "director_email": "d@e.test", "founder": "Mme Fond", "founder_email": "f@e.test",
                       "secretary": "Mme Secr", "secretary_email": "s@e.test", "informatique": "M. Info", "informatique_email": "i@e.test",
                       "address": "Abidjan, Cocody", "phone": "0102030405", "email": "contact@e.test"}, format="json")
    assert r.status_code == 201
    roles = {c["role"] for c in r.json()["comptes_crees"]}
    assert roles == {"directeur", "fondateur", "admin", "informatique"}
    etab = Etablissement.objects.get(code="ecole2")
    with tenant_context(etab):
        s = SchoolSettings.load()
        assert (s.address, s.phone, s.email) == ("Abidjan, Cocody", "0102030405", "contact@e.test")
    # Avec un fondateur : la direction n'a pas le droit de gérer les rôles
    assert "roles.manage" not in Role.all_objects.get(etablissement=etab, key="directeur").perms
    assert "roles.manage" in Role.all_objects.get(etablissement=etab, key="fondateur").perms
    assert User.all_objects.get(etablissement=etab, role="informatique").must_change_password


def test_school_without_founder_lets_direction_manage_roles(principal):
    from apps.accounts.models import Role
    r = principal.post(P + "etablissements/", {"code": "ecole3", "nom": "École Trois", "director": "M. Dir", "email": "contact@e.test", "director_email": "d@e.test"}, format="json")
    assert r.status_code == 201
    etab = Etablissement.objects.get(code="ecole3")
    assert "roles.manage" in Role.all_objects.get(etablissement=etab, key="directeur").perms


def test_school_creation_emails_identifier_and_password(principal):
    from django.core import mail
    mail.outbox.clear()
    r = principal.post(P + "etablissements/", {"code": "ecole4", "nom": "École Quatre", "director": "M. Dir", "email": "contact@e.test", "director_email": "d@e4.test",
                                                "informatique": "M. Info", "informatique_email": "i@e4.test"}, format="json")
    assert r.status_code == 201
    rows = {c["username"]: c for c in r.json()["comptes_crees"]}
    assert rows["directeur"]["invitation"] is True and rows["informatique"]["invitation"] is True
    assert {m.to[0] for m in mail.outbox} == {"d@e4.test", "i@e4.test"}
    m = next(x for x in mail.outbox if x.to == ["d@e4.test"])
    assert "ecole4" in m.body and "Identifiant : directeur" in m.body and f"Mot de passe provisoire : {rows['directeur']['password']}" in m.body
    # Les accès reçus par e-mail fonctionnent, et le changement reste imposé
    log = APIClient().post("/api/v1/auth/login/", {"ecole": "ecole4", "username": "directeur", "password": rows["directeur"]["password"]}, format="json")
    assert log.status_code == 200 and log.json()["user"]["must_change_password"]


def test_no_email_no_mail(principal):
    from django.core import mail
    mail.outbox.clear()
    r = principal.post(P + "etablissements/", {"code": "ecole5", "nom": "École Cinq", "director": "M. Dir", "email": "contact@e.test", "director_email": "d@e5.test", "secretary": "Mme S", "secretary_email": "s@e5.test"}, format="json")
    assert r.status_code == 201 and len(mail.outbox) == 2


def test_email_failure_does_not_block_creation(principal, settings):
    settings.EMAIL_BACKEND = "apps.core.test_platform_admins.BrokenMail"
    r = principal.post(P + "etablissements/", {"code": "ecole6", "nom": "École Six", "director": "M. Dir", "email": "contact@e.test", "director_email": "d@e6.test"}, format="json")
    assert r.status_code == 201 and r.json()["comptes_crees"][0]["invitation"] is False and r.json()["comptes_crees"][0]["password"]


from django.core.mail.backends.base import BaseEmailBackend  # noqa: E402


class BrokenMail(BaseEmailBackend):
    def send_messages(self, messages):
        raise OSError("serveur d’e-mail indisponible")


def test_platform_admin_and_reset_emails(principal):
    from django.core import mail
    mail.outbox.clear()
    r = principal.post(P + "administrateurs/", {"username": "kofi", "name": "Kofi", "email": "kofi@plat.test"}, format="json")
    pwd = r.json()["credentials"]["password"]
    assert r.json()["invitation"] is True and "plateforme.html" in mail.outbox[0].body and pwd in mail.outbox[0].body
    kofi = User.all_objects.get(username="kofi")
    r2 = principal.post(f"{P}administrateurs/{kofi.pk}/reinitialiser/")
    assert r2.json()["invitation"] is True and r2.json()["credentials"]["password"] in mail.outbox[1].body and "nouveau mot de passe" in mail.outbox[1].body.lower()


def test_school_email_required_and_shared_address_warning(principal):
    base = {"code": "ecole7", "nom": "École Sept", "director": "M. Dir", "director_email": "d@e7.test"}
    r = principal.post(P + "etablissements/", base, format="json")
    assert r.status_code == 400 and "email" in r.json()["errors"]
    r = principal.post(P + "etablissements/", {**base, "email": "contact@e7.test", "founder": "Mme F", "founder_email": "D@E7.test"}, format="json")
    assert r.status_code == 201
    w = r.json()["avertissements"]
    assert len(w) == 1 and "d@e7.test" in w[0] and "directeur" in w[0] and "fondateur" in w[0]
    r2 = principal.post(P + "etablissements/", {**base, "code": "ecole8", "email": "contact@e8.test"}, format="json")
    assert r2.status_code == 201 and r2.json()["avertissements"] == []
