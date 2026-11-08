from django import forms
from django.contrib import admin, messages

from .log import plog
from .models import AbonnementPaiement, ActivityLog, Etablissement, PlatformLog, PlatformSettings
from .schools import SchoolError, create_school


class EtablissementCreateForm(forms.ModelForm):
    """Création complète : l'école, son année, ses matières, ses classes et ses comptes de direction."""

    director = forms.CharField(label="Directeur / directrice", max_length=150)
    director_email = forms.EmailField(label="E-mail du directeur", required=False)
    founder = forms.CharField(label="Fondateur (facultatif)", max_length=150, required=False)
    secretary = forms.CharField(label="Secrétariat (facultatif)", max_length=150, required=False)

    class Meta:
        model = Etablissement
        fields = ("nom", "code", "prefixe")

    def clean_code(self):
        code = self.cleaned_data["code"].strip().lower()
        if code == "plateforme":
            raise forms.ValidationError("Ce code est réservé.")
        return code



@admin.register(Etablissement)
class EtablissementAdmin(admin.ModelAdmin):
    list_display = ("nom", "code", "prefixe", "actif", "created")
    list_filter = ("actif",)
    search_fields = ("nom", "code")
    def get_form(self, request, obj=None, **kw):
        if obj is None:
            kw["form"] = EtablissementCreateForm
        return super().get_form(request, obj, **kw)

    def get_fields(self, request, obj=None):
        if obj is None:
            return ("nom", "code", "prefixe", "director", "director_email", "founder", "secretary")
        return ("nom", "code", "prefixe", "actif", "abonnement_fin")

    def get_readonly_fields(self, request, obj=None):
        return ("code",) if obj else ()

    def save_model(self, request, obj, form, change):
        if change:
            super().save_model(request, obj, form, change)
            plog(request, "École modifiée (admin)", obj.code, etab=obj)
            return
        d = form.cleaned_data
        try:
            etab, rows = create_school(code=d["code"], nom=d["nom"], prefixe=d.get("prefixe", ""), director=d["director"], founder=d.get("founder", ""),
                                       secretary=d.get("secretary", ""), director_email=d.get("director_email", ""))
        except SchoolError as e:
            raise forms.ValidationError(str(e)) from e
        obj.pk, obj.created, obj._state.adding = etab.pk, etab.created, False
        obj.code, obj.nom, obj.prefixe, obj.actif = etab.code, etab.nom, etab.prefixe, etab.actif
        plog(request, "École créée (admin)", f"{etab.nom} ({etab.code})", etab=etab)
        for r in rows:
            messages.warning(request, f"Accès provisoire à noter (affiché une seule fois) — {r['name']} : identifiant « {r['username']} », mot de passe « {r['password']} »")

    # Pas de suppression depuis l'administration : supprimer une école effacerait toutes ses données. On la suspend (actif = non).

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ("ts", "etablissement", "user", "action", "detail", "ip")
    search_fields = ("action", "detail", "user__username")
    list_filter = ("etablissement", "action")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PlatformLog)
class PlatformLogAdmin(admin.ModelAdmin):
    list_display = ("ts", "user", "etablissement", "action", "detail", "ip")
    search_fields = ("action", "detail", "user__username")
    list_filter = ("action", "etablissement")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PlatformSettings)
class PlatformSettingsAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return not PlatformSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AbonnementPaiement)
class AbonnementPaiementAdmin(admin.ModelAdmin):
    list_display = ("date", "etablissement", "montant", "mode", "reference", "fin_apres")
    list_filter = ("etablissement", "mode")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
