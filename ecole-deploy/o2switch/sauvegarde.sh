#!/bin/sh
# Sauvegarde quotidienne sur O2switch : base PostgreSQL + photos et fichiers déposés.
# Les informations de la base sont lues dans le .env (DATABASE_URL) : rien à configurer.
# Réutilise ../scripts/backup.sh (même format que le déploiement Docker, donc même restore.sh).
#
# cPanel > Tâches Cron, une fois par jour (ex. 2 h 00) :
#   sh $HOME/ecole-horizon/ecole-deploy/o2switch/sauvegarde.sh >> $HOME/sauvegardes-ecole/sauvegarde.log 2>&1
set -eu
. "$(dirname "$0")/commun.sh"

export BACKUP_DIR="${BACKUP_DIR:-$HOME/sauvegardes-ecole}"   # hors de public_html
export MEDIA_DIR="${MEDIA_DIR:-$APP_DIR/media}"
export KEEP_DAYS="${KEEP_DAYS:-30}"

command -v pg_dump >/dev/null || die "pg_dump introuvable sur ce serveur : demandez-le au support O2switch"
charger_base

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077
date "+== %Y-%m-%d %H:%M:%S"
sh "$DEPLOY_DIR/scripts/backup.sh"
