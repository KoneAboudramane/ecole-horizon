from django.conf import settings
from django.db import models

from apps.core.tenancy import TenantModel
from .horaires import default_horaires
from .tranches import default_tranches

CYCLES = [("college", "Collège"), ("lycee", "Lycée")]
# Niveaux créés avec chaque école (système ivoirien) ; l'école les renomme, en ajoute (7e, 8e, 9e, 10e…), les réordonne ou les retire
DEFAULT_LEVELS = [("6e", "college", False), ("5e", "college", False), ("4e", "college", False), ("3e", "college", False),
                  ("2nde", "lycee", True), ("1ère", "lycee", True), ("Tle", "lycee", True)]
# Séries créées avec chaque école ; ensuite l'école les ajoute, renomme ou retire (Paramètres > Niveaux et séries)
DEFAULT_SERIES = {"2nde": ["A", "C"], "1ère": ["A", "C", "D"], "Tle": ["A", "C", "D"]}


class Cursus(TenantModel):
    """Cursus scolaire de l'école (français, arabe ou autre) : une école franco-arabe en a plusieurs, chacun avec ses propres
    niveaux, classes, notes et bulletins. Chaque école est créée avec le cursus français ; l'administrateur de la plateforme
    ajoute les autres à la demande de l'école."""

    LANGUES = [("fr", "Français"), ("ar", "Arabe"), ("en", "Anglais"), ("es", "Espagnol"), ("de", "Allemand")]
    nom = models.CharField(max_length=60)
    langue = models.CharField("langue du bulletin", max_length=2, choices=LANGUES, default="fr")
    nom_ecole = models.CharField("nom de l'école dans la langue du cursus", max_length=120, blank=True, help_text="Vide = nom de l'école.")
    ordre = models.PositiveSmallIntegerField(default=0)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["ordre", "id"]
        verbose_name = "cursus"
        verbose_name_plural = "cursus"
        constraints = [models.UniqueConstraint(fields=["etablissement", "nom"], name="uniq_cursus_nom")]

    def __str__(self):
        return self.nom

    @property
    def rtl(self) -> bool:
        return self.langue == "ar"


DEFAULT_CURSUS = {"nom": "Cursus français", "langue": "fr"}


def ensure_default_cursus() -> "Cursus":
    """Le cursus français de l'école courante, créé s'il n'existe aucun cursus."""
    return Cursus.objects.first() or Cursus.objects.create(**DEFAULT_CURSUS)


def bootstrap_cursus(c: Cursus) -> None:
    """Prépare un cursus ajouté : les périodes de l'année en cours (reprises du premier cursus, modifiables ensuite) et ses réglages.
    Ses niveaux, séries et matières restent à saisir par l'école, dans la langue du cursus."""
    first = Cursus.all_objects.filter(etablissement_id=c.etablissement_id).exclude(pk=c.pk).order_by("ordre", "id").first()
    year = SchoolYear.all_objects.filter(etablissement_id=c.etablissement_id, current=True).first()
    if first and year:
        for t in Term.all_objects.filter(year=year, cursus=first):
            Term.all_objects.create(etablissement_id=c.etablissement_id, cursus=c, year=year, code=t.code, label=t.label, start=t.start, end=t.end, coef=t.coef)
    from apps.core.tenancy import cursus_context, tenant_context
    with tenant_context(c.etablissement_id), cursus_context(c):
        SchoolSettings.load()


def cursus_usage(c: Cursus) -> int:
    """Nombre de données rattachées à un cursus (classes, niveaux…) : un cursus n'est retiré que vide.
    Compté sans le filtre d'établissement (`_base_manager`) : appelé aussi depuis la plateforme, hors de toute école.
    Les périodes, créées avec le cursus, ne comptent pas : elles sont retirées avec lui."""
    return sum(rel.related_model._base_manager.filter(**{rel.field.name: c}).count() for rel in c._meta.related_objects
               if rel.one_to_many and rel.related_model is not Term)


def groupe_for(level: str, serie: str = "") -> str:
    """Groupe de coefficients d'une classe : son niveau (« 6e ») ou, pour un niveau à séries, le niveau et la série (« Tle C »).
    Chaque groupe a ses propres coefficients (Matières et coefficients)."""
    level, serie = level.strip(), (serie or "").strip().upper()
    if not level:
        raise ValueError("Niveau inconnu.")
    return f"{level} {serie}" if serie else level


