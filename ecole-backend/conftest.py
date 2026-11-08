import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.permissions import ROLES


@pytest.fixture
def make_user(db):
    def _make(role="enseignant", username=None, password="secret1", **kw):
        username = username or role
        u = User(username=username, role=role, full_name=kw.pop("full_name", f"Test {role}"), **kw)
        u.set_password(password)
        u.save()
        return u
    return _make


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def login(client):
    """Connecte le client avec un compte et renvoie le client authentifié."""
    def _login(user, password="secret1"):
        r = client.post("/api/v1/auth/login/", {"username": user.username, "password": password}, format="json")
        assert r.status_code == 200, r.content
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
        return client
    return _login


@pytest.fixture
def users(make_user):
    return {r: make_user(r) for r in ROLES}


@pytest.fixture(autouse=True)
def _fast_and_isolated(settings):
    """Tests rapides (hachage léger) et indépendants (les limites de requêtes ne se cumulent pas)."""
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def school(db, make_user):
    """École minimale : classe 6e A, deux élèves (A et B, parents distincts), un enseignant de maths affecté, un d'une autre classe."""
    from django.core.management import call_command

    from apps.academics.models import SchoolClass, Subject, Teacher, TeachingAssignment
    from apps.students.services import enroll_student

    call_command("seed_school")
    from apps.academics.models import SchoolSettings
    cfg = SchoolSettings.load(); cfg.conduite_in_average = False; cfg.save()   # les tests historiques calculent les matières seules ; la conduite a ses propres tests
    cfg.bulletin_blocage = "aucun"; cfg.save()   # bulletin des familles bloqué si impayé : testé à part (test_bulletin_blocage)
    c = SchoolClass.objects.get(name="6e A")
    prof, hors = make_user("enseignant", "prof.ma"), make_user("enseignant", "prof.hors")
    TeachingAssignment.objects.update_or_create(school_class=c, subject=Subject.objects.get(code="ma"), defaults={"teacher": Teacher.objects.get(user=prof)})
    a = enroll_student(nom="Aka", prenoms="Léa", sexe="F", naissance="2013-01-01", lieu="", school_class=c, parent_name="M. Aka", parent_phone="0101010101")
    b = enroll_student(nom="Bah", prenoms="Ali", sexe="M", naissance="2013-02-02", lieu="", school_class=c, parent_name="M. Bah", parent_phone="0202020202")
    for u in (a.student.user, b.student.user, a.student.parent.user, b.student.parent.user):
        u.set_password("secret1")
        u.save()
    return dict(c=c, prof=prof, hors=hors, A=a.student, B=b.student)
