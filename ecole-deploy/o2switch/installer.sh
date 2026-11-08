#!/bin/sh
# Installation sur O2switch, lancée par « sh ~/gerer.sh installer » (ou directement).
# Automatique : trouve l'adresse de l'application Python, crée l'adresse du site si besoin, écrit le .env
# (secrets générés), installe, crée les clés des alertes, les photos, le HTTPS et l'administrateur.
# Seule information obligatoire : le mot de passe de la base, par la variable DB_PASS ou au clavier.
# Variables possibles : DB_PASS, DB_NAME, DB_USER, SITE, API_HOST, MAIL_USER, MAIL_PASS, MAIL_HOST, PREFIX,
#                       ADMIN_USER, ADMIN_NOM ; AUTO=1 = aucune question (valeurs par défaut).
set -eu
. "$(dirname "$0")/commun.sh"
HERE="$O2_DIR"
AUTO="${AUTO:-0}"

# ask VARIABLE "Question" "défaut" : garde la valeur déjà fournie ; en AUTO prend le défaut sans demander
ask() {
  eval "_cur=\${$1:-}"; [ -z "$_cur" ] || return 0
  if [ "$AUTO" = 1 ]; then eval "$1=\${3:-}"; return 0; fi
  printf '%s' "$2${3:+ [$3]} : "; read -r _r; [ -n "$_r" ] || _r="${3:-}"; eval "$1=\$_r"; }
ask_secret() {
  eval "_cur=\${$1:-}"; [ -z "$_cur" ] || return 0
  if [ "$AUTO" = 1 ] && [ "${2#*base}" = "$2" ]; then eval "$1="; return 0; fi
  printf '%s : ' "$2"; stty -echo 2>/dev/null || true; read -r _r; stty echo 2>/dev/null || true; echo; eval "$1=\$_r"; }
etape() { printf '\n\033[1m-- %s --\033[0m\n' "$*"; }

[ -f "$APP_DIR/manage.py" ] || die "$APP_DIR/manage.py introuvable"
[ -n "$VENV" ] && [ -f "$VENV/bin/activate" ] || die "environnement Python introuvable : créez l'application dans cPanel > Setup Python App (racine : ecole-horizon)"
restaurer_passenger
grep -q "config.wsgi" "$PASSENGER_ROOT/passenger_wsgi.py" 2>/dev/null || die "$PASSENGER_ROOT/passenger_wsgi.py n'est pas celui du projet : lancez  git -C $REPO_DIR checkout -- ."
. "$VENV/bin/activate"
cd "$APP_DIR"
echo "== Installation de la plateforme scolaire sur O2switch =="
echo "Application Python : $PASSENGER_ROOT  ($VENV)"

GARDER=0
if [ -f .env ]; then
  if [ "$AUTO" = 1 ]; then GARDER=1; else
    ask REPONSE "Un fichier .env existe déjà. Le garder ? (o/n)" "o"
    case "$REPONSE" in o|O|oui) GARDER=1;; *) cp .env ".env.ancien-$(date +%Y%m%d%H%M%S)";; esac
  fi
fi

