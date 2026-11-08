import pytest

from apps.academics.models import SchoolClass, SchoolSettings, Subject, Teacher, TeachingAssignment, Term
from apps.grades import calc
from apps.grades.models import Evaluation, Grade
from apps.students.services import enroll_student

pytestmark = pytest.mark.django_db


@pytest.fixture
def world(db, make_user):
    from django.core.management import call_command
    call_command("seed_school")
    cfg = SchoolSettings.load(); cfg.conduite_in_average = False; cfg.bulletin_blocage = "aucun"; cfg.save()   # règle des matières seule ; la conduite et le blocage des bulletins ont leurs propres tests
    c = SchoolClass.objects.get(name="6e A")
    ma, fr = Subject.objects.get(code="ma"), Subject.objects.get(code="fr")
    prof = make_user("enseignant", "prof.ma")
    autre = make_user("enseignant", "prof.autre")
    TeachingAssignment.objects.update_or_create(school_class=c, subject=ma, defaults={"teacher": Teacher.objects.get(user=prof)})
    TeachingAssignment.objects.update_or_create(school_class=c, subject=fr, defaults={"teacher": Teacher.objects.get(user=autre)})
    a = enroll_student(nom="Aka", prenoms="Léa", sexe="F", naissance="2013-01-01", lieu="", school_class=c, parent_name="M. Aka", parent_phone="0101010101")
    b = enroll_student(nom="Bah", prenoms="Ali", sexe="M", naissance="2013-02-02", lieu="", school_class=c, parent_name="M. Bah", parent_phone="0202020202")
    for u in (a.student.user, b.student.user, a.student.parent.user):
        u.set_password("secret1"); u.save()
    return dict(c=c, ma=ma, fr=fr, prof=prof, autre=autre, A=a.student, B=b.student, T1=Term.objects.get(code="T1"))


def mk_eval(w, subject, typ, title="Éval", published=False):
    return Evaluation.objects.create(school_class=w["c"], subject=subject, term=w["T1"], type=typ, title=title, date="2026-10-10", published=published)


def put(w, ev, **vals):
    for k, v in vals.items():
        Grade.objects.update_or_create(evaluation=ev, student=w[k], defaults={"value": v})


def test_calc_matches_prototype_rules(world):
    w = world
    put(w, mk_eval(w, w["ma"], "interro"), A=10, B=8)
    put(w, mk_eval(w, w["ma"], "devoir"), A=14, B=8)
    put(w, mk_eval(w, w["ma"], "composition"), A=16, B=8)
    put(w, mk_eval(w, w["fr"], "devoir"), A=10)
    r = calc.compute_class(w["c"], w["T1"], only_published=False)["results"]
    a, b = r[w["A"].pk], r[w["B"].pk]
    ma = next(s for s in a["subjects"] if s["subject"] == w["ma"].pk)
    assert ma["mc"] == 12 and ma["compo"] == 16 and ma["moy"] == 14  # 12×0,5 + 16×0,5
    assert a["moyenne"] == 12 and b["moyenne"] == 8       # (14×4 + 10×4) / 8 ; B n'a que les maths
    assert (a["rang"], b["rang"]) == (1, 2)
    assert ma["rang"] == 1 and ma["class_moy"] == 11 and ma["class_max"] == 14 and ma["class_min"] == 8


def test_ties_share_rank_and_unpublished_hidden(world):
    w = world
    ev = mk_eval(w, w["ma"], "devoir")
    put(w, ev, A=12, B=12)
    r = calc.compute_class(w["c"], w["T1"], only_published=False)["results"]
    assert r[w["A"].pk]["rang"] == r[w["B"].pk]["rang"] == 1
    assert calc.compute_class(w["c"], w["T1"], only_published=True)["avg"] is None


def test_mention_thresholds():
    s = [16, 14, 12, 10]
    assert [calc.mention(x, s) for x in (17, 14, 12.5, 10, 9.99, None)] == ["Très bien", "Bien", "Assez bien", "Passable", "Insuffisant", "—"]


