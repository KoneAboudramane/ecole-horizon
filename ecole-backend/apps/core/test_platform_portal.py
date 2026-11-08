"""Portail de la plateforme : tableau de bord, fiche école, comptes de direction, administrateurs, journal. Aucune suppression."""
import re

import pytest
from django.core import mail
from django.core.management import call_command
from django.test import Client

from apps.accounts.models import User
from apps.core.models import Etablissement, PlatformLog
from apps.core.schools import create_school

pytestmark = pytest.mark.django_db
P = "/api/v1/plateforme/"


@pytest.fixture
def root(client):
    call_command("create_platform_admin", username="root", name="Root", password="secret1")
    u = User.all_objects.get(username="root")
    u.email = "root@plat.test"
    u.save()
    r = client.post("/api/v1/auth/login/", {"ecole": "plateforme", "username": "root", "password": "secret1"}, format="json")
    assert r.status_code == 200
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    return client


@pytest.fixture
def ecole(root):
    etab, rows = create_school(code="horizon", nom="Horizon", director="Mme Kone", director_email="dir@h.test", secretary="Secr")
    return etab


def dirs(etab):
    return {u.role: u for u in User.all_objects.filter(etablissement=etab)}


def test_only_platform_admins_reach_the_portal(ecole, make_user):
    from rest_framework.test import APIClient
    client = APIClient()
    for path in ("stats/", "administrateurs/", "journal/", f"etablissements/{ecole.pk}/"):
        assert client.get(P + path).status_code in (401, 403)
    from apps.core.tenancy import tenant_context
    with tenant_context(ecole):
        make_user("directeur", "chef", password="secret1", etablissement=ecole)
    r = client.post("/api/v1/auth/login/", {"ecole": "horizon", "username": "chef", "password": "secret1"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    assert client.get(P + "stats/").status_code == 403 and client.get(P + "administrateurs/").status_code == 403


def test_dashboard_counts_and_dormant_schools(root, ecole):
    d = root.get(P + "stats/").json()
    assert d["ecoles"] == Etablissement.objects.count() and d["suspendues"] == 0
    assert "horizon" in [e["code"] for e in d["inactives"]]  # la direction ne s'est jamais connectée
    dirs(ecole)["directeur"].save()
    from django.utils import timezone
    User.all_objects.filter(etablissement=ecole, role="directeur").update(last_login=timezone.now())
    assert "horizon" not in [e["code"] for e in root.get(P + "stats/").json()["inactives"]]


def test_school_sheet(root, ecole):
    d = root.get(f"{P}etablissements/{ecole.pk}/").json()
    assert d["code"] == "horizon" and {a["role"] for a in d["direction"]} == {"directeur", "admin"}
    assert d["roles"]["directeur"] == 1 and not any(k == "password" for a in d["direction"] for k in a)


def test_reset_direction_password_cuts_sessions(root, ecole):
    boss = dirs(ecole)["directeur"]
    from rest_framework.test import APIClient
    other = APIClient()
    first = other.post("/api/v1/auth/login/", {"ecole": "horizon", "username": "directeur", "password": "x"}, format="json")
    assert first.status_code == 401
    r = root.post(f"{P}etablissements/{ecole.pk}/comptes/{boss.pk}/reinitialiser/")
    cred = r.json()["credentials"]
    assert r.status_code == 200 and len(cred["password"]) == 10
    ok = other.post("/api/v1/auth/login/", {"ecole": "horizon", "username": "directeur", "password": cred["password"]}, format="json")
    assert ok.status_code == 200 and ok.json()["user"]["must_change_password"] is True
    assert PlatformLog.objects.filter(action="Mot de passe réinitialisé", etablissement=ecole).exists()
    assert cred["password"] not in " ".join(PlatformLog.objects.values_list("detail", flat=True))


def test_toggle_and_email_fix_on_direction_only(root, ecole, make_user):
    sec = dirs(ecole)["admin"]
    r = root.post(f"{P}etablissements/{ecole.pk}/comptes/{sec.pk}/basculer/")
    assert r.status_code == 200 and User.all_objects.get(pk=sec.pk).is_active is False
    assert root.patch(f"{P}etablissements/{ecole.pk}/comptes/{sec.pk}/", {"email": "new@h.test"}, format="json").status_code == 200
    assert root.patch(f"{P}etablissements/{ecole.pk}/comptes/{sec.pk}/", {"email": "DIR@h.test"}, format="json").status_code == 400
    from apps.core.tenancy import tenant_context
    with tenant_context(ecole):
        prof = make_user("enseignant", "prof", etablissement=ecole)
    assert root.post(f"{P}etablissements/{ecole.pk}/comptes/{prof.pk}/reinitialiser/").status_code == 404  # hors direction
    other = Etablissement.objects.create(code="autre", nom="Autre")
    assert root.post(f"{P}etablissements/{other.pk}/comptes/{sec.pk}/reinitialiser/").status_code == 404  # autre école


def test_nothing_can_be_deleted_from_the_portal(root, ecole):
    boss = dirs(ecole)["directeur"]
    me = User.all_objects.get(username="root")
    for path in (f"etablissements/{ecole.pk}/", f"etablissements/{ecole.pk}/comptes/{boss.pk}/", "administrateurs/", f"administrateurs/{me.pk}/"):
        assert root.delete(P + path).status_code in (404, 405)
    assert root.patch(P + "administrateurs/", {}, format="json").status_code == 405
    assert User.all_objects.filter(pk__in=[boss.pk, me.pk]).count() == 2 and Etablissement.objects.filter(pk=ecole.pk).exists()


def test_create_platform_admin_and_login(root):
    r = root.post(P + "administrateurs/", {"username": "Second", "name": "Second Admin", "email": "s@plat.test"}, format="json")
    assert r.status_code == 201
    cred = r.json()["credentials"]
    assert cred["username"] == "second"
    for bad in ({"username": "second", "name": "X", "email": "x@plat.test"}, {"username": "autre", "name": "X", "email": "S@plat.test"}, {"username": "z", "name": "X", "email": "pas-un-mail"}):
        assert root.post(P + "administrateurs/", bad, format="json").status_code == 400
    from rest_framework.test import APIClient
    c = APIClient()
    ok = c.post("/api/v1/auth/login/", {"ecole": "plateforme", "username": "second", "password": cred["password"]}, format="json")
    assert ok.status_code == 200 and ok.json()["user"]["platform_admin"] and ok.json()["user"]["must_change_password"]
    names = {a["username"] for a in root.get(P + "administrateurs/").json()}
    assert names == {"root", "second"} and not any("password" in a for a in root.get(P + "administrateurs/").json())


def test_journal_records_platform_actions(root, ecole):
    root.patch(f"{P}etablissements/{ecole.pk}/", {"actif": False}, format="json")
    root.patch(f"{P}etablissements/{ecole.pk}/", {"actif": True}, format="json")
    j = root.get(P + "journal/").json()
    acts = [e["action"] for e in j["results"]]
    assert j["total"] >= 3 and "École suspendue" in j["actions"] and len(j["actions"]) == len(set(j["actions"]))
    assert "Connexion" in acts and "École suspendue" in acts and "École réactivée" in acts
    assert [e["action"] for e in root.get(P + "journal/?q=suspendue").json()["results"]] == ["École suspendue"]
    assert [e["action"] for e in root.get(P + "journal/?action=Connexion").json()["results"]] == ["Connexion"]
    page = root.get(P + "journal/?limit=1&offset=1").json()
    assert len(page["results"]) == 1 and page["total"] == j["total"] and page["results"][0] != j["results"][0]


def test_platform_admin_forgot_password(root):
    from rest_framework.test import APIClient
    c = APIClient()
    r = c.post("/api/v1/auth/forgot-password/", {"ecole": "plateforme", "identifier": "root@plat.test"}, format="json")
    assert r.status_code == 200 and len(mail.outbox) == 1 and "plateforme.html#reinitialiser/" in mail.outbox[0].body
    mail.outbox.clear()
    assert c.post("/api/v1/auth/forgot-password/", {"ecole": "plateforme", "identifier": "inconnu"}, format="json").json() == r.json() and not mail.outbox
    c.post("/api/v1/auth/forgot-password/", {"ecole": "plateforme", "identifier": "root"}, format="json")
    uid, tok = re.search(r"#reinitialiser/([^/\s]+)/([^\s]+)", mail.outbox[0].body).groups()
    ok = c.post("/api/v1/auth/reset-password/", {"ecole": "plateforme", "uid": uid, "token": tok, "new": "NouveauMdp#2026"}, format="json")
    assert ok.status_code == 200
    assert c.post("/api/v1/auth/reset-password/", {"ecole": "plateforme", "uid": uid, "token": tok, "new": "AutreMdp#2026x"}, format="json").status_code == 400  # usage unique
    assert c.post("/api/v1/auth/login/", {"ecole": "plateforme", "username": "root", "password": "NouveauMdp#2026"}, format="json").status_code == 200


# ---------- Administration Django ----------
@pytest.fixture
def dj(root):
    c = Client()
    assert c.login(username="root", password="secret1")
    return c


def test_django_admin_creates_platform_admin_and_school(dj):
    r = dj.post("/admin/accounts/platformadminaccount/add/", {"username": "Bis", "full_name": "Bis Admin", "email": "bis@plat.test",
                                                              "password1": "Tres-long#2026", "password2": "Tres-long#2026"})
    assert r.status_code == 302, r.content[:500]
    u = User.all_objects.get(username="bis")
    assert u.is_superuser and u.is_staff and u.etablissement_id is None and u.must_change_password
    r = dj.post("/admin/core/etablissement/add/", {"nom": "Nouvelle", "code": "nouvelle", "prefixe": "NV", "director": "M. Chef", "director_email": "c@n.test"}, follow=True)
    assert "mot de passe" in r.content.decode() and Etablissement.objects.filter(code="nouvelle").exists()
    chef = User.all_objects.get(etablissement__code="nouvelle", role="directeur")
    assert chef.must_change_password and chef.email == "c@n.test"
    assert not dj.post("/admin/core/etablissement/add/", {"nom": "X", "code": "plateforme", "prefixe": "X", "director": "Y"}).status_code == 302


def test_django_admin_protects_last_and_self(dj):
    root = User.all_objects.get(username="root")
    assert dj.post(f"/admin/accounts/platformadminaccount/{root.pk}/delete/", {"post": "yes"}).status_code in (403, 404)
    dj.post("/admin/accounts/platformadminaccount/add/", {"username": "bis", "full_name": "B", "email": "b@p.test", "password1": "Tres-long#2026", "password2": "Tres-long#2026"})
    bis = User.all_objects.get(username="bis")
    assert dj.post(f"/admin/accounts/platformadminaccount/{root.pk}/delete/", {"post": "yes"}).status_code in (403, 404)  # pas soi-même
    dj.post("/admin/accounts/platformadminaccount/", {"action": "desactiver", "_selected_action": [root.pk, bis.pk]}, follow=True)
    assert User.all_objects.get(pk=root.pk).is_active and not User.all_objects.get(pk=bis.pk).is_active  # soi-même exclu
    assert PlatformLog.objects.filter(action="Administrateur créé (admin)").exists()


def test_school_accounts_never_get_admin_access(dj, ecole):
    u = dirs(ecole)["directeur"]
    dj.post(f"/admin/accounts/user/{u.pk}/change/", {"etablissement": ecole.pk, "username": "directeur", "full_name": "X", "role": "directeur", "email": "d@h.test",
                                                         "lang": "fr", "is_active": "on", "failed_attempts": 0, "date_joined_0": "2026-01-01", "date_joined_1": "00:00:00"})
    assert not User.all_objects.get(pk=u.pk).is_staff


def test_statistics_only_cover_what_the_platform_does(root, ecole, client):
    root.post(P + "administrateurs/", {"username": "bis", "name": "Bis", "email": "b@p.test"}, format="json")
    assert root.post(P + "etablissements/", {"code": "nouvelle", "nom": "Nouvelle", "director": "M. Chef", "email": "contact@n.test", "director_email": "c@n.test"}, format="json").status_code == 201
    root.patch(f"{P}etablissements/{ecole.pk}/", {"actif": False}, format="json")
    boss = dirs(ecole)["directeur"]
    root.post(f"{P}etablissements/{ecole.pk}/comptes/{boss.pk}/reinitialiser/")
    from rest_framework.test import APIClient
    APIClient().post("/api/v1/auth/login/", {"ecole": "plateforme", "username": "root", "password": "faux"}, format="json")
    s = root.get(P + "statistiques/?jours=7").json()
    assert s["jours"] == 7 and len(s["actions"]) == 7 and len(s["refus"]) == 7
    types = {r["action"]: r["n"] for r in s["actions_par_type"]}
    assert types["Administrateur créé"] == 1 and types["École suspendue"] == 1 and "Connexion" not in types
    assert s["total_actions"] == sum(types.values()) == sum(a["n"] for a in s["actions"])
    assert s["reinitialisations"] == 1 and s["suspensions"] == 1 and s["ecoles_creees"] == 1 and s["total_refus"] == 1 and s["connexions_admin"] >= 1
    assert s["ecoles_suspendues"] == 1 and s["ecoles_actives"] == Etablissement.objects.filter(actif=True).count()
    assert len(s["ecoles"]) == 12 and s["ecoles"][-1]["cumul"] == Etablissement.objects.count()
    todo = {r["key"]: r["n"] for r in s["a_traiter"]}
    assert todo["provisoire"] == 3 and todo["sans_email"] == 1 and s["comptes_direction"] == 3  # directeur + secrétariat d'Horizon, directeur de Nouvelle
    User.all_objects.filter(pk=boss.pk).update(email="", is_active=True)
    assert {r["key"]: r["n"] for r in root.get(P + "statistiques/").json()["a_traiter"]}["sans_email"] == 2
    assert len(root.get(P + "statistiques/?jours=abc").json()["actions"]) == 30
    assert not any(k in s for k in ("roles", "inscriptions", "connexions_par_ecole"))  # aucun détail d'école
    assert isinstance(s["eleves"], int) and all(set(r) == {"nom", "n"} for r in s["eleves_par_ecole"])  # élèves : agrégat seulement
    assert APIClient().get(P + "statistiques/").status_code in (401, 403)


# ---------- Abonnement unique ----------
import datetime as _dt

import pytest as _pytest
from rest_framework.test import APIClient as _API

from apps.core.models import AbonnementPaiement, Etablissement as _Etab, PlatformSettings, add_months


def _pf_client(db):
    from apps.accounts.models import User
    u = User.all_objects.create_user(username="pfabo", password="Motdepasse#2026", full_name="Admin Abo", email="a@b.ci", is_superuser=True, role="admin") if not User.all_objects.filter(username="pfabo").exists() else User.all_objects.get(username="pfabo")
    c = _API()
    c.force_authenticate(u)
    return c


@_pytest.mark.django_db
def test_abonnement_etats_et_lecture_seule():
    e = _Etab.objects.create(code="abo1", nom="Abo")
    today = _dt.date.today()
    assert e.abonnement_etat == "sans_echeance" and not e.lecture_seule
    cfg = PlatformSettings.load()
    assert cfg.grace_jours == 30                     # un mois de délai, comme dans le document des tarifs
    e.abonnement_fin = today + _dt.timedelta(days=cfg.rappel_jours + 5)
    assert e.abonnement_etat == "actif"
    e.abonnement_fin = today + _dt.timedelta(days=3)
    assert e.abonnement_etat == "bientot"
    e.abonnement_fin = today - _dt.timedelta(days=2)
    assert e.abonnement_etat == "grace" and not e.lecture_seule
    e.abonnement_fin = today - _dt.timedelta(days=cfg.grace_jours + 1)
    assert e.abonnement_etat == "echu" and e.lecture_seule


def test_decoupage_et_annee_scolaire():
    from apps.core.abonnement import decouper, fin_annee_scolaire
    assert decouper(300_000, 3, 25_000) == [100_000] * 3
    assert decouper(400_000, 3, 25_000) == [150_000, 125_000, 125_000]
    assert decouper(400_000, 3, 0) == [133_334, 133_333, 133_333]                # sans arrondi : parts égales
    assert decouper(550_000, 2, 25_000) == [275_000, 275_000] and decouper(400_000, 1) == [400_000]
    cfg = PlatformSettings()                                                        # réglages par défaut, sans base
    assert fin_annee_scolaire(_dt.date(2026, 10, 1), cfg) == _dt.date(2027, 7, 31)
    assert fin_annee_scolaire(_dt.date(2027, 3, 1), cfg) == _dt.date(2027, 7, 31)
    assert fin_annee_scolaire(_dt.date(2027, 6, 1), cfg) == _dt.date(2028, 7, 31)  # dans les 3 derniers mois : l'année qui suit
    cfg.fin_annee = "30/06"
    assert fin_annee_scolaire(_dt.date(2026, 10, 1), cfg) == _dt.date(2027, 6, 30)


@_pytest.mark.django_db
def test_echeancier_inscription_puis_renouvellement_par_tranches():
    from apps.accounts.models import User
    from apps.core.abonnement import fin_annee_scolaire, plan
    admin = User.all_objects.create_user(username="pfx", password="Motdepasse#2026", full_name="PF", email="x@y.ci", is_superuser=True, role="admin")
    c = _API(); c.force_authenticate(admin)
    r = c.patch("/api/v1/plateforme/abonnement/", {"tarif_renouvellement": 300000, "grace_jours": 30}, format="json")
    assert r.status_code == 200 and r.data["tarif_inscription"] == 400000 and r.data["tarif_renouvellement_multi"] == 400000
    e = _Etab.objects.create(code="abo2", nom="Abo2")
    url = f"/api/v1/plateforme/etablissements/{e.pk}/abonnement/paiement/"
    today = _dt.date.today()
    f = c.get(f"/api/v1/plateforme/etablissements/{e.pk}/").data
    assert f["prochaine_nature"] == "inscription" and f["tarifs"]["inscription"] == 400000 and f["tranches_proposees"] == {"inscription": 2, "renouvellement": 3}
    p = c.get(f"/api/v1/plateforme/etablissements/{e.pk}/abonnement/plan/?nature=inscription&tranches=2").data
    assert [t["montant"] for t in p["tranches"]] == [200000, 200000]

    # inscription en 2 tranches : la 1re payée, l'accès court jusqu'à la 2e (deux mois plus tard)
    r = c.post(url, {"nature": "inscription", "tranches": 2, "mode": "mobile", "reference": "T1"}, format="json")
    assert r.status_code == 201 and r.data["reste_du"] == 200000 and len(r.data["echeancier"]) == 2
    e.refresh_from_db()
    assert e.abonnement_fin == add_months(today, 2)
    assert AbonnementPaiement.objects.get().montant == 200000
    assert c.post(url, {"montant": 250000}, format="json").status_code == 400          # plus que le reste dû
    r = c.post(url, {}, format="json")                                                  # 2e tranche : le reste, par défaut
    assert r.status_code == 201 and r.data["reste_du"] == 0 and r.data["prochaine_nature"] == "renouvellement"
    fin = fin_annee_scolaire(today)
    e.refresh_from_db()
    assert e.abonnement_fin == fin

    # renouvellement proposé par défaut en 3 tranches : 31 juillet, 30 novembre et fin février
    assert c.post(url, {"nature": "renouvellement", "tranches": 13}, format="json").status_code == 400
    assert [t["echeance"] for t in plan(e, "renouvellement", 3, today)] == [fin, _dt.date(fin.year, 11, 30), _dt.date(fin.year + 1, 2, 28 if (fin.year + 1) % 4 else 29)]
    r = c.post(url, {"nature": "renouvellement", "tranches": 3, "montant": 150000}, format="json")   # une tranche et demie
    assert r.status_code == 201 and r.data["reste_du"] == 150000
    e.refresh_from_db()
    assert e.abonnement_fin == _dt.date(fin.year, 11, 30)
    assert len(r.data["echeancier"]) == 3 and r.data["echeancier"][1]["regle"] == 50000

    # échéance toujours modifiable à la main ; paiement ni modifiable ni supprimable ; date future refusée
    assert c.patch(f"/api/v1/plateforme/etablissements/{e.pk}/", {"abonnement_fin": "2030-01-31"}, format="json").status_code == 200
    assert c.delete(url).status_code == 405
    assert c.post(url, {"date": "2999-01-01"}, format="json").status_code == 400
    assert c.get("/api/v1/plateforme/statistiques/").data["abonnements"]["actif"] >= 1


@_pytest.mark.django_db
def test_tarif_plusieurs_cursus():
    from apps.academics.models import Cursus
    from apps.core.abonnement import plan
    e = _Etab.objects.create(code="abo5", nom="Franco-arabe")
    Cursus.all_objects.create(etablissement=e, nom="Français", langue="fr")
    today = _dt.date.today()
    assert plan(e, "inscription", 1, today)[0]["montant"] == 400000
    Cursus.all_objects.create(etablissement=e, nom="Arabe", langue="ar")
    assert plan(e, "inscription", 1, today)[0]["montant"] == 550000
    assert [t["montant"] for t in plan(e, "renouvellement", 3, today)] == [150000, 125000, 125000]


@_pytest.mark.django_db
def test_reglages_et_echeancier_libres(root):
    """Rien n'est figé : l'administrateur change les réglages à tout moment et fixe l'échéancier de chaque école à la main."""
    from apps.core.abonnement import plan
    today = _dt.date.today()
    r = root.patch("/api/v1/plateforme/abonnement/", {"tarif_inscription": 500000, "inscription_tranches": 4, "inscription_ecart_mois": 1,
                                                       "renouvellement_dates": "1/9, 1/1", "arrondi": 0, "fin_annee": "30/6"}, format="json")
    assert r.status_code == 200 and r.data["renouvellement_dates"] == "01/09, 01/01" and r.data["fin_annee"] == "30/06"
    assert root.patch("/api/v1/plateforme/abonnement/", {"renouvellement_dates": "31/13"}, format="json").status_code == 400
    assert root.patch("/api/v1/plateforme/abonnement/", {"fin_annee": "juin"}, format="json").status_code == 400
    e = _Etab.objects.create(code="abo6", nom="Libre")
    p = plan(e, "inscription", 4, today)
    assert [t["montant"] for t in p] == [125000] * 4 and [t["echeance"] for t in p] == [add_months(today, i) for i in range(4)]
    url = f"/api/v1/plateforme/etablissements/{e.pk}/"
    assert root.get(url + "abonnement/plan/?nature=inscription&tranches=13").status_code == 400

    # prix négocié pour cette école : 3 tranches choisies à la main
    d1, d2, d3 = today, today + _dt.timedelta(days=45), today + _dt.timedelta(days=90)
    ech = [{"echeance": str(d1), "montant": 100000}, {"echeance": str(d2), "montant": 120000}, {"echeance": str(d3), "montant": 130000}]
    r = root.post(url + "abonnement/paiement/", {"nature": "inscription", "echeancier": ech, "mode": "especes"}, format="json")
    assert r.status_code == 201 and r.data["reste_du"] == 250000 and r.data["abonnement_fin"] == d2
    assert AbonnementPaiement.objects.filter(etablissement=e).get().montant == 100000
    desordre = [{"echeance": str(d2), "montant": 1}, {"echeance": str(d1), "montant": 1}]
    e2 = _Etab.objects.create(code="abo7", nom="Désordre")
    assert root.post(f"/api/v1/plateforme/etablissements/{e2.pk}/abonnement/paiement/", {"echeancier": desordre}, format="json").status_code == 400

    # une tranche non réglée se modifie : report, nouveau montant ; jamais sous ce qui est déjà réglé
    t2 = next(t for t in r.data["echeancier"] if t["numero"] == 2)
    r = root.patch(url + f"abonnement/tranches/{t2['id']}/", {"echeance": str(d2 + _dt.timedelta(days=10)), "montant": 90000}, format="json")
    assert r.status_code == 200 and r.data["reste_du"] == 220000 and r.data["abonnement_fin"] == d2 + _dt.timedelta(days=10)
    t1 = next(t for t in r.data["echeancier"] if t["numero"] == 1)
    assert root.patch(url + f"abonnement/tranches/{t1['id']}/", {"montant": 5}, format="json").status_code == 400   # déjà réglée
    root.post(url + "abonnement/paiement/", {"montant": 40000}, format="json")
    assert root.patch(url + f"abonnement/tranches/{t2['id']}/", {"montant": 10000}, format="json").status_code == 400  # 40 000 déjà réglés
    r = root.patch(url + f"abonnement/tranches/{t2['id']}/", {"montant": 40000}, format="json")                        # ramenée au réglé : soldée
    assert r.status_code == 200 and r.data["abonnement_fin"] == d3


@_pytest.mark.django_db
def test_numero_de_transaction(root):
    e = _Etab.objects.create(code="abo8", nom="Transactions")
    url = f"/api/v1/plateforme/etablissements/{e.pk}/abonnement/paiement/"
    r = root.post(url, {"nature": "inscription", "tranches": 2, "mode": "mobile"}, format="json")
    assert r.status_code == 400 and "transaction" in r.data["detail"]               # obligatoire en mobile money
    assert root.post(url, {"nature": "inscription", "tranches": 2, "mode": "mobile", "reference": " MP2610.1234 "}, format="json").status_code == 201
    assert AbonnementPaiement.objects.get(etablissement=e).reference == "MP2610.1234"
    r = root.post(url, {"mode": "mobile", "reference": "mp2610.1234"}, format="json")       # déjà enregistré : refusé
    assert r.status_code == 400 and "déjà enregistré" in r.data["detail"]
    assert root.post(url, {"mode": "cheque"}, format="json").status_code == 400
    assert root.post(url, {"mode": "especes"}, format="json").status_code == 201             # espèces : facultatif


@_pytest.mark.django_db
def test_recu_de_paiement(root):
    from apps.accounts.models import User
    from apps.core.models import PlatformLog
    e = _Etab.objects.create(code="abo9", nom="Reçus")
    url = f"/api/v1/plateforme/etablissements/{e.pk}/abonnement/paiement/"
    r1 = root.post(url, {"nature": "inscription", "tranches": 2, "mode": "mobile", "reference": "MP1"}, format="json")
    r2 = root.post(url, {"mode": "virement", "reference": "VIR-2"}, format="json")
    an = _dt.date.today().year
    assert (r1.data["paiement"]["numero"], r2.data["paiement"]["numero"]) == (f"AB-{an}-0001", f"AB-{an}-0002")
    p = AbonnementPaiement.objects.get(numero=f"AB-{an}-0001")
    assert [ln["ici"] for ln in p.detail["lignes"]] == [200000, 0] and p.detail["reste_du"] == 200000      # figé au paiement
    assert p.detail["prochaine"]["reste"] == 200000
    assert r2.data["paiements"][0]["numero"] == f"AB-{an}-0002"
    pdf = root.get(f"/api/v1/plateforme/paiements/{p.pk}/recu.pdf")
    assert pdf.status_code == 200 and pdf["Content-Type"] == "application/pdf" and pdf.content.startswith(b"%PDF")
    root.get(f"/api/v1/plateforme/paiements/{p.pk}/recu.pdf?duplicata=1")
    assert PlatformLog.objects.filter(action="Duplicata de reçu d’abonnement").count() == 1
    d = User.all_objects.create_user(username="dir9", password="Motdepasse#2026", full_name="Dir9", role="directeur", etablissement=e)
    c = _API(); c.force_authenticate(d)
    assert c.get(f"/api/v1/plateforme/paiements/{p.pk}/recu.pdf").status_code == 403


@_pytest.mark.django_db
def test_echeance_delai_echeancier_sans(root):
    from apps.core.models import PlatformLog
    e = _Etab.objects.create(code="abo10", nom="Délais")
    url = f"/api/v1/plateforme/etablissements/{e.pk}/abonnement/"
    assert root.post(url + "echeance/", {"action": "echeancier"}, format="json").status_code == 400      # pas encore d'échéancier
    r = root.post(url + "paiement/", {"nature": "inscription", "tranches": 2}, format="json")
    calc = r.data["echeance_calculee"]
    assert calc == r.data["abonnement_fin"]
    plus = calc + _dt.timedelta(days=15)
    assert root.post(url + "echeance/", {"action": "delai", "date": str(plus)}, format="json").status_code == 400  # motif obligatoire
    r = root.post(url + "echeance/", {"action": "delai", "date": str(plus), "motif": "Attente du virement de la mairie"}, format="json")
    assert r.status_code == 200 and r.data["abonnement_fin"] == plus and r.data["echeance_calculee"] == calc
    assert "Attente du virement" in PlatformLog.objects.filter(action="Échéance modifiée").latest("id").detail
    r = root.post(url + "echeance/", {"action": "echeancier"}, format="json")
    assert r.data["abonnement_fin"] == calc
    r = root.post(url + "echeance/", {"action": "sans", "motif": "École partenaire"}, format="json")
    assert r.data["abonnement_fin"] is None and r.data["abonnement_etat"] == "sans_echeance"


@_pytest.mark.django_db
def test_recu_verifiable_qr_signature_cachet(root):
    e = _Etab.objects.create(code="abo11", nom="Vérifiable")
    r = root.post(f"/api/v1/plateforme/etablissements/{e.pk}/abonnement/paiement/", {"nature": "inscription", "tranches": 2, "mode": "mobile", "reference": "MPV1"}, format="json")
    p = AbonnementPaiement.objects.get(pk=r.data["paiement"]["id"])
    assert len(p.code_verif) == 9 and p.code_verif[4] == "-"
    anon = _API()
    ok = anon.get("/api/v1/public/recu/verifier/", {"c": p.code_verif.lower().replace("-", " ")})       # saisie approximative acceptée
    assert ok.status_code == 200 and ok.data["authentique"] and ok.data["numero"] == p.numero and ok.data["montant"] == 200000 and ok.data["ecole"] == "Vérifiable"
    assert "reference" not in ok.data and "detail" not in ok.data                                       # rien au-delà de ce qui est imprimé
    assert anon.get("/api/v1/public/recu/verifier/", {"c": "AAAA-BBBB"}).status_code == 404
    assert anon.get("/api/v1/public/recu/verifier/", {"c": p.code_verif, "n": "AB-1999-0001"}).status_code == 404   # numéro qui ne correspond pas
    # signature et cachet : images seulement, imprimées sur le reçu avec le QR code
    png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    assert root.patch("/api/v1/plateforme/abonnement/", {"recu_signature": "javascript:alert(1)"}, format="json").status_code == 400
    assert root.patch("/api/v1/plateforme/abonnement/", {"recu_signature": png, "recu_cachet": png}, format="json").status_code == 200
    pdf = root.get(f"/api/v1/plateforme/paiements/{p.pk}/recu.pdf", HTTP_ORIGIN="http://localhost:4200")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    from apps.core.platform import lien_verification
    from rest_framework.test import APIRequestFactory
    lien = lien_verification(APIRequestFactory().get("/"), p)
    assert lien.startswith("http://testserver/verifier.html?c=") and p.code_verif in lien and "api=" not in lien


@_pytest.mark.django_db
def test_paiement_reserve_plateforme(db, client):
    e = _Etab.objects.create(code="abo3", nom="Abo3")
    from apps.accounts.models import User
    u = User.all_objects.create_user(username="dir3", password="Motdepasse#2026", full_name="Dir", role="directeur", etablissement=e)
    c = _API(); c.force_authenticate(u)
    assert c.post(f"/api/v1/plateforme/etablissements/{e.pk}/abonnement/paiement/", {}, format="json").status_code == 403
    assert c.patch("/api/v1/plateforme/abonnement/", {"grace_jours": 1}, format="json").status_code == 403


@_pytest.mark.django_db
def test_lecture_seule_apres_grace():
    from apps.accounts.models import User
    e = _Etab.objects.create(code="abo4", nom="Abo4", abonnement_fin=_dt.date.today() - _dt.timedelta(days=60))
    User.all_objects.create_user(username="dir4", password="Motdepasse#2026", full_name="Dir4", role="directeur", etablissement=e)
    r = _API().post("/api/v1/auth/login/", {"ecole": "abo4", "username": "dir4", "password": "Motdepasse#2026"}, format="json")
    assert r.status_code == 200                                         # la connexion reste possible
    c = _API(); c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
    me = c.get("/api/v1/me/")
    assert me.status_code == 200 and me.data["etablissement"]["lecture_seule"] is True
    r = c.post("/api/v1/announcements/", {"title": "x", "body": "y"}, format="json")
    assert r.status_code == 403 and "lecture seule" in str(r.data)
    assert c.post("/api/v1/me/password/", {}, format="json").status_code != 403   # changer son mot de passe reste permis


# ---------- Double authentification ----------
@_pytest.mark.django_db
def test_double_authentification_portail_et_admin_django():
    import time as _t
    from apps.accounts import totp
    from apps.accounts.models import User, TotpDevice
    User.all_objects.create_user(username="pf2", password="Motdepasse#2026", full_name="PF2", email="p@q.ci", is_superuser=True, is_staff=True)
    login = lambda c, **x: c.post("/api/v1/auth/login/", {"ecole": "plateforme", "username": "pf2", "password": "Motdepasse#2026", **x}, format="json")
    c = _API()
    r = login(c)
    assert r.status_code == 200
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
    assert c.get("/api/v1/auth/2fa/").data["enabled"] is False
    sec = c.post("/api/v1/auth/2fa/").data["secret"]
    assert c.post("/api/v1/auth/2fa/activer/", {"code": "000000"}, format="json").status_code == 400
    assert login(_API()).status_code == 200  # pas encore active
    code = totp._code(sec, int(_t.time() // 30))
    r = c.post("/api/v1/auth/2fa/activer/", {"code": code}, format="json")
    assert r.status_code == 200 and len(r.data["recovery_codes"]) == 8
    rec = r.data["recovery_codes"][0]
    # connexion : code requis, faux refusé, code déjà utilisé refusé, code de secours accepté une seule fois
    r = login(_API()); assert r.status_code == 401 and r.data["otp_required"]
    assert login(_API(), otp="123456").status_code == 401
    assert login(_API(), otp=code).status_code == 401  # même code réutilisé
    assert login(_API(), otp=rec).status_code == 200
    assert login(_API(), otp=rec).status_code == 401
    # Django admin : refus sans code, accès avec code de secours
    from django.test import Client
    r = Client().post("/admin/login/?next=/admin/", {"username": "pf2", "password": "Motdepasse#2026", "otp": "", "next": "/admin/"})
    assert r.status_code == 200 and b"Code de v" in r.content
    # on remplace les empreintes par un code de secours connu
    TotpDevice.objects.update(recovery=[totp.hash_code("aaaa-bbbb-cccc")])
    r = Client().post("/admin/login/?next=/admin/", {"username": "pf2", "password": "Motdepasse#2026", "otp": "aaaa-bbbb-cccc", "next": "/admin/"})
    assert r.status_code == 302
    # désactivation : mot de passe + code
    c2 = _API(); TotpDevice.objects.update(recovery=[totp.hash_code("zzzz-yyyy-xxxx")])
    tok = login(_API(), otp="zzzz-yyyy-xxxx").data["access"]; c2.credentials(HTTP_AUTHORIZATION="Bearer " + tok)
    TotpDevice.objects.update(recovery=[totp.hash_code("1111-2222-3333")])
    assert c2.post("/api/v1/auth/2fa/desactiver/", {"password": "mauvais", "code": "1111-2222-3333"}, format="json").status_code == 400
    assert c2.post("/api/v1/auth/2fa/desactiver/", {"password": "Motdepasse#2026", "code": "1111-2222-3333"}, format="json").status_code == 200
    assert login(_API()).status_code == 200


@_pytest.mark.django_db
def test_2fa_reservee_plateforme():
    from apps.accounts.models import User
    e = _Etab.objects.create(code="tfa", nom="TFA")
    u = User.all_objects.create_user(username="d", password="Motdepasse#2026", full_name="D", role="directeur", etablissement=e)
    c = _API(); c.force_authenticate(u)
    assert c.get("/api/v1/auth/2fa/").status_code == 403 and c.post("/api/v1/auth/2fa/").status_code == 403


# ---------- Anti-robot ----------
@_pytest.mark.django_db
def test_captcha_connexion_et_mot_de_passe_oublie(settings, monkeypatch):
    import re
    from apps.accounts import captcha
    from apps.accounts.models import User
    settings.CAPTCHA_ENABLED = True
    monkeypatch.setattr(captcha, "MIN_DELAY", 0)
    User.all_objects.create_user(username="pfc", password="Motdepasse#2026", full_name="C", is_superuser=True)
    c = _API()
    body = {"ecole": "plateforme", "username": "pfc", "password": "Motdepasse#2026"}
    r = c.post("/api/v1/auth/login/", body, format="json")
    assert r.status_code == 400 and r.data["captcha"]  # sans réponse
    ch = c.get("/api/v1/auth/captcha/").data
    a, op, b = re.search(r"(\d) ([+×]) (\d)", ch["question"]).groups()
    ans = int(a) + int(b) if op == "+" else int(a) * int(b)
    assert c.post("/api/v1/auth/login/", {**body, "captcha_token": ch["token"], "captcha_answer": ans + 1}, format="json").status_code == 400
    assert c.post("/api/v1/auth/login/", {**body, "captcha_token": ch["token"], "captcha_answer": ans}, format="json").status_code == 200
    assert c.post("/api/v1/auth/login/", {**body, "captcha_token": ch["token"], "captcha_answer": ans}, format="json").status_code == 400  # usage unique
    assert c.post("/api/v1/auth/forgot-password/", {"ecole": "plateforme", "identifier": "pfc"}, format="json").status_code == 400
    monkeypatch.setattr(captcha, "MIN_DELAY", 60)  # réponse instantanée = robot
    ch = c.get("/api/v1/auth/captcha/").data
    assert c.post("/api/v1/auth/login/", {**body, "captcha_token": ch["token"], "captcha_answer": ans}, format="json").status_code == 400
    settings.CAPTCHA_ENABLED = False
    assert c.get("/api/v1/auth/captcha/").data == {"enabled": False}
