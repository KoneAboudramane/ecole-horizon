"""Accès des familles et des élèves : code provisoire à 6 chiffres, remis sur la fiche d'accès, à changer à la première connexion."""
import re

import pytest

from apps.accounts.models import User
from apps.students.services import enroll_student

pytestmark = pytest.mark.django_db


def test_enrollment_gives_a_six_digit_code_to_family_and_student(school):
    r = enroll_student(nom="Test", prenoms="Pin", sexe="M", naissance="2014-01-01", lieu="", school_class=school["c"], parent_name="M. Test", parent_phone="0102030405")
    assert {c["role"] for c in r.credentials} == {"parent", "eleve"}
    for c in r.credentials:
        assert re.fullmatch(r"\d{6}", c["password"]), c
        u = User.objects.get(username=c["username"])
        assert u.must_change_password and u.check_password(c["password"])
    assert {c["username"] for c in r.credentials} == {"0102030405", r.student.matricule.lower()}


def test_reset_gives_a_new_code_and_forces_a_change(school, users, login, client):
    login(users["admin"])
    parent = school["A"].parent.user
    parent.must_change_password = False
    parent.save()
    r = client.post(f"/api/v1/users/{parent.pk}/reset-password/")
    assert r.status_code == 200 and re.fullmatch(r"\d{6}", r.data["credentials"]["password"])
    parent.refresh_from_db()
    assert parent.must_change_password and parent.check_password(r.data["credentials"]["password"])
    # le personnel garde un mot de passe provisoire plus long
    p = client.post(f"/api/v1/users/{users['enseignant'].pk}/reset-password/").data["credentials"]["password"]
    assert len(p) == 8 and not p.isdigit()
