"""Nouvelle année en trois étapes : bilan (règle « déjà redoublé ce niveau »), passage « à placer », répartition dans les classes."""
import pytest

from apps.academics.models import SchoolClass, SchoolSettings, SchoolYear
from apps.grades.models import Decision
from apps.notifications.models import Notification
from apps.students import rollover
from apps.students.models import Enrollment, Student

from .test_rollover import kid, moves
from .test_rollover import world as _world

world = _world   # même école de test que les autres passages d'année (fixture partagée)
pytestmark = pytest.mark.django_db
PLAN, APPLY, UNDO = "/api/v1/rollover/plan/", "/api/v1/rollover/apply/", "/api/v1/rollover/undo/"
PLACE, SUGGEST = "/api/v1/rollover/placement/", "/api/v1/rollover/placement/suggest/"


def no_class(plan):
    """Passage sans classe choisie : tous les élèves qui restent sont « à placer »."""
    return [{"student": m["student"], "action": m["action"]} for m in moves(plan)]


# ---------- 1. Bilan : un redoublement déjà fait sur ce niveau mène à l'exclusion ----------
def test_second_repeat_of_the_same_level_is_proposed_as_exclusion(world):
    cfg = SchoolSettings.load()
    b = world["b"]                                             # 6e A
    assert rollover.proposal_for(b, 7.0, cfg) == ("redouble", "")
    b.niveaux_redoubles = ["6e"]; b.save()
    assert rollover.proposal_for(b, 7.0, cfg) == ("exclu", "A déjà redoublé la 6e")
    assert rollover.proposal_for(b, 12.0, cfg)[0] == "admis"   # admis : la règle ne joue pas
    b.niveaux_redoubles = ["5e"]; b.save()                    # un autre niveau redoublé : redoublement normal
    assert rollover.proposal_for(b, 7.0, cfg) == ("redouble", "")


def test_bilan_shows_the_reason_and_a_repeat_can_still_be_granted(users, login, client, world):
    b = world["b"]
    b.niveaux_redoubles = ["6e"]; b.save()
    login(users["directeur"])
    row = next(r for r in client.get(f"/api/v1/decisions/?class={b.school_class_id}").data if r["student"] == b.pk)
    assert row["already_repeated"] is True
    # la direction accorde un redoublement malgré tout (dérogation) : le passage le suit
    Decision.objects.filter(student=b).update(value="redouble", comment="Redoublement accordé : raisons de santé")
    plan = client.get(PLAN).data
    assert next(r for r in plan["rows"] if r["student"] == b.pk)["action"] == "repeat"


# ---------- 2. Passage : chacun à son nouveau niveau, sans classe ----------
def test_passage_without_classes_puts_students_to_place_at_their_new_level(users, login, client, world):
    login(users["directeur"])
    r = client.post(APPLY, {"moves": no_class(client.get(PLAN).data)}, format="json")
    assert r.status_code == 201 and r.data["to_place"] == 3                     # AKA (5e), BAH (redouble 6e), COULIBALY (2nde)
    new = SchoolYear.get_current()
    for k in "abc":
        world[k].refresh_from_db()
    a, b, c = world["a"], world["b"], world["c"]
    assert not a.active and a.sortie == "placer" and a.user.is_active                # mis de côté, compte non bloqué
    assert Enrollment.objects.get(student=a, year=new).level == "5e" and Enrollment.objects.get(student=a, year=new).school_class is None
    assert Enrollment.objects.get(student=b, year=new).level == "6e" and b.niveaux_redoubles == ["6e"]   # retenu pour l'an prochain
    assert Enrollment.objects.get(student=c, year=new).level == "2nde"
    world["t"].refresh_from_db(); world["x"].refresh_from_db()
    assert world["t"].sortie == "ancien" and world["x"].sortie == "exclu"         # les sorties ne changent pas
    st = client.get(PLACE).data
    assert st["total"] == 3 and [lv["level"] for lv in st["levels"]] == ["6e", "5e", "2nde"]


# ---------- 3. Répartition ----------
def S(i, sexe="F", frm=1, name="6e A", level="6e", serie="", repeat=False):
    return {"student": i, "sexe": sexe, "from_class": frm, "from_name": name, "from_level": level, "from_serie": serie, "repeat": repeat}


