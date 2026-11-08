import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

pytestmark = pytest.mark.django_db


def png_bytes(size=(40, 40)):
    b = io.BytesIO()
    Image.new("RGB", size, "green").save(b, "PNG")
    return b.getvalue()


def test_me_returns_profile_and_permissions(users, login):
    c = login(users["admin"])
    r = c.get("/api/v1/me/")
    assert r.status_code == 200
    assert r.data["role"] == "admin" and "accounts" in r.data["permissions"]


def test_patch_me_updates_only_allowed_fields(users, login):
    u = users["enseignant"]
    c = login(u)
    r = c.patch("/api/v1/me/", {"name": "Mme Konan Aya", "phone": "07 00 00 00 00", "lang": "ar", "role": "directeur", "is_active": False}, format="json")
    assert r.status_code == 200
    u.refresh_from_db()
    assert (u.full_name, u.phone, u.lang) == ("Mme Konan Aya", "07 00 00 00 00", "ar")
    assert u.role == "enseignant" and u.is_active  # le rôle ne se modifie jamais soi-même


def test_patch_me_rejects_bad_language_and_short_name(users, login):
    c = login(users["eleve"])
    assert c.patch("/api/v1/me/", {"lang": "xx"}, format="json").status_code == 400
    assert c.patch("/api/v1/me/", {"name": "A"}, format="json").status_code == 400


def test_change_password_flow(users, login, client):
    u = users["parent"]
    c = login(u)
    assert c.post("/api/v1/me/password/", {"current": "faux", "new": "nouveau1", "confirm": "nouveau1"}, format="json").status_code == 400
    assert c.post("/api/v1/me/password/", {"current": "secret1", "new": "abc", "confirm": "abc"}, format="json").status_code == 400
    assert c.post("/api/v1/me/password/", {"current": "secret1", "new": "nouveau1", "confirm": "autre"}, format="json").status_code == 400
    assert c.post("/api/v1/me/password/", {"current": "secret1", "new": "secret1", "confirm": "secret1"}, format="json").status_code == 400
    assert c.post("/api/v1/me/password/", {"current": "secret1", "new": "nouveau1", "confirm": "nouveau1"}, format="json").status_code == 204
    client.credentials()
    assert client.post("/api/v1/auth/login/", {"username": "parent", "password": "secret1"}, format="json").status_code == 401
    assert client.post("/api/v1/auth/login/", {"username": "parent", "password": "nouveau1"}, format="json").status_code == 200


def test_temporary_password_can_be_replaced_without_current(make_user, login):
    u = make_user("eleve", must_change_password=True)
    c = login(u)
    assert c.get("/api/v1/me/").data["must_change_password"] is True
    assert c.post("/api/v1/me/password/", {"new": "perso123", "confirm": "perso123"}, format="json").status_code == 204
    assert c.get("/api/v1/me/").data["must_change_password"] is False


def test_photo_upload_and_remove(users, login, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    c = login(users["enseignant"])
    f = SimpleUploadedFile("moi.png", png_bytes(), content_type="image/png")
    r = c.post("/api/v1/me/photo/", {"photo": f}, format="multipart")
    assert r.status_code == 200 and r.data["photo"]
    r = c.delete("/api/v1/me/photo/")
    assert r.status_code == 200 and r.data["photo"] is None


def test_photo_rejects_fake_image_and_wrong_type(users, login, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    c = login(users["enseignant"])
    fake = SimpleUploadedFile("x.png", b"ceci n'est pas une image", content_type="image/png")
    assert c.post("/api/v1/me/photo/", {"photo": fake}, format="multipart").status_code == 400
    pdf = SimpleUploadedFile("x.pdf", b"%PDF-1.4", content_type="application/pdf")
    assert c.post("/api/v1/me/photo/", {"photo": pdf}, format="multipart").status_code == 400


def test_photo_rejects_big_file(users, login, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    c = login(users["enseignant"])
    big = SimpleUploadedFile("big.png", png_bytes() + b"0" * (2 * 1024 * 1024 + 1), content_type="image/png")
    assert c.post("/api/v1/me/photo/", {"photo": big}, format="multipart").status_code == 400
