#!/bin/sh
# Installation guidée sur O2switch, à lancer UNE FOIS par SSH après avoir créé l'application Python dans cPanel :
#   sh ~/ecole-horizon/ecole-deploy/o2switch/installer.sh
# Pose quelques questions, écrit ecole-backend/.env (secrets générés), installe l'application,
# crée les clés des alertes, le lien des photos et l'administrateur de la plateforme.
set -eu
. "$(dirname "$0")/commun.sh"
HERE="$O2_DIR"

ask() { # ask VARIABLE "Question" "valeur par défaut"
  printf '%s' "$2${3:+ [$3]} : "; read -r _r; [ -n "$_r" ] || _r="${3:-}"; eval "$1=\$_r"; }
ask_secret() { printf '%s : ' "$2"; stty -echo 2>/dev/null || true; read -r _r; stty echo 2>/dev/null || true; echo; eval "$1=\$_r"; }

[ -f "$APP_DIR/manage.py" ] || die "$APP_DIR/manage.py introuvable"
[ -n "$VENV" ] && [ -f "$VENV/bin/activate" ] || die "environnement Python introuvable. Créez l'application dans cPanel > Setup Python App (racine : ${APP_DIR#"$HOME"/}), ou indiquez VENV=/home/.../virtualenv/.../3.x"
restaurer_passenger
grep -q "config.wsgi" "$PASSENGER_ROOT/passenger_wsgi.py" 2>/dev/null || die "$PASSENGER_ROOT/passenger_wsgi.py n'est pas celui du projet : relancez  git -C $REPO_DIR checkout -- ."
echo "Application Python : $PASSENGER_ROOT  (environnement $VENV)"
. "$VENV/bin/activate"
cd "$APP_DIR"

echo "== Installation de la plateforme scolaire sur O2switch =="
if [ -f .env ]; then
  ask REPONSE "Un fichier .env existe déjà. Le garder et seulement (ré)installer ? (o/n)" "o"
  case "$REPONSE" in o|O|oui) GARDER=1;; *) GARDER=0; cp .env ".env.ancien-$(date +%Y%m%d%H%M%S)";; esac
else GARDER=0; fi

