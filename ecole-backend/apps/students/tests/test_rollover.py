
import pytest

from apps.academics.models import SchoolClass, SchoolSettings, SchoolYear, Term
from apps.finance.models import Payment
from apps.grades.models import Decision
from apps.students.models import Enrollment, Student
from apps.students.services import enroll_student

pytestmark = pytest.mark.django_db
PLAN, APPLY, UNDO = "/api/v1/rollover/plan/", "/api/v1/rollover/apply/", "/api/v1/rollover/undo/"


def kid(cls, nom, phone):
    return enroll_student(nom=nom, prenoms="Test", sexe="M", naissance="2012-01-01", lieu="", school_class=SchoolClass.objects.get(name=cls), parent_name=f"M. {nom}", parent_phone=phone).student


@pytest.fixture
def world(school, users):
    year = SchoolYear.get_current()
    a, b = Student.objects.get(nom="AKA"), Student.objects.get(nom="BAH")        # 6e A (fixture)
    c = kid("3e A", "COULIBALY", "0303030303")
    t = kid("Tle A", "DIALLO", "0404040404")
    x = kid("6e B", "EXCLU", "0505050505")
    for st, v in ((a, "admis"), (b, "redouble"), (c, "admis"), (t, "admis"), (x, "exclu")):
        Decision.objects.create(student=st, year=year, value=v)
    return {"year": year, "a": a, "b": b, "c": c, "t": t, "x": x}


def moves(plan, **over):
    out = []
    for r in plan["rows"]:
        out.append({"student": r["student"], "action": over.get(r["name"].split()[0], {}).get("action", r["action"]),
                    "class": over.get(r["name"].split()[0], {}).get("class", r["target"])})
    return out


def test_only_direction_can_roll_over(users, login, client, world):
    for role in ("admin", "comptable", "enseignant", "parent", "fondateur"):
        login(users[role])
        assert client.get(PLAN).status_code == 403, role
    login(users["directeur"])
    assert client.get(PLAN).status_code == 200


def test_plan_follows_decisions_and_keeps_classes_together(users, login, client, world):
    login(users["directeur"])
    p = client.get(PLAN).data
    rows = {r["name"].split()[0]: r for r in p["rows"]}
    assert p["from_year"] == "2026-2027" and p["to_year"] == "2027-2028"
    cls = {c["id"]: c for c in p["classes"]}
    assert rows["AKA"]["action"] == "promote" and cls[rows["AKA"]["target"]]["name"] == "5e A"       # « 6e A » → « 5e A »
    assert rows["BAH"]["action"] == "repeat" and cls[rows["BAH"]["target"]]["name"] == "6e A"        # redoublant : même classe
    assert rows["COULIBALY"]["action"] == "promote" and rows["COULIBALY"]["target"] is None           # 3e → 2nde : série à choisir
    assert rows["DIALLO"]["action"] == "graduate" and rows["EXCLU"]["action"] == "exclude"


def test_apply_moves_everyone_and_blocks_missing_or_wrong_destinations(users, login, client, world):
    login(users["directeur"])
    plan = client.get(PLAN).data
    seconde = SchoolClass.objects.get(name="2nde C")
    # mauvais niveau
    bad = moves(plan, COULIBALY={"action": "promote", "class": SchoolClass.objects.get(name="6e A").pk})
    assert client.post(APPLY, {"moves": bad}, format="json").status_code == 400
    # un élève oublié
    assert client.post(APPLY, {"moves": moves(plan)[:-1]}, format="json").status_code == 400
    ok = moves(plan, COULIBALY={"action": "promote", "class": seconde.pk})
    r = client.post(APPLY, {"moves": ok}, format="json")
    assert r.status_code == 201 and r.data["year"] == "2027-2028"
    for k in "abctx":
        world[k].refresh_from_db()
    assert world["a"].school_class.name == "5e A" and world["b"].school_class.name == "6e A" and world["c"].school_class_id == seconde.pk
    assert not world["t"].active and world["t"].sortie == "ancien" and not world["x"].active and world["x"].sortie == "exclu"
    assert not world["x"].user.is_active
    new = SchoolYear.get_current()
    assert new.label == "2027-2028" and new.terms.count() == 3 and not new.terms.filter(locked=True).exists()
    assert Term.objects.filter(year=world["year"], locked=True).count() == 3                       # l'ancienne année est figée
    t1_old, t1_new = world["year"].terms.get(code="T1"), new.terms.get(code="T1")
    assert t1_new.start == t1_old.start.replace(year=t1_old.start.year + 1)
    assert Enrollment.objects.filter(year=new).count() == 3 and Enrollment.objects.filter(year=world["year"]).count() >= 5