class Level(TenantModel):
    """Niveau de classe propre à l'école, dans l'ordre du cursus : le niveau suivant est celui du passage, le dernier mène au
    diplôme (anciens élèves). Un niveau « à séries » (2nde, 1ère, Tle, 10e…) demande une série à chaque classe."""

    name = models.CharField("nom", max_length=10)
    order = models.PositiveSmallIntegerField("ordre", default=0)
    cycle = models.CharField("cycle", max_length=8, choices=CYCLES, default="college")
    has_series = models.BooleanField("à séries", default=False)

    CURSUS_LOOKUP = "cursus"
    cursus = models.ForeignKey("academics.Cursus", null=True, blank=True, on_delete=models.PROTECT, related_name="levels")

    class Meta:
        ordering = ["order", "id"]
        constraints = [models.UniqueConstraint(fields=["etablissement", "cursus", "name"], name="uniq_level")]

    def __str__(self):
        return self.name


def ensure_levels() -> None:
    """Crée les niveaux habituels d'une école qui n'en a encore aucun."""
    if not Level.objects.exists():
        Level.objects.bulk_create([Level(name=n, order=i, cycle=c, has_series=s) for i, (n, c, s) in enumerate(DEFAULT_LEVELS)])


def level_names() -> list[str]:
    """Niveaux de l'école dans l'ordre du cursus."""
    return list(Level.objects.values_list("name", flat=True))


def next_level(level: str, names: list[str] | None = None) -> str | None:
    """Niveau suivant (passage) ; None pour le dernier niveau (fin de cursus) ou un niveau inconnu."""
    names = level_names() if names is None else names
    i = names.index(level) if level in names else -1
    return names[i + 1] if 0 <= i < len(names) - 1 else None


def valid_groupes() -> list[str]:
    """Groupes de coefficients de l'école : chaque niveau sans séries, puis chaque série."""
    return [*Level.objects.filter(has_series=False).values_list("name", flat=True), *(s.groupe for s in Serie.objects.all())]


class SchoolYear(TenantModel):
    label = models.CharField("année", max_length=9)  # 2026-2027
    current = models.BooleanField("année en cours", default=False)

    class Meta:
        ordering = ["-label"]
        verbose_name = "année scolaire"
        constraints = [models.UniqueConstraint(fields=["etablissement", "label"], name="uniq_year_per_school")]

    def __str__(self):
        return self.label

    def save(self, *a, **kw):
        super().save(*a, **kw)
        if self.current:
            SchoolYear.objects.exclude(pk=self.pk).filter(current=True).update(current=False)

    @classmethod
    def get_current(cls):
        return cls.objects.filter(current=True).first() or cls.objects.first()

    @property
    def short(self) -> str:
        """« 26 » pour 2026-2027 (sert au matricule)."""
        return self.label[2:4]


class Term(TenantModel):
    year = models.ForeignKey(SchoolYear, on_delete=models.CASCADE, related_name="terms")
    code = models.CharField(max_length=3)  # identifiant interne : T1, T2… ou P4 (libellé et dates propres à l'école)
    label = models.CharField(max_length=40)
    start = models.DateField()
    end = models.DateField()
    locked = models.BooleanField("clôturé", default=False)
    conduct_published = models.BooleanField("notes de conduite publiées aux familles", default=False)
    # Poids de la période dans la moyenne annuelle (usage ivoirien : 1er trimestre 1, les suivants 2), modifiable par l'école
    coef = models.PositiveSmallIntegerField("coefficient dans la moyenne annuelle", default=2)

    CURSUS_LOOKUP = "cursus"
    cursus = models.ForeignKey("academics.Cursus", null=True, blank=True, on_delete=models.CASCADE, related_name="terms")   # retirées avec un cursus vide

    class Meta:
        ordering = ["year", "start", "code"]
        constraints = [models.UniqueConstraint(fields=["year", "cursus", "code"], name="uniq_term_per_year")]

    def __str__(self):
        return f"{self.label} {self.year}"


