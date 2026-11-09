"""Configuration Django de la plateforme scolaire.

Tout ce qui change d'un environnement à l'autre vient de variables d'environnement (voir .env.example).
"""
from datetime import timedelta
from pathlib import Path

from corsheaders.defaults import default_headers
import environ

BASE_DIR = Path(__file__).resolve().parent.parent
env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, []),
    CSRF_TRUSTED_ORIGINS=(list, []),
)
environ.Env.read_env(BASE_DIR / ".env")

DEBUG = env("DEBUG")
SECRET_KEY = env("SECRET_KEY", default="dev-only-insecure-key-change-me" if DEBUG else None)
ALLOWED_HOSTS = env("ALLOWED_HOSTS")
# Adresse de l'administration Django : changez-la en production (ADMIN_URL=gestion-xyz/) pour échapper aux scans automatiques
ADMIN_URL = env("ADMIN_URL", default="admin/")
# Adresse publique du site (QR code des bulletins). Vide : déduite de la requête.
PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", default="").rstrip("/")

# E-mail (lien « mot de passe oublié » du personnel). En développement, les messages s'affichent dans la console du serveur.
# Contrôle anti-robot (petit calcul) sur la connexion et « mot de passe oublié ». Actif par défaut hors développement.
CAPTCHA_ENABLED = env.bool("CAPTCHA_ENABLED", default=not DEBUG)
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend" if DEBUG else "django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
EMAIL_TIMEOUT = 10
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default=EMAIL_HOST_USER or "ne-pas-repondre@ecole.local")
PASSWORD_RESET_TIMEOUT = 3600  # durée de validité du lien de réinitialisation : 1 heure

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "drf_spectacular",
    "apps.core",
    "apps.accounts",
    "apps.academics",
    "apps.students",
    "apps.grades",
    "apps.notifications",
    "apps.attendance",
    "apps.discipline",
    "apps.finance",
    "apps.communication",
    "apps.schedule",
    "apps.mockexams",
    "apps.homework",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "apps.core.middleware.TenantMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [BASE_DIR / "templates"],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]

# SQLite pour le développement ; PostgreSQL en production (DATABASE_URL=postgres://...)
DATABASES = {"default": env.db("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}")}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Cache partagé entre tous les processus du serveur (captcha à usage unique, limites de débit, compteurs d'envois).
# Un cache en mémoire est propre à chaque processus : en production (plusieurs processus gunicorn ou Passenger),
# il laisserait rejouer un captcha ou contourner une limite. Par défaut hors développement : table en base,
# créée automatiquement par `migrate`. Autre choix possible : CACHE_URL=filecache:///chemin/absolu.
CACHE_TABLE = "ecole_cache"
CACHES = {"default": env.cache("CACHE_URL", default="locmemcache://" if DEBUG else f"dbcache://{CACHE_TABLE}")}

# Nombre de serveurs mandataires (reverse proxy) de confiance devant Django, qui ajoutent l'adresse du client à
# X-Forwarded-For. 0 (O2switch, Apache + Passenger) : l'en-tête est ignoré, car un visiteur peut l'écrire lui-même.
# 1 (déploiement Docker derrière Caddy) : on retient la dernière adresse ajoutée par Caddy.
NUM_PROXIES = env.int("NUM_PROXIES", default=0)

AUTH_USER_MODEL = "accounts.User"
# L'identifiant n'est unique que dans une école (contrainte par établissement) : la vérification globale de Django ne s'applique plus
SILENCED_SYSTEM_CHECKS = ["auth.E003", "auth.W004"]
AUTH_PASSWORD_VALIDATORS = []  # la règle de mot de passe est appliquée par apps.accounts.passwords

LANGUAGE_CODE = "fr"
TIME_ZONE = "Africa/Abidjan"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage" if not DEBUG else "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

# Site Angular servi par Django (WhiteNoise) sur la même adresse que l'API : hébergement à une seule adresse (O2switch).
# Dossier des fichiers compilés, sans .git (copié par les scripts O2switch). Vide : le site est servi ailleurs (Caddy…).
ECOLE_SITE_ROOT = env("ECOLE_SITE_ROOT", default="")
if ECOLE_SITE_ROOT:
    WHITENOISE_ROOT = ECOLE_SITE_ROOT
    WHITENOISE_INDEX_FILE = True  # « / » sert index.html
    WHITENOISE_MIMETYPES = {".webmanifest": "application/manifest+json"}

    def _entetes_site(headers, path, url):
        """En-têtes des fichiers du site (WhiteNoise répond avant les middlewares de Django)."""
        headers["X-Frame-Options"] = "DENY"
        headers["Referrer-Policy"] = "same-origin"
        headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        nom = url.rsplit("/", 1)[-1]
        if nom in ("", "index.html", "plateforme.html", "verifier.html", "config.js", "sw-push.js", "manifest.webmanifest"):
            headers["Cache-Control"] = "no-cache"  # toujours la dernière version après une mise à jour

    WHITENOISE_ADD_HEADERS_FUNCTION = _entetes_site

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.core.authentication.TenantJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.UserRateThrottle", "rest_framework.throttling.AnonRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"user": "600/min", "anon": "60/min", "login": "20/min", "forgot": "10/hour", "verif": "30/min"},
    "EXCEPTION_HANDLER": "apps.core.errors.exception_handler",
    "NUM_PROXIES": NUM_PROXIES,  # même règle que le journal d'activité pour identifier un visiteur anonyme
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env.int("ACCESS_TOKEN_MINUTES", default=20)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("REFRESH_TOKEN_DAYS", default=1)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Plateforme scolaire : API",
    "DESCRIPTION": "API de gestion d'un collège-lycée privé (notes, bulletins, présences, scolarité).",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_HEADERS = (*default_headers, "x-cursus")   # cursus choisi (école à plusieurs cursus)
CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS")

# Verrouillage de compte après des échecs répétés
LOGIN_MAX_ATTEMPTS = env.int("LOGIN_MAX_ATTEMPTS", default=5)
LOGIN_LOCK_MINUTES = env.int("LOGIN_LOCK_MINUTES", default=15)

if not DEBUG:
    SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool("HSTS_INCLUDE_SUBDOMAINS", default=False)
    SECURE_REFERRER_POLICY = "same-origin"
    X_FRAME_OPTIONS = "DENY"
    if SECRET_KEY and SECRET_KEY.startswith("dev-only"):
        raise RuntimeError("SECRET_KEY de développement interdite quand DEBUG est désactivé.")
    if env.bool("MOBILE_MONEY_SANDBOX", default=False):
        raise RuntimeError("MOBILE_MONEY_SANDBOX doit rester désactivé en production.")

# Préfixe des matricules (HZ26-0001)
MATRICULE_PREFIX = env("MATRICULE_PREFIX", default="HZ")

# Mobile money : secret partagé avec l'opérateur pour signer les retours (webhook). Vide = webhook désactivé.
MOBILE_MONEY_WEBHOOK_SECRET = env("MOBILE_MONEY_WEBHOOK_SECRET", default="")
# Bac à sable : permet de simuler le retour de l'opérateur en développement. Doit rester à 0 en production.
MOBILE_MONEY_SANDBOX = env.bool("MOBILE_MONEY_SANDBOX", default=False)

# Alertes sur le téléphone (Web Push, gratuit) : clés générées une fois par `python manage.py generer_cles_push`.
# Vides = alertes désactivées (les notifications restent visibles dans l'application).
WEBPUSH_PUBLIC_KEY = env("WEBPUSH_PUBLIC_KEY", default="")
WEBPUSH_PRIVATE_KEY = env("WEBPUSH_PRIVATE_KEY", default="")
WEBPUSH_SUBJECT = env("WEBPUSH_SUBJECT", default="") or f"mailto:{DEFAULT_FROM_EMAIL}"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"std": {"format": "%(asctime)s %(levelname)s %(name)s : %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "std"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
    "loggers": {"django.security": {"handlers": ["console"], "level": "WARNING", "propagate": False}},
}
