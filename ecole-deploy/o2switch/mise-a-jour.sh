#!/bin/sh
# Met à jour la plateforme sur O2switch depuis GitHub, par SSH :
#   sh ~/ecole-horizon/ecole-deploy/o2switch/mise-a-jour.sh
# Récupère la dernière version (API + site), sauvegarde, installe les dépendances, applique les migrations
# (+ table du cache), copie les statiques, vérifie la configuration et redémarre l'application.
set -eu
. "$(dirname "$0")/commun.sh"

[ -n "$VENV" ] || die "environnement Python introuvable : indiquez VENV=/home/.../virtualenv/.../3.x (chemin affiché dans « Setup Python App »)"
[ -f "$APP_DIR/.env" ] || die "$APP_DIR/.env absent : lancez d'abord installer.sh"

# 0. Récupérer la dernière version, puis relancer CE script dans sa nouvelle version
if [ "${DEJA_A_JOUR:-0}" != 1 ] && [ "${SANS_GIT:-0}" != 1 ]; then
  if [ -d "$REPO_DIR/.git" ]; then
    echo "0/6 Récupération de la dernière version depuis GitHub"
    restaurer_passenger   # cPanel peut l'avoir réécrit
    git -C "$REPO_DIR" pull --ff-only || die "mise à jour du code impossible (fichiers modifiés sur le serveur ?  git -C $REPO_DIR status)"
  fi
  if [ -d "$SITE_DIR/.git" ]; then
    echo "   Site : $SITE_DIR"
    git -C "$SITE_DIR" pull --ff-only || die "mise à jour du site impossible ($SITE_DIR)"
  fi
  DEJA_A_JOUR=1 exec sh "$O2_DIR/mise-a-jour.sh"
fi

. "$VENV/bin/activate"
cd "$APP_DIR"

echo "1/5 Sauvegarde avant mise à jour"
if [ "${SANS_SAUVEGARDE:-0}" = 1 ]; then echo "   (première installation : rien à sauvegarder)"
else sh "$O2_DIR/sauvegarde.sh" || die "sauvegarde échouée : mise à jour arrêtée (SANS_SAUVEGARDE=1 pour passer outre)"; fi

echo "2/5 Dépendances"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

echo "3/5 Migrations de la base (crée aussi la table du cache partagé)"
python manage.py migrate --noinput

echo "4/5 Fichiers statiques (administration Django)"
python manage.py collectstatic --noinput --verbosity 0

echo "5/5 Vérification et redémarrage"
python manage.py check --deploy --fail-level ERROR
exporter_site
redemarrer
API_HOST="$(grep '^ALLOWED_HOSTS=' .env | cut -d= -f2 | cut -d, -f1)"
echo "Terminé. Contrôle : https://$API_HOST/api/v1/health/"
