#!/bin/sh
# Restaure une sauvegarde sur O2switch. ATTENTION : remplace toutes les données actuelles (toutes les écoles).
# Usage :  sh ~/ecole-deploy/o2switch/restaurer.sh ~/sauvegardes-ecole/ecole-AAAAMMJJ-HHMMSS.dump [~/sauvegardes-ecole/media-AAAAMMJJ-HHMMSS.tar.gz]
set -eu
DUMP="${1:?indiquez le fichier .dump}"
MEDIA_TAR="${2:-}"
APP_DIR="${APP_DIR:-$HOME/ecole-backend}"
[ -f "$DUMP" ] || { echo "$DUMP introuvable" >&2; exit 1; }

printf 'Toutes les données actuelles seront remplacées par %s. Tapez OUI pour continuer : ' "$DUMP"
read -r R; [ "$R" = "OUI" ] || { echo "Annulé."; exit 1; }

# Sauvegarde de l'état actuel avant d'écraser
sh "$(dirname "$0")/sauvegarde.sh"

eval "$(python3 - "$APP_DIR/.env" <<'PY'
import shlex, sys, urllib.parse
url = next((l.split("=", 1)[1].strip().strip("'\"") for l in open(sys.argv[1], encoding="utf-8") if l.startswith("DATABASE_URL=")), "")
u = urllib.parse.urlsplit(url)
q = lambda v: shlex.quote(urllib.parse.unquote(v or ""))
print(f"export PGHOST={q(u.hostname or 'localhost')} PGPORT={q(str(u.port or 5432))} "
      f"PGUSER={q(u.username)} PGPASSWORD={q(u.password)} PGDATABASE={q(u.path.lstrip('/'))}")
PY
)"

if [ -n "$MEDIA_TAR" ]; then
  sh "$(dirname "$0")/../scripts/restore.sh" "$DUMP" "$MEDIA_TAR" "$APP_DIR/media"
else
  sh "$(dirname "$0")/../scripts/restore.sh" "$DUMP"
fi
mkdir -p "$APP_DIR/tmp" && touch "$APP_DIR/tmp/restart.txt"
echo "Application redémarrée."
