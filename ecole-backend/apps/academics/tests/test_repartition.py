import pytest

from apps.academics.models import Coefficient, SchoolClass, Subject, Teacher, TeachingAssignment

pytestmark = pytest.mark.django_db
U = "/api/v1/assignments/repartition/"


def math_teachers(make_user, n=3):
    TeachingAssignment.objects.all().delete()                                          # on part d'une école sans affectation
    ma = Subject.objects.get(code="ma")
    out = []
    for i in range(n):
        t = Teacher.objects.get(user=make_user("enseignant", f"maths{i}"))
        t.subjects.add(ma)
        out.append(t)
    return ma, out


def test_distribution_spreads_classes_between_teachers_of_same_subject(school, users, login, client, make_user):
    ma, ts = math_teachers(make_user)
    login(users["admin"])
    r = client.post(U, {"subjects": [ma.pk]}, format="json")
    assert r.status_code == 200 and not r.data["committed"] and not TeachingAssignment.objects.exists()
    n = Coefficient.objects.filter(subject=ma).count() and SchoolClass.objects.filter(groupe__in=Coefficient.objects.filter(subject=ma).values("groupe")).count()
    assert len(r.data["assignments"]) == n and not r.data["missing"]
    per = {}
    for a in r.data["assignments"]:
        per[a["teacher"]] = per.get(a["teacher"], 0) + 1
    assert len(per) == 3 and max(per.values()) - min(per.values()) <= 2                  # charge équilibrée
    r = client.post(U, {"subjects": [ma.pk], "commit": True}, format="json")
    assert TeachingAssignment.objects.filter(subject=ma).count() == n


def test_max_hours_and_missing_teacher(school, users, login, client, make_user):
    ma, ts = math_teachers(make_user, 1)
    ts[0].max_hours = 8
    ts[0].save()
    login(users["admin"])
    r = client.post(U, {"subjects": [ma.pk]}, format="json")
    assert sum(a["hours"] for a in r.data["assignments"]) <= 8
    assert r.data["missing"] and all(m["why"] == "max_heures" for m in r.data["missing"])
    ph = Subject.objects.get(code="ph")
    r = client.post(U, {"subjects": [ph.pk]}, format="json")                              # personne n'enseigne cette matière
    assert r.data["missing"] and all(m["why"] == "aucun_enseignant" for m in r.data["missing"])


def test_existing_assignments_are_kept_unless_reset(school, users, login, client, make_user):
    ma, ts = math_teachers(make_user)
    cl = SchoolClass.objects.get(name="6e A")
    TeachingAssignment.objects.create(school_class=cl, subject=ma, teacher=ts[2])
    login(users["admin"])
    client.post(U, {"subjects": [ma.pk], "commit": True}, format="json")
    assert TeachingAssignment.objects.get(school_class=cl, subject=ma).teacher_id == ts[2].pk
    client.post(U, {"subjects": [ma.pk], "commit": True, "reset": True}, format="json")
    assert TeachingAssignment.objects.filter(subject=ma).count() > 1


def test_loads_overview_and_rights(school, users, login, client, make_user):
    ma, ts = math_teachers(make_user)
    login(users["admin"])
    client.post(U, {"subjects": [ma.pk], "commit": True}, format="json")
    r = client.get(U)
    m = next(s for s in r.data["subjects"] if s["id"] == ma.pk)
    assert m["teachers"] == 3 and all(c["teacher"] for c in m["classes"])
    assert sum(t["hours"] for t in r.data["teachers"]) == sum(c["hours"] for c in m["classes"])
    assert client.patch(f"/api/v1/teachers/{ts[0].pk}/", {"max_hours": 18}, format="json").data["max_hours"] == 18
    login(users["parent"])
    assert client.get(U).status_code == 403