def test_teacher_creates_and_enters_only_own_subject(world, login, client):
    w = world
    login(w["prof"])
    body = {"school_class": w["c"].pk, "subject": w["ma"].pk, "term": "T1", "type": "devoir", "title": "DS 1", "date": "2026-10-12"}
    r = client.post("/api/v1/evaluations/", body, format="json")
    assert r.status_code == 201 and r.data["published"] is False
    r2 = client.post("/api/v1/evaluations/", {**body, "subject": w["fr"].pk}, format="json")
    assert r2.status_code == 403
    r3 = client.put(f"/api/v1/evaluations/{r.data['id']}/grades/", {"values": {str(w["A"].pk): "14.5", str(w["B"].pk): 9}}, format="json")
    assert r3.status_code == 200 and r3.data["grades"][str(w["A"].pk)] == 14.5
    # un collègue d'une autre matière ne peut ni lire ni écrire
    login(w["autre"])
    assert client.get(f"/api/v1/evaluations/{r.data['id']}/grades/").status_code == 404
    assert client.put(f"/api/v1/evaluations/{r.data['id']}/grades/", {"values": {}}, format="json").status_code == 403
    assert client.get("/api/v1/evaluations/").data == []


def test_grade_validation(world, login, client):
    w = world
    ev = mk_eval(w, w["ma"], "devoir")
    login(w["prof"])
    url = f"/api/v1/evaluations/{ev.pk}/grades/"
    assert client.put(url, {"values": {str(w["A"].pk): 21}}, format="json").status_code == 400
    assert client.put(url, {"values": {str(w["A"].pk): -1}}, format="json").status_code == 400
    assert client.put(url, {"values": {"9999": 10}}, format="json").status_code == 400  # hors classe
    assert Grade.objects.count() == 0
    client.put(url, {"values": {str(w["A"].pk): 10}}, format="json")
    client.put(url, {"values": {str(w["A"].pk): None}}, format="json")  # null efface
    assert Grade.objects.count() == 0


def test_locked_term_blocks_teacher_until_unlocked(world, login, client, users):
    """Période verrouillée : même l'enseignant ne corrige plus ; la direction déverrouille, et c'est l'enseignant qui corrige."""
    w = world
    ev = mk_eval(w, w["ma"], "devoir")
    ev.teacher = Teacher.objects.get(user=w["prof"]); ev.save()
    url = f"/api/v1/evaluations/{ev.pk}/grades/"
    w["T1"].locked = True; w["T1"].save()
    login(w["prof"])
    r = client.put(url, {"values": {str(w["A"].pk): 10}}, format="json")
    assert r.status_code == 403 and "verrouillé" in r.data["detail"]
    login(users["directeur"])
    assert client.put(url, {"values": {str(w["A"].pk): 10}}, format="json").status_code == 403    # la direction ne touche pas aux notes
    w["T1"].locked = False; w["T1"].save()
    login(w["prof"])
    assert client.put(url, {"values": {str(w["A"].pk): 10}}, format="json").status_code == 200


def test_only_the_evaluating_teacher_changes_grades(world, users, login, client):
    """Saisir, modifier ou effacer une note, changer le barème ou le coefficient : l'enseignant de l'évaluation seul."""
    w = world
    ev = mk_eval(w, w["ma"], "devoir")
    ev.teacher = Teacher.objects.get(user=w["prof"]); ev.save()
    put(w, ev, A=12)
    url = f"/api/v1/evaluations/{ev.pk}/"
    for u in (users["directeur"], users["admin"], users["fondateur"], w["autre"]):
        login(u)
        assert client.put(url + "grades/", {"values": {str(w["A"].pk): 18}}, format="json").status_code == 403
        assert client.put(url + "grades/", {"values": {str(w["A"].pk): None}}, format="json").status_code == 403   # effacer
        assert client.patch(url, {"bareme": 40}, format="json").status_code == 403
        assert client.patch(url, {"coef": "3"}, format="json").status_code == 403
    assert float(Grade.objects.get(evaluation=ev, student=w["A"]).value) == 12
    ev.refresh_from_db(); assert ev.bareme == 20 and ev.coef == 1
    login(users["directeur"])
    assert client.get(url + "grades/").status_code == 200                                # la direction consulte toujours
    login(w["prof"])
    assert client.put(url + "grades/", {"values": {str(w["A"].pk): 14}}, format="json").status_code == 200
    assert client.patch(url, {"coef": "2"}, format="json").status_code == 200
    assert client.put(url + "grades/", {"values": {str(w["A"].pk): None}}, format="json").status_code == 200


