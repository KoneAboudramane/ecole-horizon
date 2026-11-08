"""Le cahier de textes est fermé aux élèves par défaut ; chaque école peut l'ouvrir (Paramètres)."""
import datetime

import pytest

from apps.academics.models import SchoolSettings, Subject
from apps.schedule.models import TextEntry

pytestmark = pytest.mark.django_db


@pytest.fixture
def entry(school):
    return TextEntry.objects.create(school_class=school["c"], subject=Subject.objects.first(), date=datetime.date(2026, 10, 5), content="Les fractions")


def test_student_cannot_read_the_textbook_by_default(school, entry, login, client):
    login(school["A"].user)
    assert client.get("/api/v1/textbook/").status_code == 403
    assert client.get(f"/api/v1/textbook/{entry.pk}/").status_code == 403


def test_parents_and_staff_still_read_it(school, entry, users, login, client):
    for who in (school["A"].parent.user, users["enseignant"], users["directeur"]):
        login(who)
        r = client.get("/api/v1/textbook/")
        assert r.status_code == 200, who.role


def test_school_can_open_it_to_students(school, entry, users, login, client):
    assert SchoolSettings.load().eleve_voit_cahier is False
    login(users["directeur"])
    assert client.patch("/api/v1/settings/", {"eleve_voit_cahier": True}, format="json").status_code == 200
    login(school["A"].user)
    r = client.get("/api/v1/textbook/")
    assert r.status_code == 200 and len(r.data["results"]) == 1
    assert client.get("/api/v1/settings/").data["eleve_voit_cahier"] is True
    login(users["directeur"])
    client.patch("/api/v1/settings/", {"eleve_voit_cahier": False}, format="json")
    login(school["A"].user)
    assert client.get("/api/v1/textbook/").status_code == 403


def test_only_those_who_manage_settings_can_change_it(school, users, login, client):
    for who in (school["A"].user, school["A"].parent.user, users["enseignant"]):
        login(who)
        assert client.patch("/api/v1/settings/", {"eleve_voit_cahier": True}, format="json").status_code == 403


def test_student_sees_only_his_own_absences_and_marks(school, login, client):
    from apps.attendance.models import Absence
    A, B = school["A"], school["B"]
    for st in (A, B):
        Absence.objects.create(student=st, school_class=st.school_class, date=datetime.date(2026, 10, 5), slot="matin", status="A")
    login(A.user)
    rows = client.get("/api/v1/absences/").data
    rows = rows["results"] if isinstance(rows, dict) else rows
    assert {r["student"] for r in rows} == {A.pk}
    ids = {s["id"] for s in (client.get("/api/v1/students/").data["results"])}
    assert ids == {A.pk}
    assert client.get(f"/api/v1/students/{B.pk}/").status_code in (403, 404)
    assert client.get(f"/api/v1/students/{B.pk}/attendance/").status_code in (403, 404)
