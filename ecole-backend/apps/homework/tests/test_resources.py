"""Supports de cours et cours en direct : liens https, fichier, visibilité du lien d'un cours en direct."""
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from apps.academics.models import SchoolSettings, Subject
from apps.homework.models import Resource

pytestmark = pytest.mark.django_db
R = "/api/v1/resources/"


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path


@pytest.fixture
def on(school):
    cfg = SchoolSettings.load(); cfg.devoirs_actifs = True; cfg.save()
    return school


def fmt(dt):
    return timezone.localtime(dt).strftime("%Y-%m-%dT%H:%M:%S")


def body(school, **kw):
    b = dict(school_class=school["c"].pk, subject=Subject.objects.get(code="ma").pk, kind="support", title="Chapitre 1 : les fractions",
             links=[{"url": "https://www.youtube.com/watch?v=abc", "label": "Vidéo"}])
    b.update(kw)
    return b


def test_module_off_and_only_the_class_teacher_posts(school, on, users, login, client):
    login(on["prof"])
    assert client.post(R, body(on), format="json").status_code == 201
    for who in (on["hors"], on["A"].user, on["A"].parent.user, users["directeur"]):
        login(who)
        assert client.post(R, body(on), format="json").status_code == 403, who.role
    login(on["prof"])
    assert client.post(R, body(on, subject=Subject.objects.get(code="fr").pk), format="json").status_code == 403
    cfg = SchoolSettings.load(); cfg.devoirs_actifs = False; cfg.save()
    assert client.get(R).status_code == 403


@pytest.mark.parametrize("url", ["http://exemple.com/x", "javascript:alert(1)", "https://user:pw@exemple.com/", "https:///x", "https://localhost/x", "ftp://a.com", "https://a b.com/"])
def test_only_clean_https_links(on, login, client, url):
    login(on["prof"])
    assert client.post(R, body(on, links=[{"url": url, "label": ""}]), format="json").status_code == 400


def test_link_or_file_is_required_and_file_rules(on, login, client):
    login(on["prof"])
    assert client.post(R, body(on, links=[]), format="json").status_code == 400
    r = client.post(R, body(on, links=[], will_attach=True), format="json")
    assert r.status_code == 201
    pk = r.data["id"]
    assert client.post(f"{R}{pk}/file/", {"file": SimpleUploadedFile("virus.exe", b"x")}, format="multipart").status_code == 400
    r = client.post(f"{R}{pk}/file/", {"file": SimpleUploadedFile("cours.pdf", b"%PDF-1.4 x")}, format="multipart")
    assert r.status_code == 200 and r.data["has_file"]
    login(on["A"].user)
    assert client.get(f"{R}{pk}/file/").status_code == 200
    login(on["hors"])
    assert client.get(f"{R}{pk}/file/").status_code == 403
    login(on["prof"])
    assert client.delete(f"{R}{pk}/file/").status_code == 400      # plus ni lien ni fichier


def test_students_and_parents_see_supports_of_their_class_and_are_notified(on, login, client):
    from apps.notifications.models import Notification
    login(on["prof"])
    client.post(R, body(on), format="json")
    assert Notification.objects.filter(user=on["A"].user, text__contains="support de cours").exists()
    assert Notification.objects.filter(user=on["B"].parent.user, text__contains="support de cours").exists()
    for who in (on["A"].user, on["A"].parent.user):
        login(who)
        rows = client.get(R).data
        assert len(rows) == 1 and rows[0]["links"][0]["url"].startswith("https://")
    login(on["hors"])
    assert client.get(R).data == []


def test_live_link_is_hidden_until_the_session(on, login, client):
    login(on["prof"])
    soon = timezone.now() + timedelta(hours=3)
    r = client.post(R, body(on, kind="direct", title="Cours de rattrapage", links=[{"url": "https://meet.google.com/abc-defg-hij", "label": ""}],
                            starts_at=fmt(soon), ends_at=fmt(soon + timedelta(hours=1))), format="json")
    assert r.status_code == 201 and r.data["links"]            # l'enseignant le voit toujours
    pk = r.data["id"]
    login(on["A"].user)
    d = client.get(f"{R}{pk}/").data
    assert d["links"] == [] and d["links_hidden"] is True
    Resource.objects.filter(pk=pk).update(starts_at=timezone.now() + timedelta(minutes=10), ends_at=timezone.now() + timedelta(hours=1))
    assert client.get(f"{R}{pk}/").data["links"]                # 15 minutes avant
    Resource.objects.filter(pk=pk).update(starts_at=timezone.now() - timedelta(hours=2), ends_at=timezone.now() - timedelta(hours=1))
    assert client.get(f"{R}{pk}/").data["links"] == []          # séance terminée
    Resource.objects.filter(pk=pk).update(starts_at=timezone.now(), ends_at=timezone.now() + timedelta(hours=1))
    login(on["A"].parent.user)
    assert client.get(f"{R}{pk}/").data["links"] == []          # le parent voit la séance, pas le lien
    login(on["prof"])
    assert client.post(R, body(on, kind="direct", links=[{"url": "https://meet.google.com/x.y"}]), format="json").status_code == 400   # dates absentes


def test_edit_and_delete_only_by_the_owner(on, login, client):
    login(on["prof"])
    pk = client.post(R, body(on), format="json").data["id"]
    assert client.patch(f"{R}{pk}/", {"title": "Chapitre 1 (corrigé)"}, format="json").status_code == 200
    assert client.patch(f"{R}{pk}/", {"kind": "direct"}, format="json").status_code == 400
    assert client.patch(f"{R}{pk}/", {"links": []}, format="json").status_code == 400
    login(on["hors"])
    assert client.patch(f"{R}{pk}/", {"title": "Piraté"}, format="json").status_code in (403, 404)
    assert client.delete(f"{R}{pk}/").status_code in (403, 404)
    login(on["prof"])
    assert client.delete(f"{R}{pk}/").status_code == 204 and not Resource.objects.exists()