def C(i, name, mx=10, count=0, f=0, m=0, serie=""):
    return {"id": i, "name": name, "serie": serie, "max": mx, "count": count, "f": f, "m": m}


def test_distribution_is_simply_even_and_mixes_girls_and_boys():
    studs = [S(i, "F" if i % 2 else "M", frm=1, name="6e A") for i in range(1, 7)] + [S(i, "F" if i % 2 else "M", frm=2, name="6e B") for i in range(7, 11)]
    res = rollover.distribute("5e", studs, [C(10, "5e A"), C(20, "5e B")])
    a = [s for s, c in res.items() if c == 10]
    b = [s for s, c in res.items() if c == 20]
    assert len(a) == 5 and len(b) == 5                                   # effectifs égaux
    assert sum(1 for s in a if s % 2) in (2, 3)                          # filles et garçons mélangés
    uneven = rollover.distribute("5e", [S(i) for i in range(1, 5)], [C(10, "5e A", count=4), C(20, "5e B")])
    assert sorted(uneven.values()) == [20, 20, 20, 20]                   # on complète d'abord la classe la moins remplie


def test_distribution_respects_capacity():
    full = rollover.distribute("5e", [S(1), S(2), S(3)], [C(10, "5e A", mx=2)])
    assert sorted(full.values(), key=lambda v: v is None) == [10, 10, None]              # plus de place : laissé à placer
    assert rollover.distribute("5e", [S(1)], []) == {1: None}                          # aucune classe : rien n'est proposé


def test_placement_api_suggests_then_saves_with_checks(users, login, client, world):
    login(users["directeur"])
    client.post(APPLY, {"moves": no_class(client.get(PLAN).data)}, format="json")
    a, c = world["a"], world["c"]
    client.post("/api/v1/rollover/reinscription/", {"students": [a.pk, c.pk], "confirmed": True, "motif": "Boursiers"}, format="json")
    sug = client.post(SUGGEST, {"level": "5e"}, format="json").data
    assert sug["assignments"][str(a.pk)] == SchoolClass.objects.get(name="5e A").pk
    # mauvais niveau, élève qui n'est pas à placer : refus, rien n'est enregistré
    assert client.post(PLACE, {"assignments": [{"student": a.pk, "class": SchoolClass.objects.get(name="6e A").pk}]}, format="json").status_code == 400
    assert client.post(PLACE, {"assignments": [{"student": world["t"].pk, "class": SchoolClass.objects.get(name="5e A").pk}]}, format="json").status_code == 400
    # capacité
    cl = SchoolClass.objects.get(name="2nde C"); cl.max_students = 0; cl.save()
    assert client.post(PLACE, {"assignments": [{"student": c.pk, "class": cl.pk}]}, format="json").status_code == 400
    r = client.post(PLACE, {"assignments": [{"student": a.pk, "class": sug["assignments"][str(a.pk)]}, {"student": c.pk, "class": SchoolClass.objects.get(name="2nde A").pk}]}, format="json")
    assert r.status_code == 200 and r.data == {"placed": 2, "remaining": 1}
    a.refresh_from_db(); c.refresh_from_db()
    assert a.active and a.sortie == "" and a.school_class.name == "5e A" and c.school_class.name == "2nde A"
    assert Enrollment.objects.get(student=a, year=SchoolYear.get_current()).school_class.name == "5e A"
    assert Notification.objects.filter(user=a.parent.user, text__contains="5e A").exists()           # la famille est prévenue
    assert [lv["level"] for lv in client.get(PLACE).data["levels"]] == ["6e"]


def test_placement_rights_and_former_students_list(users, login, client, world):
    login(users["directeur"])
    client.post(APPLY, {"moves": no_class(client.get(PLAN).data)}, format="json")
    login(users["admin"])                                                   # le secrétariat compose les classes
    assert client.get(PLACE).status_code == 200
    for role in ("enseignant", "comptable", "parent", "educateur"):
        login(users[role])
        assert client.get(PLACE).status_code == 403, role


