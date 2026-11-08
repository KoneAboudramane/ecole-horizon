from rest_framework.permissions import SAFE_METHODS
from rest_framework_simplejwt.authentication import JWTAuthentication

from .permissions import perms_for
from .tenancy import NO_SCHOOL, set_current, set_cursus


READ_ONLY_ALLOWED = ("auth/", "me/password/")
LECTURE_SEULE = "L’abonnement de l’école est échu : l’école est en lecture seule jusqu’au paiement. Contactez l’administration de la plateforme."

# Le service informatique n'a accès qu'à ces routes (liste blanche : tout le reste lui est refusé, y compris
# les écrans qui, par défaut, s'ouvrent à tout le personnel : notes, emploi du temps, examens, etc.).
IT_ALLOWED = ("auth/", "me/", "users/", "journal/", "settings/", "public/", "health/", "announcements/", "notifications/", "teachers/", "roles/")
# Droits que le service informatique peut avoir sans ouvrir les données scolaires. Si la direction lui en donne d'autres, la liste blanche est levée.
IT_SAFE_PERMS = {"accounts", "journal.sys", "settings.tech", "roles.manage"}


class TenantJWTAuthentication(JWTAuthentication):
    """Authentifie par jeton, puis place la requête dans l'établissement du compte.

    Un compte d'école ne voit que son école. Le super-administrateur n'en a pas : sans précision, il ne voit
    aucune donnée d'école ; l'en-tête `X-Etablissement: <code>` lui permet d'intervenir dans une école précise.
    """

    def authenticate(self, request):
        res = super().authenticate(request)
        if res is None:
            return None
        user = res[0]
        if user.etablissement_id:
            if not user.etablissement.actif:
                from rest_framework.exceptions import AuthenticationFailed
                raise AuthenticationFailed("Cet établissement est suspendu. Contactez l’administration de la plateforme.")
            # Abonnement échu au-delà du délai de grâce : l'école consulte tout mais ne modifie plus rien jusqu'au paiement.
            # La connexion, la déconnexion et le changement de mot de passe restent ouverts.
            if (user.etablissement.lecture_seule and request.method not in SAFE_METHODS
                    and not request.path.split("/api/v1/", 1)[-1].startswith(READ_ONLY_ALLOWED)):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied(LECTURE_SEULE)
            set_current(user.etablissement_id)
            # Cursus choisi dans l'interface (école franco-arabe…), dans le périmètre du compte. Un compte limité à certains
            # cursus travaille toujours dans l'un d'eux ; un cursus inconnu de l'école est ignoré.
            from apps.academics.models import Cursus
            from apps.accounts.perimetre import allowed_cursus
            allowed = allowed_cursus(user)
            cursus = request.META.get("HTTP_X_CURSUS", "").strip()
            if cursus.isdigit() and (allowed is None or int(cursus) in allowed) and Cursus.objects.filter(pk=int(cursus)).exists():
                set_cursus(int(cursus))
            elif allowed is not None:
                first = Cursus.objects.filter(pk__in=allowed).values_list("pk", flat=True).first()
                if first:
                    set_cursus(first)
            if user.role == "informatique" and not (perms_for(user) - IT_SAFE_PERMS):
                path = request.path.split("/api/v1/", 1)[-1]
                if not path.startswith(IT_ALLOWED):
                    from rest_framework.exceptions import PermissionDenied
                    raise PermissionDenied("Le service informatique n’a pas accès aux données scolaires et financières.")
        else:
            value = NO_SCHOOL
            code = request.META.get("HTTP_X_ETABLISSEMENT", "").strip().lower()
            if code and user.is_superuser:
                from .models import Etablissement
                value = Etablissement.objects.filter(code=code).values_list("pk", flat=True).first() or NO_SCHOOL
            set_current(value)
        return res
