import pytest

from apps.academics.models import SchoolClass, Subject, Teacher, TeachingAssignment
from apps.mockexams import calc
from apps.mockexams.models import MockMark
from apps.notifications.models import Notification
from apps.students.services import enroll_student

pytestmark = pytest.mark.django_db
U = "/api/v1/mock-exams/"


@pytest.fixture
def bepc(school, make_user):
    """Session BEPC blanc sur la 3e A avec 2 élèves ; coefficients réduits à maths (3) et français (1)."""
    c3 = SchoolClass.objects.get(name="3e A")
    kids = [enroll_student(nom=n, prenoms=p, sexe="M", naissance="2012-01-01", lieu="", school_class=c3, parent_name="P " + n, parent_phone=ph).student
            for n, p, ph in (("Zadi", "Eric", "0303030303"), ("Yao", "Paul", "0404040404"))]
    ma, fr = Subject.objects.get(code="ma"), Subject.objects.get(code="fr")
    TeachingAssignment.objects.update_or_create(school_class=c3, subject=ma, defaults={"teacher": Teacher.objects.get(user=school["prof"])})
    for k in kids:
        for u in (k.parent.user,):
            u.set_password("secret1"); u.save()
    return {**school, "c3": c3, "kids": kids, "ma": ma, "fr": fr}


def create(client, w, **kw):
    return client.post(U, {"name": "BEPC blanc n°1", "type": "BEPC", "start": "2026-11-30", "end": "2026-12-04", "classes": [w["c3"].pk],
                           "coefs": {"*": {"ma": 3, "fr": 1}}, **kw}, format="json")


def test_create_rules(bepc, users, login, client):
    for r in ("enseignant", "parent", "comptable", "educateur"):
        login(users[r])
        assert create(client, bepc).status_code == 403, r
    login(users["directeur"])
    assert create(client, bepc, classes=[bepc["c"].pk]).status_code == 400                 # 6e A n'est pas concernée par le BEPC
    assert create(client, bepc, end="2026-11-01").status_code == 400
    assert create(client, bepc, coefs={"*": {"zzz": 2}}).status_code == 400
    r = create(client, bepc)
    assert r.status_code == 201 and r.data["published"] is False
    assert Notification.objects.filter(user=bepc["prof"], text__contains="saisir vos notes").exists()
    r2 = client.post(U, {"name": "Défaut", "type": "BEPC", "start": "2026-11-30", "end": "2026-12-04", "classes": [bepc["c3"].pk]}, format="json")
    assert r2.status_code == 201 and r2.data["coefs"]["*"]["ma"] == 3                       # coefficients indicatifs par défaut


def put_marks(client, sid, w, subject, values):
    return client.put(U + f"{sid}/marks/", {"school_class": w["c3"].pk, "subject": subject.pk, "values": {str(k.pk): v for k, v in zip(w["kids"], values)}}, format="json")


def test_marks_and_results(bepc, users, login, client):
    login(users["directeur"])
    sid = create(client, bepc).data["id"]
    login(bepc["prof"])
    assert put_marks(client, sid, bepc, bepc["ma"], [14, 14]).status_code == 200
    assert put_marks(client, sid, bepc, bepc["fr"], [10, 10]).status_code == 403            # pas son français
    assert put_marks(client, sid, bepc, bepc["ma"], [21, 5]).status_code == 400
    res = client.get(U + f"{sid}/results/?class={bepc['c3'].pk}").data
    assert res["complete"] == 0 and all(r["avg"] is None for r in res["rows"])                # moyenne seulement si tout est noté
    login(users["admin"])                                                                      # le secrétariat peut compléter
    put_marks(client, sid, bepc, bepc["fr"], [10, 10])
    res = client.get(U + f"{sid}/results/?class={bepc['c3'].pk}").data
    assert [r["avg"] for r in res["rows"]] == [13.0, 13.0]                                      # (14×3 + 10×1) / 4
    assert {r["rank"] for r in res["rows"]} == {1} and res["admis"] == 2 and res["rate"] == 100 and res["rows"][0]["mention"] == "Assez bien"
    put_marks(client, sid, bepc, bepc["ma"], [4, 4.5])
    res = client.get(U + f"{sid}/results/?class={bepc['c3'].pk}").data
    assert res["admis"] == 0 and sorted(r["avg"] for r in res["rows"]) == [5.5, 5.88]


def test_rounding_and_rank(bepc, users, login, client):
    login(users["directeur"])
    sid = create(client, bepc, coefs={"*": {"ma": 3, "fr": 2}}).data["id"]
    login(users["admin"])
    put_marks(client, sid, bepc, bepc["ma"], [12.5, 9])
    put_marks(client, sid, bepc, bepc["fr"], [11.25, 10.3])
    rows = {r["student"]: r for r in client.get(U + f"{sid}/results/?class={bepc['c3'].pk}").data["rows"]}
    z, y = rows[bepc["kids"][0].pk], rows[bepc["kids"][1].pk]
    assert z["avg"] == 12.0 and y["avg"] == 9.52 and (z["rank"], y["rank"]) == (1, 2) and y["admissible"] is False


