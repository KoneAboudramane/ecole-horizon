from django.conf import settings
from django.db import models

from apps.core.tenancy import TenantModel

from apps.academics.models import SchoolClass, SchoolYear


class Sequence(TenantModel):
    """Compteur nommé (numéro de matricule par année) : incrémenté sous verrou pour éviter les doublons."""

    name = models.CharField(max_length=30)
    value = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["etablissement", "name"], name="uniq_sequence_per_school")]


class Parent(TenantModel):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="parent_profile")
    phone_digits = models.CharField("téléphone (chiffres)", max_length=15)

    class Meta:
        ordering = ["user__full_name"]
        constraints = [models.UniqueConstraint(fields=["etablissement", "phone_digits"], name="uniq_parent_phone")]

    def __str__(self):
        return self.user.name


class Student(TenantModel):
    SEXES = [("M", "Garçon"), ("F", "Fille")]
    # Un seul compte par élève, même s'il suit plusieurs cursus (une inscription par cursus, voir `principal`)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="student_profiles")
    matricule = models.CharField(max_length=20)
    nom = models.CharField(max_length=60)
    prenoms = models.CharField(max_length=80)
    sexe = models.CharField(max_length=1, choices=SEXES)
    naissance = models.DateField()
    lieu = models.CharField(max_length=80, blank=True)
    # Vide pour un élève « à placer » (passé dans la nouvelle année ou inscrit « à répartir ») : son niveau est alors celui
    # de son inscription de l'année en cours (`current_level`), et il n'apparaît dans aucune classe.
    school_class = models.ForeignKey(SchoolClass, null=True, blank=True, on_delete=models.PROTECT, related_name="students")
    parent = models.ForeignKey(Parent, on_delete=models.PROTECT, related_name="children")
    urgence = models.CharField("contact d'urgence", max_length=40, blank=True)
    active = models.BooleanField("inscrit", default=True)
    # « placer » : passé dans la nouvelle année à son nouveau niveau, en attente d'une classe (Nouvelle année, étape 3).
    # L'élève reste mis de côté (inactif) jusqu'à ce qu'on lui attribue une classe ; son compte n'est pas bloqué.
    SORTIES = [("exclu", "Exclu(e)"), ("ancien", "Ancien élève"), ("parti", "Parti(e)"), ("placer", "À placer")]
    sortie = models.CharField("motif de sortie", max_length=6, choices=SORTIES, blank=True)
    solde_sortie = models.PositiveIntegerField("solde dû à la sortie", default=0)
    # Niveaux déjà redoublés (« 5e »…) : un élève qui devrait redoubler un niveau déjà redoublé est proposé à l'exclusion.
    # Rempli au passage d'année ; le secrétariat le coche pour les redoublements antérieurs à la plateforme.
    niveaux_redoubles = models.JSONField("niveaux déjà redoublés", default=list, blank=True)
    # École à plusieurs cursus : l'inscription dans un autre cursus est reliée à l'inscription principale (même personne :
    # même compte, même matricule, même parent ; l'identité est tenue à jour sur toutes ses inscriptions). Vide = inscription principale.
    principal = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE, related_name="autres_cursus", verbose_name="inscription principale")

    CURSUS_LOOKUP = "cursus"
    cursus = models.ForeignKey("academics.Cursus", null=True, blank=True, on_delete=models.PROTECT, related_name="students")

    class Meta:
        ordering = ["nom", "prenoms"]
        indexes = [models.Index(fields=["nom", "prenoms"])]
        constraints = [models.UniqueConstraint(fields=["etablissement", "cursus", "matricule"], name="uniq_matricule")]

    def __str__(self):
        return f"{self.nom} {self.prenoms}"

    IDENTITE = ("nom", "prenoms", "sexe", "naissance", "lieu", "parent", "urgence")

    def inscriptions(self):
        """Toutes les inscriptions de la personne, dans tous les cursus de l'école (la principale d'abord)."""
        root = self.principal_id or self.pk
        return Student._base_manager.filter(etablissement_id=self.etablissement_id).filter(models.Q(pk=root) | models.Q(principal_id=root)) \
            .select_related("cursus", "school_class").order_by("principal_id", "id")

    @property
    def full_name(self) -> str:
        return f"{self.nom} {self.prenoms}"

    @property
    def current_level(self) -> str:
        """Niveau de l'élève : celui de sa classe ; s'il est « à placer », celui de son inscription dans l'année en cours."""
        if self.school_class_id:
            return self.school_class.level
        if not hasattr(self, "_pending_level"):
            from apps.academics.models import SchoolYear
            self._pending_level = Enrollment.objects.filter(student=self, year=SchoolYear.get_current()).values_list("level", flat=True).first() or ""
        return self._pending_level

    @property
    def reinscription_state(self) -> str:
        """Élève à placer : « attente » (rien payé), « paye » (payé, à valider par le secrétariat) ou « valide ». Sinon vide."""
        if self.sortie != "placer":
            return ""
        from apps.academics.models import SchoolYear
        from apps.finance.models import Payment
        year = SchoolYear.get_current()
        e = Enrollment.objects.filter(student=self, year=year).first()
        if e is None:
            return ""
        if e.reinscrit:
            return "valide"
        return "paye" if Payment.objects.filter(student=self, year=year, status="confirme").exists() else "attente"

    @property
    def class_label(self) -> str:
        """Classe affichée (reçus, listes) : « 6e A », ou « 5e · à placer » tant que la classe n'est pas attribuée."""
        if self.school_class_id:
            return self.school_class.name
        return f"{self.current_level} · à placer" if self.current_level else "Sans classe"


# Élèves inscrits pour l'année en cours : ceux qui ont une classe et ceux qui attendent la leur (« à placer »).
# Sert à la scolarité (encaisser l'inscription avant que la classe soit choisie, remise fratrie).
ENROLLED = models.Q(active=True) | models.Q(sortie="placer")


class Enrollment(TenantModel):
    """Inscription d'un élève dans une classe pour une année (historique des passages de classe)."""

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="enrollments")
    year = models.ForeignKey(SchoolYear, on_delete=models.PROTECT, related_name="enrollments")
    # Vide tant que l'élève passé dans la nouvelle année n'a pas été placé : `level` dit alors à quel niveau il est inscrit
    school_class = models.ForeignKey(SchoolClass, null=True, blank=True, on_delete=models.PROTECT, related_name="enrollments")
    level = models.CharField("niveau (élève à placer)", max_length=10, blank=True)
    # Réinscription : un élève passé dans la nouvelle année n'est réparti dans une classe qu'une fois sa réinscription VALIDÉE
    # par le secrétariat (sur présentation du reçu de paiement, ou sans paiement avec un motif : boursier…). Les autres peuvent
    # ne jamais revenir : ils ne prennent pas de place.
    reinscrit = models.BooleanField("réinscription validée", default=True)
    reinscription_note = models.CharField("validation de la réinscription", max_length=200, blank=True)
    date = models.DateField(auto_now_add=True)
    report = models.PositiveIntegerField("solde reporté de l'année précédente", default=0)
    credit = models.PositiveIntegerField("avance reportée de l'année précédente (paiement en trop gardé)", default=0)

    CURSUS_LOOKUP = "student__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["student", "year"], name="one_enrollment_per_year")]