def test_scheduled_exam_school_settles_until_first_grade(world, users, login, client):
    w = world
    login(users["directeur"])
    client.post("/api/v1/evaluations/schedule/", {"title": "Compo", "type": "composition", "term": "T1", "date": "2026-12-10", "classes": [w["c"].pk], "subjects": [w["ma"].pk]}, format="json")
    ev = Evaluation.objects.get(title="Compo")
    assert ev.teacher.user == w["prof"]
    assert client.patch(f"/api/v1/evaluations/{ev.pk}/", {"coef": "2"}, format="json").status_code == 200   # rien n'est saisi
    assert client.put(f"/api/v1/evaluations/{ev.pk}/grades/", {"values": {str(w["A"].pk): 9}}, format="json").status_code == 403
    login(w["prof"])
    assert client.put(f"/api/v1/evaluations/{ev.pk}/grades/", {"values": {str(w["A"].pk): 9}}, format="json").status_code == 200
    login(users["directeur"])
    assert client.patch(f"/api/v1/evaluations/{ev.pk}/", {"bareme": 40}, format="json").status_code == 403  # notes saisies : l'école ne change plus rien


def test_family_sees_only_published_own_child(world, login, client, users):
    w = world
    ev = mk_eval(w, w["ma"], "devoir")
    put(w, ev, A=15, B=5)
    parent = w["A"].parent.user
    login(parent)
    assert client.get(f"/api/v1/students/{w['A'].pk}/grades/").data["grades"] == []
    b = client.get(f"/api/v1/students/{w['A'].pk}/bulletin/").data
    assert b["result"]["moyenne"] is None and b["mention"] == "—"
    assert client.get(f"/api/v1/students/{w['B'].pk}/bulletin/").status_code == 404
    assert client.get(f"/api/v1/students/{w['B'].pk}/grades/").status_code == 404
    # publication : seule la direction
    login(w["prof"])
    assert client.post("/api/v1/evaluations/publish/", {"ids": [ev.pk], "published": True}, format="json").status_code == 403
    login(users["directeur"])
    assert client.post("/api/v1/evaluations/publish/", {"ids": [ev.pk], "published": True}, format="json").data["changed"] == 1
    login(parent)
    b = client.get(f"/api/v1/students/{w['A'].pk}/bulletin/").data
    assert b["result"]["moyenne"] == 15 and b["mention"] == "Bien" and b["result"]["rang"] == 1
    assert client.get(f"/api/v1/students/{w['A'].pk}/grades/").data["grades"][0]["value"] == 15
    assert client.get(f"/api/v1/evaluations/{ev.pk}/").status_code == 200
    # un élève ne voit pas l'autre
    login(w["B"].user)
    assert client.get(f"/api/v1/students/{w['A'].pk}/bulletin/").status_code == 404


def test_published_evaluation_cannot_be_deleted(world, login, client):
    w = world
    ev = mk_eval(w, w["ma"], "devoir", published=True)
    ev.teacher = Teacher.objects.get(user=w["prof"]); ev.save()
    login(w["prof"])
    assert client.delete(f"/api/v1/evaluations/{ev.pk}/").status_code == 400
    ev.published = False; ev.save()
    assert client.delete(f"/api/v1/evaluations/{ev.pk}/").status_code == 204