def test_publish_locks_marks_and_family_view(bepc, users, login, client):
    login(users["directeur"])
    sid = create(client, bepc).data["id"]
    login(users["admin"])
    put_marks(client, sid, bepc, bepc["ma"], [15, 8])
    put_marks(client, sid, bepc, bepc["fr"], [15, 8])
    parent = bepc["kids"][0].parent.user
    login(parent)
    assert client.get(U).data == []                                                           # brouillon : invisible
    assert client.get(U + f"{sid}/results/?class={bepc['c3'].pk}").status_code == 404
    login(bepc["prof"])
    assert client.post(U + f"{sid}/publish/", {"published": True}, format="json").status_code == 403
    login(users["admin"])
    assert client.post(U + f"{sid}/publish/", {"published": True}, format="json").data["published"] is True
    assert Notification.objects.filter(user=parent, text__contains="résultats").exists()
    assert put_marks(client, sid, bepc, bepc["ma"], [16, 8]).status_code == 400              # verrouillé après publication
    login(parent)
    assert len(client.get(U).data) == 1
    res = client.get(U + f"{sid}/results/?class={bepc['c3'].pk}").data
    assert [r["student"] for r in res["rows"]] == [bepc["kids"][0].pk]                        # seulement son enfant
    assert res["effectif"] == 2 and res["avg"] == 11.5                                        # mais les statistiques de classe
    login(bepc["kids"][1].parent.user)
    assert [r["student"] for r in client.get(U + f"{sid}/results/?class={bepc['c3'].pk}").data["rows"]] == [bepc["kids"][1].pk]
    login(users["admin"])
    client.post(U + f"{sid}/publish/", {"published": False}, format="json")
    assert put_marks(client, sid, bepc, bepc["ma"], [16, 8]).status_code == 200
    assert MockMark.objects.get(student=bepc["kids"][0], subject=bepc["ma"]).value == 16


def test_scope_for_teachers(bepc, users, login, client):
    login(users["directeur"])
    sid = create(client, bepc).data["id"]
    login(bepc["prof"])
    assert len(client.get(U).data) == 1
    d = client.get(U + f"{sid}/").data
    assert any(p["subject"] == bepc["ma"].pk and p["total"] == 2 and p["done"] == 0 for p in d["progress"])
    login(bepc["hors"])
    assert client.get(U).data == [] and client.get(U + f"{sid}/").status_code == 404
    login(users["comptable"])
    assert client.get(U).data == []


def test_bac_columns_by_serie():
    from types import SimpleNamespace
    bac = SimpleNamespace(levels=["Tle"])
    assert calc.column_of(True, SimpleNamespace(serie="D")) == "D" and calc.column_of(False, SimpleNamespace(serie="")) == "*"
    assert calc.eligible(bac, SimpleNamespace(level="Tle")) and not calc.eligible(bac, SimpleNamespace(level="1ère"))
    assert calc.eligible(None, SimpleNamespace(level="6e"))                                      # « Autre examen » : toutes les classes


# ---------- Examen défini par l'école (type « Autre ») ----------
def test_free_exam_type_any_class_own_name_and_coefs(bepc, users, login, client):
    c6 = bepc["c"]                                                   # 6e A : jamais éligible au BEPC ni au BAC
    login(users["directeur"])
    body = {"name": "Composition de Noël", "type": "AUTRE", "start": "2026-12-07", "end": "2026-12-11", "classes": [c6.pk, bepc["c3"].pk]}
    assert client.post(U, body, format="json").status_code == 400                               # coefficients obligatoires
    assert client.post(U, {**body, "coefs": {"*": {"zzz": 2}}}, format="json").status_code == 400
    assert client.post(U, {**body, "classes": [], "coefs": {"*": {"ma": 2}}}, format="json").status_code == 400
    r = client.post(U, {**body, "coefs": {"*": {"ma": 2, "fr": 1}}}, format="json")
    assert r.status_code == 201 and r.data["type"] == "AUTRE" and r.data["name"] == "Composition de Noël"
    sess = r.data["id"]
    res = client.get(U + f"{sess}/results/?class={c6.pk}")
    assert res.status_code == 200 and [s["code"] for s in res.data["subjects"]] == ["ma", "fr"]   # tri par coefficient décroissant


