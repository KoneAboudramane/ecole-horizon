import pytest

from apps.academics.models import Coefficient, SchoolClass, Subject, Teacher, TeachingAssignment, groupe_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def base(db):
    from django.core.management import call_command
    call_command("seed_school")


def test_groupe_for():
    assert groupe_for("6e") == "6e" and groupe_for("5e") == "5e" and groupe_for("3e") == "3e" and groupe_for("Tle", "d") == "Tle D"
    assert groupe_for("9e") == "9e" and groupe_for("10e", "tse") == "10e TSE"           # niveaux propres à l'école
    with pytest.raises(ValueError):
        groupe_for("", "A")


def test_seed_idempotent(base):
    from django.core.management import call_command
    call_command("seed_school")
    assert SchoolClass.objects.count() == 14 and Subject.objects.count() == 11


def test_requires_login(client, base):
    assert client.get("/api/v1/classes/").status_code == 401


def test_everyone_reads_classes_but_only_secretariat_writes(users, login, client, base):
    login(users["enseignant"])
    assert client.get("/api/v1/classes/").status_code == 200
    r = client.post("/api/v1/classes/", {"name": "6e C", "level": "6e", "max_students": 40}, format="json")
    assert r.status_code == 403
    login(users["admin"])
    r = client.post("/api/v1/classes/", {"name": "6e C", "level": "6e", "max_students": 40}, format="json")
    assert r.status_code == 201 and r.data["groupe"] == "6e" and r.data["cycle"] == "college"
    r = client.post("/api/v1/classes/", {"name": "1ère B", "level": "1ère", "serie": "B", "max_students": 40}, format="json")
    assert r.status_code == 400
    r = client.post("/api/v1/classes/", {"name": "Tle X", "level": "Tle", "max_students": 40}, format="json")
    assert r.status_code == 400
    r = client.post("/api/v1/classes/", {"name": "6e C", "level": "6e", "max_students": 40}, format="json")
    assert r.status_code == 400  # nom déjà pris


def test_class_with_students_cannot_be_deleted(users, login, client, base):
    from apps.students.services import enroll_student
    c = SchoolClass.objects.get(name="6e A")
    enroll_student(nom="X", prenoms="Y", sexe="M", naissance="2014-01-01", lieu="", school_class=c, parent_name="P", parent_phone="01 02 03 04 05")
    login(users["admin"])
    assert client.delete(f"/api/v1/classes/{c.pk}/").status_code == 400
    assert client.delete(f"/api/v1/classes/{SchoolClass.objects.get(name='6e B').pk}/").status_code == 204


def test_coefficient_set_and_remove(users, login, client, base):
    ma = Subject.objects.get(code="ma")
    login(users["enseignant"])
    assert client.put("/api/v1/coefficients/", {"groupe": "6e", "subject": ma.pk, "value": 5}, format="json").status_code == 403
    login(users["admin"])
    assert client.put("/api/v1/coefficients/", {"groupe": "6e", "subject": ma.pk, "value": 5}, format="json").status_code == 200
    assert Coefficient.objects.get(groupe="6e", subject=ma).value == 5
    assert Coefficient.objects.get(groupe="5e", subject=ma).value == 4          # la 5e garde ses propres coefficients
    client.put("/api/v1/coefficients/", {"groupe": "6e", "subject": ma.pk, "value": 0}, format="json")
    assert not Coefficient.objects.filter(groupe="6e", subject=ma).exists()
    assert client.put("/api/v1/coefficients/", {"groupe": "c1", "subject": ma.pk, "value": 5}, format="json").status_code == 400   # ancien groupe
    assert client.put("/api/v1/coefficients/", {"groupe": "Tle E", "subject": ma.pk, "value": 5}, format="json").status_code == 400  # série inexistante


