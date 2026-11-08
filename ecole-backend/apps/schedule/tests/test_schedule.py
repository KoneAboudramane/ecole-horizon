import datetime

import pytest
from django.utils import timezone

from apps.academics.horaires import Horaires
from apps.academics.models import Coefficient, SchoolClass, Subject, Teacher, TeachingAssignment
from apps.notifications.models import Notification
from apps.schedule import generator
from apps.schedule.models import Cell, TextEntry

pytestmark = pytest.mark.django_db
T = "/api/v1/timetable/"
X = "/api/v1/textbook/"


@pytest.fixture(autouse=True)
def today(monkeypatch):
    monkeypatch.setattr(timezone, "localdate", lambda *a, **k: datetime.date(2026, 12, 14))


def full_assignments(make_user):
    """Un enseignant par matière et par groupe de classes (charge réaliste), affecté à toutes les classes du groupe."""
    profs = {}
    for c in SchoolClass.objects.all():
        for co in Coefficient.objects.filter(groupe=c.groupe).select_related("subject"):
            key = (co.subject.code, c.groupe)
            if key not in profs:
                profs[key] = Teacher.objects.get(user=make_user("enseignant", f"p.{co.subject.code}.{c.groupe}"))
            TeachingAssignment.objects.update_or_create(school_class=c, subject=co.subject, defaults={"teacher": profs[key]})


def test_generator_has_no_clash_and_respects_closed_slots(school, users, login, client, make_user):
    full_assignments(make_user)
    login(users["admin"])
    r = client.post(T + "generate/")
    assert r.status_code == 200 and r.data["cells"] > 250 and r.data["unplaced"] == 0
    rows = list(Cell.objects.select_related("school_class"))
    teacher = {(a.school_class_id, a.subject_id): a.teacher_id for a in TeachingAssignment.objects.all()}
    seen = set()
    for c in rows:
        assert Horaires().is_open(c.day, c.slot)                                  # pas de cours le mercredi après-midi
        for key in (("C", c.school_class_id, c.day, c.slot), ("T", teacher[(c.school_class_id, c.subject_id)], c.day, c.slot), ("R", c.room, c.day, c.slot)):
            assert key not in seen, key
            seen.add(key)
    a = Cell.objects.filter(school_class__name="6e A")
    assert a.filter(subject__code="ma").count() == 4 and a.filter(subject__code="eps").count() == 2   # heures = coefficient (EPS : 2 h)
    assert generator.generate([c.pk for c in SchoolClass.objects.order_by("id")], [(x.school_class_id, x.subject.code, x.subject_id, x.teacher_id) for x in TeachingAssignment.objects.select_related("subject").order_by("id")],
                              lambda cl, sb: Coefficient.objects.get(groupe=SchoolClass.objects.get(pk=cl).groupe, subject_id=sb).value)[0] is not None


def test_generation_is_deterministic(school, users, login, client, make_user):
    full_assignments(make_user)
    login(users["directeur"])
    client.post(T + "generate/")
    first = sorted(Cell.objects.values_list("school_class_id", "day", "slot", "subject_id", "room"))
    client.post(T + "generate/")
    assert first == sorted(Cell.objects.values_list("school_class_id", "day", "slot", "subject_id", "room"))


