import calendar
import uuid
from datetime import date

from django.conf import settings
from django.db import models
from django.utils import timezone

from .tenancy import TenantModel


class Etablissement(models.Model):
    """Une école cliente de la plateforme. Toutes les données métier lui sont rattachées."""

    code = models.SlugField("code de connexion", max_length=20, unique=True,
                            help_text="Saisi à la connexion (ex. horizon). Lettres minuscules, chiffres et tirets.")
    nom = models.CharField(max_length=120)
    prefixe = models.CharField("préfixe des matricules", max_length=4, default="HZ")
    actif = models.BooleanField(default=True)
    created = models.DateTimeField(auto_now_add=True)
    abonnement_fin = models.DateField("fin de l'abonnement", null=True, blank=True,
                                      help_text="Vide = sans échéance (paiement unique ou école exemptée).")

    class Meta:
        ordering = ["nom"]
        verbose_name = "établissement"

    # ----- abonnement unique : une seule formule pour toutes les écoles (réglages dans PlatformSettings) -----
    @property
    def abonnement_jours(self):
        """Jours restants (négatif si échu) ; None si sans échéance."""
        return None if self.abonnement_fin is None else (self.abonnement_fin - timezone.localdate()).days

    @property
    def abonnement_etat(self) -> str:
        """sans_echeance | actif | bientot (rappel) | grace (échu, accès encore ouvert) | echu (lecture seule)."""
        d = self.abonnement_jours
        if d is None:
            return "sans_echeance"
        cfg = PlatformSettings.load()
        if d > cfg.rappel_jours:
            return "actif"
        if d >= 0:
            return "bientot"
        return "grace" if -d <= cfg.grace_jours else "echu"

    @property
    def lecture_seule(self) -> bool:
        """Échu au-delà du délai de grâce : l'école consulte ses données mais ne peut plus rien modifier jusqu'au paiement."""
        return self.abonnement_etat == "echu"

    @property
    def multi_cursus(self) -> bool:
        """École à plusieurs cursus (franco-arabe, bilingue…) : tarif « plusieurs cursus »."""
        from apps.academics.models import Cursus
        return Cursus.all_objects.filter(etablissement=self).count() > 1

    def __str__(self):
        return f"{self.nom} ({self.code})"

    def save(self, *a, **kw):
        self.code = self.code.strip().lower()
        super().save(*a, **kw)