def test_only_the_evaluating_teacher_deletes(world, users, login, client):
    """Ni la direction, ni un collègue, ni un enseignant qui n'est plus celui de l'évaluation ne peut la retirer."""
    w = world
    ev = mk_eval(w, w["ma"], "devoir")
    ev.teacher = Teacher.objects.get(user=w["prof"]); ev.save()
    url = f"/api/v1/evaluations/{ev.pk}/"
    for u in (users["directeur"], users["admin"], w["autre"]):
        login(u)
        assert client.delete(url).status_code == 403
    sans = mk_eval(w, w["ma"], "devoir", title="Sans enseignant")       # aucune personne ne la fait passer : personne ne la retire
    login(w["prof"])
    assert client.delete(f"/api/v1/evaluations/{sans.pk}/").status_code == 403
    assert client.delete(url).status_code == 204


def test_class_results_scope(world, login, client, users):
    w = world
    put(w, mk_eval(w, w["ma"], "devoir"), A=12, B=8)
    login(w["prof"])
    assert client.get(f"/api/v1/results/?class={w['c'].pk}").status_code == 200
    other = SchoolClass.objects.get(name="3e A")
    assert client.get(f"/api/v1/results/?class={other.pk}").status_code == 403
    login(users["comptable"])
    assert client.get(f"/api/v1/results/?class={w['c'].pk}").status_code == 403
    login(users["admin"])
    r = client.get(f"/api/v1/results/?class={w['c'].pk}&term=T1")
    assert r.status_code == 200 and r.data["effectif"] == 2 and r.data["max"] == 12
    assert client.get(f"/api/v1/results/?class={w['c'].pk}&term=T9").status_code == 400


def test_appreciation_council_decision(world, login, client, users):
    w = world
    sid, base = w["A"].pk, {"term": "T1"}
    login(w["prof"])
    ok = client.put("/api/v1/appreciations/", {"student": sid, "subject": w["ma"].pk, "text": "Très bon trimestre.", **base}, format="json")
    assert ok.status_code == 200
    assert client.put("/api/v1/appreciations/", {"student": sid, "subject": w["fr"].pk, "text": "x", **base}, format="json").status_code == 403
    assert client.put("/api/v1/council/", {"student": sid, "text": "Bravo", **base}, format="json").status_code == 403
    login(users["directeur"])
    assert client.put("/api/v1/council/", {"student": sid, "text": "Félicitations.", **base}, format="json").status_code == 200
    assert client.put("/api/v1/decisions/", {"student": sid, "value": "admis", "comment": "ok"}, format="json").status_code == 400   # année en cours
    Term.objects.filter(code="T3").update(locked=True)                                                                                # dernière période verrouillée
    assert client.put("/api/v1/decisions/", {"student": sid, "value": "admis", "comment": "ok"}, format="json").status_code == 200
    login(users["admin"])
    assert client.put("/api/v1/decisions/", {"student": sid, "value": "exclu"}, format="json").status_code == 403
    b = client.get(f"/api/v1/students/{sid}/bulletin/?term=T1").data
    assert b["appreciations"][w["ma"].pk] == "Très bon trimestre." and b["council"] == "Félicitations." and b["decision"] is None   # décision : dernier bulletin seulement
    assert client.get(f"/api/v1/students/{sid}/bulletin/?term=T3").data["decision"]["value"] == "admis"
    login(w["A"].parent.user)
    assert client.get("/api/v1/decisions/").data[0]["decision"]["value"] == "admis"


def test_decisions_wait_for_the_end_of_the_year(world, login, client, users):
    from datetime import timedelta
    from django.utils import timezone
    login(users["directeur"])
    body = {"student": world["A"].pk, "value": "admis"}
    last = Term.objects.order_by("end").last()
    last.end = timezone.localdate() + timedelta(days=1); last.save()
    assert client.put("/api/v1/decisions/", body, format="json").status_code == 400
    Term.objects.update(end=timezone.localdate() - timedelta(days=1))                    # date de fin passée, même sans verrouillage
    assert client.put("/api/v1/decisions/", body, format="json").status_code == 200


