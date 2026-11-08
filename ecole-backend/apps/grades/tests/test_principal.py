"""Professeur principal : attribution par la direction ou le secrétariat, accès à SA classe seulement."""
import pytest

from apps.academics.models import SchoolClass, Teacher
from apps.attendance.models import Absence
from apps.discipline.models import Incident
from apps.grades.models import CouncilComment, Grade
from apps.notifications.models import Notification

from .test_grades import mk_eval, put
from .test_grades import world as _world

world = _world   # même école de test que les notes (fixture partagée)

pytestmark = pytest.mark.django_db


def assign(client, cl, teacher):
    return client.put(f"/api/v1/classes/{cl.pk}/principal/", {"teacher": teacher.pk if teacher else None}, format="json")


def test_direction_and_secretariat_assign_head_teacher(world, users, login, client):
    w = world
    t_autre = Teacher.objects.get(user=w["autre"])
    for r in ("enseignant", "educateur", "comptable", "parent", "eleve", "informatique"):
        login(users[r])
        assert assign(client, w["c"], t_autre).status_code == 403, r
    login(users["admin"])
    r = assign(client, w["c"], t_autre)
    assert r.status_code == 200 and r.data["prof_principal"] == t_autre.pk and r.data["prof_principal_name"] == w["autre"].name
    assert Notification.objects.filter(user=w["autre"], text__contains="professeur principal").exists()
    login(users["directeur"])
    assert assign(client, w["c"], None).status_code == 200
    assert SchoolClass.objects.get(pk=w["c"].pk).prof_principal is None
    assert client.put(f"/api/v1/classes/{w['c'].pk}/principal/", {"teacher": 99999}, format="json").status_code == 400
    # Le nom s'affiche dans la liste des classes
    assign(client, w["c"], t_autre)
    row = next(c for c in client.get("/api/v1/classes/").data if c["id"] == w["c"].pk)
    assert row["prof_principal_name"] == w["autre"].name


def test_head_teacher_sees_whole_class_read_only(world, users, login, client):
    """Le professeur de français, principal de la classe, voit aussi les maths ; il ne peut pas toucher ces notes."""
    w = world
    w["c"].prof_principal = Teacher.objects.get(user=w["autre"]); w["c"].save()
    ev = mk_eval(w, w["ma"], "devoir")
    ev.teacher = Teacher.objects.get(user=w["prof"]); ev.save()
    put(w, ev, A=14, B=8)
    Absence.objects.create(student=w["A"], school_class=w["c"], date=w["T1"].start, slot="Matin", status="A")
    Absence.objects.create(student=w["A"], school_class=w["c"], date=w["T1"].start, slot="Après-midi", status="R")
    Incident.objects.create(student=w["B"], date=w["T1"].start, type="bavardage", gravite="legere", sanction="observation", description="Bavardage")

    login(w["autre"])
    assert [c["name"] for c in client.get("/api/v1/principal/").data] == ["6e A"]
    d = client.get(f"/api/v1/principal/{w['c'].pk}/?term=T1").data
    assert d["grades"][f"{ev.pk}|{w['A'].pk}"] == 14                         # notes de maths d'un collègue
    assert d["stats"]["results"][str(w["A"].pk)]["moyenne"] is not None
    assert d["assiduite"][str(w["A"].pk)] == {"absences": 1, "non_justifiees": 1, "retards": 1}
    assert d["incidents"][0]["student"] == w["B"].pk
    # Lecture seule : les notes restent à leur enseignant
    assert client.put(f"/api/v1/evaluations/{ev.pk}/grades/", {"values": {str(w["A"].pk): 20}}, format="json").status_code == 403
    assert float(Grade.objects.get(evaluation=ev, student=w["A"]).value) == 14

    # Le professeur de maths (non principal) n'y a pas accès, ni à une autre classe
    login(w["prof"])
    assert client.get("/api/v1/principal/").data == []
    assert client.get(f"/api/v1/principal/{w['c'].pk}/").status_code == 403
    login(w["autre"])
    other = SchoolClass.objects.exclude(pk=w["c"].pk).first()
    assert client.get(f"/api/v1/principal/{other.pk}/").status_code == 403


def test_head_teacher_writes_council_for_own_class_only(world, users, login, client):
    w = world
    w["c"].prof_principal = Teacher.objects.get(user=w["autre"]); w["c"].save()
    body = {"student": w["A"].pk, "term": "T1", "text": "Bon trimestre, à confirmer."}
    login(w["prof"])
    assert client.put("/api/v1/council/", body, format="json").status_code == 403         # simple enseignant de la classe
    login(w["autre"])
    assert client.put("/api/v1/council/", body, format="json").status_code == 200
    assert CouncilComment.objects.get(student=w["A"]).text == "Bon trimestre, à confirmer."
    assert client.get(f"/api/v1/principal/{w['c'].pk}/?term=T1").data["council"][str(w["A"].pk)] == "Bon trimestre, à confirmer."
    w["T1"].locked = True; w["T1"].save()
    assert client.put("/api/v1/council/", {**body, "text": "Changé"}, format="json").status_code == 403   # période close
    login(users["directeur"])
    assert client.put("/api/v1/council/", {**body, "text": "Avis de la direction"}, format="json").status_code == 200


def test_bulletin_shows_head_teacher_and_director_names(world, users, login, client, monkeypatch):
    """Le bulletin porte le nom du professeur principal et celui du directeur (Paramètres, sinon compte de direction)."""
    from reportlab import rl_config

    from apps.academics.models import SchoolSettings
    monkeypatch.setattr(rl_config, "pageCompression", 0)      # texte lisible dans le PDF
    w = world
    w["autre"].full_name = "Kone Prof Principal"; w["autre"].save()
    users["directeur"].full_name = "Diallo Compte Direction"; users["directeur"].save()
    w["c"].prof_principal = Teacher.objects.get(user=w["autre"]); w["c"].save()
    put(w, mk_eval(w, w["ma"], "devoir", published=True), A=14)

    def pdf_of():
        login(users["directeur"])
        r = client.get(f"/api/v1/students/{w['A'].pk}/bulletin.pdf?term=T1")
        assert r.status_code == 200
        return b"".join(r.streaming_content) if getattr(r, "streaming", False) else r.content

    cfg = SchoolSettings.load(); cfg.director = ""; cfg.save()
    body = pdf_of()
    assert b"Kone Prof Principal" in body and b"Diallo Compte Direction" in body      # à défaut : le compte de direction
    cfg.director = "Traore Nom Officiel"; cfg.save()
    body = pdf_of()
    assert b"Traore Nom Officiel" in body and b"Diallo Compte Direction" not in body  # le nom des Paramètres prime
    assert client.get("/api/v1/settings/").data["director_name"] == "Traore Nom Officiel"
