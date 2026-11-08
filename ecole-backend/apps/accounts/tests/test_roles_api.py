"""Gestion des rôles par l'école : le fondateur délègue, les garde-fous tiennent."""
import pytest

from apps.accounts.models import Role, User
from apps.core.models import ActivityLog
from apps.core.permissions import has_perm

pytestmark = pytest.mark.django_db
ROLES = "/api/v1/roles/"


def role_of(key):
    return Role.objects.get(key=key)


def give(key, *perms):
    r = role_of(key)
    r.perms = sorted(set(r.perms) | set(perms))
    r.save()


def reload(u):
    return User.all_objects.get(pk=u.pk)


def test_only_managers_see_roles(make_user, login, client):
    assert login(make_user("informatique")).get(ROLES).status_code == 403
    give("informatique", "roles.manage")
    r = client.get(ROLES)
    assert r.status_code == 200
    keys = {x["key"] for x in r.data["roles"]}
    assert {"fondateur", "directeur", "enseignant", "parent", "eleve"} <= keys
    assert r.data["catalog"] and r.data["templates"]


def test_founder_creates_custom_role_and_assigns_it(make_user, login, client):
    login(make_user("fondateur"))
    r = client.post(ROLES, {"label": "Économe", "perms": ["pay.read", "pay.write", "tarifs.write"]}, format="json")
    assert r.status_code == 201, r.data
    rid = r.data["id"]
    assert r.data["base"] == "personnel" and r.data["key"] == "econome"
    # compte créé avec ce rôle (par le secrétariat)
    make_user("admin", username="secr")
    login(User.objects.get(username="secr"))
    c = client.post("/api/v1/users/", {"name": "Mme Diallo", "role_id": rid, "username": "econome1", "email": "e@x.ci"}, format="json")
    assert c.status_code == 201, c.data
    u = User.objects.get(username="econome1")
    assert u.role == "personnel" and u.role_ref_id == rid and u.role_label == "Économe"
    assert has_perm(u, "pay.write") and not has_perm(u, "students.write")
    assert c.data["user"]["role_label"] == "Économe" and c.data["user"]["role_id"] == rid


def test_personnel_without_rights_sees_no_school_data(make_user, login, client):
    c = login(make_user("personnel"))
    for path in ("/api/v1/students/", "/api/v1/finance/payments/", "/api/v1/users/", "/api/v1/journal/", "/api/v1/roles/", "/api/v1/homeworks/", "/api/v1/resources/"):
        assert c.get(path).status_code in (403, 404), path


def test_delegate_cannot_grant_rights_they_do_not_hold(make_user, login, client):
    give("informatique", "roles.manage")
    login(make_user("informatique"))
    r = client.post(ROLES, {"label": "Test", "perms": ["students.write"]}, format="json")
    assert r.status_code == 403 and "students" not in str(r.data).lower() or r.status_code == 403
    ok = client.post(ROLES, {"label": "Journal seul", "perms": ["journal.sys"]}, format="json")
    assert ok.status_code == 201
    # il ne peut pas non plus retirer un droit qu'il n'a pas
    rid = role_of("comptable").pk
    assert client.patch(f"{ROLES}{rid}/", {"perms": []}, format="json").status_code == 403


def test_founder_can_grant_any_right(make_user, login, client):
    login(make_user("fondateur"))
    rid = role_of("comptable").pk
    r = client.patch(f"{ROLES}{rid}/", {"perms": ["pay.read", "students.write"]}, format="json")
    assert r.status_code == 200 and set(r.data["perms"]) == {"pay.read", "students.write"}
    log = ActivityLog.objects.filter(action="Droits d’un rôle modifiés").first()
    assert log and "+students.write" in log.detail and "-pay.write" in log.detail


def test_locked_and_founder_roles_are_protected(make_user, login, client):
    login(make_user("fondateur"))
    for key in ("parent", "eleve"):
        rid = role_of(key).pk
        assert client.patch(f"{ROLES}{rid}/", {"perms": ["pay.write"]}, format="json").status_code == 400
        assert client.delete(f"{ROLES}{rid}/").status_code == 400
    fid = role_of("fondateur").pk
    assert client.patch(f"{ROLES}{fid}/", {"perms": ["pay.read"]}, format="json").status_code == 400
    assert client.delete(f"{ROLES}{fid}/").status_code == 400


def test_delegate_cannot_edit_founder_role(make_user, login, client):
    give("informatique", "roles.manage")
    login(make_user("informatique"))
    assert client.patch(f"{ROLES}{role_of('fondateur').pk}/", {"perms": ["roles.manage", "journal"]}, format="json").status_code == 403