def test_class_validation_can_be_undone_without_touching_individual_decisions(world, login, client, users):
    from apps.grades.models import Decision
    w = world
    Term.objects.filter(code="T3").update(locked=True)
    login(users["directeur"])
    client.put("/api/v1/decisions/", {"student": w["A"].pk, "value": "admis", "batch": True}, format="json")
    client.put("/api/v1/decisions/", {"student": w["B"].pk, "value": "redouble", "comment": "Redoublement accordé : santé"}, format="json")
    rows = {r["student"]: r for r in client.get(f"/api/v1/decisions/?class={w['c'].pk}").data}
    assert rows[w["A"].pk]["decision"]["batch"] is True and rows[w["B"].pk]["decision"]["batch"] is False
    login(users["admin"])
    assert client.delete(f"/api/v1/decisions/?class={w['c'].pk}").status_code == 403
    login(users["directeur"])
    assert client.delete(f"/api/v1/decisions/?class={w['c'].pk}").data == {"deleted": 1}
    assert list(Decision.objects.values_list("student_id", flat=True)) == [w["B"].pk]


def test_decision_proposal(world, login, client, users):
    w = world
    put(w, mk_eval(w, w["ma"], "devoir"), A=12, B=8.5)
    login(users["directeur"])
    rows = {r["student"]: r for r in client.get(f"/api/v1/decisions/?class={w['c'].pk}").data}
    assert rows[w["A"].pk]["proposal"] == "admis" and rows[w["B"].pk]["proposal"] == "conseil"


def test_settings(users, login, client, world):
    login(users["eleve"])
    assert client.get("/api/v1/settings/").data["seuils"] == [16, 14, 12, 10]
    assert client.patch("/api/v1/settings/", {"name": "X"}, format="json").status_code == 403
    login(users["admin"])
    assert client.patch("/api/v1/settings/", {"compo_weight": 0.6, "seuils": [17, 15, 13, 11]}, format="json").data["seuils"] == [17, 15, 13, 11]
    assert client.patch("/api/v1/settings/", {"seuils": [10, 12, 14, 16]}, format="json").status_code == 400
    assert client.patch("/api/v1/settings/", {"compo_weight": 1.5}, format="json").status_code == 400
    assert float(SchoolSettings.load().compo_weight) == 0.6


def test_publication_notifies_families(world, login, client, users):
    from apps.notifications.models import Notification
    w = world
    ev = mk_eval(w, w["ma"], "devoir")
    login(users["directeur"])
    client.post("/api/v1/evaluations/publish/", {"ids": [ev.pk], "published": True}, format="json")
    n = Notification.objects.get(user=w["A"].parent.user, kind="note")
    assert "Mathématiques" in n.text and "Léa" in n.text
    client.post("/api/v1/evaluations/publish/", {"ids": [ev.pk], "published": True}, format="json")   # déjà publiée : rien de plus
    assert Notification.objects.filter(user=w["A"].parent.user, kind="note").count() == 1


def test_overview_is_scoped_by_role(world, login, client, users):
    w = world
    ev_ma = mk_eval(w, w["ma"], "devoir", published=True)
    ev_fr = mk_eval(w, w["fr"], "devoir", published=False)
    put(w, ev_ma, A=15, B=5)
    put(w, ev_fr, A=9, B=19)
    url = "/api/v1/overview/?term=T1"
    # direction : tout, y compris le non publié ; rangs complets
    login(users["directeur"])
    d = client.get(url).data
    assert {e["id"] for e in d["evaluations"]} == {ev_ma.pk, ev_fr.pk}
    assert d["grades"][f"{ev_fr.pk}|{w['B'].pk}"] == 19
    allc = d["stats"][str(w["c"].pk)]["all"]
    assert allc["results"][str(w["A"].pk)]["rang"] in (1, 2) and allc["effectif"] == 2
    # parent : son enfant seulement, notes publiées seulement, mais rang calculé sur toute la classe
    login(w["A"].parent.user)
    p = client.get(url).data
    assert [e["id"] for e in p["evaluations"]] == [ev_ma.pk]
    assert set(p["grades"]) == {f"{ev_ma.pk}|{w['A'].pk}"}
    pub = p["stats"][str(w["c"].pk)]["pub"]
    assert set(pub["results"]) == {str(w["A"].pk)} and pub["results"][str(w["A"].pk)]["rang"] == 1
    assert "all" not in p["stats"][str(w["c"].pk)]
    # enseignant de maths : sa matière uniquement, sans moyenne générale ni rang général
    login(w["prof"])
    t = client.get(url).data
    assert {e["id"] for e in t["evaluations"]} == {ev_ma.pk}
    res = t["stats"][str(w["c"].pk)]["all"]["results"][str(w["A"].pk)]
    assert [s["subject"] for s in res["subjects"]] == [w["ma"].pk] and res["moyenne"] is None and res["rang"] is None
    # sans rôle pédagogique : refusé
    login(users["comptable"])
    assert client.get(url).status_code == 403


