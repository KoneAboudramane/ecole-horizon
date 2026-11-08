import pytest

from apps.core.permissions import ALL_PERMS, PERMS, ROLES, has_perm

pytestmark = pytest.mark.django_db


def test_every_role_is_in_the_matrix():
    assert set(PERMS) == set(ROLES)


def test_families_have_no_staff_permission(users):
    for role in ("parent", "eleve"):
        assert not any(has_perm(users[role], p) for p in ALL_PERMS)


def test_key_separations_of_duties(users):
    # le directeur publie les notes, le secrétariat ne le peut pas
    assert has_perm(users["directeur"], "publish") and not has_perm(users["admin"], "publish")
    # seule la comptabilité enregistre un paiement ; la direction et le fondateur ne font que lire
    assert has_perm(users["comptable"], "pay.write")
    assert not any(has_perm(users[r], "pay.write") for r in ROLES if r != "comptable")
    assert has_perm(users["fondateur"], "pay.read") and has_perm(users["directeur"], "pay.read")
    # seul le directeur valide une sanction grave
    assert [r for r in ROLES if has_perm(users[r], "discipline.validate")] == ["directeur"]
    # seuls le secrétariat et le service informatique gèrent les comptes
    assert [r for r in ROLES if has_perm(users[r], "accounts")] == ["admin", "informatique"]


def test_inactive_user_has_no_permission(users):
    users["directeur"].is_active = False
    assert not has_perm(users["directeur"], "publish")


def test_unknown_permission_is_denied(users):
    assert not has_perm(users["directeur"], "launch.rockets")