class ActivityLog(TenantModel):
    """Journal d'activité : qui a fait quoi, et quand. Ne se modifie jamais."""

    ts = models.DateTimeField(auto_now_add=True, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=80)
    detail = models.CharField(max_length=300, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-ts", "-id"]
        verbose_name = "entrée du journal"
        verbose_name_plural = "journal d’activité"

    def __str__(self):
        return f"{self.ts:%Y-%m-%d %H:%M} {self.action}"


class PlatformLog(models.Model):
    """Journal de la plateforme : actions des administrateurs de la plateforme (connexions, écoles, comptes). Jamais modifiable ni supprimable."""

    ts = models.DateTimeField(auto_now_add=True, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    etablissement = models.ForeignKey(Etablissement, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=80)
    detail = models.CharField(max_length=300, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-ts", "-id"]
        verbose_name = "entrée du journal de la plateforme"
        verbose_name_plural = "journal de la plateforme"

    def __str__(self):
        return f"{self.ts:%Y-%m-%d %H:%M} {self.action}"


def add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


class PlatformSettings(models.Model):
    """Réglages de la plateforme (une seule ligne) : les mêmes tarifs pour toutes les écoles, selon leur nombre de cursus."""

    tarif_inscription = models.PositiveIntegerField("inscription, un seul cursus (FCFA)", default=400_000)
    tarif_inscription_multi = models.PositiveIntegerField("inscription, plusieurs cursus (FCFA)", default=550_000)
    tarif_renouvellement = models.PositiveIntegerField("renouvellement annuel, un seul cursus (FCFA)", default=300_000)
    tarif_renouvellement_multi = models.PositiveIntegerField("renouvellement annuel, plusieurs cursus (FCFA)", default=400_000)
    grace_jours = models.PositiveSmallIntegerField("délai de grâce (jours)", default=30, help_text="Accès complet maintenu après l'échéance ; ensuite, lecture seule.")
    # Échéancier proposé par défaut : l'administrateur ajuste ensuite chaque tranche, école par école.
    fin_annee = models.CharField("fin de l'année scolaire (JJ/MM)", max_length=5, default="31/07")
    inscription_tranches = models.PositiveSmallIntegerField("inscription : nombre de tranches proposé", default=2)
    inscription_ecart_mois = models.PositiveSmallIntegerField("inscription : mois entre deux tranches", default=2)
    renouvellement_dates = models.CharField("renouvellement : dates des tranches (JJ/MM, séparées par des virgules)", max_length=120,
                                            default="31/07, 30/11, 29/02", help_text="Un jour trop grand prend le dernier jour du mois (29/02 → fin février).")
    arrondi = models.PositiveIntegerField("arrondi des tranches (FCFA)", default=25_000, help_text="0 = parts égales, sans arrondi.")
    # Reçus d'abonnement : signature et cachet imprimés en bas (images en data URL, vides = non imprimés)
    recu_signature = models.TextField("signature sur les reçus (image)", blank=True, default="")
    recu_cachet = models.TextField("cachet sur les reçus (image)", blank=True, default="")
    recu_adresse = models.CharField("adresse imprimée sur les reçus", max_length=160, blank=True)
    recu_mentions = models.CharField("mentions légales des reçus (RCCM, compte contribuable…)", max_length=200, blank=True)
    recu_ville = models.CharField("ville du « Fait à » des reçus", max_length=60, blank=True)
    rappel_jours = models.PositiveSmallIntegerField("rappel avant l'échéance (jours)", default=30)
    # Page d'accueil publique : commune à toutes les écoles de la plateforme
    accueil_nom = models.CharField("nom affiché sur la page d'accueil", max_length=120, blank=True,
                                   help_text="Vide : le nom de l'école quand la plateforme n'en héberge qu'une, sinon « Plateforme scolaire ».")
    accueil_logo = models.TextField("logo de la page d'accueil (image en data URL)", blank=True, default="")
    accueil_carte = models.BooleanField("carte d'exemple sur la page d'accueil", default=True)
    # Promotion de la plateforme auprès des écoles : coordonnées affichées (vides = masquées) et prix de l'abonnement (affiché sur demande)
    accueil_whatsapp = models.CharField("numéro WhatsApp", max_length=30, blank=True)
    accueil_telephone = models.CharField("téléphone", max_length=30, blank=True)
    accueil_email = models.EmailField("e-mail de contact", blank=True)
    # Jamais affiché : l'adresse où l'administrateur reçoit chaque demande de démonstration (vide = l'e-mail de contact)
    accueil_email_demandes = models.EmailField("e-mail qui reçoit les demandes de démonstration", blank=True)
    accueil_prix = models.BooleanField("afficher le prix de l'abonnement", default=False)
    accueil_chiffres = models.BooleanField("afficher les chiffres de la plateforme", default=True)
    accueil_visiteurs = models.BooleanField("afficher la fréquentation de la page d'accueil", default=True)

    class Meta:
        verbose_name = "réglages de la plateforme"
        verbose_name_plural = "réglages de la plateforme"

    @classmethod
    def load(cls) -> "PlatformSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def save(self, *a, **kw):
        self.pk = 1
        super().save(*a, **kw)

    def __str__(self):
        return "Réglages de la plateforme"

    def tarif(self, nature: str, multi: bool) -> int:
        if nature == "inscription":
            return self.tarif_inscription_multi if multi else self.tarif_inscription
        return self.tarif_renouvellement_multi if multi else self.tarif_renouvellement


class AbonnementTranche(models.Model):
    """Une tranche de l'échéancier d'une école : l'inscription se règle en 1 ou 2 fois, le renouvellement en 1 ou 3 fois.
    Les paiements règlent les tranches dans l'ordre ; l'échéance d'accès de l'école est celle de la première tranche non soldée."""

    NATURES = [("inscription", "Inscription"), ("renouvellement", "Renouvellement")]
    etablissement = models.ForeignKey(Etablissement, on_delete=models.CASCADE, related_name="tranches")
    nature = models.CharField(max_length=14, choices=NATURES)
    numero = models.PositiveSmallIntegerField()
    nombre = models.PositiveSmallIntegerField("nombre de tranches")
    echeance = models.DateField()
    montant = models.PositiveIntegerField("montant (FCFA)")
    regle = models.PositiveIntegerField("déjà réglé (FCFA)", default=0)
    periode_fin = models.DateField("fin de l'année couverte")
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["echeance", "id"]
        verbose_name = "tranche d'abonnement"
        verbose_name_plural = "tranches d'abonnement"

    @property
    def reste(self) -> int:
        return self.montant - self.regle

    def __str__(self):
        return f"{self.etablissement.code} {self.nature} {self.numero}/{self.nombre} {self.echeance}"


class AbonnementPaiement(models.Model):
    """Paiement d'abonnement enregistré par l'administration de la plateforme. Jamais modifiable ni supprimable."""

    MODES = [("especes", "Espèces"), ("virement", "Virement"), ("mobile", "Mobile money"), ("cheque", "Chèque"), ("autre", "Autre")]
    etablissement = models.ForeignKey(Etablissement, on_delete=models.CASCADE, related_name="paiements_abonnement")
    date = models.DateField()
    montant = models.PositiveIntegerField("montant (FCFA)")
    mode = models.CharField(max_length=10, choices=MODES, default="especes")
    reference = models.CharField("n° de transaction", max_length=60, blank=True)
    numero = models.CharField("n° de reçu", max_length=20, unique=True, null=True, blank=True)
    # Code secret imprimé sur le reçu (et dans son QR code) : il permet à quiconque tient le reçu d'en vérifier l'authenticité,
    # sans qu'on puisse deviner celui des autres reçus en changeant le numéro.
    code_verif = models.CharField("code de vérification", max_length=9, unique=True, null=True, blank=True)
    # Ce que le paiement a réglé, figé à l'enregistrement : le reçu reste exact même si une tranche est modifiée ensuite.
    detail = models.JSONField(default=dict, blank=True)
    fin_avant = models.DateField(null=True, blank=True)
    fin_apres = models.DateField(null=True, blank=True)
    par = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]
        verbose_name = "paiement d'abonnement"
        verbose_name_plural = "paiements d'abonnement"

    def __str__(self):
        return f"{self.etablissement.code} {self.date} {self.montant}"


def accueil_path(instance, filename):
    return f"accueil/{uuid.uuid4().hex[:16]}.jpg"        # nom aléatoire, pas de listing de dossier


class AccueilPhoto(models.Model):
    """Photo du diaporama de la page d'accueil publique (commune à la plateforme), réduite et sans métadonnées."""

    MAX = 6
    image = models.ImageField(upload_to=accueil_path)
    caption = models.CharField("légende", max_length=120, blank=True)
    order = models.PositiveSmallIntegerField(default=0)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "id"]
        verbose_name = "photo de la page d'accueil"


class DemandeDemo(models.Model):
    """Demande de démonstration envoyée depuis la page d'accueil par une école intéressée (traitée par l'administrateur de la plateforme)."""

    ecole = models.CharField("nom de l'école", max_length=120)
    ville = models.CharField(max_length=80, blank=True)
    nom = models.CharField("nom du contact", max_length=120)
    telephone = models.CharField("téléphone", max_length=30)
    email = models.EmailField(blank=True)
    message = models.TextField(max_length=1000, blank=True)
    created = models.DateTimeField(auto_now_add=True)
    traitee = models.BooleanField("traitée", default=False)

    class Meta:
        ordering = ["traitee", "-created"]
        verbose_name = "demande de démonstration"

    def __str__(self):
        return f"{self.ecole} ({self.nom})"


class VisiteJour(models.Model):
    """Fréquentation de la page d'accueil, jour par jour : pages vues et visiteurs (chacun compté une fois par jour)."""

    day = models.DateField("jour", unique=True)
    vues = models.PositiveIntegerField("pages vues", default=0)
    visiteurs = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-day"]
        verbose_name = "visites du jour"
        verbose_name_plural = "visites par jour"


class VisiteurJour(models.Model):
    """Empreinte anonyme d'un visiteur pour la journée (ni adresse IP ni cookie : un hachage qui change chaque jour).
    Ne sert qu'à ne compter qu'une fois le même visiteur ; effacée le surlendemain."""

    day = models.DateField(db_index=True)
    empreinte = models.CharField(max_length=16)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["day", "empreinte"], name="one_visitor_per_day")]
