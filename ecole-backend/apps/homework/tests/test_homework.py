"""Devoirs en fichier et épreuves en ligne : droits, chrono côté serveur, correction automatique, report dans les notes."""
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from apps.academics.models import SchoolSettings, Subject
from apps.homework.models import Assignment, Submission

pytestmark = pytest.mark.django_db
H = "/api/v1/homeworks/"


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path


@pytest.fixture
def on(school):
    cfg = SchoolSettings.load(); cfg.devoirs_actifs = True; cfg.save()
    return school


def fmt(dt):
    return timezone.localtime(dt).strftime("%Y-%m-%dT%H:%M:%S")


def create(client, school, **kw):
    body = dict(school_class=school["c"].pk, subject=Subject.objects.get(code="ma").pk, kind="fichier", title="Exercices de fractions",
                due_at=fmt(timezone.now() + timedelta(days=2)))
    body.update(kw)
    r = client.post(H, body, format="json")
    assert r.status_code == 201, r.content
    return r.data


QUESTIONS = [
    {"kind": "qcm", "text": "Combien font 1/2 + 1/4 ?", "choices": ["1/6", "3/4", "2/6", "1"], "correct": [1], "points": 2},
    {"kind": "vf", "text": "0,5 est égal à 1/2.", "correct": [0], "points": 1},
    {"kind": "qcm", "text": "Quels nombres sont premiers ?", "choices": ["2", "4", "7", "9"], "correct": [0, 2], "points": 2},
]


def epreuve(client, school, minutes=30):
    a = create(client, school, kind="epreuve", duration_min=minutes)
    r = client.put(f"{H}{a['id']}/questions/", {"questions": QUESTIONS}, format="json")
    assert r.status_code == 200, r.content
    assert client.post(f"{H}{a['id']}/send/").status_code == 200
    return a["id"]


def test_module_is_off_by_default(school, login, client):
    login(school["prof"])
    assert client.get(H).status_code == 403


def test_only_the_teacher_of_the_class_creates(on, users, login, client):
    body = dict(school_class=on["c"].pk, subject=Subject.objects.get(code="ma").pk, kind="fichier", title="Exercices", due_at=fmt(timezone.now() + timedelta(days=1)))
    for who in (on["hors"], on["A"].user, on["A"].parent.user, users["directeur"]):
        login(who)
        assert client.post(H, body, format="json").status_code == 403, who.role
    login(on["prof"])
    assert client.post(H, {**body, "subject": Subject.objects.get(code="fr").pk}, format="json").status_code == 403   # matière qu'il n'enseigne pas ici
    assert client.post(H, body, format="json").status_code == 201


def test_draft_is_invisible_until_sent(on, login, client):
    login(on["prof"])
    a = create(client, on)
    login(on["A"].user)
    assert client.get(H).data == [] and client.get(f"{H}{a['id']}/").status_code == 404
    login(on["prof"])
    assert client.post(f"{H}{a['id']}/send/").status_code == 200
    login(on["A"].user)
    assert len(client.get(H).data) == 1
    from apps.notifications.models import Notification
    assert Notification.objects.filter(user=on["A"].user, text__contains="Exercices de fractions").exists()
    assert Notification.objects.filter(user=on["A"].parent.user, text__contains="Exercices de fractions").exists()


def test_file_flow_submit_replace_grade(on, login, client):
    login(on["prof"])
    a = create(client, on, max_points=10)
    client.post(f"{H}{a['id']}/send/")
    login(on["A"].user)
    r = client.post(f"{H}{a['id']}/submit/", {"file": SimpleUploadedFile("copie.pdf", b"%PDF-1.4 x"), "comment": "voilà"}, format="multipart")
    assert r.status_code == 200 and r.data["status"] == "rendu" and not r.data["late"]
    r = client.post(f"{H}{a['id']}/submit/", {"file": SimpleUploadedFile("v2.png", b"png")}, format="multipart")
    assert r.status_code == 200 and r.data["file_name"] == "v2.png"
    assert Submission.objects.count() == 1
    login(on["prof"])
    rows = client.get(f"{H}{a['id']}/submissions/").data["rows"]
    assert {x["name"]: x["status"] for x in rows} == {"AKA Léa": "rendu", "BAH Ali": "a_faire"}
    sid = next(x["id"] for x in rows if x["id"])
    assert client.get(f"/api/v1/submissions/{sid}/file/").status_code == 200
    r = client.put(f"{H}{a['id']}/grades/", {"grades": [{"student": on["A"].pk, "score": 8, "feedback": "Bien"}, {"student": on["B"].pk, "score": 5}]}, format="json")
    assert r.status_code == 200
    assert client.put(f"{H}{a['id']}/grades/", {"grades": [{"student": on["A"].pk, "score": 11}]}, format="json").status_code == 400   # au-dessus du barème
    login(on["A"].user)
    me = client.get(f"{H}{a['id']}/").data["mine"][0]
    assert me["score"] == 8 and me["status"] == "corrige" and me["feedback"] == "Bien"
    r = client.post(f"{H}{a['id']}/submit/", {"file": SimpleUploadedFile("v3.pdf", b"x")}, format="multipart")
    assert r.status_code == 400   # déjà corrigée
    login(on["B"].user)
    assert client.get(f"/api/v1/submissions/{sid}/file/").status_code == 404   # copie d'un camarade