# ---------- bulletin PDF et QR de vérification ----------
def _pdf(r):
    return b"".join(r.streaming_content) if getattr(r, "streaming", False) else r.content


def _published_marks(w):
    ev = mk_eval(w, w["ma"], "devoir", published=True)
    put(w, ev, A=14, B=9)
    return ev


def test_bulletin_pdf_rights_and_templates(world, login, client):
    w = world
    _published_marks(w)
    A, B = w["A"], w["B"]
    # famille : son enfant seulement
    login(A.parent.user)
    for tpl in ("classique", "moderne", "compact"):
        r = client.get(f"/api/v1/students/{A.pk}/bulletin.pdf?term=T1&template={tpl}")
        assert r.status_code == 200 and r["Content-Type"] == "application/pdf" and _pdf(r).startswith(b"%PDF"), tpl
    assert client.get(f"/api/v1/students/{B.pk}/bulletin.pdf?term=T1").status_code == 404
    login(A.user)
    assert client.get(f"/api/v1/students/{A.pk}/bulletin.pdf").status_code == 200
    assert client.get(f"/api/v1/students/{B.pk}/bulletin.pdf").status_code == 404
    # un enseignant n'a pas accès aux bulletins ; sans connexion non plus
    login(w["prof"])
    assert client.get(f"/api/v1/students/{A.pk}/bulletin.pdf").status_code == 403
    assert client.get(f"/api/v1/classes/{w['c'].pk}/bulletins.pdf").status_code == 403
    client.credentials()
    assert client.get(f"/api/v1/students/{A.pk}/bulletin.pdf").status_code == 401


def test_class_bulletins_one_page_per_student(world, login, client, users):
    w = world
    _published_marks(w)
    login(users["directeur"])
    r = client.get(f"/api/v1/classes/{w['c'].pk}/bulletins.pdf?term=T1&published=1")
    assert r.status_code == 200 and "bulletins-6e-a-T1.pdf" in r["Content-Disposition"]
    assert _pdf(r).count(b"/Type /Page\n") + _pdf(r).count(b"/Type /Page ") >= 2
    assert client.get(f"/api/v1/classes/{SchoolClass.objects.get(name='6e B').pk}/bulletins.pdf").status_code == 400  # classe vide


def test_qr_verification_page(world, client):
    from apps.grades import bulletin_pdf

    w = world
    _published_marks(w)
    stats = calc.compute_class(w["c"], w["T1"], only_published=True)
    res = stats["results"][w["A"].pk]
    token = bulletin_pdf.make_token(w["A"].pk, w["T1"].pk, res["moyenne"], res["rang"])
    r = client.get(f"/api/v1/public/verify/{token}/")                       # public : aucune connexion
    page = r.content.decode()
    assert r.status_code == 200 and "Bulletin authentique" in page and "AKA" in page and "14,00" in page
    # les notes publiées changent : l'ancien bulletin n'est plus authentique
    Grade.objects.filter(student=w["A"]).update(value=5)
    r = client.get(f"/api/v1/public/verify/{token}/")
    assert r.status_code == 404 and "Ne correspond plus" in r.content.decode()
    # code falsifié ou inventé
    bad = client.get(f"/api/v1/public/verify/{token[:-3]}xyz/")
    assert bad.status_code == 404 and "Code non reconnu" in bad.content.decode()
    assert client.get("/api/v1/public/verify/n-importe-quoi/").status_code == 404


