#!/bin/sh
# Lance backup.sh une fois par jour à l'heure BACKUP_HOUR (et une fois au démarrage si aucune sauvegarde n'existe).
set -u
HOUR="${BACKUP_HOUR:-2}"
ls "${BACKUP_DIR:-/backups}"/ecole-*.dump >/dev/null 2>&1 || sh /scripts/backup.sh || echo "Échec de la sauvegarde initiale"
while true; do
  NOW=$(date +%H); NOW=${NOW#0}; NOW=${NOW:-0}
  if [ "$NOW" = "${HOUR#0}" ]; then sh /scripts/backup.sh || echo "ÉCHEC DE LA SAUVEGARDE"; sleep 3700; else sleep 600; fi
done
