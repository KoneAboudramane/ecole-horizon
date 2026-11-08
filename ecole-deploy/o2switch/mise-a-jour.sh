#!/bin/sh
# À lancer par SSH après avoir envoyé une nouvelle version de ecole-backend (et à la première installation).
# Usage :  sh ~/ecole-deploy/o2switch/mise-a-jour.sh
# Remplace ce que faisait le conteneur Docker au démarrage : dépendances, migrations (+ table du cache), fichiers statiques,
# vérification de la configuration, redémarrage de l'application.
set -eu

APP_DIR="${APP_DIR:-$HOME/ecole-backend}"
# Environnement Python créé par cPanel (« Setup Python App ») : le chemin exact est affiché en haut de la page de l'application.
VENV="${VENV:-$(ls -d "$HOME"/virtualenv/ecole-backend/3.* 2>/dev/null | sort -V | tail -n 1)}"

[ -n "$VENV" ] && [ -f "$VENV/bin/activate" ] || { echo "Environnement Python introuvable : indiquez VENV=/home/.../virtualenv/ecole-backend/3.x" >&2; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo "$APP_DIR/.env absent (modèle : env.production.example)" >&2; exit 1; }

. "$VENV/bin/activate"
cd "$APP_DIR"

echo "1/5 Sauvegarde avant mise à jour"
if [ "${SANS_SAUVEGARDE:-0}" = 1 ]; then echo "   (première installation : rien à sauvegarder)"
else sh "$(dirname "$0")/sauvegarde.sh" || { echo "Sauvegarde échouée : mise à jour arrêtée (SANS_SAUVEGARDE=1 pour passer outre)." >&2; exit 1; }; fi

echo "2/5 Dépendances"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

echo "3/5 Migrations de la base (crée aussi la table du cache partagé)"
python manage.py migrate --noinput

echo "4/5 Fichiers statiques (administration Django)"
python manage.py collectstatic --noinput --verbosity 0

echo "5/5 Vérification et redémarrage"
python manage.py check --deploy --fail-level ERROR
mkdir -p tmp && touch tmp/restart.txt
echo "Terminé. Contrôle :  curl -s https://\$(grep ^ALLOWED_HOSTS .env | cut -d= -f2 | cut -d, -f1)/api/v1/health/"
