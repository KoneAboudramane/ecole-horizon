from datetime import date, timedelta

import pytest

from apps.academics.models import SchoolClass, SchoolSettings, Subject, Term
from apps.attendance.models import Absence
from apps.discipline.models import ConductDeduction, EducatorClass
from apps.grades import calc
from apps.grades.models import Evaluation, Grade
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db


@pytest.fixture
def cw(school, users):
    """6e A avec deux élèves, des notes pour A, et la conduite dans la moyenne (réglage par défaut)."""
    cfg = SchoolSettings.load(); cfg.conduite_in_average = True; cfg.save()
    term = Term.objects.get(code="T1")
    ev = Evaluation.objects.create(school_class=school["c"], subject=Subject.objects.get(code="ma"), term=term, type="devoir", title="D", date=term.start, published=True)
    Grade.objects.create(evaluation=ev, student=school["A"], value=10)
    return {**school, "term": term, "ev": ev}


def day(w, n):
    return w["term"].start + timedelta(days=n)


def absent(w, st, d, slot="Matin", justif="aucune"):
    return Absence.objects.create(student=st, school_class=w["c"], date=d, slot=slot, status="A", justif=justif)


def test_conduct_defaults_to_max_and_counts_in_average(cw):
    r = calc.compute_class(cw["c"], cw["term"], only_published=False)["results"]
    a, b = r[cw["A"].pk], r[cw["B"].pk]
    assert a["conduite"]["note"] == 20 and a["conduite"]["in_average"]
    coef = next(s["coef"] for s in a["subjects"] if s["coef"] and s["moy"] is not None)
    assert a["moyenne"] == pytest.approx((10 * coef + 20) / (coef + 1))     # conduite : coefficient 1 par défaut
    assert b["moyenne"] is None                                              # sans aucune note, la conduite seule ne donne pas de moyenne


def test_removed_points_lower_the_note_and_the_average(cw):
    ConductDeduction.objects.create(student=cw["A"], term=cw["term"], points=2.5, reason="Bavardages", date=day(cw, 1))
    a = calc.compute_class(cw["c"], cw["term"], only_published=False)["results"][cw["A"].pk]
    assert a["conduite"]["note"] == 17.5
    cfg = SchoolSettings.load(); cfg.conduite_in_average = False; cfg.save()
    a2 = calc.compute_class(cw["c"], cw["term"], only_published=False)["results"][cw["A"].pk]
    assert a2["moyenne"] == 10 and a2["conduite"]["note"] == 17.5            # affichée sur le bulletin mais hors moyenne
    cfg.conduite_in_average, cfg.conduite_coef = True, 2
    cfg.save()
    a3 = calc.compute_class(cw["c"], cw["term"], only_published=False)["results"][cw["A"].pk]
    coef = next(s["coef"] for s in a3["subjects"] if s["moy"] is not None)
    assert a3["moyenne"] == pytest.approx((10 * coef + 17.5 * 2) / (coef + 2))


def test_family_sees_conduct_only_after_publication(cw, users, login, client):
    login(users["educateur"])
    assert client.post("/api/v1/conduct/deductions/", {"student": cw["A"].pk, "term": "T1", "points": "3", "reason": "Insolence"}, format="json").status_code == 201
    login(cw["A"].parent.user)
    b = client.get(f"/api/v1/students/{cw['A'].pk}/bulletin/?term=T1").data["result"]
    assert b["conduite"] is None
    assert client.post("/api/v1/conduct/publish/", {"term": "T1", "published": True}, format="json").status_code == 403
    login(users["directeur"])
    assert client.post("/api/v1/conduct/publish/", {"term": "T1", "published": True}, format="json").data["published"] is True
    assert Notification.objects.filter(user=cw["A"].parent.user, text__contains="conduite").exists()
    login(cw["A"].parent.user)
    assert client.get(f"/api/v1/students/{cw['A'].pk}/bulletin/?term=T1").data["result"]["conduite"]["note"] == 17


