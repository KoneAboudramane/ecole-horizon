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
# Type de base créée dans cPanel : mysql (MySQL/MariaDB, par défaut) ou postgres
DB_TYPE="${DB_TYPE:-mysql}"
case "$DB_TYPE" in mysql|postgres) ;; *) echo "DB_TYPE doit valoir mysql ou postgres" >&2; exit 1;; esac

# url_base UTILISATEUR MOTDEPASSE BASE -> DATABASE_URL (caractères spéciaux encodés)
url_base() {
  python3 - "$DB_TYPE" "$1" "$2" "$3" <<'PY'
import sys, urllib.parse as p
t, u, pw, db = sys.argv[1:]
e = lambda v: p.quote(v, safe="")
print(f"mysql://{e(u)}:{e(pw)}@localhost:3306/{e(db)}" if t == "mysql" else f"postgres://{e(u)}:{e(pw)}@localhost:5432/{e(db)}")
PY
}

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
  # Une seule adresse pour le site et l'API : celle de l'application Python dans cPanel
  if [ -z "${API_HOST:-}" ]; then
    eval "$(python3 "$HERE/detecter.py" "$REPO_DIR")"
    [ -z "${ERREUR_DETECTION:-}" ] || die "$ERREUR_DETECTION"
  fi
  API_HOST="${API_HOST#https://}"; API_HOST="${API_HOST%/}"; SITE="$API_HOST"
  echo "Adresse : https://$API_HOST  (site + API)"

  etape "Base de données ($DB_TYPE)"
  if [ "${DEMO:-0}" = 1 ]; then
    # Démonstration : nom de la base et utilisateur toujours demandés (noms choisis librement dans cPanel)
    _auto="$AUTO"; AUTO=0
    ask DB_NAME "Nom de la base MySQL de la démonstration" "$(id -un)_demo"
    ask DB_USER "Utilisateur MySQL de cette base" "$DB_NAME"
    AUTO="$_auto"
  else
    ask DB_NAME "Nom de la base" "$(id -un)_ecole-horizon"
    ask DB_USER "Utilisateur de la base" "$DB_NAME"
  fi
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
DATABASE_URL=$(url_base "$DB_USER" "$DB_PASS" "$DB_NAME")
NUM_PROXIES=0
ADMIN_URL=$ADMIN_URL
ECOLE_CODE=
ECOLE_SITE_ROOT=$SITE_PUBLIC
DEMO_INSTANCE=$([ "${DEMO:-0}" = 1 ] && echo True || echo False)
ACCESS_TOKEN_MINUTES=20
REFRESH_TOKEN_DAYS=1
LOGIN_MAX_ATTEMPTS=$([ "${DEMO:-0}" = 1 ] && echo 50 || echo 5)
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

etape "Site compilé (GitHub, branche site-o2switch)"
if [ -d "$SITE_DIR/.git" ]; then git -C "$SITE_DIR" pull --ff-only --quiet || true
else git clone --quiet -b site-o2switch "$(git -C "$REPO_DIR" remote get-url origin)" "$SITE_DIR"; fi
echo "Site : $SITE_DIR (servi par l'application)"

etape "Dépendances Python (première fois : quelques minutes)"
pip install --quiet --upgrade pip || true
pip install --quiet -r requirements.txt || die "installation des dépendances impossible (voir le message ci-dessus)"
python -c "import django" || die "Django n'est pas installé dans $VENV"
echo "OK"

etape "Connexion à la base"
# .env d'un essai précédent avec l'autre type de base : on garde utilisateur, mot de passe et nom, on change le type
python3 - .env "$DB_TYPE" <<'PY'
import os, sys, urllib.parse as p
chemin, voulu = sys.argv[1:]
lignes = open(chemin, encoding="utf-8").read().splitlines()
for i, l in enumerate(lignes):
    if l.startswith("DATABASE_URL="):
        u = p.urlsplit(l.split("=", 1)[1])
        actuel = "mysql" if u.scheme.startswith("mysql") else "postgres"
        if actuel != voulu:
            port = 3306 if voulu == "mysql" else 5432
            lignes[i] = f"DATABASE_URL={voulu}://{u.username}:{u.password}@localhost:{port}{u.path}"
            open(chemin, "w", encoding="utf-8").write("\n".join(lignes) + "\n")
            os.chmod(chemin, 0o600)
            print(f"Base passée de {actuel} à {voulu} dans .env")
PY
LOG="$HOME/.ecole-test-base.log"
tester_base() {
  python manage.py shell -c "from django.db import connection; connection.ensure_connection(); print(connection.vendor, connection.get_database_version(), ': connexion OK')" \
    > "$LOG" 2>&1
}
if ! tester_base; then
  # cPanel n'autorise parfois que le socket local : on essaie automatiquement
  if [ "$DB_TYPE" = mysql ]; then
    for s in /var/lib/mysql/mysql.sock /var/run/mysqld/mysqld.sock /tmp/mysql.sock; do
      [ -S "$s" ] || continue
      grep -v '^DB_SOCKET=' .env > .env.tmp && echo "DB_SOCKET=$s" >> .env.tmp && mv .env.tmp .env && chmod 600 .env
      tester_base && break
    done
  elif grep -q '@localhost:5432/' .env; then
    sed 's#@localhost:5432/#@/#' .env > .env.tmp && mv .env.tmp .env && chmod 600 .env
    tester_base || true
  fi
