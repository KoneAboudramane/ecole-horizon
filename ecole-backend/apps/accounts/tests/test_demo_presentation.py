"""Démonstration à deux écoles (Mali, Côte d'Ivoire) : garde-fous et contenu."""
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.academics.models import SchoolYear
from apps.accounts.models import User
from apps.core.models import Etablissement
from apps.students.models import Enrollment, Student

pytestmark = pytest.mark.django_db


def test_refusee_hors_installation_de_demonstration(settings):
    settings.DEMO_INSTANCE = False
    with pytest.raises(CommandError, match="DEMO_INSTANCE"):
        call_command("demo_presentation")


def test_refusee_sur_une_base_avec_une_vraie_ecole(settings, users):
    settings.DEMO_INSTANCE = True
    with pytest.raises(CommandError, match="base dédiée"):
        call_command("demo_presentation", reinitialiser=True)
    assert User.objects.filter(pk=users["directeur"].pk).exists()        # rien n'a été effacé


def test_mots_de_passe_et_comptes_non_modifiables_en_demonstration(settings, users, login, client):
    settings.DEMO_INSTANCE = True
    login(users["directeur"])
    assert client.post("/api/v1/me/password/", {"current": "secret1", "new": "Autre-mot-2-passe!"}, format="json").status_code == 403
    login(users["admin"])
    assert client.post(f"/api/v1/users/{users['parent'].pk}/reset-password/").status_code == 403
    assert client.post(f"/api/v1/users/{users['parent'].pk}/toggle-active/").status_code == 403


def test_deux_ecoles_sur_trois_annees(settings):
    settings.DEMO_INSTANCE = True
    call_command("demo_presentation", verbosity=0)
    for code in ("demo-mali", "demo-ci"):
        etab = Etablissement.objects.get(code=code)
        years = sorted(SchoolYear.all_objects.filter(etablissement=etab).values_list("label", flat=True))
        assert len(years) == 3 and SchoolYear.all_objects.get(etablissement=etab, current=True).label == years[-1]
        eleve = User.all_objects.get(etablissement=etab, username="eleve")
        assert eleve.check_password("demo") and not eleve.must_change_password
        st = Student.all_objects.get(user=eleve)
        assert Enrollment.all_objects.filter(student=st).count() == 3            # présente depuis trois ans : archives à montrer
        assert Student.all_objects.filter(etablissement=etab, parent=st.parent).count() == 2
        # Toutes les classes ont un emploi du temps et un cahier de textes ; aucun enseignant à deux endroits à la fois
        from apps.academics.models import SchoolClass, TeachingAssignment
        from apps.mockexams.models import MockSession
        from apps.schedule.models import Cell, TextEntry
        prof = {(a.school_class_id, a.subject_id): a.teacher_id for a in TeachingAssignment.all_objects.filter(etablissement=etab)}
        vus = set()
        for cell in Cell.all_objects.filter(etablissement=etab):
            cle = (prof[(cell.school_class_id, cell.subject_id)], cell.day, cell.slot)
            assert cle not in vus, f"conflit d'enseignant {cle}"
            vus.add(cle)
        for cl in SchoolClass.all_objects.filter(etablissement=etab):
            assert Cell.all_objects.filter(school_class=cl).count() >= 15, cl.name
            assert TextEntry.all_objects.filter(school_class=cl).exists(), cl.name
        assert MockSession.all_objects.filter(etablissement=etab, name="BAC blanc", published=True).exists()
        ens = User.all_objects.get(etablissement=etab, username="enseignant")
        assert st.school_class.prof_principal.user_id == ens.pk
    assert not Etablissement.objects.filter(actif=True).exclude(code__startswith="demo-").exists()
