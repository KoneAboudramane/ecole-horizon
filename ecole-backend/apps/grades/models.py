from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.tenancy import TenantModel

from apps.academics.models import SchoolClass, SchoolYear, Subject, Teacher, Term
from apps.students.models import Student

EVAL_TYPES = [("interro", "Interrogation"), ("devoir", "Devoir"), ("composition", "Composition")]
BAREME_MAX = 100  # note maximale qu'une évaluation peut avoir (sur 10, 20, 30… ou autre barème choisi par l'enseignant)
DECISIONS = [("admis", "Admis(e)"), ("redouble", "Redouble"), ("exclu", "Exclu(e)"), ("conseil", "Conseil à réunir")]


class Evaluation(TenantModel):
    school_class = models.ForeignKey(SchoolClass, on_delete=models.CASCADE, related_name="evaluations")
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name="evaluations")
    term = models.ForeignKey(Term, on_delete=models.PROTECT, related_name="evaluations")
    type = models.CharField(max_length=12, choices=EVAL_TYPES)
    title = models.CharField(max_length=80)
    date = models.DateField()
    published = models.BooleanField(default=False)
    teacher = models.ForeignKey(Teacher, null=True, blank=True, on_delete=models.SET_NULL, related_name="evaluations")
    scheduled = models.BooleanField("programmée par l'école", default=False)
    coef = models.DecimalField("coefficient de l'évaluation", max_digits=4, decimal_places=1, default=1)
    bareme = models.PositiveSmallIntegerField("barème (note maximale)", default=20,
                                              validators=[MinValueValidator(1), MaxValueValidator(BAREME_MAX)])

    CURSUS_LOOKUP = "school_class__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        ordering = ["date", "id"]
        indexes = [models.Index(fields=["school_class", "subject", "term"])]


class Grade(TenantModel):
    evaluation = models.ForeignKey(Evaluation, on_delete=models.CASCADE, related_name="grades")
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="grades")
    # Note telle que saisie, sur le barème de l'évaluation (15 pour 15/30) ; les moyennes la ramènent sur 20 (calc.sur20)
    value = models.DecimalField(max_digits=5, decimal_places=2, validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal(BAREME_MAX))])

    CURSUS_LOOKUP = "evaluation__school_class__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["evaluation", "student"], name="one_grade_per_eval_student")]


class Appreciation(TenantModel):
    """Appréciation d'un enseignant sur un élève dans sa matière, pour un trimestre."""

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="appreciations")
    term = models.ForeignKey(Term, on_delete=models.CASCADE)
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)
    text = models.CharField(max_length=300)

    CURSUS_LOOKUP = "student__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["student", "term", "subject"], name="one_appreciation")]


class CouncilComment(TenantModel):
    """Avis du conseil de classe sur le trimestre."""

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="council_comments")
    term = models.ForeignKey(Term, on_delete=models.CASCADE)
    text = models.CharField(max_length=300)

    CURSUS_LOOKUP = "student__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["student", "term"], name="one_council_comment")]


class Decision(TenantModel):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="decisions")
    year = models.ForeignKey(SchoolYear, on_delete=models.PROTECT)
    value = models.CharField(max_length=10, choices=DECISIONS)
    comment = models.CharField(max_length=300, blank=True)
    batch = models.BooleanField("validée en lot", default=False)   # « Valider les propositions de la classe » : annulable en lot
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    date = models.DateField(auto_now=True)

    CURSUS_LOOKUP = "student__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["student", "year"], name="one_decision_per_year")]