def test_unknown_right_and_duplicate_name_are_refused(make_user, login, client):
    login(make_user("fondateur"))
    assert client.post(ROLES, {"label": "Pirate", "perms": ["tout.faire"]}, format="json").status_code == 400
    assert client.post(ROLES, {"label": "Enseignant", "perms": []}, format="json").status_code == 400


def test_role_in_use_cannot_be_deleted(make_user, login, client):
    login(make_user("fondateur"))
    make_user("comptable", username="cpt")
    assert client.delete(f"{ROLES}{role_of('comptable').pk}/").status_code == 400
    r = client.post(ROLES, {"label": "Bibliothécaire", "perms": []}, format="json")
    assert client.delete(f"{ROLES}{r.data['id']}/").status_code == 204
    assert ActivityLog.objects.filter(action="Rôle supprimé").exists()


def test_last_manager_cannot_be_removed(make_user, login, client):
    f = make_user("fondateur")
    make_user("admin", username="secr")
    login(User.objects.get(username="secr"))
    # le fondateur est le seul à gérer les rôles : on ne peut pas le désactiver
    r = client.post(f"/api/v1/users/{f.pk}/toggle-active/")
    assert r.status_code == 400 and "gérer les rôles" in r.data["detail"]
    # avec un délégué actif, c'est possible
    give("informatique", "roles.manage")
    make_user("informatique", username="it")
    assert client.post(f"/api/v1/users/{f.pk}/toggle-active/").status_code == 200


def test_change_account_role_by_role_id(make_user, login, client):
    make_user("fondateur")
    t = make_user("enseignant", username="prof")
    make_user("admin", username="secr")
    login(User.objects.get(username="secr"))
    cid = role_of("comptable").pk
    r = client.patch(f"/api/v1/users/{t.pk}/", {"role_id": cid}, format="json")
    assert r.status_code == 200, r.data
    t = reload(t)
    assert t.role == "comptable" and t.role_ref_id == cid
    assert client.patch(f"/api/v1/users/{t.pk}/", {"role_id": role_of("parent").pk}, format="json").status_code == 400


def test_custom_teacher_scope_creates_teacher_profile(make_user, login, client):
    login(make_user("fondateur"))
    r = client.post(ROLES, {"label": "Professeur principal", "perms": ["appel"], "scope": "enseignant"}, format="json")
    assert r.status_code == 201 and r.data["base"] == "enseignant"
    make_user("admin", username="secr")
    login(User.objects.get(username="secr"))
    c = client.post("/api/v1/users/", {"name": "M. Yao", "role_id": r.data["id"], "username": "pp1", "email": "pp@x.ci"}, format="json")
    assert c.status_code == 201, c.data
    u = User.objects.get(username="pp1")
    assert u.role == "enseignant" and hasattr(u, "teacher") and has_perm(u, "appel") and not has_perm(u, "cahier.write")


def test_informatique_whitelist_lifts_only_with_school_rights(make_user, login, client):
    make_user("informatique")
    c = login(User.objects.get(username="informatique"))
    assert c.get("/api/v1/finance/tarifs/").status_code == 403           # liste blanche
    give("informatique", "roles.manage")
    assert c.get("/api/v1/finance/tarifs/").status_code == 403           # déléguer les rôles n'ouvre pas les données
    give("informatique", "pay.read")
    assert c.get("/api/v1/finance/tarifs/").status_code == 200


def test_removing_a_right_applies_at_once(make_user, login, client):
    c = login(make_user("fondateur"))
    rid = role_of("comptable").pk
    make_user("comptable", username="cpt")
    from rest_framework.test import APIClient
    cc = APIClient()
    tok = cc.post("/api/v1/auth/login/", {"username": "cpt", "password": "secret1"}, format="json").data["access"]
    cc.credentials(HTTP_AUTHORIZATION=f"Bearer {tok}")
    assert cc.get("/api/v1/finance/payments/").status_code == 200
    c.patch(f"{ROLES}{rid}/", {"perms": ["tarifs.write"]}, format="json")
    assert cc.get("/api/v1/finance/payments/").status_code == 403


def test_custom_role_with_educator_scope(make_user, login, client):
    login(make_user("fondateur"))
    r = client.post(ROLES, {"label": "Surveillant de cour", "perms": ["appel", "discipline"], "scope": "educateur"}, format="json")
    assert r.status_code == 201 and r.data["base"] == "educateur"
    make_user("admin", username="secr")
    login(User.objects.get(username="secr"))
    c = client.post("/api/v1/users/", {"name": "M. Zadi", "role_id": r.data["id"], "username": "surv1", "email": "z@x.ci"}, format="json")
    assert c.status_code == 201, c.data
    u = User.objects.get(username="surv1")
    assert u.role == "educateur" and has_perm(u, "appel") and not has_perm(u, "justifs")