def test_edit_rights_and_conflicts(school, users, login, client):
    c, ma = school["c"], Subject.objects.get(code="ma")
    body = {"school_class": c.pk, "day": 0, "slot": 0, "subject": ma.pk, "room": "Salle 1"}
    for r in ("enseignant", "parent", "comptable", "educateur"):
        login(users[r])
        assert client.put(T, body, format="json").status_code == 403, r
    login(users["admin"])
    assert client.put(T, body, format="json").status_code == 200
    # même enseignant de maths, autre classe, même créneau → refus
    other = SchoolClass.objects.get(name="6e B")
    TeachingAssignment.objects.update_or_create(school_class=other, subject=ma, defaults={"teacher": TeachingAssignment.objects.get(school_class=c, subject=ma).teacher})
    r = client.put(T, {**body, "school_class": other.pk, "room": "Salle 2"}, format="json")
    assert r.status_code == 400 and "déjà en cours" in r.data["detail"]
    fr = Subject.objects.get(code="fr")
    TeachingAssignment.objects.update_or_create(school_class=other, subject=fr, defaults={"teacher": Teacher.objects.get(user=school["hors"])})
    r = client.put(T, {**body, "school_class": other.pk, "subject": fr.pk}, format="json")   # même salle 1
    assert r.status_code == 400 and "Salle 1" in r.data["detail"]
    assert client.put(T, {**body, "school_class": other.pk, "subject": fr.pk, "room": "Salle 2"}, format="json").status_code == 200
    assert client.put(T, {**body, "day": 2, "slot": 6}, format="json").status_code == 400          # mercredi après-midi
    ph = Subject.objects.get(code="ph")
    assert client.put(T, {**body, "subject": ph.pk, "slot": 1}, format="json").status_code == 400   # philo pas en 6e
    assert client.delete(T + f"?class={c.pk}&day=0&slot=0").status_code == 204
    assert client.delete(T + f"?class={c.pk}&day=0&slot=0").status_code == 404


def test_timetable_read_scope(school, users, login, client):
    login(users["admin"])
    Cell.objects.create(school_class=school["c"], day=0, slot=0, subject=Subject.objects.get(code="ma"), room="Salle 1")
    Cell.objects.create(school_class=SchoolClass.objects.get(name="3e A"), day=0, slot=0, subject=Subject.objects.get(code="ma"), room="Salle 5")
    login(school["A"].parent.user)
    assert [x["school_class"] for x in client.get(T).data["cells"]] == [school["c"].pk]     # sa classe seulement
    login(users["directeur"])
    assert len(client.get(T).data["cells"]) == 2
    assert len(client.get(T + f"?class={school['c'].pk}").data["cells"]) == 1


# ---------- Cahier de textes ----------
def entry(client, w, **kw):
    ma = Subject.objects.get(code="ma")
    return client.post(X, {"school_class": w["c"].pk, "subject": ma.pk, "date": "2026-12-14", "content": "Équations", "homework": "Exercice 5", "due": "2026-12-16", **kw}, format="json")


def test_textbook_write_rights(school, users, login, client):
    for r in ("directeur", "admin", "parent", "eleve", "educateur"):
        login(users[r])
        assert entry(client, school).status_code == 403, r
    login(school["hors"])
    assert entry(client, school).status_code == 403                                   # n'enseigne pas cette classe
    login(school["prof"])
    r = entry(client, school)
    assert r.status_code == 201 and r.data["teacher_name"] == school["prof"].name
    assert entry(client, school).status_code == 400                                   # une séance par jour
    assert Notification.objects.filter(user=school["A"].parent.user, text__contains="Mathématiques").count() == 1


def test_textbook_validation(school, login, client):
    login(school["prof"])
    assert entry(client, school, date="2026-12-20").status_code == 400                # séance à venir
    assert entry(client, school, content=" ").status_code == 400
    assert entry(client, school, due=None).status_code == 400                         # devoir sans date de remise
    assert entry(client, school, due="2026-12-10").status_code == 400
    assert entry(client, school, homework="", due=None).status_code == 201


def test_textbook_update_delete_and_scope(school, users, login, client):
    login(school["prof"])
    eid = entry(client, school).data["id"]
    Notification.objects.all().delete()
    assert client.patch(X + f"{eid}/", {"content": "Équations (suite)"}, format="json").status_code == 200
    assert Notification.objects.count() == 0                                          # devoir inchangé : pas de nouvel avis
    client.patch(X + f"{eid}/", {"due": "2026-12-17"}, format="json")
    assert Notification.objects.filter(user=school["A"].parent.user).count() == 1
    login(school["hors"])
    assert client.patch(X + f"{eid}/", {"content": "x"}, format="json").status_code == 403
    assert client.delete(X + f"{eid}/").status_code == 403
    assert client.get(X).data["results"] == []
    login(school["A"].parent.user)
    assert len(client.get(X + "?homework=1&from=2026-12-14").data["results"]) == 1
    assert client.get(X + "?homework=1&from=2026-12-18").data["results"] == []
    login(users["comptable"])
    assert client.get(X).data["results"] == []
    login(school["prof"])
    assert client.delete(X + f"{eid}/").status_code == 204
    assert TextEntry.objects.count() == 0


