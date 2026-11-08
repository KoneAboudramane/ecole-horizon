"""Page d'accueil publique : commune à toutes les écoles, gérée uniquement par l'administrateur de la plateforme."""
import os
from io import BytesIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.models import AccueilPhoto, PlatformLog
from apps.core.schools import create_school

pytestmark = pytest.mark.django_db
U = "/api/v1/plateforme/accueil/"
LOGO = "data:image/png;base64,iVBORw0KGgo="


@pytest.fixture(autouse=True)
def _media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path


@pytest.fixture
def root(client):
    call_command("create_platform_admin", username="root", name="Root", password="secret1")
    r = client.post("/api/v1/auth/login/", {"ecole": "plateforme", "username": "root", "password": "secret1"}, format="json")
    assert r.status_code == 200
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
    return client


def photo(w=2400, h=1600, name="ecole.jpg", fmt="JPEG"):
    buf = BytesIO()
    im = Image.new("RGB", (w, h), (30, 120, 80))
    if fmt == "JPEG":
        exif = Image.Exif()
        exif[0x010F] = "Appareil"            # métadonnée : doit disparaître
        im.save(buf, fmt, exif=exif.tobytes())
    else:
        im.save(buf, fmt)
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg" if fmt == "JPEG" else "image/png")


def test_platform_admin_builds_the_shared_home_page(root):
    create_school(code="alpha", nom="Alpha", director="Mme A", director_email="a@a.test")
    create_school(code="beta", nom="Beta", director="M. B", director_email="b@b.test")
    r = root.post(U, {"photo": photo(), "caption": "La cour"}, format="multipart")
    assert r.status_code == 201 and r.data["caption"] == "La cour" and r.data["url"].endswith(".jpg")
    x = AccueilPhoto.objects.get()
    with Image.open(x.image.path) as im:
        assert max(im.size) == 1920 and not im.getexif()                 # réduite, métadonnées retirées
    second = root.post(U, {"photo": photo(name="b.png", fmt="PNG")}, format="multipart").data
    assert root.patch(f"{U}{second['id']}/", {"caption": "Le préau"}, format="json").data["caption"] == "Le préau"
    r = root.patch(U, {"order": [second["id"], x.pk], "carte": False, "nom": "Réseau Horizon", "logo": LOGO}, format="json")
    assert [p["id"] for p in r.data["photos"]] == [second["id"], x.pk] and r.data["carte"] is False and r.data["nom"] == "Réseau Horizon"
    assert root.patch(U, {"logo": "javascript:alert(1)"}, format="json").status_code == 400
    assert PlatformLog.objects.filter(action__icontains="page d’accueil").exists()
    # La même page d'accueil pour toutes les écoles, sans connexion
    anon = APIClient()
    for q in ("", "?ecole=alpha", "?ecole=beta"):
        acc = anon.get("/api/v1/public/school/" + q).data["accueil"]
        assert [p["caption"] for p in acc["photos"]] == ["Le préau", "La cour"] and acc["carte"] is False and acc["nom"] == "Réseau Horizon" and acc["logo"] == LOGO
    path = x.image.path
    assert root.delete(f"{U}{x.pk}/").status_code == 204
    assert not os.path.exists(path) and AccueilPhoto.objects.count() == 1


def test_slideshow_rules_and_schools_cannot_touch_the_home_page(root):
    etab, _rows = create_school(code="horizon", nom="Horizon", director="Mme Kone", director_email="dir@h.test")
    assert root.post(U, {"photo": photo(200, 150)}, format="multipart").status_code == 400          # trop petite
    bad = SimpleUploadedFile("x.jpg", b"pas une image", content_type="image/jpeg")
    assert root.post(U, {"photo": bad}, format="multipart").status_code == 400
    for _ in range(AccueilPhoto.MAX):
        assert root.post(U, {"photo": photo(900, 600)}, format="multipart").status_code == 201
    r = root.post(U, {"photo": photo(900, 600)}, format="multipart")
    assert r.status_code == 400 and "au plus" in r.data["detail"]
    d = User.all_objects.get(etablissement=etab, role="directeur")
    d.set_password("secret1"); d.must_change_password = False; d.save()
    c = APIClient()
    tok = c.post("/api/v1/auth/login/", {"ecole": "horizon", "username": d.username, "password": "secret1"}, format="json").data["access"]
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {tok}")
    assert c.get(U).status_code == 403
    assert c.patch(U, {"nom": "Pirate"}, format="json").status_code == 403
    assert c.post(U, {"photo": photo(900, 600)}, format="multipart").status_code == 403
