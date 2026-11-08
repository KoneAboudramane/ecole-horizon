from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User
from apps.accounts.passwords import temp_password


class Command(BaseCommand):
    help = "Crée un administrateur de la plateforme (gère les établissements ; ne voit aucune donnée d'école). Connexion avec le code « plateforme »."

    def add_arguments(self, p):
        p.add_argument("--username", required=True)
        p.add_argument("--name", required=True)
        p.add_argument("--principal", action="store_true", help="Administrateur principal (valide et gère les autres). Le tout premier administrateur l'est d'office.")
        p.add_argument("--password", default="", help="Sinon un mot de passe provisoire est généré et affiché.")

    def handle(self, *a, username, name, password, principal=False, **o):
        username = username.strip().lower()
        if User.all_objects.filter(etablissement__isnull=True, username=username).exists():
            raise CommandError("Cet identifiant existe déjà.")
        principal = principal or not User.all_objects.filter(etablissement__isnull=True, is_superuser=True).exists()
        pw = password or temp_password(12)
        u = User(username=username, full_name=name.strip(), role="", is_superuser=True, is_staff=True, must_change_password=not password, platform_owner=principal)
        u.set_password(pw)
        u.save()
        self.stdout.write(self.style.SUCCESS(f"Administrateur{' principal' if principal else ''} « {name} » créé. Connexion : code d'école « plateforme », identifiant {username}" + ("" if password else f", mot de passe provisoire {pw}")))