class Subject(TenantModel):
    code = models.SlugField(max_length=12)
    name = models.CharField(max_length=60)
    short = models.CharField(max_length=12)

    CURSUS_LOOKUP = "cursus"
    cursus = models.ForeignKey("academics.Cursus", null=True, blank=True, on_delete=models.PROTECT, related_name="subjects")

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["etablissement", "cursus", "code"], name="uniq_subject_code"),
                       models.UniqueConstraint(fields=["etablissement", "cursus", "name"], name="uniq_subject_name")]

    def __str__(self):
        return self.name


class Serie(TenantModel):
    """Série du lycée propre à l'école (A, C, D, A1, E, G2…) pour un niveau. Elle donne son groupe de coefficients aux classes."""

    level = models.CharField("niveau", max_length=10)
    code = models.CharField("code", max_length=10)
    name = models.CharField("nom", max_length=40, blank=True)

    CURSUS_LOOKUP = "cursus"
    cursus = models.ForeignKey("academics.Cursus", null=True, blank=True, on_delete=models.PROTECT, related_name="series")

    class Meta:
        ordering = ["level", "code"]
        constraints = [models.UniqueConstraint(fields=["etablissement", "cursus", "level", "code"], name="uniq_serie")]

    def __str__(self):
        return self.groupe

    @property
    def groupe(self) -> str:
        return groupe_for(self.level, self.code)


def ensure_series() -> None:
    """Crée les séries habituelles d'une école qui n'en a encore aucune."""
    if not Serie.objects.exists():
        lv_ok = set(Level.objects.filter(has_series=True).values_list("name", flat=True))
        Serie.objects.bulk_create([Serie(level=lv, code=c) for lv, codes in DEFAULT_SERIES.items() if lv in lv_ok for c in codes])


class SchoolClass(TenantModel):
    CYCLES = CYCLES
    name = models.CharField(max_length=30)
    level = models.CharField(max_length=10)
    serie = models.CharField(max_length=10, blank=True)
    groupe = models.CharField("groupe de coefficients", max_length=20)
    max_students = models.PositiveSmallIntegerField(default=45)
    cycle = models.CharField(max_length=8, choices=CYCLES)
    room = models.ForeignKey("Room", null=True, blank=True, on_delete=models.SET_NULL, related_name="classes")
    # Professeur principal : attribué par la direction ou le secrétariat. Il voit toutes les notes de sa classe (lecture seule),
    # rédige l'avis du conseil et suit l'assiduité et la discipline de ses élèves (voir apps.grades.principal).
    prof_principal = models.ForeignKey("Teacher", null=True, blank=True, on_delete=models.SET_NULL, related_name="principal_of",
                                       verbose_name="professeur principal")

    CURSUS_LOOKUP = "cursus"
    cursus = models.ForeignKey("academics.Cursus", null=True, blank=True, on_delete=models.PROTECT, related_name="classes")

    class Meta:
        ordering = ["id"]
        verbose_name = "classe"
        constraints = [models.UniqueConstraint(fields=["etablissement", "cursus", "name"], name="uniq_class_name")]

    def __str__(self):
        return self.name


class Room(TenantModel):
    """Salle de l'école. Une classe a une salle principale ; les salles spécialisées (labo, informatique, sport) se réservent par créneau."""

    KINDS = [("classe", "Salle de classe"), ("labo", "Laboratoire"), ("info", "Salle informatique"), ("sport", "Terrain / gymnase"), ("autre", "Autre")]
    name = models.CharField(max_length=40)
    capacity = models.PositiveSmallIntegerField("places", default=45)
    kind = models.CharField(max_length=6, choices=KINDS, default="classe")

    class Meta:
        ordering = ["kind", "name"]
        verbose_name = "salle"
        constraints = [models.UniqueConstraint(fields=["etablissement", "name"], name="uniq_room_name")]

    def __str__(self):
        return self.name


class Coefficient(TenantModel):
    """Coefficient d'une matière pour un groupe de classes. Absent = la matière n'est pas enseignée à ce groupe."""

    groupe = models.CharField("groupe de coefficients", max_length=20)      # « 6e », « Tle C »… (voir groupe_for)
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name="coefficients")
    value = models.PositiveSmallIntegerField()

    CURSUS_LOOKUP = "cursus"
    cursus = models.ForeignKey("academics.Cursus", null=True, blank=True, on_delete=models.PROTECT, related_name="coefficients")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["etablissement", "cursus", "groupe", "subject"], name="uniq_coef")]