if [ "$GARDER" = 0 ]; then
  etape "Adresses"
  if [ -z "${API_HOST:-}" ] || [ -z "${SITE:-}" ]; then
    eval "$(python3 "$HERE/detecter.py" "$REPO_DIR")"
    [ -z "${ERREUR_DETECTION:-}" ] || die "$ERREUR_DETECTION"
    if [ -n "${CREER_SITE:-}" ]; then
      set -- $CREER_SITE
      echo "Création du sous-domaine du site : $SITE  (dossier ecole-site)"
      uapi --output=json SubDomain addsubdomain domain="$1" rootdomain="$2" dir="ecole-site" disallowdot=0 \
        | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print(*(r.get("errors") or []), file=sys.stderr); sys.exit(0 if r.get("status") == 1 else 1)' \
        || die "création de $SITE impossible : créez-le dans cPanel > Domaines avec la racine « ecole-site », puis relancez"
      set --
    fi
  fi
  SITE="${SITE#https://}"; SITE="${SITE%/}"; API_HOST="${API_HOST#https://}"; API_HOST="${API_HOST%/}"
  echo "Site : https://$SITE"
  echo "API  : https://$API_HOST"

  etape "Base PostgreSQL"
  ask DB_NAME "Nom de la base" "$(id -un)_ecole-horizon"
  ask DB_USER "Utilisateur de la base" "$DB_NAME"
  ask_secret DB_PASS "Mot de passe de la base"
  [ -n "$DB_PASS" ] || die "mot de passe de la base vide (DB_PASS)"
  echo "Base : $DB_NAME  /  utilisateur : $DB_USER"

  etape "E-mail"
  ask MAIL_USER "Adresse d'envoi (vide = plus tard)" ""
  MAIL_PASS="${MAIL_PASS:-}"; [ -z "$MAIL_USER" ] || ask_secret MAIL_PASS "Mot de passe de cette boîte"
  case "$MAIL_PASS" in \$*|*\'*) die "le mot de passe e-mail ne doit pas commencer par \$ ni contenir d'apostrophe";; esac
  if [ -n "$MAIL_USER" ]; then ask MAIL_HOST "Serveur SMTP" "mail.${MAIL_USER#*@}"; else MAIL_HOST=""; echo "(à configurer plus tard dans ecole-backend/.env)"; fi
  ask PREFIX "Préfixe des matricules" "HZ"

  ENC() { python -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"; }
  SECRET_KEY="$(python -c 'import secrets;print(secrets.token_urlsafe(60))')"
  ADMIN_URL="gestion-$(python -c 'import secrets;print(secrets.token_hex(4))')/"
  umask 077
  cat > .env <<EOF
# Généré par installer.sh le $(date "+%Y-%m-%d %H:%M"). Ne jamais publier ce fichier.
DEBUG=False
SECRET_KEY=$SECRET_KEY
ALLOWED_HOSTS=$API_HOST
PUBLIC_BASE_URL=https://$SITE
CORS_ALLOWED_ORIGINS=https://$SITE
CSRF_TRUSTED_ORIGINS=https://$SITE,https://$API_HOST
DATABASE_URL=postgres://$(ENC "$DB_USER"):$(ENC "$DB_PASS")@localhost:5432/$(ENC "$DB_NAME")
NUM_PROXIES=0
ADMIN_URL=$ADMIN_URL
ECOLE_CODE=
ACCESS_TOKEN_MINUTES=20
REFRESH_TOKEN_DAYS=1
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCK_MINUTES=15
MATRICULE_PREFIX=$PREFIX
MOBILE_MONEY_WEBHOOK_SECRET=
MOBILE_MONEY_SANDBOX=0
EMAIL_HOST=$MAIL_HOST
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=$MAIL_USER
EMAIL_HOST_PASSWORD='$MAIL_PASS'
DEFAULT_FROM_EMAIL=${MAIL_USER:-ne-pas-repondre@$SITE}
WEBPUSH_PUBLIC_KEY=
WEBPUSH_PRIVATE_KEY=
WEBPUSH_SUBJECT=mailto:${MAIL_USER:-ne-pas-repondre@$SITE}
LOG_LEVEL=INFO
HSTS_INCLUDE_SUBDOMAINS=False
EOF
  chmod 600 .env
  echo ".env écrit (clé secrète et adresse d'administration générées)."
fi

etape "Connexion à la base"
python manage.py shell -c "from django.db import connection; connection.ensure_connection(); print('PostgreSQL', connection.pg_version // 10000 if connection.vendor == 'postgresql' else connection.vendor, ': connexion OK')" \
  || die "connexion à la base impossible. Dans cPanel > Bases de données PostgreSQL : vérifiez le mot de passe et que l'utilisateur est AJOUTÉ à la base avec tous les droits. Puis relancez."

etape "Installation (dépendances, tables, fichiers statiques) : quelques minutes"
SANS_GIT=1 SANS_SAUVEGARDE=1 sh "$HERE/mise-a-jour.sh"

etape "Clés des alertes sur téléphone"
if grep -q '^WEBPUSH_PUBLIC_KEY=$' .env; then
  CLES="$(python manage.py generer_cles_push 2>/dev/null | grep -E '^WEBPUSH_(PUBLIC|PRIVATE)_KEY=' || true)"
  if [ -n "$CLES" ]; then
    grep -v -E '^WEBPUSH_(PUBLIC|PRIVATE)_KEY=' .env > .env.tmp && printf '%s\n' "$CLES" >> .env.tmp && mv .env.tmp .env && chmod 600 .env
    echo "Clés générées."
  else echo "Génération impossible : à refaire plus tard (python manage.py generer_cles_push)"; fi
else echo "Clés déjà présentes."; fi

etape "Photos, site et sécurité"
mkdir -p media
cp "$HERE/api/media.htaccess" media/.htaccess
API_HOST="$(grep '^ALLOWED_HOSTS=' .env | cut -d= -f2 | cut -d, -f1)"
API_ROOT="${API_ROOT:-$HOME/$API_HOST}"
if [ -d "$API_ROOT" ]; then
  [ -e "$API_ROOT/media" ] || ln -s "$APP_DIR/media" "$API_ROOT/media"
  if [ -f "$API_ROOT/.htaccess" ] && ! grep -q "Options -Indexes" "$API_ROOT/.htaccess"; then
    { grep -v '^#' "$HERE/api/.htaccess-a-ajouter"; echo; cat "$API_ROOT/.htaccess"; } > "$API_ROOT/.htaccess.tmp" && mv "$API_ROOT/.htaccess.tmp" "$API_ROOT/.htaccess"
  fi
  echo "Photos : $API_ROOT/media"
else
  echo "ATTENTION : dossier $API_ROOT absent ; photos à relier à la main :  ln -s $APP_DIR/media <dossier de l'API>/media"
fi
ecrire_config_site && echo "Site relié à l'API (config.js)."
uapi SSL start_autossl_check >/dev/null 2>&1 && echo "Certificats HTTPS demandés (prêts en 5 à 30 minutes)." || true
redemarrer
mkdir -p "$HOME/sauvegardes-ecole" && chmod 700 "$HOME/sauvegardes-ecole"

etape "Administrateur de la plateforme"
if python manage.py shell -c "from apps.accounts.models import User; import sys; sys.exit(0 if User.all_objects.filter(etablissement__isnull=True, is_superuser=True).exists() else 1)" 2>/dev/null; then
  echo "Un administrateur existe déjà."
else
  ask ADMIN_USER "Identifiant" "root"; ask ADMIN_NOM "Votre nom" "Administrateur"
  python manage.py create_platform_admin --username "$ADMIN_USER" --name "$ADMIN_NOM" || true
fi

ADMIN_URL="$(grep '^ADMIN_URL=' .env | cut -d= -f2)"
SITE_URL="$(grep '^PUBLIC_BASE_URL=' .env | cut -d= -f2)"
cat <<EOF

==================== Terminé ====================
  Site         : $SITE_URL
  Portail      : $SITE_URL/plateforme.html   (connexion avec l'identifiant ci-dessus)
  API          : https://$API_HOST/api/v1/health/
  Admin Django : https://$API_HOST/$ADMIN_URL
NOTEZ le mot de passe provisoire affiché plus haut et l'adresse Admin Django.
Si le navigateur signale un problème de certificat, attendez 30 minutes (HTTPS en cours).
=================================================
EOF