def test_absence_rule_applies_per_halfday_and_is_idempotent(cw, users, login, client):
    absent(cw, cw["A"], day(cw, 1), "Matin")
    absent(cw, cw["A"], day(cw, 1), "C2")                                   # un cours le même matin : pas une absence de plus
    absent(cw, cw["A"], day(cw, 2), "Après-midi")
    login(users["educateur"])
    row = client.get(f"/api/v1/conduct/?class={cw['c'].pk}&term=T1").data["students"]
    a = next(x for x in row if x["student"] == cw["A"].pk)
    assert a["halfdays"] == 2 and a["due"] == 0                              # matin du jour 1 (compté une fois) + après-midi du jour 2
    absent(cw, cw["A"], day(cw, 3), "Matin")
    a = next(x for x in client.get(f"/api/v1/conduct/?class={cw['c'].pk}&term=T1").data["students"] if x["student"] == cw["A"].pk)
    assert a["halfdays"] == 3 and a["due"] == 1
    for _ in range(2):
        assert client.post("/api/v1/conduct/absences/apply/", {"school_class": cw["c"].pk, "term": "T1"}, format="json").status_code == 200
    assert ConductDeduction.objects.filter(student=cw["A"], kind="absences").count() == 1
    assert calc.compute_class(cw["c"], cw["term"], only_published=False)["results"][cw["A"].pk]["conduite"]["note"] == 19
    Absence.objects.filter(student=cw["A"]).update(justif="acceptee")        # une fois justifiées, le retrait disparaît
    client.post("/api/v1/conduct/absences/apply/", {"school_class": cw["c"].pk, "term": "T1"}, format="json")
    assert not ConductDeduction.objects.filter(student=cw["A"], kind="absences").exists()


def test_incident_can_remove_points_and_pending_ones_do_not_count_yet(cw, users, login, client):
    login(users["educateur"])
    base = {"student": cw["A"].pk, "date": str(day(cw, 2)), "type": "bavardage", "gravite": "legere", "sanction": "avertissement", "description": "Bavarde en cours"}
    r = client.post("/api/v1/incidents/", {**base, "retrait": "1"}, format="json")
    assert r.status_code == 201 and r.data["points"] == 1
    g = client.post("/api/v1/incidents/", {**base, "type": "bagarre", "gravite": "grave", "sanction": "exclusion_temp", "retrait": "3"}, format="json")
    assert g.data["status"] == "a_valider"
    row = lambda: next(x for x in client.get(f"/api/v1/conduct/?class={cw['c'].pk}&term=T1").data["students"] if x["student"] == cw["A"].pk)  # noqa: E731
    assert row()["note"] == 19 and any(d["pending"] for d in row()["deductions"])
    login(users["directeur"])
    client.post(f"/api/v1/incidents/{g.data['id']}/decide/", {"accept": True}, format="json")
    login(users["educateur"])
    assert row()["note"] == 16


def test_educator_only_sees_and_manages_assigned_classes(cw, users, login, client):
    other = SchoolClass.objects.exclude(pk=cw["c"].pk).first()
    login(users["directeur"])
    r = client.put(f"/api/v1/educators/{users['educateur'].pk}/classes/", {"classes": [other.pk]}, format="json")
    assert r.status_code == 200 and r.data["classes"] == [other.pk]
    assert [e["classes"] for e in client.get("/api/v1/educators/").data if e["id"] == users["educateur"].pk] == [[other.pk]]
    absent(cw, cw["A"], day(cw, 1))
    login(users["educateur"])
    assert client.get("/api/v1/educators/mine/").data["classes"] == [other.pk]
    assert client.get(f"/api/v1/conduct/?class={cw['c'].pk}&term=T1").status_code == 403
    assert client.post("/api/v1/conduct/deductions/", {"student": cw["A"].pk, "term": "T1", "points": "1", "reason": "Test"}, format="json").status_code == 403
    assert client.get("/api/v1/absences/").data["results"] == [] if "results" in client.get("/api/v1/absences/").data else client.get("/api/v1/absences/").data == []
    assert client.post("/api/v1/incidents/", {"student": cw["A"].pk, "date": str(day(cw, 1)), "type": "tenue", "gravite": "legere", "sanction": "observation", "description": "Tenue"}, format="json").status_code == 403
    assert client.get("/api/v1/educators/").status_code == 403                # l'attribution reste à la direction et au secrétariat
    login(users["admin"])
    assert client.put(f"/api/v1/educators/{users['educateur'].pk}/classes/", {"classes": []}, format="json").status_code == 200
    login(users["educateur"])
    assert client.get("/api/v1/educators/mine/").data["classes"] is None     # sans attribution : vue de toute l'école
    assert client.get(f"/api/v1/conduct/?class={cw['c'].pk}&term=T1").status_code == 200
    assert not EducatorClass.objects.filter(educateur=users["educateur"]).exists()