def test_unpaid_balance_is_carried_and_new_year_starts_fresh(users, login, client, world):
    from apps.finance.services import record_payment
    login(users["directeur"])
    a = world["a"]
    record_payment(student=a, amount=100000, mode="especes")                 # 6e : 50 000 + 180 000 = 230 000 dus
    plan = client.get(PLAN).data
    seconde = SchoolClass.objects.get(name="2nde C")
    assert client.post(APPLY, {"moves": moves(plan, COULIBALY={"action": "promote", "class": seconde.pk})}, format="json").status_code == 201
    login(users["comptable"])
    acc = client.get(f"/api/v1/finance/students/{a.pk}/account/").data
    assert acc["lines"][0]["key"] == "REP" and acc["lines"][0]["amount"] == 130000 and acc["paid"] == 0       # reste de l'an passé, payé en premier
    assert acc["total"] == 130000 + 50000 + 180000 and acc["balance"] == acc["total"]
    assert client.get("/api/v1/finance/reports/").data["reports"][str(a.pk)] == 130000
    assert client.get("/api/v1/finance/payments/").data["results"] == []                                      # l'historique est celui de l'année en cours
    assert len(client.get("/api/v1/finance/payments/?year=all").data["results"]) == 1
    login(users["comptable"])
    assert client.post("/api/v1/finance/payments/", {"student": a.pk, "amount": 130000, "mode": "especes"}, format="json").status_code == 201
    acc = client.get(f"/api/v1/finance/students/{a.pk}/account/").data
    assert acc["lines"][0]["remaining"] == 0 and acc["balance"] == 230000
    # un redoublant qui n'avait rien payé repart avec toute sa dette de l'an passé, en première ligne
    b = client.get(f"/api/v1/finance/students/{world['b'].pk}/account/").data
    assert b["lines"][0]["key"] == "REP" and b["lines"][0]["amount"] == 230000


def test_undo_until_the_new_year_has_content(users, login, client, world):
    login(users["directeur"])
    plan = client.get(PLAN).data
    seconde = SchoolClass.objects.get(name="2nde C")
    client.post(APPLY, {"moves": moves(plan, COULIBALY={"action": "promote", "class": seconde.pk})}, format="json")
    assert client.get(PLAN).data["last"]["can_undo"] is True
    # un paiement dans la nouvelle année bloque l'annulation
    from apps.finance.services import record_payment
    p = record_payment(student=world["a"], amount=1000, mode="especes")
    assert client.post(UNDO).status_code == 400 and "paiements" in client.post(UNDO).data["detail"]
    Payment.objects.filter(pk=p.pk).delete()
    r = client.post(UNDO)
    assert r.status_code == 200 and SchoolYear.get_current().label == "2026-2027"
    for k in "abcx":
        world[k].refresh_from_db()
    assert world["a"].school_class.name == "6e A" and world["x"].active and world["x"].sortie == "" and world["x"].user.is_active
    assert world["c"].school_class.name == "3e A" and SchoolYear.objects.count() == 1
    assert not Term.objects.filter(year=world["year"], locked=True).exists()
    assert client.post(UNDO).status_code == 400                           # plus rien à annuler


def test_new_students_in_new_year_block_undo(users, login, client, world):
    login(users["directeur"])
    plan = client.get(PLAN).data
    client.post(APPLY, {"moves": moves(plan, COULIBALY={"action": "promote", "class": SchoolClass.objects.get(name="2nde C").pk})}, format="json")
    kid("6e A", "NOUVEAU", "0606060606")
    r = client.post(UNDO)
    assert r.status_code == 400 and "inscrits" in r.data["detail"]


def test_reintegrate_excluded_student_with_debt(users, login, client, world):
    login(users["directeur"])
    plan = client.get(PLAN).data
    client.post(APPLY, {"moves": moves(plan, COULIBALY={"action": "promote", "class": SchoolClass.objects.get(name="2nde C").pk})}, format="json")
    x = world["x"]; x.refresh_from_db()
    assert x.solde_sortie == 230000
    url = f"/api/v1/students/{x.pk}/reintegrate/"
    cl = SchoolClass.objects.get(name="6e B")
    login(users["enseignant"])
    assert client.post(url, {"school_class": cl.pk}, format="json").status_code == 403
    login(users["admin"])                                             # le secrétariat peut réintégrer
    assert client.post(url, {"school_class": 0}, format="json").status_code == 400
    r = client.post(url, {"school_class": cl.pk}, format="json")
    assert r.status_code == 200 and r.data["active"] is True and r.data["sortie"] == ""
    x.refresh_from_db()
    assert x.user.is_active and x.solde_sortie == 0 and Enrollment.objects.get(student=x, year=SchoolYear.get_current()).report == 230000
    assert client.post(url, {"school_class": cl.pk}, format="json").status_code == 400            # déjà inscrit


