from django.conf import settings
from django.db import models

from apps.core.tenancy import TenantModel

from apps.students.models import Student

TYPES = [("bavardage", "Bavardage"), ("tenue", "Tenue non conforme"), ("devoirs", "Devoirs non faits"), ("telephone", "Téléphone en classe"),
         ("insolence", "Insolence"), ("bagarre", "Bagarre"), ("fraude", "Fraude ou triche"), ("degradation", "Dégradation de matériel"), ("autre", "Autre")]
GRAVITES = [("legere", "Légère"), ("moyenne", "Moyenne"), ("grave", "Grave")]
SANCTIONS = [("observation", "Observation écrite"), ("avertissement", "Avertissement"), ("retenue", "Retenue"),
             ("travail", "Travail d’intérêt scolaire"), ("convocation", "Convocation des parents"),
             ("exclusion_cours", "Exclusion de cours"), ("exclusion_temp", "Exclusion temporaire")]
STATUS = [("valide", "Validé"), ("a_valider", "À valider"), ("refuse", "Refusé")]


class Incident(TenantModel):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="incidents")
    date = models.DateField()
    type = models.CharField(max_length=12, choices=TYPES)
    gravite = models.CharField(max_length=8, choices=GRAVITES)
    sanction = models.CharField(max_length=16, choices=SANCTIONS)
    description = models.CharField(max_length=500)
    status = models.CharField(max_length=10, choices=STATUS, default="valide")
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="incidents_reported")
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decision_note = models.CharField(max_length=300, blank=True)

    CURSUS_LOOKUP = "student__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        ordering = ["-date", "-id"]


class EducatorClass(TenantModel):
    """Classe confiée à un éducateur. Un éducateur sans aucune classe attribuée garde la vue de toute l'école."""

    educateur = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="classes_educateur")
    school_class = models.ForeignKey("academics.SchoolClass", on_delete=models.CASCADE, related_name="educateurs")

    CURSUS_LOOKUP = "school_class__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["educateur", "school_class"], name="one_educateur_per_class_pair")]


class ConductDeduction(TenantModel):
    """Retrait de points sur la note de conduite d'un élève pour une période (note = maximum − somme des retraits)."""

    KINDS = [("absences", "Absences non justifiées"), ("discipline", "Sanction disciplinaire"), ("autre", "Autre")]
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="conduct_deductions")
    term = models.ForeignKey("academics.Term", on_delete=models.CASCADE, related_name="conduct_deductions")
    points = models.DecimalField(max_digits=4, decimal_places=1)
    reason = models.CharField(max_length=200)
    kind = models.CharField(max_length=10, choices=KINDS, default="autre")
    date = models.DateField()
    incident = models.ForeignKey(Incident, null=True, blank=True, on_delete=models.CASCADE, related_name="deductions")
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    CURSUS_LOOKUP = "student__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        ordering = ["date", "id"]
        indexes = [models.Index(fields=["term", "student"])]
        constraints = [models.UniqueConstraint(fields=["student", "term"], condition=models.Q(kind="absences"), name="one_absence_deduction")]
