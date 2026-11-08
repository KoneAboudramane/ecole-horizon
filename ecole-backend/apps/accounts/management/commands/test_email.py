from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Envoie un e-mail de test pour vérifier la configuration SMTP (celui qui sert au « mot de passe oublié »)."

    def add_arguments(self, p):
        p.add_argument("destinataire", help="Adresse e-mail qui doit recevoir le message de test")

    def handle(self, *a, destinataire, **kw):
        if "console" in settings.EMAIL_BACKEND or "locmem" in settings.EMAIL_BACKEND:
            self.stdout.write(self.style.WARNING("Attention : le serveur n'envoie pas de vrais e-mails (EMAIL_BACKEND = %s)." % settings.EMAIL_BACKEND))
        elif not settings.EMAIL_HOST:
            raise CommandError("EMAIL_HOST est vide : renseignez EMAIL_HOST, EMAIL_HOST_USER et EMAIL_HOST_PASSWORD.")
        try:
            send_mail("Test d'envoi — plateforme scolaire", "Si vous lisez ce message, l'envoi d'e-mails fonctionne : le « mot de passe oublié » sera opérationnel.",
                      settings.DEFAULT_FROM_EMAIL, [destinataire], fail_silently=False)
        except Exception as e:  # noqa: BLE001 — on veut afficher la vraie cause (mot de passe, port, TLS…)
            raise CommandError(f"Échec de l'envoi : {e}") from e
        self.stdout.write(self.style.SUCCESS(f"E-mail de test envoyé à {destinataire} (expéditeur : {settings.DEFAULT_FROM_EMAIL})."))
