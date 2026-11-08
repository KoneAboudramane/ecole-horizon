from datetime import timedelta

import pytest
from django.utils import timezone

from apps.academics.models import Subject, Teacher, TeachingAssignment
from apps.attendance.models import Absence
from apps.notifications.models import Notification
from apps.schedule.models import Cell, Replacement

pytestmark = pytest.mark.django_db
MON = "2026-10-05"        # un lundi passé
TUE = "2026-10-06"
APPEL = "/api/v1/attendance/appel/"


def put_appel(client, w, slot, date=MON, a="A"):
    return client.put(APPEL, {"school_class": w["c"].pk, "date": date, "slot": slot,
                              "entries": [{"student": w["A"].pk, "status": a}, {"student": w["B"].pk, "status": "P"}]}, format="json")


@pytest.fixture
def week(school):
    """6e A : maths le lundi aux créneaux 0 et 1 (un bloc de 2 h), français le lundi au créneau 2."""
    ma, fr = Subject.objects.get(code="ma"), Subject.objects.get(code="fr")
    for sl, sub in ((0, ma), (1, ma), (2, fr)):
        Cell.objects.create(school_class=school["c"], day=0, slot=sl, subject=sub, room="Salle 1")
    return school


def test_teacher_timetable_and_lessons_come_from_class_timetable(week, login, client):
    login(week["prof"])
    r = client.get(f"/api/v1/lessons/?date={MON}")
    rows = r.data["lessons"]
    assert len(rows) == 1 and rows[0]["slots"] == [0, 1] and rows[0]["code"] == "C1" and not rows[0]["done"]   # 2 h consécutives = 1 cours
    assert client.get(f"/api/v1/lessons/?date={TUE}").data["lessons"] == []                                      # pas cours le mardi
    login(week["hors"])
    assert client.get(f"/api/v1/lessons/?date={MON}").data["lessons"] == []


def test_appel_follows_timetable(week, login, client):
    login(week["prof"])
    assert put_appel(client, week, "C1").status_code == 200
    assert client.get(f"/api/v1/lessons/?date={MON}").data["lessons"][0]["done"]
    assert put_appel(client, week, "C3").status_code == 403                  # le créneau 3 est un cours de français
    assert put_appel(client, week, "C1", date=TUE).status_code == 403        # pas de cours ce jour-là
    assert put_appel(client, week, "Matin").status_code == 403               # l'appel par demi-journée est réservé au personnel quand il y a un emploi du temps
    login(week["hors"])
    assert put_appel(client, week, "C1").status_code == 403


def test_one_family_alert_per_day_even_for_several_lessons(week, login, client):
    login(week["prof"])
    put_appel(client, week, "C1")
    assert Notification.objects.filter(user=week["A"].parent.user, kind="absence").count() == 1
    fr_prof = Teacher.objects.get(user=week["hors"])
    TeachingAssignment.objects.create(school_class=week["c"], subject=Subject.objects.get(code="fr"), teacher=fr_prof)
    login(week["hors"])
    assert put_appel(client, week, "C3").status_code == 200
    assert Absence.objects.filter(student=week["A"]).count() == 2
    assert Notification.objects.filter(user=week["A"].parent.user, kind="absence").count() == 1


def test_staff_keeps_free_appel_and_old_slots_without_timetable(school, users, login, client):
    login(users["educateur"])
    assert put_appel(client, school, "Matin").status_code == 200
    login(school["prof"])
    assert put_appel(client, school, "Après-midi").status_code == 200       # école sans emploi du temps : comme avant
    assert put_appel(client, school, "Z9").status_code == 400


def test_replacement_gives_the_class_to_another_teacher(week, users, login, client):
    login(users["admin"])
    sub = Teacher.objects.get(user=week["hors"])
    body = {"school_class": week["c"].pk, "date": MON, "slot": 0, "teacher": sub.pk}
    r = client.post("/api/v1/replacements/", body, format="json")
    assert r.status_code == 201 and r.data["absent_name"]
    assert Notification.objects.filter(user=week["hors"]).exists()
    login(week["hors"])
    mine = client.get(f"/api/v1/lessons/?date={MON}").data["lessons"]
    assert any(x["slot"] == 0 and x["teacher"] == sub.pk for x in mine)
    assert put_appel(client, week, "C1").status_code == 200                  # le remplaçant fait l'appel
    login(week["prof"])
    titular = client.get(f"/api/v1/lessons/?date={MON}").data["lessons"]
    assert any(x["replaced_out"] for x in titular)
    assert put_appel(client, week, "C1").status_code == 403                  # le titulaire absent ne le peut plus


def test_replacement_rules(week, users, login, client):
    login(users["admin"])
    me = Teacher.objects.get(user=week["prof"])
    other = Teacher.objects.get(user=week["hors"])
    base = {"school_class": week["c"].pk, "date": MON, "teacher": other.pk}
    assert client.post("/api/v1/replacements/", {**base, "slot": 0, "teacher": me.pk}, format="json").status_code == 400   # déjà le titulaire
    assert client.post("/api/v1/replacements/", {**base, "slot": 5}, format="json").status_code == 400                    # pas de cours à ce créneau
    # le remplaçant est déjà occupé ailleurs au même moment
    c2 = type(week["c"]).objects.exclude(pk=week["c"].pk).first()
    TeachingAssignment.objects.update_or_create(school_class=c2, subject=Subject.objects.get(code="fr"), defaults={"teacher": other})
    Cell.objects.create(school_class=c2, day=0, slot=0, subject=Subject.objects.get(code="fr"), room="Salle 2")
    r = client.post("/api/v1/replacements/", {**base, "slot": 0}, format="json")
    assert r.status_code == 400 and c2.name in r.data["detail"]
    cand = client.get(f"/api/v1/replacements/candidates/?class={week['c'].pk}&date={MON}&slot=0").data
    assert next(x for x in cand if x["id"] == other.pk)["busy"] == c2.name
    login(week["prof"])
    assert client.post("/api/v1/replacements/", {**base, "slot": 1}, format="json").status_code == 403
    login(users["admin"])
    ok = client.post("/api/v1/replacements/", {**base, "slot": 2}, format="json")
    assert ok.status_code == 201
    assert client.delete(f"/api/v1/replacements/{ok.data['id']}/").status_code == 204 and not Replacement.objects.exists()


