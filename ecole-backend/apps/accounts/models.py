import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractUser, UserManager as BaseUserManager
from django.db import models
from django.utils import timezone

from apps.core.permissions import ROLE_LABELS, ROLES, perms_for
from apps.core.tenancy import TenantManagerMixin, TenantModel, current_or_default

LANGS = ["fr", "en", "ar", "es", "de"]


def photo_path(instance, filename):
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    # Nom aléatoire : l'adresse d'une photo ne peut pas se deviner à partir du numéro de compte
    return f"photos/user-{instance.pk}-{uuid.uuid4().hex[:16]}.{ext}"


class UserManager(TenantManagerMixin, BaseUserManager):
    def get_by_natural_key(self, username):
        # Les comptes de plateforme (sans école) sont les seuls à se connecter par l'administration Django.
        return self.get(username=username, etablissement__isnull=True)


class Role(TenantModel):
    """Un rôle de l'école : un nom et un paquet de droits. Créé avec l'école à partir des rôles par défaut, puis modifiable.

    `base` est le « type » de rôle que le code connaît (il règle la portée : un enseignant ne voit que ses classes, un parent
    que ses enfants) ; les droits eux viennent de `perms`. Les rôles parent et élève sont verrouillés."""

    key = models.SlugField("clé", max_length=40)
    label = models.CharField("nom", max_length=60)
    base = models.CharField(max_length=20, choices=[(r, ROLE_LABELS[r]) for r in ROLES])
    perms = models.JSONField("droits", default=list, blank=True)
    locked = models.BooleanField("droits verrouillés", default=False)
    builtin = models.BooleanField("créé avec l'école", default=False)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["label"]
        constraints = [models.UniqueConstraint(fields=["etablissement", "key"], name="uniq_role_key_per_school")]
        verbose_name = "rôle"

    def __str__(self):
        return self.label