def test_school_sets_its_own_averages(users, login, client, world):
    from apps.grades import calc
    cfg = SchoolSettings.load()
    assert [calc.propose_decision(a, cfg) for a in (12, 9, 7)] == ["admis", "conseil", "redouble"]       # réglages d'origine
    login(users["directeur"])
    assert client.patch("/api/v1/settings/", {"passage_admission": 9, "passage_redoublement": 9}, format="json").status_code == 200   # sans zone de conseil
    cfg = SchoolSettings.load()
    assert [calc.propose_decision(a, cfg) for a in (12, 9, 8.99)] == ["admis", "admis", "redouble"]
    assert client.patch("/api/v1/settings/", {"passage_exclusion": 5}, format="json").status_code == 200
    cfg = SchoolSettings.load()
    assert calc.propose_decision(4.5, cfg) == "exclu" and calc.propose_decision(6, cfg) == "redouble"
    for bad in ({"passage_redoublement": 12}, {"passage_exclusion": 9}, {"passage_admission": 25}):
        assert client.patch("/api/v1/settings/", bad, format="json").status_code == 400, bad
    assert client.patch("/api/v1/settings/", {"passage_exclusion": None}, format="json").status_code == 200
    assert client.get("/api/v1/settings/").data["passage_exclusion"] is None


def test_rule_can_differ_by_level(users, login, client, world):
    from apps.grades import calc
    login(users["directeur"])
    rules = {"3e": {"admission": 11, "redoublement": 9, "exclusion": None}, "Tle": {"admission": 12, "redoublement": 12}}
    assert client.patch("/api/v1/settings/", {"passage_niveaux": rules}, format="json").status_code == 200
    cfg = SchoolSettings.load()
    assert calc.propose_decision(10, cfg, "3e") == "conseil"        # règle du niveau
    assert calc.propose_decision(10, cfg, "4e") == "admis"          # niveau sans exception : règle de l'école (10 / 8)
    assert calc.propose_decision(11.5, cfg, "Tle") == "redouble" and calc.propose_decision(12, cfg, "Tle") == "admis"
    assert client.get("/api/v1/settings/").data["passage_niveaux"]["3e"] == {"admission": 11.0, "redoublement": 9.0, "exclusion": None}
    assert client.get(PLAN).data["settings"]["niveaux"]["Tle"]["admission"] == 12.0
    for bad in ({"3e": {"admission": 9, "redoublement": 11}}, {"7e": {"admission": 10, "redoublement": 8}}, {"3e": {"admission": 10}},
                {"3e": {"admission": 10, "redoublement": 8, "exclusion": 8}}, {"3e": {"admission": 25, "redoublement": 8}}, {"3e": "x"}):
        assert client.patch("/api/v1/settings/", {"passage_niveaux": bad}, format="json").status_code == 400, bad
    assert client.patch("/api/v1/settings/", {"passage_niveaux": {}}, format="json").status_code == 200      # retour à la règle de l'école
    assert calc.propose_decision(10, SchoolSettings.load(), "3e") == "admis"


def _grade(world, student, value, cls="6e A"):
    from apps.academics.models import Subject
    from apps.grades.models import Evaluation, Grade
    ev, _ = Evaluation.objects.get_or_create(school_class=SchoolClass.objects.get(name=cls), subject=Subject.objects.get(code="ma"), term=Term.objects.get(year=world["year"], code="T1"),
                                             type="devoir", title="Devoir 1", defaults={"date": "2026-10-10", "published": True})
    Grade.objects.create(evaluation=ev, student=student, value=value)


def _roll(client, world):
    plan = client.get(PLAN).data
    cls = {c["name"]: c["id"] for c in plan["classes"]}
    mv = []
    for r in plan["rows"]:
        if r["action"] in ("promote", "repeat"):
            mv.append({"student": r["student"], "action": r["action"], "class": r["target"] or cls["2nde A"]})
        else:
            mv.append({"student": r["student"], "action": r["action"], "class": None})
    return client.post(APPLY, {"moves": mv}, format="json")


