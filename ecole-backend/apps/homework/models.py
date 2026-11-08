import uuid

from django.db import models
from django.utils import timezone

from apps.academics.models import SchoolClass, Subject, Teacher
from apps.core.tenancy import TenantModel
from apps.students.models import Student

KINDS = [("fichier", "Devoir à rendre en fichier"), ("epreuve", "Épreuve en ligne (QCM, vrai/faux)")]
CORRECTIONS = [("jamais", "L’élève voit seulement sa note"), ("fin", "Corrigé visible à la fermeture de l’épreuve"), ("manuel", "Corrigé visible quand l’enseignant l’ouvre")]
QUESTION_KINDS = [("qcm", "QCM"), ("vf", "Vrai ou faux")]


def attachment_path(instance, filename):
    ext = filename.rsplit(".", 1)[-1].lower()[:5] if "." in filename else "bin"
    # Nom aléatoire : l'adresse d'un fichier ne se devine pas (et il n'est servi que par l'API, après contrôle des droits)
    return f"devoirs/{uuid.uuid4().hex}.{ext}"


class Assignment(TenantModel):
    """Un devoir envoyé par un enseignant à l'une de ses classes : à rendre en fichier, ou épreuve en ligne chronométrée."""

    school_class = models.ForeignKey(SchoolClass, on_delete=models.CASCADE, related_name="homeworks")
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name="homeworks")
    teacher = models.ForeignKey(Teacher, null=True, on_delete=models.SET_NULL, related_name="homeworks")
    kind = models.CharField(max_length=8, choices=KINDS)
    title = models.CharField(max_length=120)
    instructions = models.TextField(blank=True)
    attachment = models.FileField(upload_to=attachment_path, blank=True)
    attachment_name = models.CharField(max_length=200, blank=True)
    opens_at = models.DateTimeField(default=timezone.now)
    due_at = models.DateTimeField()
    allow_late = models.BooleanField("remise en retard acceptée", default=True)
    max_points = models.DecimalField("barème (devoir en fichier)", max_digits=5, decimal_places=2, default=20)
    duration_min = models.PositiveSmallIntegerField("durée de l'épreuve en minutes", null=True, blank=True)
    shuffle = models.BooleanField("ordre des questions et des réponses mélangé", default=True)
    correction = models.CharField(max_length=6, choices=CORRECTIONS, default="fin")
    correction_open = models.BooleanField(default=False)
    max_leaves = models.PositiveSmallIntegerField("sorties de la page tolérées pendant l'épreuve (0 : pas de limite)", default=3)
    published = models.BooleanField("envoyé à la classe", default=False)
    evaluation = models.ForeignKey("grades.Evaluation", null=True, blank=True, on_delete=models.SET_NULL, related_name="homeworks")
    created_at = models.DateTimeField(auto_now_add=True)

    CURSUS_LOOKUP = "school_class__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        ordering = ["-due_at", "-id"]


class Question(TenantModel):
    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE, related_name="questions")
    position = models.PositiveSmallIntegerField(default=0)
    kind = models.CharField(max_length=3, choices=QUESTION_KINDS)
    text = models.CharField(max_length=600)
    choices = models.JSONField(default=list)   # textes des réponses proposées
    correct = models.JSONField(default=list)   # indices des bonnes réponses
    points = models.DecimalField(max_digits=4, decimal_places=2, default=1)

    CURSUS_LOOKUP = "assignment__school_class__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        ordering = ["position", "id"]


def submission_path(instance, filename):
    return attachment_path(instance, filename).replace("devoirs/", "copies/", 1)


class Submission(TenantModel):
    """La copie d'un élève : fichier rendu, ou tentative d'épreuve (début, échéance, réponses cochées, note)."""

    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE, related_name="submissions")
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="submissions")
    file = models.FileField(upload_to=submission_path, blank=True)
    file_name = models.CharField(max_length=200, blank=True)
    comment = models.CharField(max_length=500, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    late = models.BooleanField(default=False)
    started_at = models.DateTimeField(null=True, blank=True)
    deadline_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    answers = models.JSONField(default=dict)
    score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    feedback = models.CharField(max_length=500, blank=True)
    graded_at = models.DateTimeField(null=True, blank=True)
    leaves = models.PositiveSmallIntegerField("sorties de la page pendant l'épreuve", default=0)
    manual = models.BooleanField("saisie par l'enseignant (copie papier)", default=False)

    CURSUS_LOOKUP = "student__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["assignment", "student"], name="one_submission_per_student")]

    @property
    def status(self) -> str:
        if self.graded_at and self.assignment.kind == "fichier":
            return "corrige"
        if self.assignment.kind == "epreuve":
            return "termine" if self.finished_at else "en_cours"
        return "rendu" if self.submitted_at else "a_faire"


def resource_path(instance, filename):
    return attachment_path(instance, filename).replace("devoirs/", "supports/", 1)


class Resource(TenantModel):
    """Un support de cours (liens, fichier) ou un cours en direct (lien de visioconférence à une date) pour une classe et une matière."""

    KINDS = [("support", "Support de cours"), ("direct", "Cours en direct")]
    school_class = models.ForeignKey(SchoolClass, on_delete=models.CASCADE, related_name="resources")
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name="resources")
    teacher = models.ForeignKey(Teacher, null=True, on_delete=models.SET_NULL, related_name="resources")
    kind = models.CharField(max_length=8, choices=KINDS)
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    links = models.JSONField(default=list)   # [{"url": "https://…", "label": "…"}]
    file = models.FileField(upload_to=resource_path, blank=True)
    file_name = models.CharField(max_length=200, blank=True)
    starts_at = models.DateTimeField(null=True, blank=True)   # cours en direct : début
    ends_at = models.DateTimeField(null=True, blank=True)     # cours en direct : fin
    created_at = models.DateTimeField(auto_now_add=True)

    CURSUS_LOOKUP = "school_class__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        ordering = ["-created_at", "-id"]
