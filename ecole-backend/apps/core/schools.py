"""Création et initialisation d'un établissement (utilisé par la commande `init_school` et par l'API de la plateforme)."""
from django.core.management import call_command
from django.db import transaction

from .models import Etablissement
from .tenancy import tenant_context


class SchoolError(Exception):
    pass


def bootstrap_school(etab: Etablissement, *, director: str, founder: str = "", secretary: str = "", director_email: str = "", founder_email: str = "", secretary_email: str = "",
                     it: str = "", it_email: str = "", address: str = "", phone: str = "", email: str = "") -> list[dict]:
    """Année, matières, classes, réglages et comptes de direction d'une école. Renvoie les accès provisoires (affichés une fois)."""
    from apps.academics.models import SchoolSettings
    from apps.accounts.models import User
    from apps.accounts.passwords import temp_password

    with tenant_context(etab), transaction.atomic():
        if User.objects.exclude(role="parent").exists():
            raise SchoolError("Des comptes existent déjà dans cet établissement : l'installation initiale a déjà été faite.")
        call_command("seed_school", verbosity=0, sans_matieres=True)  # chaque école saisit ses propres matières
        s = SchoolSettings.load()
        s.name = etab.nom
        s.director = director.strip()
        s.address, s.phone, s.email = address.strip(), phone.strip(), email.strip().lower()
        s.save()
        rows = []
        for username, role, name, mail in (("directeur", "directeur", director, director_email), ("fondateur", "fondateur", founder, founder_email),
                                           ("secretariat", "admin", secretary, secretary_email), ("informatique", "informatique", it, it_email)):
            if not name.strip():
                continue
            pw = temp_password(10)
            u = User(username=username, role=role, full_name=name.strip(), email=mail.strip().lower(), must_change_password=True)
            u.set_password(pw)
            u.save()
            rows.append({"username": username, "name": name.strip(), "role": role, "password": pw})
        if not founder.strip():
            # Sans fondateur, personne ne pourrait déléguer les droits : la direction reçoit le droit de gérer les rôles (l'école peut le retirer).
            from apps.accounts.models import Role
            r = Role.all_objects.filter(etablissement=etab, key="directeur").first()
            if r and "roles.manage" not in r.perms:
                r.perms = sorted({*r.perms, "roles.manage"})
                r.save(update_fields=["perms"])
    return rows


def create_school(*, code: str, nom: str, prefixe: str = "", director: str, founder: str = "", secretary: str = "", director_email: str = "", founder_email: str = "", secretary_email: str = "",
                  **extra) -> tuple[Etablissement, list[dict]]:
    code = code.strip().lower()
    if Etablissement.objects.filter(code=code).exists() or code == "plateforme":
        raise SchoolError("Ce code est déjà utilisé.")
    with transaction.atomic():
        etab = Etablissement.objects.create(code=code, nom=nom.strip(), prefixe=(prefixe or code[:2]).upper()[:4])
        rows = bootstrap_school(etab, director=director, founder=founder, secretary=secretary, director_email=director_email,
                               founder_email=founder_email, secretary_email=secretary_email, **extra)
    return etab, rows
