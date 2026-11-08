from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import TotpDevice, User


class Command(BaseCommand):
    help = "Retire la double authentification d'un administrateur de la plateforme (téléphone et codes de secours perdus)."

    def add_arguments(self, parser):
        parser.add_argument("username")

    def handle(self, *a, username, **kw):
        u = User.all_objects.filter(etablissement__isnull=True, is_superuser=True, username=username).first()
        if not u:
            raise CommandError("Aucun administrateur de la plateforme avec cet identifiant.")
        n = TotpDevice.objects.filter(user=u).delete()[0]
        self.stdout.write(self.style.SUCCESS("Double authentification retirée." if n else "Elle n'était pas activée."))