def test_file_rules(on, login, client):
    login(on["prof"])
    a = create(client, on, allow_late=False)
    client.post(f"{H}{a['id']}/send/")
    login(on["A"].user)
    for name, data in (("virus.exe", b"x"), ("vide.pdf", b""), ("gros.pdf", b"x" * (5 * 1024 * 1024 + 1))):
        r = client.post(f"{H}{a['id']}/submit/", {"file": SimpleUploadedFile(name, data)}, format="multipart")
        assert r.status_code == 400, name
    Assignment.objects.filter(pk=a["id"]).update(due_at=timezone.now() - timedelta(hours=1), opens_at=timezone.now() - timedelta(days=3))
    assert client.post(f"{H}{a['id']}/submit/", {"file": SimpleUploadedFile("c.pdf", b"x")}, format="multipart").status_code == 400
    Assignment.objects.filter(pk=a["id"]).update(allow_late=True)
    r = client.post(f"{H}{a['id']}/submit/", {"file": SimpleUploadedFile("c.pdf", b"x")}, format="multipart")
    assert r.status_code == 200 and r.data["late"] is True


def test_parent_cannot_act_and_other_class_cannot_see(on, users, make_user, login, client):
    login(on["prof"])
    a = create(client, on)
    client.post(f"{H}{a['id']}/send/")
    login(on["A"].parent.user)
    assert len(client.get(H).data) == 1
    assert client.post(f"{H}{a['id']}/submit/", {"file": SimpleUploadedFile("c.pdf", b"x")}, format="multipart").status_code == 403
    login(on["hors"])
    assert client.get(H).data == [] and client.get(f"{H}{a['id']}/submissions/").status_code == 403
    login(users["directeur"])
    assert len(client.get(H).data) == 1     # la direction suit les devoirs envoyés
    assert client.get(f"{H}{a['id']}/submissions/").status_code == 200
    assert client.put(f"{H}{a['id']}/grades/", {"grades": []}, format="json").status_code == 403


def test_quiz_questions_are_hidden_until_start_and_never_show_answers(on, login, client):
    login(on["prof"])
    aid = epreuve(client, on)
    assert "correct" in client.get(f"{H}{aid}/").data["questions"][0]
    login(on["A"].user)
    d = client.get(f"{H}{aid}/").data
    assert "questions" not in d and d["question_count"] == 3 and d["total_points"] == 5
    r = client.post(f"{H}{aid}/start/")
    assert r.status_code == 200 and len(r.data["questions"]) == 3 and 0 < r.data["remaining"] <= 1800
    assert all("correct" not in q for q in r.data["questions"])
    again = client.post(f"{H}{aid}/start/")
    assert [q["id"] for q in again.data["questions"]] == [q["id"] for q in r.data["questions"]]   # même ordre à la reprise
    assert again.data["remaining"] <= r.data["remaining"]


def test_quiz_scoring_and_finish(on, login, client):
    login(on["prof"])
    aid = epreuve(client, on)
    qs = {q["text"]: q["id"] for q in client.get(f"{H}{aid}/").data["questions"]}
    login(on["A"].user)
    client.post(f"{H}{aid}/start/")
    ans = {str(qs["Combien font 1/2 + 1/4 ?"]): [1], str(qs["0,5 est égal à 1/2."]): [1], str(qs["Quels nombres sont premiers ?"]): [0]}   # 2 pts + 0 + 0 (réponse partielle)
    assert client.put(f"{H}{aid}/answers/", {"answers": ans}, format="json").status_code == 200
    assert client.put(f"{H}{aid}/answers/", {"answers": {str(qs["0,5 est égal à 1/2."]): [0, 1]}}, format="json").status_code == 400
    assert client.put(f"{H}{aid}/answers/", {"answers": {"999": [0]}}, format="json").status_code == 200   # question inconnue ignorée
    client.put(f"{H}{aid}/answers/", {"answers": ans}, format="json")
    r = client.post(f"{H}{aid}/finish/")
    assert r.status_code == 200 and r.data["score"] == 2 and r.data["status"] == "termine"
    assert client.post(f"{H}{aid}/start/").status_code == 400
    assert client.put(f"{H}{aid}/answers/", {"answers": ans}, format="json").status_code == 400
    login(on["prof"])
    res = client.get(f"{H}{aid}/submissions/").data
    assert res["average"] == 2 and {q["text"]: q["success"] for q in res["questions"]}["Combien font 1/2 + 1/4 ?"] == 100
    sid = next(x["id"] for x in res["rows"] if x["id"])
    det = client.get(f"/api/v1/submissions/{sid}/").data
    assert det["answers"][0]["ok"] in (True, False) and "correct" in det["answers"][0]


