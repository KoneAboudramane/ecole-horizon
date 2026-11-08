from django import forms
from django.contrib import admin, messages
from django.contrib.auth import password_validation
from django.contrib.auth.admin import UserAdmin

from apps.core.log import plog

from django.contrib.admin.forms import AdminAuthenticationForm

from .models import PlatformAdminAccount, TotpDevice, User


class OtpAdminAuthenticationForm(AdminAuthenticationForm):
    """Connexion à l'administration Django : demande le code de double authentification quand le compte l'a activée."""

    otp = forms.CharField(label="Code de vérification (si activé)", required=False, max_length=20, widget=forms.TextInput(attrs={"autocomplete": "one-time-code", "inputmode": "numeric"}))

    def clean(self):
        data = super().clean()
        user = self.get_user()
        dev = user and TotpDevice.objects.filter(user=user, confirmed=True).first()
        if dev and not dev.verifier(self.cleaned_data.get("otp", "").strip()):
            raise forms.ValidationError("Code de vérification manquant ou incorrect.", code="otp")
        return data


admin.site.login_form = OtpAdminAuthenticationForm


@admin.register(User)
class SchoolUserAdmin(UserAdmin):
    """Comptes des écoles. Les administrateurs de la plateforme ont leur propre écran."""

    list_display = ("username", "etablissement", "full_name", "role", "phone", "is_active", "must_change_password")
    list_filter = ("etablissement", "role", "is_active")
    search_fields = ("username", "full_name", "phone")
    ordering = ("full_name",)
    fieldsets = (
        (None, {"fields": ("etablissement", "username", "password")}),
        ("Identité", {"fields": ("full_name", "role", "phone", "email", "lang", "photo")}),
        ("Sécurité", {"fields": ("is_active", "must_change_password", "failed_attempts", "locked_until", "groups", "user_permissions")}),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("etablissement", "username", "full_name", "role", "email", "password1", "password2")}),)

    def get_queryset(self, request):
        return User.all_objects.filter(etablissement__isnull=False)

    def save_model(self, request, obj, form, change):
        if obj.etablissement_id is None:
            self.message_user(request, "Choisissez l’établissement : rien n’a été enregistré.", messages.ERROR)
            return
        obj.is_superuser = obj.is_staff = False  # un compte d'école n'accède jamais à l'administration
        super().save_model(request, obj, form, change)
        plog(request, "Compte modifié (admin)" if change else "Compte créé (admin)", f"{obj.etablissement.code} / {obj.username}", etab=obj.etablissement)


class PlatformAdminForm(forms.ModelForm):
    password1 = forms.CharField(label="Mot de passe", widget=forms.PasswordInput, strip=False)
    password2 = forms.CharField(label="Confirmation", widget=forms.PasswordInput, strip=False)

    class Meta:
        model = PlatformAdminAccount
        fields = ("username", "full_name", "email", "platform_owner")

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if not email:
            raise forms.ValidationError("L’e-mail est obligatoire (mot de passe oublié).")
        if User.all_objects.filter(etablissement__isnull=True, email__iexact=email).exists():
            raise forms.ValidationError("Cette adresse est déjà utilisée par un administrateur.")
        return email

    def clean_username(self):
        u = self.cleaned_data["username"].strip().lower()
        if User.all_objects.filter(etablissement__isnull=True, username__iexact=u).exists():
            raise forms.ValidationError("Cet identifiant existe déjà.")
        return u

    def clean(self):
        d = super().clean()
        if d.get("password1") != d.get("password2"):
            raise forms.ValidationError("Les deux mots de passe ne correspondent pas.")
        if d.get("password1"):
            password_validation.validate_password(d["password1"])
        return d


@admin.register(PlatformAdminAccount)
class PlatformAdminAdmin(admin.ModelAdmin):
    """Administrateurs de la plateforme. C'est ici (et nulle part ailleurs) qu'on désactive ou supprime l'un d'eux."""

    list_display = ("username", "full_name", "email", "platform_owner", "platform_pending", "is_active", "last_login")
    actions = ["desactiver", "reactiver", "retirer_2fa"]
    fields = ("username", "full_name", "email", "platform_owner", "is_active", "platform_pending", "must_change_password", "last_login")
    readonly_fields = ("last_login",)

    def get_queryset(self, request):
        return PlatformAdminAccount.all_objects.filter(etablissement__isnull=True, is_superuser=True)

    def get_form(self, request, obj=None, **kw):
        if obj is None:
            kw["form"] = PlatformAdminForm
        return super().get_form(request, obj, **kw)

    def get_fields(self, request, obj=None):
        return ("username", "full_name", "email", "platform_owner", "password1", "password2") if obj is None else self.fields

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields + (("username",) if obj else ())

    def save_model(self, request, obj, form, change):
        obj.etablissement, obj.role, obj.is_superuser, obj.is_staff = None, "", True, True
        if not change:
            obj.set_password(form.cleaned_data["password1"])
            obj.must_change_password = True
        super().save_model(request, obj, form, change)
        plog(request, "Administrateur modifié (admin)" if change else "Administrateur créé (admin)", obj.username)

    def has_delete_permission(self, request, obj=None):
        if obj is None:
            return False  # pas de suppression en masse
        return obj.pk != request.user.pk and self.get_queryset(request).filter(is_active=True).exclude(pk=obj.pk).exists()

    def delete_model(self, request, obj):
        plog(request, "Administrateur supprimé (admin)", obj.username)
        super().delete_model(request, obj)

    @admin.action(description="Désactiver les administrateurs sélectionnés")
    def desactiver(self, request, qs):
        qs = qs.exclude(pk=request.user.pk)
        if not self.get_queryset(request).filter(is_active=True).exclude(pk__in=qs.values("pk")).exists():
            self.message_user(request, "Il doit rester au moins un administrateur actif.", messages.ERROR)
            return
        for u in qs:
            plog(request, "Administrateur désactivé (admin)", u.username)
        qs.update(is_active=False)

    @admin.action(description="Réactiver les administrateurs sélectionnés")
    def reactiver(self, request, qs):
        qs.update(is_active=True, platform_pending=False)


    @admin.action(description="Retirer la double authentification (téléphone perdu)")
    def retirer_2fa(self, request, qs):
        qs = qs.exclude(pk=request.user.pk)  # on ne s'ôte pas soi-même sa protection ; voir la commande reset_2fa
        for u in qs:
            if TotpDevice.objects.filter(user=u).delete()[0]:
                plog(request, "Double authentification retirée (admin)", u.username)
        self.message_user(request, "Double authentification retirée pour les comptes sélectionnés (sauf le vôtre).")