def test_free_exam_per_serie_column_with_fallback(bepc, users, login, client):
    """Colonnes par série si l'école en prévoit, sinon colonne commune."""
    from apps.academics.models import SchoolClass
    tc = SchoolClass.objects.filter(level="Tle", serie="C").first()
    if tc is None:
        pytest.skip("pas de Tle C dans le jeu de test")
    from types import SimpleNamespace
    assert calc.column_of(False, tc, {"C": {"ma": 1}, "*": {"fr": 1}}) == "C"
    assert calc.column_of(False, tc, {"*": {"fr": 1}}) == "*"
    assert calc.column_of(False, tc) == "*" and calc.eligible(None, tc) and not calc.eligible(SimpleNamespace(levels=["3e"]), tc)


# ---------- Types d'examen définis par l'école (BEPC, BAC, DEF, CEP…) ----------
T = "/api/v1/mock-exam-types/"


def test_school_defines_its_exam_types(bepc, users, login, client):
    """Une école malienne ou burkinabè saisit ses examens : nom, niveaux, coefficients ; les sessions s'en servent."""
    from apps.mockexams.models import ExamType
    login(users["enseignant"])
    assert sorted(x["name"] for x in client.get(T).data) == ["BAC", "BEPC"]                    # créés avec l'école
    assert client.post(T, {"name": "DEF", "levels": ["3e"], "coefs": {"*": {"fr": 2}}}, format="json").status_code == 403
    login(users["admin"])
    assert client.post(T, {"name": "bepc", "levels": ["3e"]}, format="json").status_code == 400  # doublon
    assert client.post(T, {"name": "DEF", "levels": []}, format="json").status_code == 400       # un niveau au moins
    assert client.post(T, {"name": "DEF", "levels": ["3e"], "coefs": {"*": {"zzz": 2}}}, format="json").status_code == 400
    r = client.post(T, {"name": "  DEF ", "levels": ["3e"], "per_serie": False, "coefs": {"*": {"fr": 4, "ma": 3, "an": 0}}}, format="json")
    assert r.status_code == 201 and r.data["name"] == "DEF" and r.data["coefs"] == {"*": {"fr": 4, "ma": 3}}
    did = r.data["id"]
    # session sur le DEF : classes du niveau, coefficients saisis sur le type repris par défaut
    body = {"name": "DEF blanc n°1", "type": "DEF", "start": "2026-11-30", "end": "2026-12-04", "classes": [bepc["c3"].pk]}
    assert client.post(U, {**body, "classes": [bepc["c"].pk]}, format="json").status_code == 400  # 6e A non concernée
    r = client.post(U, body, format="json")
    assert r.status_code == 201 and r.data["exam_type"] == did and r.data["type"] == "DEF" and r.data["coefs"] == {"*": {"fr": 4, "ma": 3}}
    assert client.post(U, {**body, "exam_type": did, "type": None}, format="json").status_code == 201
    assert client.post(U, {**body, "type": "CEPE"}, format="json").status_code == 400            # examen inconnu
    # renommé et coefficients changés : les sessions existantes gardent les leurs
    assert client.patch(f"{T}{did}/", {"name": "DEF (9e année)", "coefs": {"*": {"fr": 1}}}, format="json").status_code == 200
    s = client.get(U + f"{r.data['id']}/").data
    assert s["type"] == "DEF" and s["coefs"] == {"*": {"fr": 4, "ma": 3}}
    # utilisé : on ne le retire pas, on le masque
    assert client.delete(f"{T}{did}/").status_code == 400
    assert client.patch(f"{T}{did}/", {"active": False}, format="json").data["active"] is False
    # inutilisé : retiré
    cep = client.post(T, {"name": "CEP", "levels": ["6e"], "coefs": {"*": {"fr": 1}}}, format="json").data
    assert client.delete(f"{T}{cep['id']}/").status_code == 204 and not ExamType.objects.filter(name="CEP").exists()


def test_exam_type_per_serie_needs_each_serie_column(bepc, users, login, client):
    """Examen par série : chaque série des classes choisies doit avoir ses coefficients (saisis sur la session ou le type)."""
    from apps.academics.models import SchoolClass
    tles = list(SchoolClass.objects.filter(level="Tle"))
    if not tles:
        pytest.skip("pas de Terminale dans le jeu de test")
    login(users["directeur"])
    et = client.post(T, {"name": "BAC malien", "levels": ["Tle"], "per_serie": True, "coefs": {}}, format="json").data
    body = {"name": "BAC blanc", "exam_type": et["id"], "start": "2026-11-30", "end": "2026-12-04", "classes": [c.pk for c in tles]}
    r = client.post(U, body, format="json")
    assert r.status_code == 400 and "série" in str(r.data), r.data
    r = client.post(U, {**body, "coefs": {c.serie: {"ma": 2} for c in tles}}, format="json")
    assert r.status_code == 201 and r.data["per_serie"] is True
