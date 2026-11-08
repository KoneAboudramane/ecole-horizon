from django.core.management.base import BaseCommand, CommandError

from apps.core.models import Etablissement
from apps.core.schools import SchoolError, bootstrap_school, create_school


class Command(BaseCommand):
    help = ("Initialise un établissement : année, matières, classes et comptes de direction, avec des mots de passe provisoires "
            "affichés une seule fois. Sans --ecole : le premier établissement (installation à une seule école). "
            "Avec --ecole <code> : crée une école supplémentaire. Ne crée AUCUNE donnée de démonstration.")

    def add_arguments(self, p):
        p.add_argument("--school", required=True, help="Nom de l'établissement")
        p.add_argument("--director", required=True, help="Nom complet du directeur / de la directrice")
        p.add_argument("--founder", default="", help="Nom complet du fondateur (facultatif)")
        p.add_argument("--secretary", default="", help="Nom complet du secrétariat (facultatif)")
        p.add_argument("--director-email", default="", help="E-mail du directeur (pour « mot de passe oublié »)")
        p.add_argument("--founder-email", default="", help="E-mail du fondateur")
        p.add_argument("--secretary-email", default="", help="E-mail du secrétariat")
        p.add_argument("--ecole", default="", help="Code de connexion de l'école (ex. horizon) : obligatoire pour une école supplémentaire")
        p.add_argument("--prefix", default="", help="Préfixe des matricules (2 à 4 lettres, ex. HZ)")

    def handle(self, *a, school, director, founder, secretary, ecole, prefix, director_email, founder_email, secretary_email, **o):
        code = ecole.strip().lower()
        try:
            if code and not Etablissement.objects.filter(code=code).exists():
                etab, rows = create_school(code=code, nom=school, prefixe=prefix, director=director, founder=founder, secretary=secretary,
                                       director_email=director_email, founder_email=founder_email, secretary_email=secretary_email)
            else:
                etab = Etablissement.objects.filter(code=code).first() if code else Etablissement.objects.order_by("id").first()
                if etab is None:
                    etab = Etablissement.objects.create(code="principal", nom=school.strip(), prefixe=(prefix or "HZ").upper()[:4])
                elif not code and Etablissement.objects.count() > 1:
                    raise CommandError("Plusieurs établissements existent : précisez --ecole <code>.")
                etab.nom = school.strip()
                if prefix:
                    etab.prefixe = prefix.upper()[:4]
                etab.save()
                rows = bootstrap_school(etab, director=director, founder=founder, secretary=secretary,
                                       director_email=director_email, founder_email=founder_email, secretary_email=secretary_email)
        except SchoolError as e:
            raise CommandError(str(e)) from e
        self.stdout.write(self.style.SUCCESS(f"Établissement « {etab.nom} » (code de connexion : {etab.code}) initialisé. Notez ces accès : ils ne seront plus affichés."))
        for r in rows:
            self.stdout.write(f"  {r['name']:32} identifiant : {r['username']:12} mot de passe provisoire : {r['password']}")