def test_justificatif_goes_to_the_class_educator_and_scope_applies(cw, users, login, client, make_user):
    edu2 = make_user("educateur", "edu2")
    EducatorClass.objects.create(educateur=edu2, school_class=cw["c"])
    EducatorClass.objects.create(educateur=users["educateur"], school_class=SchoolClass.objects.exclude(pk=cw["c"].pk).first())
    ab = absent(cw, cw["A"], date.today() - timedelta(days=1))
    login(cw["A"].parent.user)
    assert client.post(f"/api/v1/absences/{ab.pk}/justify/", {"motif": "Palu"}, format="json").status_code == 200
    assert Notification.objects.filter(user=edu2, text__contains="Justificatif").exists()
    assert not Notification.objects.filter(user=users["educateur"], text__contains="Justificatif").exists()
    login(users["educateur"])
    assert client.post(f"/api/v1/absences/{ab.pk}/decide/", {"accept": True}, format="json").status_code == 404   # hors de ses classes
    login(edu2)
    assert client.post(f"/api/v1/absences/{ab.pk}/decide/", {"accept": True}, format="json").status_code == 200


def test_locked_term_and_validation(cw, users, login, client):
    login(users["educateur"])
    bad = {"student": cw["A"].pk, "term": "T1", "reason": "Test"}
    assert client.post("/api/v1/conduct/deductions/", {**bad, "points": "0"}, format="json").status_code == 400
    assert client.post("/api/v1/conduct/deductions/", {**bad, "points": "21"}, format="json").status_code == 400
    ok = client.post("/api/v1/conduct/deductions/", {**bad, "points": "1"}, format="json")
    cw["term"].locked = True; cw["term"].save()
    assert client.delete(f"/api/v1/conduct/deductions/{ok.data['id']}/").status_code == 403
    login(users["directeur"])
    assert client.delete(f"/api/v1/conduct/deductions/{ok.data['id']}/").status_code == 204


def test_conduct_settings_and_roles(cw, users, login, client):
    for r in ("enseignant", "comptable", "parent", "eleve"):
        login(users[r] if r not in ("parent", "eleve") else cw["A"].parent.user if r == "parent" else cw["A"].user)
        assert client.get(f"/api/v1/conduct/?class={cw['c'].pk}&term=T1").status_code == 403, r
    login(users["directeur"])
    assert client.patch("/api/v1/settings/", {"conduite_max": "0"}, format="json").status_code == 400
    assert client.patch("/api/v1/settings/", {"conduite_baremes": {"inconnue": 1}}, format="json").status_code == 400
    r = client.patch("/api/v1/settings/", {"conduite_max": "10", "absence_tranche": 2, "conduite_baremes": {"retenue": 2}}, format="json")
    assert r.status_code == 200 and float(r.data["conduite_max"]) == 10


