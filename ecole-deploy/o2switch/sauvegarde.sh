#!/bin/sh
# Sauvegarde quotidienne sur O2switch : base PostgreSQL + photos et fichiers déposés.
# Les informations de la base sont lues dans ~/ecole-backend/.env (DATABASE_URL) : rien à configurer.
# Réutilise ../scripts/backup.sh (même format que le déploiement Docker, donc même restore.sh).
#
# cPanel > Tâches Cron, une fois par jour (ex. 2 h 00) :
#   sh $HOME/ecole-deploy/o2switch/sauvegarde.sh >> $HOME/sauvegardes-ecole/sauvegarde.log 2>&1
set -eu

APP_DIR="${APP_DIR:-$HOME/ecole-backend}"
export BACKUP_DIR="${BACKUP_DIR:-$HOME/sauvegardes-ecole}"   # hors de public_html
export MEDIA_DIR="${MEDIA_DIR:-$APP_DIR/media}"
export KEEP_DAYS="${KEEP_DAYS:-30}"

[ -f "$APP_DIR/.env" ] || { echo "$APP_DIR/.env absent" >&2; exit 1; }
command -v pg_dump >/dev/null || { echo "pg_dump introuvable sur ce serveur : demandez-le au support O2switch" >&2; exit 1; }

# DATABASE_URL=postgres://utilisateur:motdepasse@hote:port/base  ->  variables lues par pg_dump
eval "$(python3 - "$APP_DIR/.env" <<'PY'
import shlex, sys, urllib.parse
url = ""
for line in open(sys.argv[1], encoding="utf-8"):
    if line.startswith("DATABASE_URL="):
        url = line.split("=", 1)[1].strip().strip("'\"")
u = urllib.parse.urlsplit(url)
if not u.scheme.startswith("postgres"):
    sys.exit("DATABASE_URL n'est pas une base PostgreSQL")
q = lambda v: shlex.quote(urllib.parse.unquote(v or ""))
print(f"export PGHOST={q(u.hostname or 'localhost')} PGPORT={q(str(u.port or 5432))} "
      f"PGUSER={q(u.username)} PGPASSWORD={q(u.password)} PGDATABASE={q(u.path.lstrip('/'))}")
PY
)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077
date "+== %Y-%m-%d %H:%M:%S"
sh "$(dirname "$0")/../scripts/backup.sh"