def test_teacher_sees_only_own_textbook(school, users, login, client, make_user):
    """Deux enseignants de la même classe : chacun ne voit que le cahier de ses matières ; la direction voit tout."""
    from apps.academics.models import Teacher, TeachingAssignment
    from apps.schedule.models import Replacement
    fr = Subject.objects.get(code="fr")
    prof_fr = make_user("enseignant", "prof.fr")
    TeachingAssignment.objects.update_or_create(school_class=school["c"], subject=fr, defaults={"teacher": Teacher.objects.get(user=prof_fr)})
    login(school["prof"])
    ma_id = entry(client, school).data["id"]
    login(prof_fr)
    fr_id = entry(client, school, subject=fr.pk, content="Dictée").data["id"]

    assert [e["id"] for e in client.get(X).data["results"]] == [fr_id]               # pas les maths du collègue
    assert client.get(X + f"{ma_id}/").status_code == 404
    login(school["prof"])
    assert [e["id"] for e in client.get(X).data["results"]] == [ma_id]
    assert client.get(X + f"{fr_id}/").status_code == 404
    assert client.get(X + "?homework=1&from=2026-12-14").data["results"][0]["id"] == ma_id
    login(users["directeur"])
    assert {e["id"] for e in client.get(X).data["results"]} == {ma_id, fr_id}

    # Le remplaçant voit la séance qu'il a écrite ; le titulaire la voit aussi (c'est sa matière)
    Replacement.objects.create(school_class=school["c"], date="2026-12-13", slot=1, subject=Subject.objects.get(code="ma"),
                               teacher=Teacher.objects.get(user=school["hors"]))
    login(school["hors"])
    rep = entry(client, school, date="2026-12-13", content="Remplacement").data["id"]
    assert [e["id"] for e in client.get(X).data["results"]] == [rep]
    login(school["prof"])
    assert {e["id"] for e in client.get(X).data["results"]} == {ma_id, rep}


# ---------- Horaires propres à chaque école ----------
H = T + "horaires/"
SIX = {"creneaux": [{"debut": "08h00", "fin": "09h00"}, {"debut": "09h00", "fin": "10h00"}, {"debut": "10h15", "fin": "11h15"},
                    {"debut": "11h15", "fin": "12h15"}, {"debut": "13h00", "fin": "14h00"}, {"debut": "14h00", "fin": "15h00"}],
       "pauses": {"2": "Récréation", "4": "Déjeuner"}, "ouverts": [6, 6, 4, 6, 6, 0, 0]}   # pas de cours le samedi, mercredi matin


def test_default_horaires_are_the_original_ones(school, users, login, client):
    login(users["parent"])
    d = client.get(T).data
    assert d["ouverts"] == [8, 8, 5, 8, 8, 4, 0] and len(d["slots"]) == 8
    assert d["breaks"] == {"2": "Récréation · 09h30 à 09h45", "5": "Pause déjeuner · 12h45 à 14h30"} or d["breaks"] == {2: "Récréation · 09h30 à 09h45", 5: "Pause déjeuner · 12h45 à 14h30"}


def test_only_direction_and_secretariat_set_horaires(school, users, login, client):
    for r in ("enseignant", "parent", "comptable", "educateur", "informatique", "fondateur"):
        login(users[r])
        assert client.put(H, SIX, format="json").status_code == 403, r
    login(users["admin"])
    r = client.put(H, SIX, format="json")
    assert r.status_code == 200 and r.data["ouverts"] == [6, 6, 4, 6, 6, 0, 0]
    login(users["parent"])
    d = client.get(T).data
    assert d["ouverts"] == [6, 6, 4, 6, 6, 0, 0] and len(d["slots"]) == 6 and d["slots"][0] == {"start": "08h00", "end": "09h00"}
    assert str(d["breaks"].get("2") or d["breaks"].get(2)) == "Récréation · 09h00 à 10h15" or "Récréation" in str(d["breaks"])