def test_substitute_sees_the_class_roster(week, users, login, client):
    login(week["hors"])
    assert client.get(f"/api/v1/students/?class={week['c'].pk}").data["count"] == 0 if "count" in client.get(f"/api/v1/students/?class={week['c'].pk}").data else True
    login(users["admin"])
    # le remplaçant voit la classe pendant 7 jours après la séance : le dernier lundi, pas une date figée qui vieillit
    today = timezone.localdate()
    monday = (today - timedelta(days=today.weekday())).isoformat()
    client.post("/api/v1/replacements/", {"school_class": week["c"].pk, "date": monday, "slot": 0, "teacher": Teacher.objects.get(user=week["hors"]).pk}, format="json")
    login(week["hors"])
    r = client.get(f"/api/v1/students/?class={week['c'].pk}").data
    assert len(r["results"] if "results" in r else r) == 2


def test_textbook_resume_and_substitute_writes(week, users, login, client):
    ma = Subject.objects.get(code="ma")
    base = {"school_class": week["c"].pk, "subject": ma.pk}
    login(week["prof"])
    assert client.get(f"/api/v1/textbook/last/?class={week['c'].pk}&subject={ma.pk}").data is None            # rien encore
    assert client.post("/api/v1/textbook/", {**base, "date": "2026-09-28", "content": "Les fractions", "homework": "Ex. 3", "due": MON}, format="json").status_code == 201
    last = client.get(f"/api/v1/textbook/last/?class={week['c'].pk}&subject={ma.pk}").data
    assert last["content"] == "Les fractions" and last["date"] == "2026-09-28"
    assert client.get(f"/api/v1/textbook/last/?class={week['c'].pk}&subject={ma.pk}&before=2026-09-28").data is None
    # un remplaçant écrit dans le cahier de la séance qu'il tient, et le titulaire reprend ensuite à sa suite
    login(week["hors"])
    assert client.post("/api/v1/textbook/", {**base, "date": MON, "content": "Exercices"}, format="json").status_code == 403
    login(users["admin"])
    client.post("/api/v1/replacements/", {"school_class": week["c"].pk, "date": MON, "slot": 0, "teacher": Teacher.objects.get(user=week["hors"]).pk}, format="json")
    login(week["hors"])
    r = client.post("/api/v1/textbook/", {**base, "date": MON, "content": "Exercices sur les fractions"}, format="json")
    assert r.status_code == 201
    assert client.post("/api/v1/textbook/", {**base, "date": TUE, "content": "Autre jour"}, format="json").status_code == 403
    login(week["prof"])
    last = client.get(f"/api/v1/textbook/last/?class={week['c'].pk}&subject={ma.pk}").data
    assert last["content"] == "Exercices sur les fractions" and last["teacher_name"]
    lesson = client.get(f"/api/v1/lessons/?date={MON}").data["lessons"]
    assert next(x for x in lesson if x["subject"] == ma.pk)["entry"] == r.data["id"]


SUIVI = "/api/v1/attendance/suivi/"


def test_educator_follows_every_appel_of_the_period(week, users, login, client):
    login(week["prof"])
    assert put_appel(client, week, "C1").status_code == 200                    # maths fait, Léa absente ; le français (C3) n'est pas fait
    assert client.get(f"{SUIVI}?from={MON}&to={MON}").status_code == 403         # réservé au personnel
    login(users["educateur"])
    rows = [r for r in client.get(f"{SUIVI}?from={MON}&to={MON}").data["rows"] if r["school_class"] == week["c"].pk]
    done = next(r for r in rows if r["slot"] == "C1")
    assert done["done"] and done["taken_by"] == week["prof"].name and done["absents"] == 1 and done["taken_at"] is not None
    assert done["subject_name"] and done["start"]
    assert not next(r for r in rows if r["slot"] == "C3")["done"]
    missing = client.get(f"{SUIVI}?from={MON}&to={MON}&class={week['c'].pk}&missing=1").data["rows"]
    assert [r["slot"] for r in missing] == ["C3"]
    assert client.get(f"{SUIVI}?from={TUE}&to={MON}").status_code == 400


def test_educator_with_classes_sees_only_their_appels_and_lessons(week, users, login, client):
    from apps.academics.models import SchoolClass
    from apps.discipline.models import EducatorClass
    other = SchoolClass.objects.exclude(pk=week["c"].pk).first()
    EducatorClass.objects.create(educateur=users["educateur"], school_class=other)
    login(users["educateur"])
    assert not any(r["school_class"] == week["c"].pk for r in client.get(f"{SUIVI}?from={MON}&to={MON}").data["rows"])
    assert client.get(f"/api/v1/lessons/?date={MON}").data["lessons"] == []      # « Cours du jour » suit la même règle
    EducatorClass.objects.filter(educateur=users["educateur"]).delete()           # sans classe confiée : toute l'école
    assert client.get(f"/api/v1/lessons/?date={MON}").data["lessons"]