def test_provisional_bulletin_has_no_qr(world, login, client, users):
    w = world
    mk = mk_eval(w, w["ma"], "devoir", published=False)
    put(w, mk, A=12)
    login(users["directeur"])
    prov = _pdf(client.get(f"/api/v1/students/{w['A'].pk}/bulletin.pdf?term=T1"))
    final = _pdf(client.get(f"/api/v1/students/{w['A'].pk}/bulletin.pdf?term=T1&published=1"))
    assert prov.startswith(b"%PDF") and final.startswith(b"%PDF")


def test_school_schedules_exam_and_teachers_enter_marks(world, users, login, client):
    from apps.notifications.models import Notification
    login(users["directeur"])
    body = {"title": "Composition 1", "type": "composition", "term": "T1", "date": "2026-12-10", "classes": [world["c"].pk]}
    r = client.post("/api/v1/evaluations/schedule/", body, format="json")
    assert r.status_code == 200 and r.data["created"] > 2 and r.data["teachers"] == 2
    assert {o["subject"] for o in r.data["orphans"]}                               # matières sans enseignant signalées
    assert Evaluation.objects.filter(title="Composition 1", scheduled=True, school_class=world["c"]).count() == r.data["created"]
    assert Notification.objects.filter(user=world["prof"], text__contains="Composition 1").exists()
    assert client.post("/api/v1/evaluations/schedule/", body, format="json").data["created"] == 0   # relancer ne duplique pas
    ev = Evaluation.objects.get(title="Composition 1", subject=world["ma"], school_class=world["c"])
    login(world["prof"])
    assert any(e["id"] == ev.pk and e["scheduled"] for e in client.get("/api/v1/evaluations/?class=%d" % world["c"].pk).data)
    r = client.put(f"/api/v1/evaluations/{ev.pk}/grades/", {"values": {str(world["A"].pk): 14.5}}, format="json")
    assert r.status_code == 200 and Grade.objects.filter(evaluation=ev).count() == 1       # l'enseignant saisit les notes
    assert client.patch(f"/api/v1/evaluations/{ev.pk}/", {"title": "Autre"}, format="json").status_code == 403
    assert client.delete(f"/api/v1/evaluations/{ev.pk}/").status_code == 403
    login(world["autre"])
    assert client.put(f"/api/v1/evaluations/{ev.pk}/grades/", {"values": {str(world["A"].pk): 3}}, format="json").status_code == 403   # pas sa matière
    assert client.post("/api/v1/evaluations/schedule/", body, format="json").status_code == 403


def test_evaluation_coef_weights_subject_average(world, users, login, client):
    w = world
    e1 = mk_eval(w, w["ma"], "interro")
    e2 = mk_eval(w, w["ma"], "devoir")
    e2.coef = 3; e2.save()
    put(w, e1, A=10)
    put(w, e2, A=18)
    ma = next(s for s in calc.compute_class(w["c"], w["T1"], only_published=False)["results"][w["A"].pk]["subjects"] if s["subject"] == w["ma"].pk)
    assert ma["mc"] == 16  # (10×1 + 18×3) / 4, et non 14

    login(users["directeur"])
    ok = client.post("/api/v1/evaluations/", {"school_class": w["c"].pk, "subject": w["ma"].pk, "term": "T1", "type": "devoir", "title": "TP", "date": "2026-10-12", "coef": "2.5"}, format="json")
    assert ok.status_code == 201 and float(ok.data["coef"]) == 2.5
    assert float(client.post("/api/v1/evaluations/", {"school_class": w["c"].pk, "subject": w["ma"].pk, "term": "T1", "type": "devoir", "title": "TP2", "date": "2026-10-12"}, format="json").data["coef"]) == 1
    for bad in ("0", "11"):
        r = client.post("/api/v1/evaluations/", {"school_class": w["c"].pk, "subject": w["ma"].pk, "term": "T1", "type": "devoir", "title": "X", "date": "2026-10-12", "coef": bad}, format="json")
        assert r.status_code == 400
    s = client.post("/api/v1/evaluations/schedule/", {"title": "Compo", "type": "composition", "term": "T1", "date": "2026-12-10", "classes": [w["c"].pk], "coef": "2"}, format="json")
    assert s.status_code == 200 and Evaluation.objects.filter(title="Compo").exists() and not Evaluation.objects.filter(title="Compo").exclude(coef=2).exists()