def test_past_year_can_still_be_consulted_with_its_own_roster(users, login, client, world):
    _grade(world, world["a"], 15)
    _grade(world, world["b"], 5)
    login(users["directeur"])
    assert _roll(client, world).status_code == 201, "passage"
    # l'année en cours est maintenant 2027-2028 : AKA est en 5e A, mais l'archive de 2026-2027 le montre en 6e A, avec BAH
    arch = client.get("/api/v1/archives/").data
    assert arch["years"] == ["2026-2027"] and arch["year"] == "2026-2027"
    rows = {r["name"].split()[0]: r for r in arch["rows"]}
    assert rows["AKA"]["class_name"] == "6e A" and rows["AKA"]["annual_avg"] == 15 and rows["BAH"]["annual_avg"] == 5
    assert rows["EXCLU"]["sortie"] == "exclu" and rows["DIALLO"]["sortie"] == "ancien"        # les sortis figurent toujours dans leur année
    b = client.get(f"/api/v1/students/{world['a'].pk}/bulletin/?term=T1&year=2026-2027").data
    assert b["class"] == rows["AKA"]["class"] and b["effectif"] == 2 and b["result"]["moyenne"] == 15 and b["result"]["rang"] == 1
    pdf = client.get(f"/api/v1/students/{world['a'].pk}/bulletin.pdf?term=T1&year=2026-2027")
    assert pdf.status_code == 200 and pdf["Content-Type"] == "application/pdf"
    assert client.get(f"/api/v1/classes/{rows['AKA']['class']}/bulletins.pdf?term=T1&year=2026-2027").status_code == 200
    assert client.get("/api/v1/archives/?year=2027-2028").status_code == 400            # l'année en cours n'est pas une archive
    assert client.get(f"/api/v1/students/{world['a'].pk}/bulletin/?term=T1&year=1999-2000").status_code == 400
    # la nouvelle année repart vide : AKA n'a pas de notes en 5e A
    assert client.get(f"/api/v1/students/{world['a'].pk}/bulletin/?term=T1").data["result"]["moyenne"] is None


def test_family_sees_only_own_archive_and_staff_without_rights_is_refused(users, login, client, world):
    _grade(world, world["a"], 15)
    login(users["directeur"])
    _roll(client, world)
    for role in ("enseignant", "comptable", "educateur"):
        login(users[role])
        assert client.get("/api/v1/archives/").status_code == 403, role
    parent = world["a"].parent.user
    parent.set_password("secret1"); parent.save()
    login(parent)
    rows = client.get("/api/v1/archives/").data["rows"]
    assert [r["name"].split()[0] for r in rows] == ["AKA"]
    assert client.get(f"/api/v1/students/{world['a'].pk}/bulletin/?term=T1&year=2026-2027").status_code == 200
    assert client.get(f"/api/v1/students/{world['b'].pk}/bulletin/?term=T1&year=2026-2027").status_code == 404


def test_excluded_account_is_blocked_then_restored_on_reintegration(users, login, client, world):
    x = world["x"]
    x.user.set_password("secret1"); x.user.save()
    login(users["directeur"])
    _roll(client, world)
    from rest_framework.test import APIClient
    anon = APIClient()
    r = anon.post("/api/v1/auth/login/", {"username": x.user.username, "password": "secret1"}, format="json")
    assert r.status_code in (400, 401, 403) and "access" not in r.data
    cl = SchoolClass.objects.get(name="6e A")
    assert client.post(f"/api/v1/students/{x.pk}/reintegrate/", {"school_class": cl.pk}, format="json").status_code == 200
    r = anon.post("/api/v1/auth/login/", {"username": x.user.username, "password": "secret1"}, format="json")
    assert r.status_code == 200 and "access" in r.data


def test_without_decision_the_plan_follows_the_averages_and_leaves_council_cases_open(users, login, client, world):
    Decision.objects.filter(year=world["year"]).delete()
    _grade(world, world["a"], 16)       # AKA : admis
    _grade(world, world["b"], 9)        # BAH : entre 8 et 10 → conseil de classe
    login(users["directeur"])
    rows = {r["name"].split()[0]: r for r in client.get(PLAN).data["rows"]}
    assert rows["AKA"]["action"] == "promote" and rows["AKA"]["proposal"] == "admis"
    assert rows["BAH"]["proposal"] == "conseil" and rows["BAH"]["action"] is None and rows["BAH"]["target"] is None
    assert rows["COULIBALY"]["proposal"] is None and rows["COULIBALY"]["action"] is None        # sans notes : rien n'est supposé
