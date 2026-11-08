from rest_framework import serializers

from apps.core.permissions import STAFF_ROLES

from .models import LANGS, User
from .passwords import check_new_password

MAX_PHOTO = 2 * 1024 * 1024
PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}


class UserSerializer(serializers.ModelSerializer):
    """Représentation d'un compte, telle que l'interface la consomme."""

    name = serializers.CharField(source="full_name")
    role_label = serializers.SerializerMethodField()
    role_id = serializers.IntegerField(source="role_ref_id", read_only=True)
    photo = serializers.SerializerMethodField()
    permissions = serializers.ListField(source="permissions_list", child=serializers.CharField(), read_only=True)
    etablissement = serializers.SerializerMethodField()
    platform_admin = serializers.BooleanField(source="is_platform_admin", read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "name", "role", "role_id", "role_label", "phone", "email", "lang", "photo",
                  "must_change_password", "is_active", "permissions", "etablissement", "platform_admin", "cursus"]
        read_only_fields = fields

    def get_role_label(self, obj) -> str:
        return obj.role_label or "Administrateur de la plateforme"

    def get_etablissement(self, obj) -> dict | None:
        e = obj.etablissement
        if not e:
            return None
        out = {"code": e.code, "nom": e.nom, "lecture_seule": e.lecture_seule}
        if obj.role in ("directeur", "fondateur", "admin"):  # seule la direction est prévenue de l'échéance
            out["abonnement"] = {"etat": e.abonnement_etat, "fin": e.abonnement_fin, "jours": e.abonnement_jours}
        return out

    def get_photo(self, obj) -> str | None:
        if not obj.photo:
            return None
        req = self.context.get("request")
        return req.build_absolute_uri(obj.photo.url) if req else obj.photo.url


class ProfileUpdateSerializer(serializers.Serializer):
    """Ce que chacun peut modifier lui-même : jamais son rôle, son identifiant ni ses permissions."""

    name = serializers.CharField(max_length=150, required=False)
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    lang = serializers.ChoiceField(choices=LANGS, required=False)

    def validate_name(self, v):
        v = v.strip()
        if len(v) < 2:
            raise serializers.ValidationError("Indiquez votre nom complet.")
        return v

    def validate_email(self, v):
        user = self.instance
        v = v.strip().lower()
        if user is not None and user.role in STAFF_ROLES and v != (user.email or "").lower():
            raise serializers.ValidationError("L’adresse e-mail du personnel est gérée par l’administration de l’école.")
        return v

    def update(self, instance, validated):
        if "name" in validated:
            instance.full_name = validated["name"]
        for f in ("phone", "email", "lang"):
            if f in validated:
                setattr(instance, f, validated[f])
        instance.save()
        return instance


class LoginSerializer(serializers.Serializer):
    ecole = serializers.CharField(required=False, allow_blank=True, help_text="Code de l'établissement (facultatif s'il n'y en a qu'un ; « plateforme » pour l'administrateur).")
    username = serializers.CharField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    captcha_token = serializers.CharField(required=False, allow_blank=True, write_only=True)
    captcha_answer = serializers.CharField(required=False, allow_blank=True, write_only=True)
    otp = serializers.CharField(required=False, allow_blank=True, write_only=True, help_text="Code de double authentification (administrateurs de la plateforme).")


class PasswordChangeSerializer(serializers.Serializer):
    current = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
    new = serializers.CharField(trim_whitespace=False)
    confirm = serializers.CharField(required=False, trim_whitespace=False)

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.must_change_password:  # un mot de passe provisoire se remplace sans redonner l'ancien
            if not attrs.get("current") or not user.check_password(attrs["current"]):
                raise serializers.ValidationError({"current": "Le mot de passe actuel est incorrect."})
        check_new_password(attrs["new"], attrs.get("confirm"), attrs.get("current") or None)
        if user.check_password(attrs["new"]):
            raise serializers.ValidationError({"new": "Le nouveau mot de passe doit être différent de l’actuel."})
        return attrs


def staff_email_taken(email: str, exclude_pk=None) -> bool:
    """Deux membres du personnel d'une même école ne partagent pas la même adresse (le lien de réinitialisation y est envoyé)."""
    qs = User.objects.filter(role__in=STAFF_ROLES, email__iexact=email)
    return (qs.exclude(pk=exclude_pk) if exclude_pk else qs).exists()


class StaffCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150)
    role = serializers.ChoiceField(choices=STAFF_ROLES, required=False)
    role_id = serializers.IntegerField(required=False, help_text="Rôle de l'école (rôle par défaut ou rôle créé par l'école). Remplace `role`.")
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True)
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=True, error_messages={"required": "L’adresse e-mail est obligatoire pour le personnel.", "blank": "L’adresse e-mail est obligatoire pour le personnel."})
    cursus = serializers.ListField(child=serializers.IntegerField(), required=False, help_text="Cursus où travaille le compte ; liste vide = tous. Absent : selon le rôle.")

    def validate(self, a):
        if "role" not in a and "role_id" not in a:
            raise serializers.ValidationError({"role": "Choisissez un rôle."})
        return a

    def validate_email(self, v):
        v = v.strip().lower()
        if staff_email_taken(v):
            raise serializers.ValidationError("Cette adresse e-mail est déjà utilisée par un autre compte du personnel.")
        return v

    def validate_username(self, v):
        v = v.strip().lower()
        if len(v) < 3 or " " in v:
            raise serializers.ValidationError("L’identifiant doit contenir au moins 3 caractères, sans espace.")
        if User.objects.filter(username__iexact=v).exists():
            raise serializers.ValidationError("Cet identifiant est déjà utilisé.")
        return v


class UserAdminUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150, required=False)
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=STAFF_ROLES, required=False)
    role_id = serializers.IntegerField(required=False)
    cursus = serializers.ListField(child=serializers.IntegerField(), required=False, help_text="Cursus où travaille le compte ; liste vide = tous.")