def test_undo_after_placement_restores_everything(users, login, client, world):
    login(users["directeur"])
    client.post(APPLY, {"moves": no_class(client.get(PLAN).data)}, format="json")
    client.post(PLACE, {"assignments": [{"student": world["a"].pk, "class": SchoolClass.objects.get(name="5e A").pk}]}, format="json")
    assert client.post(UNDO).status_code == 200
    for k in "ab":
        world[k].refresh_from_db()
    assert world["a"].active and world["a"].school_class.name == "6e A" and world["a"].sortie == ""
    assert world["b"].niveaux_redoubles == [] and world["b"].active                     # le redoublement retenu est effacé


def test_secretariat_records_an_earlier_repeat_on_the_student_file(users, login, client, world):
    login(users["admin"])
    r = client.patch(f"/api/v1/students/{world['a'].pk}/", {"niveaux_redoubles": ["6e", "6e"]}, format="json")
    assert r.status_code == 200 and r.data["niveaux_redoubles"] == ["6e"]
    assert client.patch(f"/api/v1/students/{world['a'].pk}/", {"niveaux_redoubles": ["7e"]}, format="json").status_code == 400
    assert Student.objects.get(pk=world["a"].pk).niveaux_redoubles == ["6e"]
    kid("6e B", "SANS", "0707070707")                                       # inscription normale : aucun redoublement
    assert Student.objects.get(nom="SANS").niveaux_redoubles == []


# ---------- Limites levées : scolarité, inscription « à répartir », secrétariat, famille ----------
def test_student_to_place_pays_at_the_rate_of_the_new_level(users, login, client, world):
    from apps.finance.models import Tarif
    login(users["directeur"])
    client.post(APPLY, {"moves": no_class(client.get(PLAN).data)}, format="json")
    c = world["c"]                                                            # 3e → 2nde, à placer
    login(users["comptable"])
    acc = client.get(f"/api/v1/finance/students/{c.pk}/account/").data
    t = Tarif.objects.get(level="2nde")
    assert sum(line["amount"] for line in acc["lines"] if line["key"] != "REP") == t.ins + t.sco      # tarif de 2nde, pas de 3e
    r = client.post("/api/v1/finance/payments/", {"student": c.pk, "amount": 10000, "mode": "especes"}, format="json")
    assert r.status_code == 201 and r.data["class_name"] == "2nde · à placer"
    rec = client.get(f"/api/v1/finance/payments/{r.data['id']}/receipt/").data
    assert rec["student"]["class"] == "2nde · à placer"


def test_new_student_can_be_enrolled_to_be_placed_later(users, login, client, world):
    login(users["admin"])
    body = {"nom": "Nouveau", "prenoms": "Élève", "sexe": "F", "naissance": "2014-03-03", "lieu": "", "parent_name": "Mme Nouveau", "parent_phone": "0808080808"}
    assert client.post("/api/v1/students/", body, format="json").status_code == 400                    # ni classe ni niveau
    r = client.post("/api/v1/students/", {**body, "level": "6e"}, format="json")
    assert r.status_code == 201
    s = Student.objects.get(pk=r.data["student"]["id"])
    assert not s.active and s.sortie == "placer" and s.school_class is None and s.current_level == "6e" and s.class_label == "6e · à placer"
    lv = next(x for x in client.get(PLACE).data["levels"] if x["level"] == "6e")
    row = next(x for x in lv["students"] if x["student"] == s.pk)
    assert row["new"] is True and row["from_name"] == "Nouvel élève" and row["repeat"] is False
    # le secrétariat place l'élève (étape 3) ; ou depuis son dossier, en choisissant sa classe
    r = client.post(PLACE, {"assignments": [{"student": s.pk, "class": SchoolClass.objects.get(name="6e B").pk}]}, format="json")
    assert r.status_code == 200
    s.refresh_from_db()
    assert s.active and s.school_class.name == "6e B"


def test_file_class_change_places_a_student_to_place(users, login, client, world):
    login(users["admin"])
    r = client.post("/api/v1/students/", {"nom": "Dossier", "prenoms": "Test", "sexe": "M", "naissance": "2014-04-04", "lieu": "", "parent_name": "M. Dossier",
                                          "parent_phone": "0909090909", "level": "6e"}, format="json")
    sid = r.data["student"]["id"]
    assert client.patch(f"/api/v1/students/{sid}/", {"school_class": SchoolClass.objects.get(name="6e A").pk}, format="json").status_code == 200
    s = Student.objects.get(pk=sid)
    assert s.active and s.sortie == "" and s.school_class.name == "6e A"
    assert Enrollment.objects.get(student=s, year=SchoolYear.get_current()).school_class.name == "6e A"