@pytest.mark.parametrize("patch", [
    {"creneaux": []},
    {"creneaux": [{"debut": "8h", "fin": "09h00"}]},
    {"creneaux": [{"debut": "09h00", "fin": "08h00"}]},
    {"creneaux": [{"debut": "08h00", "fin": "09h00"}, {"debut": "08h30", "fin": "09h30"}]},
    {"ouverts": [6, 6]},
    {"ouverts": [7, 6, 4, 6, 6, 0]},
    {"ouverts": [0, 0, 0, 0, 0, 0, 0]},
    {"pauses": {"0": "x"}},
    {"pauses": {"9": "x"}},
])
def test_invalid_horaires_are_refused(school, users, login, client, patch):
    login(users["admin"])
    r = client.put(H, {**SIX, **patch}, format="json")
    assert r.status_code == 400 and r.data["detail"], patch


def test_generator_follows_school_horaires(school, users, login, client, make_user):
    full_assignments(make_user)
    login(users["admin"])
    assert client.put(H, SIX, format="json").status_code == 200
    r = client.post(T + "generate/")
    assert r.status_code == 200 and r.data["cells"] > 100
    rows = list(Cell.objects.all())
    assert rows and all(c.day != 5 and c.slot < SIX["ouverts"][c.day] for c in rows)         # rien le samedi, mercredi 4 créneaux
    assert all(c.slot <= 5 for c in rows)
    # un double (2 h) ne traverse jamais une pause : créneaux 1-2 (récréation) et 3-4 (déjeuner) ne sont pas appariés
    pairs = Horaires(SIX).pairs
    assert (1, 2) not in pairs and (3, 4) not in pairs and (0, 1) in pairs
    body = {"school_class": school["c"].pk, "day": 5, "slot": 0, "subject": Subject.objects.get(code="ma").pk, "room": "Salle 1"}
    assert client.put(T, body, format="json").status_code == 400                              # samedi fermé
    assert client.put(T, {**body, "day": 2, "slot": 4}, format="json").status_code == 400     # mercredi : 4 créneaux seulement


def test_horaires_change_protects_placed_courses(school, users, login, client):
    c, ma = school["c"], Subject.objects.get(code="ma")
    login(users["admin"])
    assert client.put(T, {"school_class": c.pk, "day": 0, "slot": 7, "subject": ma.pk, "room": "Salle 1"}, format="json").status_code == 200
    r = client.put(H, SIX, format="json")                                    # le créneau 7 n'existerait plus
    assert r.status_code == 400 and r.data["errors"]["code"] == "cours_invalides" and str(r.data["errors"]["invalides"]) == "1"
    assert Cell.objects.count() == 1 and client.get(H).data["ouverts"] == [8, 8, 5, 8, 8, 4, 0]   # rien n'a changé
    r = client.put(H, {**SIX, "retirer": True}, format="json")
    assert r.status_code == 200 and r.data["retires"] == 1 and Cell.objects.count() == 0


def test_sunday_can_be_opened_and_old_six_day_horaires_still_load(client, login, users):
    login(users["admin"])
    r = client.put(H, {**SIX, "ouverts": [6, 6, 4, 6, 6, 0, 3]}, format="json")
    assert r.status_code == 200 and r.data["ouverts"][6] == 3
    r = client.put(H, {**SIX, "ouverts": [6, 6, 4, 6, 6, 0]}, format="json")                 # ancien format : dimanche fermé
    assert r.status_code == 200 and r.data["ouverts"] == [6, 6, 4, 6, 6, 0, 0]


# ---------- Salles ----------
R = "/api/v1/rooms/"