def test_school_manages_its_lycee_series(users, login, client, base):
    """L'école ajoute, renomme et retire ses séries ; une série utilisée par une classe ne se retire pas."""
    from apps.academics.models import Serie
    S = "/api/v1/series/"
    login(users["enseignant"])
    assert len(client.get(S).data) == 8                                         # 2nde A, C ; 1ère et Tle A, C, D
    assert client.post(S, {"level": "Tle", "code": "E"}, format="json").status_code == 403
    login(users["admin"])
    r = client.post(S, {"level": "Tle", "code": "e", "name": "Mathématiques et technique", "copy_from": "Tle C"}, format="json")
    assert r.status_code == 201 and r.data["groupe"] == "Tle E"
    assert Coefficient.objects.filter(groupe="Tle E").count() == Coefficient.objects.filter(groupe="Tle C").count() > 0
    assert client.post(S, {"level": "Tle", "code": "E"}, format="json").status_code == 400          # doublon
    assert client.post(S, {"level": "Tle", "code": "1A"}, format="json").status_code == 400         # code invalide
    assert client.post(S, {"level": "4e", "code": "A"}, format="json").status_code == 400           # pas de série au collège
    # une classe peut maintenant être créée en Tle E ; ses coefficients sont ceux de la série
    r = client.post("/api/v1/classes/", {"name": "Tle E", "level": "Tle", "serie": "E", "max_students": 40}, format="json")
    assert r.status_code == 201 and r.data["groupe"] == "Tle E"
    e = Serie.objects.get(level="Tle", code="E")
    # utilisée : le code ne change plus, le nom si ; elle ne se retire pas
    assert client.patch(f"{S}{e.pk}/", {"code": "F"}, format="json").status_code == 400
    assert client.patch(f"{S}{e.pk}/", {"name": "Technique"}, format="json").data["name"] == "Technique"
    r = client.delete(f"{S}{e.pk}/")
    assert r.status_code == 400 and "Tle E" in str(r.data)
    # inutilisée : on la renomme (coefficients suivis), puis on la retire (coefficients effacés)
    a1 = client.post(S, {"level": "1ère", "code": "A1"}, format="json").data
    client.put("/api/v1/coefficients/", {"groupe": "1ère A1", "subject": Subject.objects.get(code="fr").pk, "value": 5}, format="json")
    assert client.patch(f"{S}{a1['id']}/", {"code": "A2"}, format="json").data["groupe"] == "1ère A2"
    assert Coefficient.objects.filter(groupe="1ère A2").count() == 1 and not Coefficient.objects.filter(groupe="1ère A1").exists()
    assert client.delete(f"{S}{a1['id']}/").status_code == 204
    assert not Coefficient.objects.filter(groupe="1ère A2").exists()


def test_teacher_profile_created_with_account(make_user):
    u = make_user("enseignant", "prof1")
    assert Teacher.objects.filter(user=u).exists()
    make_user("parent", "p1")
    assert Teacher.objects.count() == 1


def test_assignment_replace_and_remove(users, make_user, login, client, base):
    t1, t2 = Teacher.objects.get(user=users["enseignant"]), Teacher.objects.get(user=make_user("enseignant", "prof2"))
    c, ma = SchoolClass.objects.get(name="6e A"), Subject.objects.get(code="ma")
    login(users["admin"])
    body = {"school_class": c.pk, "subject": ma.pk}
    assert client.put("/api/v1/assignments/", {**body, "teacher": t1.pk}, format="json").status_code == 200
    assert client.put("/api/v1/assignments/", {**body, "teacher": t2.pk}, format="json").status_code == 200
    assert TeachingAssignment.objects.get(school_class=c, subject=ma).teacher == t2
    assert client.put("/api/v1/assignments/", {**body, "teacher": None}, format="json").status_code == 204
    assert not TeachingAssignment.objects.filter(school_class=c, subject=ma).exists()
    # matière absente du groupe (philo en 6e) → refusé
    ph = Subject.objects.get(code="ph")
    assert client.put("/api/v1/assignments/", {"school_class": c.pk, "subject": ph.pk, "teacher": t1.pk}, format="json").status_code == 400


def test_term_lock_only_direction(users, login, client, base):
    from apps.academics.models import Term
    t = Term.objects.get(code="T1")
    login(users["admin"])
    assert client.post(f"/api/v1/terms/{t.pk}/lock/", {"locked": True}, format="json").status_code == 403
    login(users["directeur"])
    assert client.post(f"/api/v1/terms/{t.pk}/lock/", {"locked": True}, format="json").data["locked"] is True


def _periodes(client, rows):
    return client.put("/api/v1/calendar/periodes/", {"periodes": rows}, format="json")


