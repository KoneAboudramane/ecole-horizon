from django.conf import settings
from django.db import models

from apps.core.tenancy import TenantModel

from apps.academics.models import SchoolClass
from apps.students.models import Student

SLOTS = [("Matin", "Matin"), ("Après-midi", "Après-midi")]


class AppelSession(TenantModel):
    """Un appel fait pour une classe, un jour et un créneau (même sans absent)."""

    school_class = models.ForeignKey(SchoolClass, on_delete=models.CASCADE, related_name="appels")
    date = models.DateField()
    slot = models.CharField(max_length=10, choices=SLOTS)
    taken_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    taken_at = models.DateTimeField("dernier enregistrement", auto_now=True, null=True)

    CURSUS_LOOKUP = "school_class__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["school_class", "date", "slot"], name="one_appel_per_slot")]


class Absence(TenantModel):
    STATUS = [("A", "Absent"), ("R", "Retard")]
    JUSTIF = [("aucune", "Aucun justificatif"), ("en_attente", "En attente"), ("acceptee", "Acceptée"), ("refusee", "Refusée")]
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="absences")
    school_class = models.ForeignKey(SchoolClass, on_delete=models.CASCADE)
    date = models.DateField()
    slot = models.CharField(max_length=10, choices=SLOTS)
    status = models.CharField(max_length=1, choices=STATUS)
    justif = models.CharField(max_length=10, choices=JUSTIF, default="aucune")
    motif = models.CharField(max_length=300, blank=True)

    CURSUS_LOOKUP = "student__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        ordering = ["-date", "slot", "student__nom"]
        constraints = [models.UniqueConstraint(fields=["student", "date", "slot"], name="one_absence_per_slot")]