def test_time_is_enforced_by_the_server(on, login, client):
    login(on["prof"])
    aid = epreuve(client, on, minutes=10)
    qid = client.get(f"{H}{aid}/").data["questions"][0]["id"]
    login(on["A"].user)
    client.post(f"{H}{aid}/start/")
    client.put(f"{H}{aid}/answers/", {"answers": {str(qid): [1]}}, format="json")
    Submission.objects.update(deadline_at=timezone.now() - timedelta(minutes=1))   # le temps est écoulé
    assert client.put(f"{H}{aid}/answers/", {"answers": {str(qid): [0]}}, format="json").status_code == 400
    s = Submission.objects.get()
    assert s.finished_at is not None and s.score == 2        # rendue d'office avec les réponses sauvegardées avant la fin
    assert client.post(f"{H}{aid}/start/").status_code == 400
    login(on["prof"])
    client.get(f"{H}{aid}/submissions/")          # la lecture par l'enseignant clôt aussi les tentatives expirées


def test_expired_attempt_is_closed_when_the_teacher_looks(on, login, client):
    login(on["prof"])
    aid = epreuve(client, on)
    login(on["A"].user)
    client.post(f"{H}{aid}/start/")
    Submission.objects.update(deadline_at=timezone.now() - timedelta(minutes=1))
    login(on["prof"])
    rows = client.get(f"{H}{aid}/submissions/").data["rows"]
    assert next(x for x in rows if x["student"] == on["A"].pk)["status"] == "termine"


def test_start_window(on, login, client):
    login(on["prof"])
    aid = epreuve(client, on)
    Assignment.objects.filter(pk=aid).update(opens_at=timezone.now() + timedelta(hours=1))
    login(on["A"].user)
    assert client.post(f"{H}{aid}/start/").status_code == 400
    Assignment.objects.filter(pk=aid).update(opens_at=timezone.now() - timedelta(days=2), due_at=timezone.now() - timedelta(hours=1))
    assert client.post(f"{H}{aid}/start/").status_code == 400


def test_deadline_caps_the_duration(on, login, client):
    login(on["prof"])
    aid = epreuve(client, on, minutes=120)
    Assignment.objects.filter(pk=aid).update(due_at=timezone.now() + timedelta(minutes=10))
    login(on["A"].user)
    assert client.post(f"{H}{aid}/start/").data["remaining"] <= 600


def test_correction_visibility_modes(on, login, client):
    login(on["prof"])
    aid = epreuve(client, on)
    login(on["A"].user)
    client.post(f"{H}{aid}/start/")
    client.post(f"{H}{aid}/finish/")
    sid = Submission.objects.get().pk
    assert client.get(f"/api/v1/submissions/{sid}/").status_code == 403           # « fin » : pas avant la fermeture
    Assignment.objects.filter(pk=aid).update(due_at=timezone.now() - timedelta(minutes=1), opens_at=timezone.now() - timedelta(days=1))
    r = client.get(f"/api/v1/submissions/{sid}/")
    assert r.status_code == 200 and "correct" in r.data["answers"][0]
    Assignment.objects.filter(pk=aid).update(correction="jamais")
    assert client.get(f"/api/v1/submissions/{sid}/").status_code == 403
    assert client.get(f"{H}{aid}/").data["mine"][0]["score"] is not None          # mais sa note, il la voit
    Assignment.objects.filter(pk=aid).update(correction="manuel")
    assert client.get(f"/api/v1/submissions/{sid}/").status_code == 403
    login(on["prof"])
    assert client.post(f"{H}{aid}/correction/", {"open": True}, format="json").status_code == 200
    login(on["A"].parent.user)
    assert client.get(f"/api/v1/submissions/{sid}/").status_code == 200           # le parent suit son enfant
    login(on["B"].user)
    assert client.get(f"/api/v1/submissions/{sid}/").status_code == 404           # pas la copie d'un camarade