def test_family_sees_the_child_to_place_but_nothing_of_the_old_class(users, login, client, world):
    from apps.academics.models import Subject
    from apps.schedule.models import TextEntry
    login(users["directeur"])
    client.post(APPLY, {"moves": no_class(client.get(PLAN).data)}, format="json")
    a = world["a"]                                                             # était en 6e A, à placer en 5e
    TextEntry.objects.create(school_class=SchoolClass.objects.get(name="6e A"), subject=Subject.objects.get(code="ma"), date="2026-10-01", content="Cours des nouveaux 6e A")
    login(a.parent.user)
    kids = client.get("/api/v1/students/").data
    kids = kids["results"] if isinstance(kids, dict) else kids
    me = next(k for k in kids if k["id"] == a.pk)
    assert me["sortie"] == "placer" and me["class_name"] == "5e · à placer" and me["level"] == "5e"
    tb = client.get("/api/v1/textbook/").data
    tb = tb["results"] if isinstance(tb, dict) else tb
    assert not any(e["content"] == "Cours des nouveaux 6e A" for e in tb)        # rien de son ancienne classe
    r = client.get(f"/api/v1/students/{a.pk}/bulletin/?term=T1")
    assert r.status_code == 404 and "pas encore de classe" in r.data["detail"]


def test_family_pages_do_not_fail_for_a_child_to_place(users, login, client, world):
    """Toutes les pages qu'ouvrent le parent et l'élève répondent, même si l'élève n'a pas encore de classe."""
    login(users["directeur"])
    client.post(APPLY, {"moves": no_class(client.get(PLAN).data)}, format="json")
    a = world["a"]
    urls = ["decisions/", "overview/?term=T1", "students/", "textbook/?page_size=1000", "absences/?page_size=500", "attendance/sessions/",
            "incidents/", "announcements/", "notifications/", "finance/payments/?page_size=500", "finance/tarifs/", "finance/dates/",
            "homeworks/", "resources/", "mock-exams/", "messages/recipients/", "messages/threads/", "timetable/", "classes/", "settings/",
            f"finance/students/{a.pk}/account/", f"finance/students/{a.pk}/statement/", "archives/"]
    for who in (a.parent.user, a.user):                                   # le parent, puis l'élève lui-même
        login(who)
        for url in urls:
            r = client.get("/api/v1/" + url)
            assert r.status_code < 500, (who.username, url, r.status_code)


# ---------- Réinscription avant la répartition ----------
REINS, DEPARTS = "/api/v1/rollover/reinscription/", "/api/v1/rollover/departs/"