class User(AbstractUser):
    """Compte de connexion. Un compte = une personne = un rôle.

    L'identifiant de connexion (`username`) est : le matricule pour un élève, le téléphone ou un identifiant
    court pour le personnel et les parents. `first_name`/`last_name` ne sont pas utilisés : le nom complet
    est dans `full_name`, comme dans l'interface.
    """

    ROLE_CHOICES = [(r, ROLE_LABELS[r]) for r in ROLES]

    etablissement = models.ForeignKey("core.Etablissement", null=True, blank=True, on_delete=models.CASCADE, related_name="+",
                                      verbose_name="établissement", help_text="Vide = administrateur de la plateforme.")
    username = models.CharField("identifiant", max_length=150)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, db_index=True, blank=True)
    role_ref = models.ForeignKey("accounts.Role", null=True, blank=True, on_delete=models.PROTECT, related_name="members", verbose_name="rôle de l'école")
    full_name = models.CharField("nom complet", max_length=150)
    phone = models.CharField("téléphone", max_length=30, blank=True)
    lang = models.CharField(max_length=2, default="fr")
    photo = models.ImageField(upload_to=photo_path, blank=True)
    must_change_password = models.BooleanField(default=False)
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    # Administrateurs de la plateforme : le principal gère les autres ; une invitation reste « en attente » jusqu'à sa validation.
    platform_owner = models.BooleanField("administrateur principal", default=False)
    platform_pending = models.BooleanField("invitation à valider", default=False)
    invited_by = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    # École à plusieurs cursus : cursus où travaille ce compte du personnel ; aucun = tous (voir apps.accounts.perimetre)
    cursus = models.ManyToManyField("academics.Cursus", blank=True, related_name="+", verbose_name="cursus (périmètre)")

    first_name = None
    last_name = None

    objects = UserManager()
    all_objects = BaseUserManager()  # sans filtre d'école : connexion et administration de la plateforme

    class Meta:
        ordering = ["full_name", "username"]
        constraints = [
            models.UniqueConstraint(fields=["etablissement", "username"], name="uniq_username_per_school"),
            models.UniqueConstraint(fields=["username"], condition=models.Q(etablissement__isnull=True), name="uniq_username_platform"),
        ]
        verbose_name = "compte"
        verbose_name_plural = "comptes"

    def save(self, *a, **kw):
        if self.etablissement_id is None and not self.is_superuser:
            self.etablissement_id = current_or_default()
            if kw.get("update_fields") is not None:
                kw["update_fields"] = list(kw["update_fields"]) + ["etablissement"]
        # Le rôle de l'école suit le type de rôle : à défaut, le rôle par défaut de ce type dans l'école
        if self.etablissement_id and self.role and (self.role_ref_id is None or (self.role_ref_id and self.role_ref.base != self.role)):
            ref = Role.all_objects.filter(etablissement_id=self.etablissement_id, key=self.role).first()
            self.role_ref = ref
            if kw.get("update_fields") is not None:
                kw["update_fields"] = list(kw["update_fields"]) + ["role_ref"]
        creating = self._state.adding
        super().save(*a, **kw)
        if creating and self.etablissement_id and self.role in ("directeur", "educateur", "personnel"):
            # Directeur, éducateur, rôle créé par l'école : un cursus par défaut, le cursus courant (sinon le premier de l'école)
            from apps.core.tenancy import UNSET, current_cursus, default_cursus_id
            cur = current_cursus()
            self.cursus.add(cur if cur is not UNSET else default_cursus_id(self.etablissement_id))

    @property
    def is_platform_owner(self) -> bool:
        """Administrateur principal de la plateforme : valide, désactive et réinitialise les autres administrateurs."""
        return self.is_platform_admin and self.platform_owner

    @property
    def is_platform_admin(self) -> bool:
        return self.is_superuser and self.etablissement_id is None

    def __str__(self):
        return f"{self.full_name or self.username} ({self.role_label})"

    @property
    def name(self) -> str:
        return self.full_name or self.username

    @property
    def role_label(self) -> str:
        """Nom du rôle tel que l'école l'a choisi."""
        if self.role_ref_id:
            return self.role_ref.label
        return ROLE_LABELS.get(self.role, "")

    @property
    def permissions_list(self) -> list[str]:
        return sorted(perms_for(self))

    # --- Verrouillage après des échecs répétés ---
    @property
    def is_locked(self) -> bool:
        return bool(self.locked_until and self.locked_until > timezone.now())

    def register_failure(self) -> None:
        self.failed_attempts += 1
        if self.failed_attempts >= settings.LOGIN_MAX_ATTEMPTS:
            self.locked_until = timezone.now() + timedelta(minutes=settings.LOGIN_LOCK_MINUTES)
            self.failed_attempts = 0
        self.save(update_fields=["failed_attempts", "locked_until"])

    def register_success(self) -> None:
        if self.failed_attempts or self.locked_until:
            self.failed_attempts = 0
            self.locked_until = None
            self.save(update_fields=["failed_attempts", "locked_until"])


class PlatformAdminAccount(User):
    """Administrateur de la plateforme (sans école). Existe pour avoir son propre écran dans l'administration Django."""

    class Meta:
        proxy = True
        verbose_name = "administrateur de la plateforme"
        verbose_name_plural = "administrateurs de la plateforme"


class TotpDevice(models.Model):
    """Double authentification d'un administrateur de la plateforme. Active quand `confirmed` est vrai."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="totp")
    secret = models.CharField(max_length=40)
    confirmed = models.BooleanField(default=False)
    last_step = models.BigIntegerField(default=0)
    recovery = models.JSONField(default=list, blank=True)  # empreintes SHA-256 des codes de secours non utilisés
    created = models.DateTimeField(auto_now_add=True)

    def verifier(self, code: str) -> bool:
        """Code de l'application ou code de secours (usage unique)."""
        from . import totp
        step = totp.verify(self.secret, code, self.last_step)
        if step:
            self.last_step = step
            self.save(update_fields=["last_step"])
            return True
        h = totp.hash_code(code)
        if h in self.recovery:
            self.recovery = [x for x in self.recovery if x != h]
            self.save(update_fields=["recovery"])
            return True
        return False


def totp_required(user) -> bool:
    return bool(user and getattr(user, "pk", None) and TotpDevice.objects.filter(user=user, confirmed=True).exists())
