"""Les droits d'un rôle sont dans la base, par école : modifiables, avec les rôles parent et élève toujours verrouillés."""
import pytest

from apps.accounts.models import Role, User
from apps.core.models import Etablissement
from apps.core.permissions import DEFAULT_PERMS, ROLES, has_perm, perms_for
from apps.core.tenancy import tenant_context

pytestmark = pytest.mark.django_db


def fresh(u):
    return User.all_objects.get(pk=u.pk)


def test_new_school_gets_default_roles():
    e = Etablissement.objects.create(code="nouvelle", nom="Nouvelle école")
    roles = {r.key: r for r in Role.all_objects.filter(etablissement=e)}
    assert set(roles) == set(ROLES)
    assert set(roles["enseignant"].perms) == DEFAULT_PERMS["enseignant"]
    assert roles["parent"].locked and roles["eleve"].locked and not roles["directeur"].locked


def test_account_is_linked_to_its_school_role(make_user):
    u = make_user("comptable")
    assert u.role_ref.key == "comptable" and u.role_ref.etablissement_id == u.etablissement_id
    assert u.role_label == "Comptable"


def test_changing_role_rights_applies_on_next_load(make_user):
    u = make_user("informatique")
    assert not has_perm(u, "roles.manage")
    r = u.role_ref
    r.perms = sorted(set(r.perms) | {"roles.manage"})
    r.save()
    assert has_perm(fresh(u), "roles.manage")
    assert "roles.manage" in fresh(u).permissions_list


def test_rights_are_per_school(make_user):
    other = Etablissement.objects.create(code="autre", nom="Autre école")
    a = make_user("comptable", username="cpt-a")
    with tenant_context(other):
        b = make_user("comptable", username="cpt-b")
    rb = b.role_ref
    rb.perms = []
    rb.save()
    assert has_perm(fresh(a), "pay.write") and not has_perm(fresh(b), "pay.write")


def test_parent_and_student_stay_without_rights_even_if_row_is_tampered(make_user):
    p = make_user("parent")
    Role.all_objects.filter(pk=p.role_ref_id).update(perms=["pay.write", "settings"])
    assert perms_for(fresh(p)) == set()


def test_missing_role_row_falls_back_to_defaults(make_user):
    u = make_user("enseignant")
    User.all_objects.filter(pk=u.pk).update(role_ref=None)
    Role.all_objects.filter(etablissement_id=u.etablissement_id, key="enseignant").delete()
    assert perms_for(fresh(u)) == DEFAULT_PERMS["enseignant"]


def test_server_sends_rights_of_the_school_role(make_user, login):
    u = make_user("informatique")
    r = u.role_ref
    r.perms = sorted(set(r.perms) | {"pay.read"})
    r.save()
    c = login(u)
    me = c.get("/api/v1/me/").data
    assert "pay.read" in me["permissions"] and me["role_label"] == "Informatique"


def test_founder_can_manage_roles_by_default(make_user):
    assert has_perm(make_user("fondateur"), "roles.manage")
    assert not has_perm(make_user("directeur"), "roles.manage")
