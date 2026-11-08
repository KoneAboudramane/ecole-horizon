"""Périmètre de cursus des comptes (école à plusieurs cursus) : fondateur, secrétariat, comptable, informatique voient tous
les cursus ; directeur, éducateur et rôles créés par l'école, un seul par défaut ; l'enseignant, ceux de ses classes.
Personne ne donne un périmètre plus large que le sien ; le passage d'année est réservé à qui voit tous les cursus."""
import pytest

from apps.academics.models import Cursus, Level, SchoolClass, Subject, Teacher, TeachingAssignment, bootstrap_cursus
from apps.core.tenancy import cursus_context

pytestmark = pytest.mark.django_db
U = "/api/v1/users/"


@pytest.fixture
def two(school, users):
    fr = Cursus.objects.get()
    ar = Cursus.objects.create(nom="Cursus arabe", langue="ar", ordre=1)
    bootstrap_cursus(ar)
    with cursus_context(ar):
        Level.objects.create(name="الأول", order=0)
        k = SchoolClass.objects.create(name="الأول أ", level="الأول", groupe="الأول", cycle="college")
        sub = Subject.objects.create(code="qr", name="القرآن", short="قرآن")
    return {"fr": fr, "ar": ar, "k": k, "sub": sub}


def names(c, **h):
    return [x["nom"] for x in c.get("/api/v1/cursus/", **h).json()]


def test_defaults_by_role(two, users, login):
    # le directeur existant travaille dans le cursus français ; secrétariat, comptable, fondateur voient tout
    assert names(login(users["directeur"])) == ["Cursus français"]
    for r in ("admin", "comptable", "fondateur"):
        assert names(login(users[r])) == ["Cursus français", "Cursus arabe"], r


def test_restricted_director_always_works_in_its_cursus(two, users, login):
    c = login(users["directeur"])
    classes = [x["name"] for x in c.get("/api/v1/classes/", HTTP_X_CURSUS=str(two["ar"].pk)).json()]   # demande refusée : cursus hors périmètre
    assert "الأول أ" not in classes and "6e A" in classes
    assert "الأول أ" not in [x["name"] for x in c.get("/api/v1/classes/").json()]                       # sans en-tête : son cursus, pas toute l'école


def test_teacher_sees_the_cursus_of_its_classes(two, users, login):
    t = Teacher.objects.get(user=users["enseignant"])
    TeachingAssignment.objects.create(teacher=t, subject=two["sub"], school_class=two["k"])
    assert names(login(users["enseignant"])) == ["Cursus arabe"]                                   # ses seules classes sont arabes
    TeachingAssignment.objects.create(teacher=t, subject=Subject.objects.filter(cursus=two["fr"]).first(), school_class=SchoolClass.objects.get(name="6e B"))
    assert names(login(users["enseignant"])) == ["Cursus français", "Cursus arabe"]


def test_account_created_in_a_cursus_and_scope_rules(two, users, login):
    adm = login(users["admin"])
    h = {"HTTP_X_CURSUS": str(two["ar"].pk)}
    r = adm.post(U, {"name": "M. Haidara", "role": "directeur", "username": "dir.arabe", "email": "dir.ar@ecole.test"}, format="json", **h)
    assert r.status_code == 201 and r.json()["user"]["cursus"] == [two["ar"].pk]                 # directeur : le cursus où on le crée
    r = adm.post(U, {"name": "Mme Compta", "role": "comptable", "username": "compta2", "email": "c2@ecole.test"}, format="json", **h)
    assert r.json()["user"]["cursus"] == []                                                          # comptable : tous les cursus
    # le directeur du cursus arabe (droit « comptes ») ne donne pas plus que son périmètre et ne gère pas le cursus français
    from apps.accounts.models import Role, User
    dar = User.objects.get(username="dir.arabe")
    role = Role.objects.get(key="directeur")
    role.perms = sorted({*role.perms, "accounts"}); role.save()
    dar.set_password("secret1"); dar.must_change_password = False; dar.save()
    d = login(dar)
    assert names(d) == ["Cursus arabe"]
    assert d.post(U, {"name": "X", "role": "educateur", "username": "edu.x", "email": "x@ecole.test", "cursus": []}, format="json").status_code == 400
    assert d.post(U, {"name": "Y", "role": "educateur", "username": "edu.y", "email": "y@ecole.test"}, format="json").json()["user"]["cursus"] == [two["ar"].pk]
    assert d.post(f"{U}{users['directeur'].pk}/toggle-active/").status_code in (403, 404)
    assert users["directeur"].pk not in [u["id"] for u in d.get(U).json()["results"]]
    r = login(users["admin"]).patch(f"{U}{dar.pk}/", {"cursus": []}, format="json")
    assert r.status_code == 200, r.json()                                                            # le secrétariat élargit son périmètre
    assert names(login(dar)) == ["Cursus français", "Cursus arabe"]


def test_school_wide_passage_is_for_all_cursus_accounts(two, users, login):
    assert login(users["directeur"]).get("/api/v1/rollover/plan/").status_code == 403              # directeur du seul cursus français
    users["directeur"].cursus.clear()
    assert login(users["directeur"]).get("/api/v1/rollover/plan/").status_code == 200
