from django.db import models

from apps.core.tenancy import TenantModel

from apps.academics.models import SchoolClass, Subject, Teacher


class Cell(TenantModel):
    """Une heure de cours : classe + jour (0 = lundi) + créneau (0 à 7) → matière et salle."""

    school_class = models.ForeignKey(SchoolClass, on_delete=models.CASCADE, related_name="cells")
    day = models.PositiveSmallIntegerField()
    slot = models.PositiveSmallIntegerField()
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)
    room = models.CharField(max_length=40)

    CURSUS_LOOKUP = "school_class__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        ordering = ["day", "slot"]
        constraints = [models.UniqueConstraint(fields=["school_class", "day", "slot"], name="one_cell_per_class_slot")]


class TextEntry(TenantModel):
    """Cahier de textes : contenu d'une séance et travail à faire (une séance par classe, matière et jour)."""

    school_class = models.ForeignKey(SchoolClass, on_delete=models.CASCADE, related_name="text_entries")
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)
    teacher = models.ForeignKey(Teacher, null=True, on_delete=models.SET_NULL)
    date = models.DateField()
    content = models.CharField(max_length=600)
    homework = models.CharField(max_length=400, blank=True)
    due = models.DateField(null=True, blank=True)

    CURSUS_LOOKUP = "school_class__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        ordering = ["-date", "subject_id"]
        constraints = [models.UniqueConstraint(fields=["school_class", "subject", "date"], name="one_entry_per_day")]


class Replacement(TenantModel):
    """Remplacement : pour un cours précis (classe, date, créneau), un autre enseignant tient la classe à la place du titulaire."""

    school_class = models.ForeignKey(SchoolClass, on_delete=models.CASCADE, related_name="replacements")
    date = models.DateField()
    slot = models.PositiveSmallIntegerField()
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)
    teacher = models.ForeignKey(Teacher, on_delete=models.CASCADE, related_name="replacements")
    absent = models.ForeignKey(Teacher, null=True, blank=True, on_delete=models.SET_NULL, related_name="replaced")
    by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL)

    CURSUS_LOOKUP = "school_class__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        ordering = ["date", "slot"]
        constraints = [models.UniqueConstraint(fields=["school_class", "date", "slot"], name="one_replacement_per_lesson")]
