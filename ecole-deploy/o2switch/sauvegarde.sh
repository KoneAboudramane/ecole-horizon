#!/bin/sh
# Sauvegarde quotidienne sur O2switch : base (MySQL/MariaDB ou PostgreSQL) + photos et fichiers déposés.
# Les informations de la base sont lues dans le .env (DATABASE_URL) : rien à configurer.
# Fichiers : ~/sauvegardes-ecole/ecole-AAAAMMJJ-HHMMSS.sql.gz (MySQL) ou .dump (PostgreSQL) + media-….tar.gz
#
# cPanel > Tâches Cron, une fois par jour (ex. 2 h 00), ou option 8 de « sh ~/gerer.sh » :
#   sh $HOME/ecole-horizon/ecole-deploy/o2switch/sauvegarde.sh >> $HOME/sauvegardes-ecole/sauvegarde.log 2>&1
set -eu
. "$(dirname "$0")/commun.sh"

BACKUP_DIR="${BACKUP_DIR:-$HOME/sauvegardes-ecole}"   # hors du site
MEDIA_DIR="${MEDIA_DIR:-$APP_DIR/media}"
KEEP_DAYS="${KEEP_DAYS:-30}"

charger_base
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077
date "+== %Y-%m-%d %H:%M:%S"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ "$DB_KIND" = mysql ]; then
  command -v mysqldump >/dev/null || die "mysqldump introuvable sur ce serveur"
  OUT="$BACKUP_DIR/ecole-$STAMP.sql.gz"
  mysqldump --defaults-extra-file="$MYSQL_CNF" --single-transaction --quick --routines --no-tablespaces \
    --default-character-set=utf8mb4 "$DB_NAME" | gzip -9 > "$OUT.tmp"
  gzip -t "$OUT.tmp" && zcat "$OUT.tmp" | tail -n 1 | grep -q "Dump completed" || die "sauvegarde incomplète ($OUT.tmp)"
  mv "$OUT.tmp" "$OUT"
else
  command -v pg_dump >/dev/null || die "pg_dump introuvable sur ce serveur"
  OUT="$BACKUP_DIR/ecole-$STAMP.dump"
  pg_dump -Fc --no-owner -f "$OUT.tmp"
  pg_restore -l "$OUT.tmp" >/dev/null
  mv "$OUT.tmp" "$OUT"
fi

if [ -d "$MEDIA_DIR" ]; then
  tar -czf "$BACKUP_DIR/media-$STAMP.tar.gz.tmp" -C "$MEDIA_DIR" . && mv "$BACKUP_DIR/media-$STAMP.tar.gz.tmp" "$BACKUP_DIR/media-$STAMP.tar.gz"
fi

# Rotation
find "$BACKUP_DIR" -maxdepth 1 \( -name 'ecole-*.sql.gz' -o -name 'ecole-*.dump' -o -name 'media-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "Sauvegarde OK : $OUT ($(du -h "$OUT" | cut -f1))"
