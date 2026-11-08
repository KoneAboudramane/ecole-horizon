"""Page d'accueil, promotion auprès des écoles : coordonnées et prix réglés par l'administrateur de la plateforme ; une école
intéressée demande une démonstration sans compte ; l'administrateur voit et traite les demandes."""
import pytest
from rest_framework.test import APIClient

from apps.core.models import DemandeDemo, PlatformSettings

from .test_platform_portal import root  # noqa: F401  (fixture)

pytestmark = pytest.mark.django_db
PUB = "/api/v1/public/demande-demo/"


def test_contacts_and_price_are_published_when_set(root):  # noqa: F811
    c = PlatformSettings.load()
    c.tarif_inscription, c.tarif_renouvellement = 400000, 300000
    c.save()
    r = root.patch("/api/v1/plateforme/accueil/", {"whatsapp": "+225 07 00 00 00 01", "email": "contact@plateforme.ci", "prix": True}, format="json")
    assert r.status_code == 200 and r.json()["contact"]["whatsapp"] == "+225 07 00 00 00 01"
    pub = APIClient().get("/api/v1/public/school/").json()["accueil"]
    assert pub["contact"]["email"] == "contact@plateforme.ci" and pub["prix"] == {"inscription": 400000, "renouvellement": 300000}
    root.patch("/api/v1/plateforme/accueil/", {"prix": False}, format="json")
    assert APIClient().get("/api/v1/public/school/").json()["accueil"]["prix"] is None          # « tarif sur demande »
    assert root.patch("/api/v1/plateforme/accueil/", {"whatsapp": "appelez-moi"}, format="json").status_code == 400


def test_a_school_requests_a_demo_and_the_platform_admin_handles_it(root):  # noqa: F811
    anon = APIClient()
    r = anon.post(PUB, {"ecole": "Groupe scolaire Al Nour", "ville": "Bouaké", "nom": "M. Traoré", "telephone": "07 08 09 10 11"}, format="json")
    assert r.status_code == 201
    assert anon.post(PUB, {"ecole": "X", "nom": "", "telephone": "abc"}, format="json").status_code == 400
    rows = root.get("/api/v1/plateforme/demandes/").json()
    assert [(x["ecole"], x["ville"], x["traitee"]) for x in rows] == [("Groupe scolaire Al Nour", "Bouaké", False)]
    assert root.patch(f"/api/v1/plateforme/demandes/{rows[0]['id']}/", {"traitee": True}, format="json").json()["traitee"] is True
    assert anon.get("/api/v1/plateforme/demandes/").status_code in (401, 403)


def test_the_platform_admin_receives_each_demo_request_by_email(root, mailoutbox, monkeypatch, django_capture_on_commit_callbacks):  # noqa: F811
    from apps.core import accueil
    monkeypatch.setattr(accueil, "_start", lambda fn, *a: fn(*a))   # envoi direct, sans fil d'exécution
    anon, demo = APIClient(), {"ecole": "Collège Les Palmiers", "nom": "Mme Koné", "telephone": "07 01 02 03 04", "message": "600 élèves"}
    with django_capture_on_commit_callbacks(execute=True):
        anon.post(PUB, demo, format="json")
    assert mailoutbox == []                                          # aucune adresse réglée : rien n'est envoyé
    root.patch("/api/v1/plateforme/accueil/", {"email": "contact@plateforme.ci"}, format="json")
    with django_capture_on_commit_callbacks(execute=True):
        anon.post(PUB, demo, format="json")
    assert mailoutbox[-1].to == ["contact@plateforme.ci"]            # par défaut : l'e-mail de contact
    r = root.patch("/api/v1/plateforme/accueil/", {"email_demandes": "ventes@plateforme.ci"}, format="json")
    assert r.json()["email_demandes"] == "ventes@plateforme.ci"
    with django_capture_on_commit_callbacks(execute=True):
        anon.post(PUB, demo, format="json")
    m = mailoutbox[-1]
    assert m.to == ["ventes@plateforme.ci"] and "Collège Les Palmiers" in m.subject and "07 01 02 03 04" in m.body and "600 élèves" in m.body
    assert "email_demandes" not in APIClient().get("/api/v1/public/school/").json()["accueil"]   # adresse jamais publiée
    assert root.patch("/api/v1/plateforme/accueil/", {"email_demandes": "pas-une-adresse"}, format="json").status_code == 400


def test_robots_filling_the_hidden_field_are_ignored():
    r = APIClient().post(PUB, {"ecole": "Spam", "nom": "Bot", "telephone": "0102030405", "site": "http://spam"}, format="json")
    assert r.status_code == 201 and not DemandeDemo.objects.exists()


def test_platform_figures_are_totals_without_names(root, users):  # noqa: F811
    from django.core.cache import cache
    cache.delete("accueil-chiffres")
    pub = APIClient().get("/api/v1/public/school/").json()["accueil"]
    assert set(pub["chiffres"]) == {"ecoles", "eleves", "connectes", "paiements"} and all(isinstance(v, int) for v in pub["chiffres"].values())
    root.patch("/api/v1/plateforme/accueil/", {"chiffres": False}, format="json")
    assert APIClient().get("/api/v1/public/school/").json()["accueil"]["chiffres"] is None


def test_home_page_visits_are_counted_anonymously(root):  # noqa: F811
    from apps.core.models import VisiteJour, VisiteurJour
    c = APIClient(HTTP_USER_AGENT="Mozilla/5.0 (Linux; Android 14) Chrome/130")
    for _ in range(3):
        assert c.post("/api/v1/public/visite/").status_code == 204
    APIClient(HTTP_USER_AGENT="Googlebot/2.1").post("/api/v1/public/visite/")        # robot : ignoré
    APIClient(HTTP_USER_AGENT="Mozilla/5.0 (iPhone) Safari", REMOTE_ADDR="10.0.0.9").post("/api/v1/public/visite/")
    v = VisiteJour.objects.get()
    assert (v.vues, v.visiteurs) == (4, 2)                                            # 4 pages vues, 2 visiteurs
    assert all(len(x.empreinte) == 16 and "." not in x.empreinte for x in VisiteurJour.objects.all())   # aucune adresse conservée
    d = root.get("/api/v1/plateforme/visites/?jours=7").json()
    assert d["jours"] == 7 and len(d["serie"]) == 7 and d["aujourdhui"] == 2 and d["periode"]["vues"] == 4
    assert APIClient().get("/api/v1/plateforme/visites/").status_code in (401, 403)


def test_visitor_figures_on_the_home_page(root):  # noqa: F811
    from django.core.cache import cache
    cache.delete("accueil-visiteurs")
    APIClient(HTTP_USER_AGENT="Mozilla/5.0 Chrome/130").post("/api/v1/public/visite/")
    v = APIClient().get("/api/v1/public/school/").json()["accueil"]["visiteurs"]
    assert v == {"aujourdhui": 1, "mois": 1, "total": 1}
    root.patch("/api/v1/plateforme/accueil/", {"visiteurs": False}, format="json")
    assert APIClient().get("/api/v1/public/school/").json()["accueil"]["visiteurs"] is None