def test_secretariat_validates_reinscriptions_on_receipt(users, login, client, world):
    login(users["directeur"])
    client.post(APPLY, {"moves": no_class(client.get(PLAN).data)}, format="json")
    a, b = world["a"], world["b"]
    st = client.get(PLACE).data
    assert (st["confirmed"], st["paid"], st["waiting"]) == (0, 0, 3)
    assert client.post(SUGGEST, {"level": "5e"}, format="json").data["assignments"] == {}     # personne n'est validé
    login(a.parent.user)
    kids = client.get("/api/v1/students/").data
    kids = kids["results"] if isinstance(kids, dict) else kids
    assert next(k for k in kids if k["id"] == a.pk)["reinscription_state"] == "attente"
    # le comptable encaisse : l'élève est « payé, à valider » (le paiement ne valide pas seul)
    login(users["comptable"])
    pay = client.post("/api/v1/finance/payments/", {"student": a.pk, "amount": 5000, "mode": "especes"}, format="json").data
    assert Enrollment.objects.get(student=a, year=SchoolYear.get_current()).reinscrit is False
    assert client.get(f"/api/v1/students/{a.pk}/").data["reinscription_state"] == "paye"
    # le secrétariat voit le paiement et peut ouvrir le reçu, puis valide
    login(users["admin"])
    row = next(x for lv in client.get(PLACE).data["levels"] for x in lv["students"] if x["student"] == a.pk)
    assert row["state"] == "paye" and row["paid"] == 5000 and row["receipts"][0]["receipt_no"] == pay["receipt_no"]
    assert client.get(f"/api/v1/finance/payments/{pay['id']}/receipt/").status_code == 200
    assert client.get(f"/api/v1/finance/payments/{pay['id']}/receipt.pdf").status_code == 200
    assert client.post(REINS, {"students": [a.pk], "confirmed": True}, format="json").status_code == 200
    e = Enrollment.objects.get(student=a, year=SchoolYear.get_current())
    assert e.reinscrit and e.reinscription_note == f"Reçu {pay['receipt_no']}"
    assert str(a.pk) in client.post(SUGGEST, {"level": "5e"}, format="json").data["assignments"]
    # sans paiement : motif obligatoire
    r = client.post(REINS, {"students": [b.pk], "confirmed": True}, format="json")
    assert r.status_code == 400 and "motif" in str(r.data)
    assert client.post(REINS, {"students": [b.pk], "confirmed": True, "motif": "Enfant du personnel"}, format="json").status_code == 200
    assert Enrollment.objects.get(student=b, year=SchoolYear.get_current()).reinscription_note == "Sans paiement : Enfant du personnel"
    assert client.post(REINS, {"students": [b.pk], "confirmed": False}, format="json").status_code == 200       # annulation
    assert client.post(REINS, {"students": [world["t"].pk], "confirmed": True, "motif": "xxx"}, format="json").status_code == 400
    for role in ("enseignant", "comptable", "parent"):
        login(users[role])
        assert client.post(REINS, {"students": [b.pk], "motif": "xxx"}, format="json").status_code == 403, role
    login(users["enseignant"])
    assert client.get(f"/api/v1/finance/payments/{pay['id']}/receipt/").status_code in (403, 404)       # pas pour tout le monde


def test_a_non_reinscribed_student_can_still_be_placed_by_hand(users, login, client, world):
    login(users["directeur"])
    client.post(APPLY, {"moves": no_class(client.get(PLAN).data)}, format="json")
    b = world["b"]
    r = client.post(PLACE, {"assignments": [{"student": b.pk, "class": SchoolClass.objects.get(name="6e B").pk}]}, format="json")
    assert r.status_code == 200
    b.refresh_from_db()
    assert b.active and b.school_class.name == "6e B"


def test_students_who_did_not_come_back_are_marked_as_departed(users, login, client, world):
    from apps.finance.services import record_payment
    login(users["directeur"])
    client.post(APPLY, {"moves": no_class(client.get(PLAN).data)}, format="json")
    a, b, c = world["a"], world["b"], world["c"]
    record_payment(student=c, amount=1000, mode="especes")                    # COULIBALY revient
    debt_b = Enrollment.objects.get(student=b, year=SchoolYear.get_current()).report
    r = client.post(DEPARTS, {}, format="json")
    assert r.status_code == 200 and r.data == {"departed": 2, "remaining": 1}
    for x in (a, b, c):
        x.refresh_from_db()
    assert a.sortie == "parti" and not a.active and not a.user.is_active and b.solde_sortie == debt_b
    assert not Enrollment.objects.filter(student=a, year=SchoolYear.get_current()).exists()
    assert c.sortie == "placer"                                                # réinscrit : toujours à placer
    # il revient finalement : réintégration, avec sa dette
    login(users["admin"])
    assert client.post(f"/api/v1/students/{a.pk}/reintegrate/", {"school_class": SchoolClass.objects.get(name="5e A").pk}, format="json").status_code == 200
    a.refresh_from_db()
    assert a.active and a.school_class.name == "5e A"
    # un paiement a été fait dans la nouvelle année : plus d'annulation ; sans lui, tout revient comme avant
    from apps.finance.models import Payment
    login(users["directeur"])
    assert client.post(UNDO).status_code == 400
    Payment.objects.all().delete()
    assert client.post(UNDO).status_code == 200
    b.refresh_from_db()
    assert b.active and b.sortie == "" and b.school_class.name == "6e A" and b.user.is_active