fi
if grep -q "connexion OK" "$LOG" 2>/dev/null; then
  tail -n 1 "$LOG"; rm -f "$LOG"
else
  echo "Raison : $(grep -iE 'FATAL|denied|refus|authenti|password|unknown database|does not exist|n.existe pas|can.t connect' "$LOG" | tail -n 1)"
  rm -f "$LOG"
  if [ "$DB_TYPE" = mysql ]; then
    # Aide : bases auxquelles cet utilisateur a réellement accès (souvent, le nom saisi n'est pas le bon)
    python - .env <<'PY' || true
import sys, urllib.parse as p
import pymysql
url = next(l.split("=", 1)[1].strip() for l in open(sys.argv[1], encoding="utf-8") if l.startswith("DATABASE_URL="))
u = p.urlsplit(url)
env = {l.split("=", 1)[0]: l.split("=", 1)[1].strip() for l in open(sys.argv[1], encoding="utf-8") if "=" in l and not l.startswith("#")}
try:
    kw = {"unix_socket": env["DB_SOCKET"]} if env.get("DB_SOCKET") else {"host": u.hostname or "localhost", "port": u.port or 3306}
    c = pymysql.connect(user=p.unquote(u.username), password=p.unquote(u.password or ""), **kw)
    with c.cursor() as cur:
        cur.execute("SHOW DATABASES")
        bases = [r[0] for r in cur.fetchall() if r[0] not in ("information_schema", "performance_schema")]
    print(f"Bases accessibles par {p.unquote(u.username)} : {', '.join(bases) if bases else 'AUCUNE (utilisateur relié à aucune base)'}")
    print(f"Base demandée : {p.unquote(u.path.lstrip('/'))}")
except Exception as e:
    print(f"(connexion de l'utilisateur impossible : {e})")
PY
    PAGE="Bases de données MySQL"
  else PAGE="Bases de données PostgreSQL"; fi
  # .env écrit pendant CET essai : on l'efface pour reposer les questions au prochain (jamais un .env déjà en service)
  if [ "$GARDER" = 0 ]; then rm -f .env; fi
  die "la base refuse la connexion. Dans cPanel > « $PAGE » : 1) vérifiez le mot de passe de l'utilisateur ; 2) section « Ajouter un utilisateur à une base de données », choisissez l'utilisateur et la base, « Ajouter », cochez TOUS LES PRIVILÈGES. Puis relancez :  sh ~/gerer.sh $([ "${DEMO:-0}" = 1 ] && echo installer-demo || echo installer)"
fi

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
uapi SSL start_autossl_check >/dev/null 2>&1 && echo "Certificats HTTPS demandés (prêts en 5 à 30 minutes)." || true
redemarrer
mkdir -p "$HOME/sauvegardes-ecole" && chmod 700 "$HOME/sauvegardes-ecole"

if [ "${DEMO:-0}" = 1 ]; then
  etape "Écoles de démonstration (Mali et Côte d'Ivoire, 3 années) : 2 à 5 minutes"
  python manage.py demo_presentation --reinitialiser || die "création de la démonstration impossible (voir ci-dessus)"
  # Remise à zéro automatique chaque nuit à 3 h (les visiteurs modifient les données)
  LIGNE="0 3 * * * cd $APP_DIR && $VENV/bin/python manage.py demo_presentation --reinitialiser >> $REPO_DIR/demo-reinit.log 2>&1 && touch $PASSENGER_ROOT/tmp/restart.txt"
  if ! crontab -l 2>/dev/null | grep -q "demo_presentation"; then
    { crontab -l 2>/dev/null; echo "$LIGNE"; } | crontab - 2>/dev/null && echo "Remise à zéro programmée chaque nuit à 3 h." \
      || echo "ATTENTION : ajoutez dans cPanel > Tâches Cron (chaque nuit) :  $LIGNE"
  fi
  redemarrer
  SITE_URL="$(grep '^PUBLIC_BASE_URL=' .env | cut -d= -f2)"
  cat <<EOF

=========== Démonstration prête ===========
  Mali          : $SITE_URL/?ecole=demo-mali
  Côte d'Ivoire : $SITE_URL/?ecole=demo-ci
  Comptes (mot de passe : demo) : directeur, fondateur, secretariat, comptable,
                                  enseignant, educateur, informatique, parent, eleve
  Tout est remis à zéro chaque nuit.
===========================================
EOF
  exit 0
fi

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
