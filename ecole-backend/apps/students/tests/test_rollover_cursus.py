"""Passage d'année d'une école à plusieurs cursus : l'année est commune, le passage concerne toute l'école en une fois,
chaque élève selon les niveaux, classes et périodes de SON cursus."""
import pytest

from apps.academics.models import Cursus, Level, SchoolClass, SchoolYear, Term, bootstrap_cursus
from apps.core.tenancy import cursus_context
from apps.grades.models import Decision
from apps.students.models import Student

from .test_rollover import APPLY, PLAN, UNDO, world  # noqa: F401  (fixture)

pytestmark = pytest.mark.django_db


@pytest.fixture
def ar(world, users, login):  # noqa: F811
    users["directeur"].cursus.clear()            # le passage d'année est réservé à qui voit tous les cursus
    c = Cursus.objects.create(nom="Cursus arabe", langue="ar", ordre=1)
    bootstrap_cursus(c)
    with cursus_context(c):
        Level.objects.create(name="الأول", order=0)
        Level.objects.create(name="الثاني", order=1)
        k1 = SchoolClass.objects.create(name="6e A", level="الأول", groupe="الأول", cycle="college")     # même nom qu'une classe du cursus français
        k2 = SchoolClass.objects.create(name="5e A", level="الثاني", groupe="الثاني", cycle="college")
    adm = login(users["admin"])
    for k in ("t", "b"):          # DIALLO (Tle, ancien élève côté français) et BAH suivent aussi le cursus arabe, en 1re année
        assert adm.post(f"/api/v1/students/{world[k].pk}/cursus/", {"cursus": c.pk, "school_class": k1.pk}, format="json").status_code == 201
    second = {k: Student.all_objects.get(principal=world[k]) for k in ("t", "b")}
    Decision.objects.create(student=second["t"], year=world["year"], value="admis")
    Decision.objects.create(student=second["b"], year=world["year"], value="redouble")
    return {"cursus": c, "k1": k1, "k2": k2, **second}


def test_plan_covers_every_cursus_with_its_own_levels(ar, world, users, login):  # noqa: F811
    p = login(users["directeur"]).get(PLAN).json()
    rows = {r["student"]: r for r in p["rows"]}
    t2, b2 = rows[ar["t"].pk], rows[ar["b"].pk]
    assert t2["cursus_nom"] == "Cursus arabe" and t2["class_name"] == "Cursus arabe · 6e A"
    assert t2["action"] == "promote" and t2["target"] == ar["k2"].pk and t2["next_level"] == "الثاني"   # niveau suivant dans SON cursus
    assert b2["action"] == "repeat" and b2["target"] == ar["k1"].pk
    assert rows[world["a"].pk]["class_name"] == "Cursus français · 6e A"


def test_apply_moves_each_cursus_and_keeps_the_account_of_a_student_still_enrolled(ar, world, users, login):  # noqa: F811
    c = login(users["directeur"])
    p = c.get(PLAN).json()
    moves = [{"student": r["student"], "action": r["action"] or "leave", "class": r["target"]} for r in p["rows"]]
    wrong = [dict(m, **{"class": world["a"].school_class_id}) if m["student"] == ar["b"].pk else m for m in moves]   # classe du cursus français
    assert c.post(APPLY, {"moves": wrong}, format="json").status_code == 400
    r = c.post(APPLY, {"moves": moves}, format="json")
    assert r.status_code == 201, r.json()
    new = SchoolYear.get_current()
    assert Term.objects.filter(year=new, cursus=ar["cursus"]).count() == 3 and Term.objects.filter(year=new).count() == 6   # périodes de chaque cursus
    for k in ("t", "b"):
        ar[k].refresh_from_db()
        world[k].refresh_from_db()
    assert ar["t"].school_class_id == ar["k2"].pk and ar["b"].school_class_id == ar["k1"].pk
    assert world["t"].sortie == "ancien" and world["t"].user.is_active          # fini côté français, mais toujours élève côté arabe
    assert c.post(UNDO).status_code == 200
    ar["t"].refresh_from_db()
    assert ar["t"].school_class_id == ar["k1"].pk and Term.objects.filter(year=SchoolYear.get_current()).count() == 6