def test_justification_deadline_set_by_the_school(cw, users, login, client):
    cfg = SchoolSettings.load(); cfg.justif_delai = 3; cfg.save()
    old = absent(cw, cw["A"], date.today() - timedelta(days=4))
    recent = absent(cw, cw["A"], date.today() - timedelta(days=3), slot="Après-midi")
    login(cw["A"].parent.user)
    r = client.post(f"/api/v1/absences/{old.pk}/justify/", {"motif": "Palu"}, format="json")
    assert r.status_code == 400 and "délai" in str(r.data)
    assert client.post(f"/api/v1/absences/{recent.pk}/justify/", {"motif": "Palu"}, format="json").status_code == 200   # dernier jour du délai
    cfg.justif_delai = 0; cfg.save()                                                                                       # 0 : sans délai
    assert client.post(f"/api/v1/absences/{old.pk}/justify/", {"motif": "Palu"}, format="json").status_code == 200


def test_school_records_a_paper_justification_even_late(cw, users, login, client):
    from apps.core.models import ActivityLog
    cfg = SchoolSettings.load(); cfg.justif_delai = 2; cfg.save()
    ab = absent(cw, cw["A"], date.today() - timedelta(days=10))
    login(cw["A"].parent.user)
    assert client.post(f"/api/v1/absences/{ab.pk}/record/", {"motif": "Certificat"}, format="json").status_code == 403
    login(users["educateur"])
    r = client.post(f"/api/v1/absences/{ab.pk}/record/", {"motif": "Certificat médical apporté au bureau"}, format="json")
    assert r.status_code == 200 and r.data["justif"] == "acceptee"
    assert Notification.objects.filter(user=cw["A"].parent.user, text__contains="justifiée par l’école").exists()
    assert ActivityLog.objects.filter(detail__contains="hors délai").exists()
    assert client.post(f"/api/v1/absences/{ab.pk}/record/", {"motif": "Encore"}, format="json").status_code == 400


def test_locked_term_only_direction_handles_justifications(cw, users, login, client):
    ab = absent(cw, cw["A"], day(cw, 1))
    Term.objects.filter(pk=cw["term"].pk).update(locked=True)
    login(cw["A"].parent.user)
    assert client.post(f"/api/v1/absences/{ab.pk}/justify/", {"motif": "Palu"}, format="json").status_code == 400
    login(users["educateur"])
    assert client.post(f"/api/v1/absences/{ab.pk}/record/", {"motif": "Certificat"}, format="json").status_code == 403
    login(users["directeur"])
    assert client.post(f"/api/v1/absences/{ab.pk}/record/", {"motif": "Certificat"}, format="json").status_code == 200


def test_decision_on_a_justification_updates_the_applied_conduct(cw, users, login, client):
    cfg = SchoolSettings.load(); cfg.absence_tranche = 2; cfg.absence_points = 1; cfg.save()
    a1, a2 = absent(cw, cw["A"], day(cw, 1)), absent(cw, cw["A"], day(cw, 2))
    a3 = absent(cw, cw["A"], day(cw, 3))
    login(users["educateur"])
    client.post("/api/v1/conduct/absences/apply/", {"school_class": cw["c"].pk, "term": "T1"}, format="json")
    ded = lambda: ConductDeduction.objects.filter(student=cw["A"], kind="absences").first()  # noqa: E731
    assert ded().points == 1                                                    # 3 demi-journées → −1
    client.post(f"/api/v1/absences/{a1.pk}/record/", {"motif": "Certificat"}, format="json")
    assert ded().points == 1 and ded().reason.startswith("2 ")                  # 2 demi-journées → toujours −1
    client.post(f"/api/v1/absences/{a2.pk}/record/", {"motif": "Certificat"}, format="json")
    assert ded() is None                                                        # 1 demi-journée → plus de retrait
    Absence.objects.filter(pk=a3.pk).update(justif="en_attente")
    absent(cw, cw["A"], day(cw, 4))
    client.post(f"/api/v1/absences/{a3.pk}/decide/", {"accept": False}, format="json")
    assert ded() is None                                                        # rien de créé : la règle s'applique depuis la page Conduite