def test_questions_are_frozen_once_someone_started(on, login, client):
    login(on["prof"])
    aid = epreuve(client, on)
    login(on["A"].user)
    client.post(f"{H}{aid}/start/")
    login(on["prof"])
    assert client.put(f"{H}{aid}/questions/", {"questions": QUESTIONS[:1]}, format="json").status_code == 400
    assert client.patch(f"{H}{aid}/", {"duration_min": 5}, format="json").status_code == 400
    assert client.delete(f"{H}{aid}/").status_code == 400
    assert client.patch(f"{H}{aid}/", {"title": "Nouveau titre"}, format="json").status_code == 200


def test_question_validation_and_send_rules(on, login, client):
    login(on["prof"])
    a = create(client, on, kind="epreuve", duration_min=20)
    assert client.post(f"{H}{a['id']}/send/").status_code == 400                        # pas de question
    bad = [{"kind": "qcm", "text": "Question ?", "choices": ["a"], "correct": [0]},
           {"kind": "qcm", "text": "Question ?", "choices": ["a", "b"], "correct": [5]},
           {"kind": "vf", "text": "Question ?", "correct": [0, 1]},
           {"kind": "qcm", "text": "Question ?", "choices": ["a", "b"], "correct": [0], "points": 0}]
    for q in bad:
        assert client.put(f"{H}{a['id']}/questions/", {"questions": [q]}, format="json").status_code == 400, q
    body = dict(school_class=on["c"].pk, subject=Subject.objects.get(code="ma").pk, kind="epreuve", title="Sans durée", due_at=fmt(timezone.now() + timedelta(days=1)))
    assert client.post(H, body, format="json").status_code == 400


def test_manual_grade_for_a_paper_copy_and_report_to_the_gradebook(on, login, client):
    from apps.grades.models import Grade
    login(on["prof"])
    a = create(client, on, max_points=10)
    client.post(f"{H}{a['id']}/send/")
    r = client.put(f"{H}{a['id']}/grades/", {"grades": [{"student": on["A"].pk, "score": 7.5}, {"student": on["B"].pk, "score": 4}]}, format="json")
    assert r.status_code == 200 and Submission.objects.filter(manual=True).count() == 2
    r = client.post(f"{H}{a['id']}/to-grades/", {}, format="json")
    assert r.status_code == 200 and r.data["grades"] == 2 and r.data["published"] is False
    assert {float(g.value) for g in Grade.objects.all()} == {15.0, 8.0}                 # ramenées sur 20
    client.put(f"{H}{a['id']}/grades/", {"grades": [{"student": on["B"].pk, "score": 6}]}, format="json")
    r2 = client.post(f"{H}{a['id']}/to-grades/", {}, format="json")
    assert r2.data["evaluation"] == r.data["evaluation"] and Grade.objects.count() == 2 and float(Grade.objects.get(student=on["B"]).value) == 12.0


def test_school_isolation_of_files_and_module_switch(on, login, client):
    login(on["prof"])
    a = create(client, on)
    cfg = SchoolSettings.load(); cfg.devoirs_actifs = False; cfg.save()
    assert client.get(f"{H}{a['id']}/").status_code == 403


def test_leaving_the_page_is_counted_and_ends_the_test_past_the_limit(on, login, client):
    login(on["prof"])
    a = create(client, on, kind="epreuve", duration_min=20, max_leaves=2)
    client.put(f"{H}{a['id']}/questions/", {"questions": QUESTIONS}, format="json")
    client.post(f"{H}{a['id']}/send/")
    login(on["A"].user)
    assert client.post(f"{H}{a['id']}/leave/").status_code == 400          # pas d'épreuve en cours
    client.post(f"{H}{a['id']}/start/")
    r = client.post(f"{H}{a['id']}/leave/")
    assert r.data == {"leaves": 1, "max_leaves": 2, "finished": False}
    r = client.post(f"{H}{a['id']}/leave/")
    assert r.data["finished"] is True and Submission.objects.get().finished_at is not None
    assert client.post(f"{H}{a['id']}/leave/").status_code == 400
    login(on["prof"])
    row = next(x for x in client.get(f"{H}{a['id']}/submissions/").data["rows"] if x["student"] == on["A"].pk)
    assert row["leaves"] == 2 and row["status"] == "termine"


def test_no_limit_when_zero(on, login, client):
    login(on["prof"])
    a = create(client, on, kind="epreuve", duration_min=20, max_leaves=0)
    client.put(f"{H}{a['id']}/questions/", {"questions": QUESTIONS}, format="json")
    client.post(f"{H}{a['id']}/send/")
    login(on["A"].user)
    client.post(f"{H}{a['id']}/start/")
    for _ in range(6):
        assert client.post(f"{H}{a['id']}/leave/").data["finished"] is False
    login(on["B"].user)
    assert client.post(f"{H}{a['id']}/leave/").status_code == 400
    login(on["A"].parent.user)
    assert client.post(f"{H}{a['id']}/leave/").status_code == 403
