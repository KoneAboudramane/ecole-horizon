#!/bin/sh
# Restaure une sauvegarde dans la base pointée par PGHOST/PGUSER/PGDATABASE/PGPASSWORD. ATTENTION : remplace les données actuelles.
# Usage : sh restore.sh /chemin/ecole-AAAAMMJJ-HHMMSS.dump [/chemin/media-AAAAMMJJ-HHMMSS.tar.gz MEDIA_DIR]
set -eu
DUMP="${1:?indiquez le fichier .dump}"
pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" "$DUMP"
if [ -n "${2:-}" ] && [ -n "${3:-}" ]; then mkdir -p "$3" && tar -xzf "$2" -C "$3"; fi
echo "Restauration terminée."