def test_school_chooses_semesters_and_keeps_notes(users, login, client, school):
    from apps.academics.models import SchoolYear
    login(users["directeur"])
    y = SchoolYear.get_current()
    t1 = y.terms.get(code="T1")
    sem = [{"label": "1er semestre", "start": "2026-09-07", "end": "2027-01-29"}, {"label": "2e semestre", "start": "2027-02-01", "end": "2027-06-30"}]
    r = _periodes(client, sem)
    assert r.status_code == 200 and [t["label"] for t in r.data] == ["1er semestre", "2e semestre"]
    assert y.terms.count() == 2 and y.terms.get(code="T1").pk == t1.pk                    # la première période garde son identité
    assert client.get("/api/v1/calendar/").data["terms"][1]["label"] == "2e semestre"
    # quatre périodes : les nouvelles reçoivent un code libre, l'ordre suit les dates
    four = [{"label": "P1", "start": "2026-09-07", "end": "2026-11-15"}, {"label": "P2", "start": "2026-11-16", "end": "2027-01-20"},
            {"label": "P3", "start": "2027-01-21", "end": "2027-04-01"}, {"label": "P4", "start": "2027-04-02", "end": "2027-06-30"}]
    r = _periodes(client, four)
    assert r.status_code == 200 and [t["label"] for t in r.data] == ["P1", "P2", "P3", "P4"] and len({t["code"] for t in r.data}) == 4


@pytest.mark.parametrize("rows", [
    [], "x",
    [{"label": "", "start": "2026-09-07", "end": "2026-12-01"}],
    [{"label": "A", "start": "2026-12-01", "end": "2026-09-07"}],
    [{"label": "A", "start": "2026-09-07", "end": "2026-12-01"}, {"label": "B", "start": "2026-11-01", "end": "2027-02-01"}],
    [{"label": "A", "start": "2026-09-07", "end": "2026-12-01"}, {"label": "a", "start": "2027-01-01", "end": "2027-02-01"}],
    [{"label": "A", "start": "n'importe quoi", "end": "2026-12-01"}],
])
def test_invalid_periods_are_refused(users, login, client, school, rows):
    login(users["directeur"])
    assert _periodes(client, rows).status_code == 400


def test_period_with_evaluations_cannot_be_removed(users, login, client, school):
    from apps.academics.models import SchoolYear
    from apps.grades.models import Evaluation
    login(users["directeur"])
    y = SchoolYear.get_current()
    two = [{"label": "S1", "start": "2026-09-07", "end": "2027-01-29"}, {"label": "S2", "start": "2027-02-01", "end": "2027-06-30"}]
    Evaluation.objects.create(school_class=SchoolClass.objects.get(name="6e A"), subject=Subject.objects.get(code="ma"), term=y.terms.get(code="T3"),
                              type="devoir", title="Devoir", date="2027-04-20")
    r = _periodes(client, two)
    assert r.status_code == 400 and "déjà des évaluations" in r.data["detail"] and y.terms.count() == 3
    Evaluation.objects.all().delete()
    assert _periodes(client, two).status_code == 200 and y.terms.count() == 2


def test_only_direction_and_secretariat_set_periods(users, login, client, school):
    row = [{"label": "S1", "start": "2026-09-07", "end": "2027-06-30"}]
    for role in ("enseignant", "parent", "comptable", "educateur"):
        login(users[role])
        assert _periodes(client, row).status_code == 403, role
    login(users["admin"])
    assert _periodes(client, row).status_code == 200


