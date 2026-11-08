from datetime import timedelta

import pytest
from django.utils import timezone

from apps.academics.models import SchoolSettings, Subject, Teacher
from apps.academics.horaires import Horaires
from apps.notifications.models import Notification
from apps.schedule.models import Cell

pytestmark = pytest.mark.django_db
DISPO = "/api/v1/timetable/dispo/"
MON = "2026-10-05"


def all_keys(days=range(7)):
    hr = Horaires()
    return [f"{d}-{s}" for d in days for s in range(hr.slots_open(d))]


def test_teacher_fills_own_availability_until_the_deadline(school, users, login, client):
    me = Teacher.objects.get(user=school["prof"])
    login(school["prof"])
    r = client.get(DISPO).data
    assert [t["id"] for t in r["teachers"]] == [me.pk] and r["teachers"][0]["updated"] is None   # l'enseignant ne voit que la sienne
    assert r["teachers"][0]["hours"] > 0 and r["teachers"][0]["required"] >= r["teachers"][0]["hours"]
    ok = client.put(f"{DISPO}{me.pk}/", {"grid": {"2-0": "x", "2-1": "x", "5-0": "p"}}, format="json")
    assert ok.status_code == 200 and ok.data["available"] == ok.data["open"] - 2 and ok.data["avoid"] == 1
    me.refresh_from_db()
    assert me.dispo == {"2-0": "x", "2-1": "x", "5-0": "p"} and me.dispo_at
    assert client.put(f"{DISPO}{me.pk}/", {"grid": {"6-0": "x"}}, format="json").status_code == 400          # dimanche : pas de cours
    assert client.put(f"{DISPO}{me.pk}/", {"grid": {"0-0": "z"}}, format="json").status_code == 400
    r = client.put(f"{DISPO}{me.pk}/", {"grid": {k: "x" for k in all_keys()}}, format="json")
    assert r.status_code == 400 and "au moins" in r.data["detail"]                                             # minimum de créneaux disponibles
    other = Teacher.objects.get(user=school["hors"])
    assert client.put(f"{DISPO}{other.pk}/", {"grid": {}}, format="json").status_code == 403
    assert client.put(DISPO, {"limite": None}, format="json").status_code == 403
    # Date limite passée : l'enseignant ne peut plus modifier, la direction si
    login(users["admin"])
    yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
    assert client.put(DISPO, {"limite": yesterday, "ratio": 1}, format="json").data["closed"]
    login(school["prof"])
    r = client.put(f"{DISPO}{me.pk}/", {"grid": {}}, format="json")
    assert r.status_code == 400 and "close" in r.data["detail"]
    login(users["admin"])
    r = client.put(f"{DISPO}{me.pk}/", {"grid": {k: "x" for k in all_keys()}}, format="json")
    assert r.status_code == 200 and r.data["warning"]                                                         # possible, mais signalé
    assert Notification.objects.filter(user=school["prof"], text__contains="disponibilités").exists()
    assert len(client.get(DISPO).data["teachers"]) >= 2
    login(users["parent"])
    assert client.get(DISPO).status_code == 403


def test_generator_never_uses_unavailable_slots(school, users, login, client):
    me = Teacher.objects.get(user=school["prof"])
    ma = Subject.objects.get(code="ma")
    me.dispo = {k: "x" for k in all_keys((0, 1))} | {k: "p" for k in all_keys((3,))}      # ni lundi ni mardi, plutôt pas le jeudi
    me.save()
    login(users["admin"])
    r = client.post("/api/v1/timetable/generate/")
    assert r.status_code == 200
    days = set(Cell.objects.filter(school_class=school["c"], subject=ma).values_list("day", flat=True))
    assert days and not days & {0, 1} and 3 not in days
    # Indisponible partout : ses cours ne peuvent pas être placés et la direction sait pourquoi
    me.dispo = {k: "x" for k in all_keys()}
    me.save()
    r = client.post("/api/v1/timetable/generate/").data
    assert not Cell.objects.filter(school_class=school["c"], subject=ma).exists()
    assert r["unplaced"] and r["blocked_by"][0]["name"] == school["prof"].name and r["blocked_by"][0]["missing"] > 0


def test_manual_placement_and_replacements_show_unavailability(school, users, login, client):
    me = Teacher.objects.get(user=school["prof"])
    me.dispo = {"0-0": "x", "0-1": "p"}
    me.save()
    ma = Subject.objects.get(code="ma")
    login(users["admin"])
    body = {"school_class": school["c"].pk, "day": 0, "slot": 0, "subject": ma.pk, "room": "Salle 1"}
    r = client.put("/api/v1/timetable/", body, format="json")
    assert r.status_code == 200 and "indisponible" in r.data["warnings"][0]                                   # averti, pas bloqué
    assert "préfère" in client.put("/api/v1/timetable/", {**body, "slot": 1}, format="json").data["warnings"][0]
    fr = Subject.objects.get(code="fr")
    Cell.objects.create(school_class=school["c"], day=0, slot=2, subject=fr, room="Salle 1")
    from apps.academics.models import TeachingAssignment
    TeachingAssignment.objects.update_or_create(school_class=school["c"], subject=fr, defaults={"teacher": Teacher.objects.get(user=school["hors"])})
    me.dispo = {"0-2": "x"}
    me.save()
    cand = client.get(f"/api/v1/replacements/candidates/?class={school['c'].pk}&date={MON}&slot=2").data
    assert next(x for x in cand if x["id"] == me.pk)["dispo"] == "x"


def test_reminder_goes_to_teachers_who_have_not_filled_in(school, users, login, client):
    me = Teacher.objects.get(user=school["prof"])
    login(school["prof"])
    client.put(f"{DISPO}{me.pk}/", {"grid": {}}, format="json")
    login(users["admin"])
    cfg = SchoolSettings.load()
    cfg.dispo_limite = timezone.localdate() + timedelta(days=7)
    cfg.save()
    r = client.post(f"{DISPO}remind/")
    assert r.status_code == 200 and r.data["sent"] >= 1
    assert Notification.objects.filter(user=school["hors"], text__contains="disponibilités").exists()
    assert not Notification.objects.filter(user=school["prof"], text__contains="Indiquez vos disponibilités").exists()
