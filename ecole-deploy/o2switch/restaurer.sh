#!/bin/sh
# Restaure une sauvegarde sur O2switch. ATTENTION : remplace toutes les données actuelles (toutes les écoles).
# Usage :  sh restaurer.sh ~/sauvegardes-ecole/ecole-AAAAMMJJ-HHMMSS.sql.gz [~/sauvegardes-ecole/media-AAAAMMJJ-HHMMSS.tar.gz]
#          (ou un fichier .dump pour PostgreSQL)
set -eu
. "$(dirname "$0")/commun.sh"
DUMP="${1:?indiquez le fichier de sauvegarde}"
MEDIA_TAR="${2:-}"
[ -f "$DUMP" ] || die "$DUMP introuvable"

printf 'Toutes les données actuelles seront remplacées par %s. Tapez OUI pour continuer : ' "$DUMP"
read -r R; [ "$R" = "OUI" ] || { echo "Annulé."; exit 1; }

# Sauvegarde de l'état actuel avant d'écraser
sh "$O2_DIR/sauvegarde.sh"
charger_base

case "$DUMP" in
  *.sql.gz)
    [ "$DB_KIND" = mysql ] || die "sauvegarde MySQL, mais la base configurée n'est pas MySQL"
    zcat "$DUMP" | mysql --defaults-extra-file="$MYSQL_CNF" --default-character-set=utf8mb4 "$DB_NAME" ;;
  *.dump)
    [ "$DB_KIND" = postgres ] || die "sauvegarde PostgreSQL, mais la base configurée n'est pas PostgreSQL"
    pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" "$DUMP" ;;
  *) die "format inconnu : $DUMP" ;;
esac
if [ -n "$MEDIA_TAR" ]; then mkdir -p "$APP_DIR/media" && tar -xzf "$MEDIA_TAR" -C "$APP_DIR/media"; fi
redemarrer
echo "Restauration terminée, application redémarrée."
