#!/bin/sh
# Sauvegarde : base PostgreSQL (format compressé pg_dump) + dossier des photos. Variables : PGHOST PGUSER PGDATABASE PGPASSWORD,
# BACKUP_DIR, MEDIA_DIR (facultatif), KEEP_DAYS (30 par défaut). Usage : sh backup.sh
set -eu
BACKUP_DIR="${BACKUP_DIR:-/backups}"; KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/ecole-$STAMP.dump"
pg_dump -Fc --no-owner -f "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
if [ -n "${MEDIA_DIR:-}" ] && [ -d "$MEDIA_DIR" ]; then
  tar -czf "$BACKUP_DIR/media-$STAMP.tar.gz.tmp" -C "$MEDIA_DIR" . && mv "$BACKUP_DIR/media-$STAMP.tar.gz.tmp" "$BACKUP_DIR/media-$STAMP.tar.gz"
fi
# Contrôle : la sauvegarde doit pouvoir être relue
pg_restore -l "$OUT" >/dev/null
# Rotation
find "$BACKUP_DIR" -maxdepth 1 \( -name 'ecole-*.dump' -o -name 'media-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "Sauvegarde OK : $OUT ($(du -h "$OUT" | cut -f1))"
