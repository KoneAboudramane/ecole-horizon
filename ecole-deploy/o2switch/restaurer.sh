#!/bin/sh
# Restaure une sauvegarde sur O2switch. ATTENTION : remplace toutes les données actuelles (toutes les écoles).
# Usage :  sh restaurer.sh ~/sauvegardes-ecole/ecole-AAAAMMJJ-HHMMSS.dump [~/sauvegardes-ecole/media-AAAAMMJJ-HHMMSS.tar.gz]
set -eu
. "$(dirname "$0")/commun.sh"
DUMP="${1:?indiquez le fichier .dump}"
MEDIA_TAR="${2:-}"
[ -f "$DUMP" ] || die "$DUMP introuvable"

printf 'Toutes les données actuelles seront remplacées par %s. Tapez OUI pour continuer : ' "$DUMP"
read -r R; [ "$R" = "OUI" ] || { echo "Annulé."; exit 1; }

# Sauvegarde de l'état actuel avant d'écraser
sh "$O2_DIR/sauvegarde.sh"
charger_base

if [ -n "$MEDIA_TAR" ]; then
  sh "$DEPLOY_DIR/scripts/restore.sh" "$DUMP" "$MEDIA_TAR" "$APP_DIR/media"
else
  sh "$DEPLOY_DIR/scripts/restore.sh" "$DUMP"
fi
redemarrer
echo "Application redémarrée."
