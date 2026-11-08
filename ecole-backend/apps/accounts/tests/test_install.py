import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.models import User

pytestmark = pytest.mark.django_db
LOGO = "data:image/png;base64,iVBORw0KGgo="


def test_init_school_creates_leaders_with_temp_passwords(capsys):
    call_command("init_school", school="Collège Test", director="Mme Directrice", founder="M. Fondateur")
    out = capsys.readouterr().out
    assert "Collège Test" in out and "mot de passe provisoire" in out
    d = User.objects.get(username="directeur")
    assert d.must_change_password and d.role == "directeur" and not d.check_password("demo")
    assert User.objects.filter(username="fondateur").exists() and not User.objects.filter(username="secretariat").exists()
    assert not User.objects.filter(username__in=["enseignant", "parent", "eleve"]).exists()
    with pytest.raises(CommandError):
        call_command("init_school", school="X", director="Y")


def test_seed_demo_refused_in_production(settings):
    settings.DEBUG = False
    with pytest.raises(CommandError):
        call_command("seed_demo")


def test_public_school_identity_and_logo_validation(client, users, login):
    r = client.get("/api/v1/public/school/")
    assert r.status_code == 200 and set(r.data) == {"name", "logo", "hue", "code", "multi", "accueil"}
    login(users["directeur"])
    assert client.patch("/api/v1/settings/", {"logo": LOGO}, format="json").status_code == 200
    assert client.patch("/api/v1/settings/", {"logo": "javascript:alert(1)"}, format="json").status_code == 400
    assert client.patch("/api/v1/settings/", {"logo": "data:image/png;base64," + "A" * 400_001}, format="json").status_code == 400
    client.credentials()  # déconnecté : le logo est visible sur l'écran de connexion
    assert client.get("/api/v1/public/school/").data["logo"] == LOGO


@pytest.mark.django_db
def test_seed_demo_creates_calendar_and_classes(settings):
    """Sans année ni trimestre, l'interface n'a rien à afficher : seed_demo doit tout préparer."""
    from apps.academics.models import SchoolClass, Term

    settings.DEBUG = True
    call_command("seed_demo", verbosity=0)
    assert Term.objects.filter(year__current=True).count() == 3
    assert SchoolClass.objects.count() == 14


def test_seed_recette_loads_realistic_data_in_one_school(tmp_path):
    from apps.core.models import Etablissement
    from apps.core.tenancy import tenant_context
    from apps.finance.models import Payment
    from apps.grades.models import Grade
    from apps.students.models import Student

    out = tmp_path / "comptes.csv"
    with pytest.raises(CommandError):
        call_command("seed_recette", password="Recette2026", sortie=str(out))  # sans --confirme-test
    call_command("init_school", ecole="rec", school="École de recette", director="Dir", prefix="RC")
    call_command("seed_recette", ecole="rec", password="Recette2026", sortie=str(out), confirme_test=True)
    etab = Etablissement.objects.get(code="rec")
    with tenant_context(etab):
        assert Student.objects.count() >= 70 and Payment.objects.count() > 30 and Grade.objects.count() > 500
        assert Student.objects.first().matricule.startswith("RC26-")
        with pytest.raises(CommandError):  # une seconde exécution est refusée
            call_command("seed_recette", ecole="rec", password="Recette2026", sortie=str(out), confirme_test=True)
    assert Student.all_objects.exclude(etablissement=etab).count() == 0
    assert len(out.read_text(encoding="utf-8-sig").splitlines()) > 100