if [ "$GARDER" = 0 ]; then
  echo; echo "-- Adresses (sans https://) --"
  ask SITE "Adresse du site (ex. ecole.mondomaine.ci)" ""
  [ -n "$SITE" ] || die "adresse du site obligatoire"
  SITE="${SITE#https://}"; SITE="${SITE%/}"
  ask API "Adresse de l'API" "api.${SITE#www.}"
  API="${API#https://}"; API="${API%/}"

  echo; echo "-- Base PostgreSQL créée dans cPanel --"
  ask DB_NAME "Nom de la base" "$(id -un)_ecole-horizon"
  ask DB_USER "Utilisateur de la base" "$DB_NAME"
  ask_secret DB_PASS "Mot de passe de la base"
  [ -n "$DB_PASS" ] || die "mot de passe de la base vide"

  echo; echo "-- E-mail (boîte créée dans cPanel ; laisser vide pour configurer plus tard) --"
  ask MAIL_USER "Adresse d'envoi" "ne-pas-repondre@${SITE#*.}"
  MAIL_PASS=""; [ -z "$MAIL_USER" ] || ask_secret MAIL_PASS "Mot de passe de cette boîte"
  case "$MAIL_PASS" in \$*|*\'*) die "le mot de passe e-mail ne doit pas commencer par \$ ni contenir d'apostrophe : changez-le dans cPanel";; esac
  ask MAIL_HOST "Serveur SMTP" "mail.${MAIL_USER#*@}"
  ask PREFIX "Préfixe des matricules" "HZ"

  ENC() { python -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"; }
  SECRET_KEY="$(python -c 'import secrets;print(secrets.token_urlsafe(60))')"
  ADMIN_URL="gestion-$(python -c 'import secrets;print(secrets.token_hex(4))')/"
  umask 077
  cat > .env <<EOF
# Généré par installer.sh le $(date "+%Y-%m-%d %H:%M"). Ne jamais publier ce fichier.
DEBUG=False
SECRET_KEY=$SECRET_KEY
ALLOWED_HOSTS=$API
PUBLIC_BASE_URL=https://$SITE
CORS_ALLOWED_ORIGINS=https://$SITE
CSRF_TRUSTED_ORIGINS=https://$SITE,https://$API
DATABASE_URL=postgres://$(ENC "$DB_USER"):$(ENC "$DB_PASS")@localhost:5432/$DB_NAME
NUM_PROXIES=0
ADMIN_URL=$ADMIN_URL
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
DEFAULT_FROM_EMAIL=$MAIL_USER
WEBPUSH_PUBLIC_KEY=
WEBPUSH_PRIVATE_KEY=
WEBPUSH_SUBJECT=mailto:$MAIL_USER
LOG_LEVEL=INFO
HSTS_INCLUDE_SUBDOMAINS=False
EOF
  chmod 600 .env
  echo ".env écrit (clé secrète et adresse d'administration générées)."
fi

echo; echo "-- Connexion à la base --"
python manage.py shell -c "from django.db import connection; connection.ensure_connection(); print('PostgreSQL', connection.pg_version // 10000 if connection.vendor == 'postgresql' else connection.vendor)" \
  || die "connexion à la base impossible : vérifiez nom, utilisateur, mot de passe et droits (cPanel > Bases de données PostgreSQL)"

echo; echo "-- Installation (dépendances, migrations, statiques) --"
SANS_GIT=1 SANS_SAUVEGARDE=1 sh "$HERE/mise-a-jour.sh"

echo; echo "-- Clés des alertes sur téléphone --"
if grep -q '^WEBPUSH_PUBLIC_KEY=$' .env; then
  CLES="$(python manage.py generer_cles_push 2>/dev/null | grep -E '^WEBPUSH_(PUBLIC|PRIVATE)_KEY=' || true)"
  if [ -n "$CLES" ]; then
    grep -v -E '^WEBPUSH_(PUBLIC|PRIVATE)_KEY=' .env > .env.tmp && printf '%s\n' "$CLES" >> .env.tmp && mv .env.tmp .env && chmod 600 .env
    echo "Clés générées."
  else echo "Génération impossible : lancez plus tard  python manage.py generer_cles_push"; fi
else echo "Clés déjà présentes."; fi

echo; echo "-- Photos (dossier media servi par Apache) --"
mkdir -p media
cp "$HERE/api/media.htaccess" media/.htaccess
API_HOST="$(grep '^ALLOWED_HOSTS=' .env | cut -d= -f2 | cut -d, -f1)"
API_ROOT="$HOME/$API_HOST"
if [ -d "$API_ROOT" ]; then
  [ -e "$API_ROOT/media" ] || ln -s "$APP_DIR/media" "$API_ROOT/media"
  if [ -f "$API_ROOT/.htaccess" ] && ! grep -q "Options -Indexes" "$API_ROOT/.htaccess"; then
    { grep -v '^#' "$HERE/api/.htaccess-a-ajouter"; echo; cat "$API_ROOT/.htaccess"; } > "$API_ROOT/.htaccess.tmp" && mv "$API_ROOT/.htaccess.tmp" "$API_ROOT/.htaccess"
  fi
  echo "Lien $API_ROOT/media prêt."
else
  echo "ATTENTION : dossier $API_ROOT absent. Créez le lien à la main :  ln -s $APP_DIR/media <dossier du sous-domaine de l'API>/media"
fi
redemarrer
mkdir -p "$HOME/sauvegardes-ecole" && chmod 700 "$HOME/sauvegardes-ecole"

echo; echo "-- Administrateur de la plateforme --"
ask CREER "Créer maintenant le compte administrateur de la plateforme ? (o/n)" "o"
case "$CREER" in o|O|oui)
  ask ROOT_USER "Identifiant" "root"; ask ROOT_NAME "Votre nom" ""
  python manage.py create_platform_admin --username "$ROOT_USER" --name "${ROOT_NAME:-Administrateur}" || true;;
esac

ADMIN_URL="$(grep '^ADMIN_URL=' .env | cut -d= -f2)"
SITE_URL="$(grep '^PUBLIC_BASE_URL=' .env | cut -d= -f2)"
cat <<EOF

== Terminé ==
  API        : https://$API_HOST/api/v1/health/   (doit répondre)
  Portail    : $SITE_URL/plateforme.html
  Admin Django : https://$API_HOST/$ADMIN_URL   (notez cette adresse)
Étapes restantes :
  1. Vérifier que le site s'ouvre (dossier du site : $SITE_DIR, voir GUIDE-O2SWITCH.md).
  2. Tester l'e-mail :  python manage.py test_email votre.adresse@exemple.com
  3. Programmer la sauvegarde (cPanel > Tâches Cron) :
     sh $HERE/sauvegarde.sh >> \$HOME/sauvegardes-ecole/sauvegarde.log 2>&1
EOF
