from django.db import models

from apps.core.tenancy import TenantModel

from apps.academics.models import SchoolClass, Subject
from apps.students.models import Student

class ExamType(TenantModel):
    """Examen préparé, défini par l'école : BEPC, BAC, DEF, CEP, Brevet… (nom, niveaux concernés, coefficients par défaut).
    `per_serie` : une colonne de coefficients par série (comme le BAC) ; sinon une seule colonne « * » pour toutes les classes."""

    name = models.CharField("nom", max_length=40)
    levels = models.JSONField("niveaux concernés", default=list)          # ["3e"], ["Tle"], ["9e"]…
    per_serie = models.BooleanField("coefficients par série", default=False)
    coefs = models.JSONField("coefficients par défaut", default=dict)     # {"*": {"fr": 3}} ou {"A": {...}, "C": {...}}
    active = models.BooleanField("proposé pour les nouvelles sessions", default=True)

    CURSUS_LOOKUP = "cursus"
    cursus = models.ForeignKey("academics.Cursus", null=True, blank=True, on_delete=models.PROTECT, related_name="exam_types")

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["etablissement", "cursus", "name"], name="uniq_exam_type")]

    def __str__(self):
        return self.name


# Créés avec chaque école (Côte d'Ivoire) ; l'école les renomme, les modifie, les retire ou en ajoute d'autres
DEFAULT_EXAM_TYPES = [
    ("BEPC", ["3e"], False, {"*": {"fr": 3, "ma": 3, "an": 2, "hg": 2, "pc": 2, "sv": 1, "eps": 1}}),
    ("BAC", ["Tle"], True, {"A": {"fr": 4, "ph": 4, "hg": 3, "an": 3, "lv2": 2, "ma": 2, "eps": 1},
                            "C": {"ma": 5, "pc": 4, "sv": 2, "ph": 2, "fr": 2, "an": 2, "hg": 2, "eps": 1},
                            "D": {"ma": 4, "pc": 4, "sv": 4, "ph": 2, "fr": 2, "an": 2, "hg": 2, "eps": 1}}),
]


def ensure_exam_types() -> None:
    """Crée le BEPC et le BAC d'une école qui n'a encore aucun type d'examen."""
    if not ExamType.objects.exists():
        for name, levels, per_serie, coefs in DEFAULT_EXAM_TYPES:
            ExamType.objects.create(name=name, levels=levels, per_serie=per_serie, coefs=coefs)


class MockSession(TenantModel):
    name = models.CharField(max_length=80)
    # Nom de l'examen au moment de la création (« BEPC », « DEF »…) ou « AUTRE » ; l'historique ne change pas si le type est renommé
    type = models.CharField(max_length=40)
    exam_type = models.ForeignKey(ExamType, null=True, blank=True, on_delete=models.PROTECT, related_name="sessions")
    per_serie = models.BooleanField(default=False)
    start = models.DateField()
    end = models.DateField()
    classes = models.ManyToManyField(SchoolClass, related_name="mock_sessions")
    # {"*": {"fr": 3, ...}} pour le BEPC ; {"A": {...}, "C": {...}} (une colonne par série) pour le BAC. Clés = codes matières.
    coefs = models.JSONField(default=dict)
    published = models.BooleanField(default=False)

    CURSUS_LOOKUP = "cursus"
    cursus = models.ForeignKey("academics.Cursus", null=True, blank=True, on_delete=models.PROTECT, related_name="mock_sessions")

    class Meta:
        ordering = ["-start", "-id"]


class MockMark(TenantModel):
    session = models.ForeignKey(MockSession, on_delete=models.CASCADE, related_name="marks")
    student = models.ForeignKey(Student, on_delete=models.CASCADE)
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)
    value = models.DecimalField(max_digits=4, decimal_places=2)

    CURSUS_LOOKUP = "session__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["session", "student", "subject"], name="one_mark")]