class Teacher(TenantModel):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="teacher")
    subjects = models.ManyToManyField(Subject, blank=True, related_name="teachers")
    max_hours = models.PositiveSmallIntegerField("heures maximum par semaine", null=True, blank=True)
    # Disponibilités pour l'emploi du temps : {"jour-créneau": "x"} indisponible, "p" plutôt pas ; un créneau absent est disponible
    dispo = models.JSONField("indisponibilités", default=dict, blank=True)
    dispo_at = models.DateTimeField("disponibilités saisies le", null=True, blank=True)

    class Meta:
        ordering = ["user__full_name"]

    def __str__(self):
        return self.user.name


class TeachingAssignment(TenantModel):
    """Qui enseigne quelle matière dans quelle classe (un seul enseignant par couple classe-matière)."""

    teacher = models.ForeignKey(Teacher, on_delete=models.CASCADE, related_name="assignments")
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name="assignments")
    school_class = models.ForeignKey(SchoolClass, on_delete=models.CASCADE, related_name="assignments")

    CURSUS_LOOKUP = "school_class__cursus"   # cloisonnement par cursus (voir apps.core.tenancy)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["school_class", "subject"], name="uniq_assignment")]


class SchoolSettings(TenantModel):
    """Réglages de l'établissement (une seule ligne) : identité, calcul des moyennes, remise fratrie."""

    TEMPLATES = [("classique", "Classique"), ("moderne", "Moderne"), ("compact", "Compact")]
    name = models.CharField(max_length=120, default="Collège-Lycée Horizon")
    address = models.CharField(max_length=200, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    director = models.CharField(max_length=120, blank=True)
    hue = models.PositiveSmallIntegerField(default=155)
    template = models.CharField(max_length=10, choices=TEMPLATES, default="classique")
    # En-tête officiel du bulletin (modèle classique) : pays et devise, modifiables par l'école ; vide = ligne omise
    entete_pays = models.CharField("en-tête du bulletin : pays", max_length=80, blank=True, default="République de Côte d’Ivoire")
    entete_devise = models.CharField("en-tête du bulletin : devise", max_length=80, blank=True, default="Union – Discipline – Travail")
    compo_weight = models.DecimalField("poids de la composition", max_digits=3, decimal_places=2, default=0.5)
    seuil_tb = models.DecimalField(max_digits=4, decimal_places=2, default=16)
    seuil_b = models.DecimalField(max_digits=4, decimal_places=2, default=14)
    seuil_ab = models.DecimalField(max_digits=4, decimal_places=2, default=12)
    seuil_p = models.DecimalField(max_digits=4, decimal_places=2, default=10)
    remise_fratrie = models.PositiveSmallIntegerField("remise fratrie (%)", default=10)
    logo = models.TextField("logo (image en data URL)", blank=True, default="")
    horaires = models.JSONField("horaires de cours", default=default_horaires, blank=True)
    tranches = models.JSONField("tranches de scolarité", default=default_tranches, blank=True)
    # Passage en classe supérieure : moyennes annuelles choisies par l'école
    passage_niveaux = models.JSONField("moyennes de passage par niveau", default=dict, blank=True)
    passage_admission = models.DecimalField("moyenne d'admission", max_digits=4, decimal_places=2, default=10)
    passage_redoublement = models.DecimalField("moyenne sous laquelle on redouble", max_digits=4, decimal_places=2, default=8)
    passage_exclusion = models.DecimalField("moyenne sous laquelle l'exclusion est proposée", max_digits=4, decimal_places=2, null=True, blank=True)
    # Conduite : note maximale de départ, retraits, place dans la moyenne générale (tout est choisi par l'école)
    conduite_max = models.DecimalField("note de conduite maximale", max_digits=4, decimal_places=1, default=20)
    conduite_in_average = models.BooleanField("la conduite entre dans la moyenne générale", default=True)
    conduite_coef = models.DecimalField("coefficient de la conduite", max_digits=3, decimal_places=1, default=1)
    absence_tranche = models.PositiveSmallIntegerField("absences non justifiées par retrait (0 : aucune règle)", default=3)
    absence_points = models.DecimalField("points retirés par tranche d'absences", max_digits=3, decimal_places=1, default=1)
    justif_delai = models.PositiveSmallIntegerField("délai pour justifier une absence, en jours (0 : sans délai)", default=0)
    # Disponibilités des enseignants avant l'emploi du temps
    dispo_limite = models.DateField("date limite de saisie des disponibilités", null=True, blank=True)
    dispo_ratio = models.DecimalField("créneaux disponibles exigés par heure de cours (0 : aucun minimum)", max_digits=3, decimal_places=1, default=1.5)
    conduite_baremes = models.JSONField("retrait conseillé par sanction", default=dict, blank=True)
    # Ce que l'élève voit : le cahier de textes est réservé aux parents et au personnel, sauf choix contraire de l'école
    eleve_voit_cahier = models.BooleanField("l'élève voit le cahier de textes", default=False)
    devoirs_actifs = models.BooleanField("devoirs et épreuves en ligne ouverts", default=False)
    # Bulletin réservé aux familles à jour : « retard » (échéances échues réglées), « total » (scolarité de l'année soldée) ou « aucun »
    BLOCAGES = [("aucun", "Jamais bloqué"), ("retard", "Échéances échues réglées"), ("total", "Scolarité de l'année soldée")]
    bulletin_blocage = models.CharField("bulletin des familles bloqué si impayé", max_length=6, choices=BLOCAGES, default="retard")

    CURSUS_LOOKUP = "cursus"
    cursus = models.ForeignKey("academics.Cursus", null=True, blank=True, on_delete=models.CASCADE, related_name="+")

    class Meta:
        verbose_name = "réglages de l'établissement"
        constraints = [models.UniqueConstraint(fields=["etablissement", "cursus"], name="one_settings_per_school")]

    # Réglages communs à toute l'école (identité, scolarité, ce que voient les familles) : identiques dans chacun de ses cursus.
    # Les autres (bulletin, calcul des moyennes, passage, conduite, horaires…) sont propres à chaque cursus.
    SHARED = ("name", "address", "phone", "email", "hue", "logo", "remise_fratrie", "tranches", "bulletin_blocage", "eleve_voit_cahier", "devoirs_actifs")

    @classmethod
    def load(cls):
        """Réglages du cursus courant de l'établissement courant ; créés au premier accès, avec les réglages communs de l'école."""
        from apps.core.tenancy import UNSET, current_cursus, current_or_default, default_cursus_id
        etab = current_or_default()
        cursus = current_cursus()
        cursus = cursus if cursus is not UNSET else default_cursus_id(etab)
        obj = cls.all_objects.filter(etablissement_id=etab, cursus_id=cursus).first()
        if obj is None:
            first = cls.all_objects.filter(etablissement_id=etab).order_by("id").first()
            obj = cls(etablissement_id=etab, cursus_id=cursus, **({k: getattr(first, k) for k in cls.SHARED} if first else {}))
            obj.save()
        return obj

    def save(self, *a, **kw):
        super().save(*a, **kw)
        fields = kw.get("update_fields")
        shared = [k for k in self.SHARED if fields is None or k in fields]
        if shared:   # les réglages communs restent identiques dans tous les cursus de l'école
            type(self).all_objects.filter(etablissement_id=self.etablissement_id).exclude(pk=self.pk).update(**{k: getattr(self, k) for k in shared})

    def director_name(self) -> str:
        """Nom du directeur imprimé sur les bulletins : celui des Paramètres, à défaut celui du compte de direction actif."""
        if self.director.strip():
            return self.director.strip()
        from apps.accounts.models import User
        return User.all_objects.filter(etablissement_id=self.etablissement_id, role="directeur", is_active=True) \
            .order_by("id").values_list("full_name", flat=True).first() or ""

    @property
    def seuils(self) -> list[float]:
        return [float(self.seuil_tb), float(self.seuil_b), float(self.seuil_ab), float(self.seuil_p)]


class YearRollover(TenantModel):
    """Passage d'une année à la suivante : conserve l'état d'avant pour pouvoir annuler tant que rien n'a été fait dans la nouvelle année."""

    from_year = models.ForeignKey(SchoolYear, on_delete=models.PROTECT, related_name="rollovers_from")
    to_year = models.ForeignKey(SchoolYear, on_delete=models.PROTECT, related_name="rollovers_to")
    snapshot = models.JSONField(default=dict)
    by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL)
    date = models.DateTimeField(auto_now_add=True)
    undone = models.BooleanField(default=False)

    class Meta:
        ordering = ["-id"]