def test_school_manages_its_levels_like_a_malian_school(users, login, client, base):
    """Une école malienne saisit ses niveaux (7e, 8e, 9e, 10e…), leur ordre, leur cycle et leurs séries."""
    from apps.academics.models import Level, Serie, level_names, next_level
    from apps.finance.models import Tarif
    L = "/api/v1/levels/"
    login(users["enseignant"])
    assert [x["name"] for x in client.get(L).data] == ["6e", "5e", "4e", "3e", "2nde", "1ère", "Tle"]
    assert client.post(L, {"name": "9e", "cycle": "college"}, format="json").status_code == 403
    login(users["admin"])
    # ajout après la 3e, au collège ; puis un niveau à séries au lycée
    r = client.post(L, {"name": "9e", "cycle": "college", "after": "3e"}, format="json")
    assert r.status_code == 201 and level_names()[4] == "9e"
    assert client.post(L, {"name": "9E", "cycle": "college"}, format="json").status_code == 400            # doublon
    ten = client.post(L, {"name": "10e", "cycle": "lycee", "has_series": True, "after": "9e"}, format="json").data
    assert next_level("3e") == "9e" and next_level("9e") == "10e" and next_level("Tle") is None
    # séries sur un niveau à séries seulement
    assert client.post("/api/v1/series/", {"level": "9e", "code": "A"}, format="json").status_code == 400
    assert client.post("/api/v1/series/", {"level": "10e", "code": "TSE"}, format="json").status_code == 201
    # classes : 9e sans série, 10e avec une série de l'école
    r = client.post("/api/v1/classes/", {"name": "9e A", "level": "9e", "max_students": 40}, format="json")
    assert r.status_code == 201 and r.data["groupe"] == "9e" and r.data["cycle"] == "college"
    assert client.post("/api/v1/classes/", {"name": "10e X", "level": "10e", "max_students": 40}, format="json").status_code == 400
    r = client.post("/api/v1/classes/", {"name": "10e TSE", "level": "10e", "serie": "tse", "max_students": 40}, format="json")
    assert r.status_code == 201 and r.data["groupe"] == "10e TSE" and r.data["cycle"] == "lycee"
    assert client.post("/api/v1/classes/", {"name": "11e", "level": "11e", "max_students": 40}, format="json").status_code == 400
    # coefficients et tarif du nouveau niveau
    ma = Subject.objects.get(code="ma")
    assert client.put("/api/v1/coefficients/", {"groupe": "9e", "subject": ma.pk, "value": 3}, format="json").status_code == 200
    assert client.put("/api/v1/coefficients/", {"groupe": "10e TSE", "subject": ma.pk, "value": 5}, format="json").status_code == 200
    login(users["fondateur"])                                                                     # les tarifs : la direction générale
    r = client.put("/api/v1/finance/tarifs/", {"level": "9e", "ins": 10000, "sco": 90000}, format="json")
    assert r.status_code in (200, 201), r.data
    login(users["admin"])
    # niveau utilisé : ni renommé, ni retiré, ni privé de séries ; son cycle peut changer
    nine = Level.objects.get(name="9e")
    assert client.patch(f"{L}{nine.pk}/", {"name": "9e année"}, format="json").status_code == 400
    assert client.delete(f"{L}{nine.pk}/").status_code == 400
    assert client.patch(f"{L}{ten['id']}/", {"has_series": False}, format="json").status_code == 400
    assert client.patch(f"{L}{nine.pk}/", {"cycle": "lycee"}, format="json").status_code == 200
    assert SchoolClass.objects.get(name="9e A").cycle == "lycee"
    # ordre du cursus
    names = level_names()
    assert client.post(f"{L}order/", {"names": names[:-1]}, format="json").status_code == 400
    new = ["6e", "5e", "4e", "3e", "9e", "10e", "2nde", "1ère", "Tle"]
    assert client.post(f"{L}order/", {"names": new}, format="json").status_code == 200 and level_names() == new
    # niveau inutilisé : renommé (séries et coefficients suivent), puis retiré
    eleven = client.post(L, {"name": "11e", "cycle": "lycee", "has_series": True}, format="json").data
    client.post("/api/v1/series/", {"level": "11e", "code": "TLL"}, format="json")
    client.put("/api/v1/coefficients/", {"groupe": "11e TLL", "subject": ma.pk, "value": 2}, format="json")
    r = client.patch(f"{L}{eleven['id']}/", {"name": "11e année"}, format="json")
    assert r.status_code == 200 and Serie.objects.filter(level="11e année", code="TLL").exists()
    assert Coefficient.objects.filter(groupe="11e année TLL").exists()
    assert client.delete(f"{L}{eleven['id']}/").status_code == 204
    assert not Serie.objects.filter(level="11e année").exists() and not Coefficient.objects.filter(groupe="11e année TLL").exists()
    assert Tarif.objects.filter(level="9e").exists()