def make_rooms(client, n=12, cap=50):
    for i in range(n):
        assert client.post(R, {"name": f"S{i + 1:02d}", "capacity": cap, "kind": "classe"}, format="json").status_code == 201
    client.post(R, {"name": "Labo A", "capacity": 30, "kind": "labo"}, format="json")
    client.post(R, {"name": "Stade", "capacity": 200, "kind": "sport"}, format="json")


def test_rooms_crud_and_rights(school, users, login, client):
    login(users["admin"])
    r = client.post(R, {"name": "A1", "capacity": 40, "kind": "classe"}, format="json")
    assert r.status_code == 201
    assert client.post(R, {"name": "a1", "capacity": 40, "kind": "classe"}, format="json").status_code == 400   # nom unique
    assert client.patch(f"{R}{r.data['id']}/", {"capacity": 35}, format="json").data["capacity"] == 35
    login(users["parent"])
    assert client.get(R).status_code == 200
    assert client.post(R, {"name": "B1", "capacity": 40, "kind": "classe"}, format="json").status_code == 403


def test_auto_assign_gives_each_class_its_own_room(school, users, login, client):
    login(users["admin"])
    make_rooms(client, n=3)
    r = client.post(R + "auto/")
    assert r.status_code == 200 and len(r.data["assigned"]) == 3 and r.data["left"]
    rooms = list(SchoolClass.objects.exclude(room=None).values_list("room_id", flat=True))
    assert len(rooms) == len(set(rooms)) == 3
    cl = SchoolClass.objects.filter(room=None).first()
    taken = SchoolClass.objects.exclude(room=None).first().room
    assert client.patch(f"/api/v1/classes/{cl.pk}/", {"room": taken.pk}, format="json").status_code == 400      # déjà prise


def test_generation_uses_class_rooms_labs_and_sport(school, users, login, client, make_user):
    full_assignments(make_user)
    login(users["admin"])
    make_rooms(client, n=SchoolClass.objects.count())
    r = client.post(T + "generate/")
    assert r.status_code == 200 and r.data["unplaced"] == 0
    names = set(Cell.objects.values_list("room", flat=True))
    assert names <= {x["name"] for x in client.get(R).data}                      # que des salles du catalogue
    assert "Stade" in names
    c = Cell.objects.filter(subject__code="ma").first()
    assert c.room == c.school_class.room.name
    seen = set()
    for x in Cell.objects.all():
        key = (x.room, x.day, x.slot)
        assert key not in seen
        seen.add(key)


def test_cell_room_must_be_in_catalogue_and_capacity_warns(school, users, login, client, make_user):
    full_assignments(make_user)
    login(users["admin"])
    cl = SchoolClass.objects.get(name="6e A")
    ma = Subject.objects.get(code="ma")
    body = {"school_class": cl.pk, "day": 0, "slot": 0, "subject": ma.pk, "room": "Salle libre"}
    assert client.put(T, body, format="json").status_code == 200                  # pas de catalogue : texte libre accepté
    client.post(R, {"name": "Petite", "capacity": 1, "kind": "classe"}, format="json")
    assert client.put(T, body, format="json").status_code == 400                  # catalogue non vide : salle inconnue refusée
    body["room"] = "Petite"
    r = client.put(T, body, format="json")
    assert r.status_code == 200, r.data
    assert (cl.students.filter(active=True).count() <= 1 or r.data["warnings"])


def test_rename_room_updates_cells_and_delete_asks_confirmation(school, users, login, client, make_user):
    full_assignments(make_user)
    login(users["admin"])
    rid = client.post(R, {"name": "Vieille", "capacity": 50, "kind": "classe"}, format="json").data["id"]
    cl = SchoolClass.objects.get(name="6e A")
    ma = Subject.objects.get(code="ma")
    client.put(T, {"school_class": cl.pk, "day": 1, "slot": 0, "subject": ma.pk, "room": "Vieille"}, format="json")
    client.patch(f"{R}{rid}/", {"name": "Neuve"}, format="json")
    assert Cell.objects.get(school_class=cl, day=1, slot=0).room == "Neuve"
    assert client.delete(f"{R}{rid}/").status_code == 400
    assert client.delete(f"{R}{rid}/?force=1").status_code == 204
