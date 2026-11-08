import uuid

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from apps.core.tenancy import TenantModel

from apps.academics.models import SchoolYear
from apps.students.models import Student

MODES = [("especes", "Espèces"), ("virement", "Virement"), ("cheque", "Chèque"), ("orange", "Orange Money"),
         ("mtn", "MTN Money"), ("moov", "Moov Money"), ("wave", "Wave")]
ONLINE_MODES = ["orange", "mtn", "moov", "wave"]


class Tarif(TenantModel):
    """Frais d'un niveau (en FCFA) : inscription + scolarité annuelle (payée en tranches choisies par l'école)."""

    level = models.CharField(max_length=10)
    ins = models.PositiveIntegerField("inscription")
    sco = models.PositiveIntegerField("scolarité")
    # École à plusieurs cursus : ce que paie en plus, pour ce cursus, un élève qui suit déjà un autre cursus de l'école
    # (forfait global : tarif complet du cursus principal + complément de chaque autre cursus). Vide = inscription + scolarité.
    complement = models.PositiveIntegerField("tarif en complément d'un autre cursus", null=True, blank=True)

    CURSUS_LOOKUP = "cursus"
    cursus = models.ForeignKey("academics.Cursus", null=True, blank=True, on_delete=models.PROTECT, related_name="tarifs")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["etablissement", "cursus", "level"], name="uniq_tarif_level")]


class FeeDate(TenantModel):
    year = models.ForeignKey(SchoolYear, on_delete=models.CASCADE, related_name="fee_dates")
    key = models.CharField(max_length=3)  # INS, T1, T2… (les tranches sont propres à l'école)
    date = models.DateField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["year", "key"], name="one_fee_date")]


class Payment(TenantModel):
    STATUS = [("confirme", "Confirmé"), ("annule", "Annulé")]
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="payments")
    year = models.ForeignKey(SchoolYear, null=True, blank=True, on_delete=models.PROTECT, related_name="payments")  # année scolaire du paiement
    amount = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    mode = models.CharField(max_length=10, choices=MODES)
    ref = models.CharField("référence", max_length=60, blank=True)
    date = models.DateField()
    receipt_no = models.CharField(max_length=20)
    status = models.CharField(max_length=10, choices=STATUS, default="confirme")
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)  # vide = opérateur mobile money
    note = models.CharField(max_length=300, blank=True)
    created = models.DateTimeField(auto_now_add=True)
    advance = models.PositiveIntegerField("part gardée en avance (au-delà du solde dû)", default=0)
    detail = models.JSONField("détail figé sur le reçu : échéances réglées et reste", null=True, blank=True)

    class Meta:
        ordering = ["-date", "-id"]
        constraints = [
            # une même opération (mode + référence) ne peut être encaissée qu'une fois
            models.UniqueConstraint(fields=["etablissement", "mode", "ref"], condition=models.Q(status="confirme") & ~models.Q(ref=""), name="uniq_confirmed_ref"),
            models.UniqueConstraint(fields=["etablissement", "receipt_no"], name="uniq_receipt_per_school"),
        ]


class StatementLine(TenantModel):
    """Ligne du relevé de l'opérateur ou de la banque, rapprochée avec un paiement enregistré."""

    ref = models.CharField(max_length=60)
    date = models.DateField()
    mode = models.CharField(max_length=10, choices=MODES)
    amount = models.PositiveIntegerField()
    phone = models.CharField(max_length=30, blank=True)
    payment = models.ForeignKey(Payment, null=True, blank=True, on_delete=models.SET_NULL, related_name="statement_lines")

    class Meta:
        ordering = ["date", "id"]
        constraints = [models.UniqueConstraint(fields=["mode", "ref"], name="uniq_statement_ref")]


class PaymentIntent(TenantModel):
    """Demande de paiement mobile money initiée par un parent ; elle n'est confirmée que par l'opérateur (webhook signé)."""

    STATUS = [("pending", "En attente"), ("succeeded", "Réussi"), ("failed", "Échoué"), ("mismatch", "Montant différent")]
    reference = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="intents")
    amount = models.PositiveIntegerField()
    mode = models.CharField(max_length=10, choices=MODES)
    phone = models.CharField(max_length=30)
    status = models.CharField(max_length=10, choices=STATUS, default="pending")
    provider_ref = models.CharField(max_length=80, blank=True)
    payment = models.OneToOneField(Payment, null=True, blank=True, on_delete=models.SET_NULL)
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created"]


class CashClosing(TenantModel):
    """Clôture de caisse d'un jour : espèces attendues d'après les reçus et espèces comptées par le comptable."""

    date = models.DateField()
    expected_cash = models.PositiveIntegerField()
    counted_cash = models.PositiveIntegerField()
    note = models.CharField(max_length=300, blank=True)
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date"]
        constraints = [models.UniqueConstraint(fields=["etablissement", "date"], name="one_closing_per_day")]


class BulletinDerogation(TenantModel):
    """Bulletin remis à la famille malgré un impayé (décision de la direction), pour une année scolaire."""

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="bulletin_derogations")
    year = models.ForeignKey(SchoolYear, on_delete=models.CASCADE, related_name="+")
    note = models.CharField("motif", max_length=200, blank=True)
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["student", "year"], name="one_derogation_per_year")]