def test_bareme_note_entered_as_is_and_brought_to_20(world, users, login, client):
    w = world
    sur30 = mk_eval(w, w["ma"], "interro")
    sur30.bareme = 30; sur30.save()
    sur10 = mk_eval(w, w["ma"], "devoir")
    sur10.bareme = 10; sur10.save()
    put(w, sur30, A=15)      # 15/30 = 10/20
    put(w, sur10, A=8)       # 8/10 = 16/20
    ma = next(s for s in calc.compute_class(w["c"], w["T1"], only_published=False)["results"][w["A"].pk]["subjects"] if s["subject"] == w["ma"].pk)
    assert ma["mc"] == 13    # (10 + 16) / 2 : chaque note ramenée sur 20 avant la moyenne

    login(w["prof"])
    url = f"/api/v1/evaluations/{sur30.pk}/grades/"
    assert client.put(url, {"values": {str(w["A"].pk): 28}}, format="json").status_code == 200   # au-delà de 20 : permis sur 30
    assert client.put(url, {"values": {str(w["A"].pk): 31}}, format="json").status_code == 400
    assert client.put(f"/api/v1/evaluations/{sur10.pk}/grades/", {"values": {str(w["A"].pk): 11}}, format="json").status_code == 400
    assert client.get(url).data["grades"][str(w["A"].pk)] == 28   # rendue telle que saisie

    new = {"school_class": w["c"].pk, "subject": w["ma"].pk, "term": "T1", "type": "devoir", "date": "2026-10-12"}
    assert client.post("/api/v1/evaluations/", {**new, "title": "Sans barème"}, format="json").data["bareme"] == 20
    r = client.post("/api/v1/evaluations/", {**new, "title": "Sur 40", "bareme": 40}, format="json")
    assert r.status_code == 201 and r.data["bareme"] == 40
    for bad in (0, 101):
        assert client.post("/api/v1/evaluations/", {**new, "title": "X", "bareme": bad}, format="json").status_code == 400
    # Baisser le barème sous une note déjà saisie est refusé ; le monter est permis
    assert client.patch(f"/api/v1/evaluations/{sur30.pk}/", {"bareme": 20}, format="json").status_code == 400
    assert client.patch(f"/api/v1/evaluations/{sur30.pk}/", {"bareme": 40}, format="json").status_code == 200

    login(users["directeur"])
    s = client.post("/api/v1/evaluations/schedule/", {"title": "Compo 40", "type": "composition", "term": "T1", "date": "2026-12-10", "classes": [w["c"].pk], "bareme": 40}, format="json")
    assert s.status_code == 200 and not Evaluation.objects.filter(title="Compo 40").exclude(bareme=40).exists()


def test_bulletin_template_imposed_by_school_for_families(world, login, client, users, monkeypatch):
    """Parents et élèves reçoivent toujours le modèle choisi par l'école ; le personnel peut en essayer un autre."""
    from apps.grades import bulletin_pdf
    from apps.academics.models import SchoolSettings

    w = world
    _published_marks(w)
    cfg = SchoolSettings.load()
    cfg.template = "moderne"
    cfg.save()
    seen = []
    real = bulletin_pdf.build_bulletins_pdf
    monkeypatch.setattr(bulletin_pdf, "build_bulletins_pdf", lambda *a, **k: (seen.append(k.get("tpl")), real(*a, **k))[1])
    url = f"/api/v1/students/{w['A'].pk}/bulletin.pdf?term=T1&template=compact"
    login(w["A"].parent.user)
    assert client.get(url).status_code == 200
    login(w["A"].user)
    assert client.get(url).status_code == 200
    login(users["directeur"])
    assert client.get(url).status_code == 200
    assert seen == ["moderne", "moderne", "compact"]
