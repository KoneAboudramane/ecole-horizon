from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme


class TenantJWTScheme(SimpleJWTScheme):
    """Même schéma de sécurité que SimpleJWT : l'authentification par jeton, avec choix de l'établissement."""

    target_class = "apps.core.authentication.TenantJWTAuthentication"
    name = "jwtAuth"
