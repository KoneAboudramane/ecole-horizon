from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User
from apps.core.commandutil import add_ecole_option, in_school
from apps.core.permissions import STAFF_ROLES  # noqa: E402

# Mêmes profils que la démonstration Angular ; mot de passe : demo
DEMO = [
    ("fondateur", "fondateur", "M. Ouattara Lanciné"),
    ("directeur", "directeur", "Mme Diarrassouba Fatoumata"),
    ("secretariat", "admin", "Mme Bakayoko Mariam"),
    ("enseignant", "enseignant", "Mme Konan Aya"),
    ("educateur", "educateur", "M. Yapo Serge"),
    ("comptable", "comptable", "M. Soro Ibrahim"),
    ("informatique", "informatique", "M. Tano Désiré"),
    ("parent", "parent", "M. Brou Kouadio"),
    ("eleve", "eleve", "Brou Marie-Ange"),
]


class Command(BaseCommand):
    help = "Crée les comptes de démonstration (mot de passe : demo). Sans effet sur un compte existant. Jamais en production."

    def add_arguments(self, p):
        add_ecole_option(p)
        p.add_argument("--complet", action="store_true", help="Charge en plus une école bien remplie (≈ 80 élèves, notes, emploi du temps, devoirs, messages, paiements…) pour une présentation")

    def handle(self, *args, **opts):
        with in_school(opts.get("ecole", "")):
            self._demo(complet=opts.get("complet", False))

    def _demo(self, complet=False):
        if not settings.DEBUG:
            raise CommandError("Les comptes de démonstration (mot de passe « demo ») sont interdits quand DEBUG est désactivé.")
        call_command("seed_school", verbosity=0)
        from apps.academics.models import SchoolSettings
        from apps.core.models import Etablissement
        Etablissement.objects.filter(code="principal", nom="Établissement principal").update(nom=SchoolSettings.load().name)  # année, trimestres, matières, classes : indispensables à l'interface
        created = 0
        from apps.students.models import Student
        complet = complet and not Student.objects.exists()  # une école déjà remplie n'est jamais rechargée
        for username, role, name in DEMO:
            if complet and role in ("parent", "eleve"):
                continue  # ces deux comptes seront rattachés à un vrai élève
            u, new = User.objects.get_or_create(username=username, defaults={"role": role, "full_name": name, "email": f"{username}@demo.test" if role in STAFF_ROLES else ""})
            if new:
                u.set_password("demo")
                u.save()
                created += 1
        self.stdout.write(self.style.SUCCESS(f"{created} compte(s) créé(s), {len(DEMO) - created} déjà présent(s)."))
        if complet:
            from .demo_complet import load_complet
            load_complet(DEMO, self.stdout)
