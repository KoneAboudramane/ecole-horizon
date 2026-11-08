#!/bin/sh
# Gestion complète de la plateforme scolaire sur O2switch : UN SEUL script, avec un menu.
#
# Première fois (Terminal de cPanel), UNE commande (remplacez MOTDEPASSE par celui de la base PostgreSQL) :
#   curl -fsSL https://raw.githubusercontent.com/KoneAboudramane/ecole-horizon/main/ecole-deploy/o2switch/gerer.sh -o ~/gerer.sh && DB_PASS='MOTDEPASSE' sh ~/gerer.sh installer
# Ensuite, à chaque fois :  sh ~/gerer.sh
# Sans menu :  sh ~/gerer.sh installer | mise-a-jour | sauvegarder | etat | erreurs | redemarrer
set -eu

REPO_URL="https://github.com/KoneAboudramane/ecole-horizon.git"
REPO_DIR="${REPO_DIR:-$HOME/ecole-horizon}"
O2="$REPO_DIR/ecole-deploy/o2switch"
APP_DIR="$REPO_DIR/ecole-backend"
_site_env="$(grep '^ECOLE_SITE_DIR=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2 || true)"
SITE_DIR="${SITE_DIR:-${_site_env:-$HOME/ecole-site}}"
SAUV_DIR="$HOME/sauvegardes-ecole"

titre() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok() { printf '\033[32m%s\033[0m\n' "$*"; }
attention() { printf '\033[33m%s\033[0m\n' "$*"; }
erreur() { printf '\033[31mERREUR : %s\033[0m\n' "$*" >&2; }
pause() { printf '\nAppuyez sur Entrée pour revenir au menu...'; read -r _; }

# Clone (ou rattrape un dossier déjà créé par cPanel) une branche du dépôt dans un dossier
recuperer() { # recuperer DOSSIER BRANCHE
  if [ -d "$1/.git" ]; then
    git -C "$1" pull --ff-only --quiet
  else
    mkdir -p "$1"
    git -C "$1" init --quiet
    git -C "$1" remote add origin "$REPO_URL" 2>/dev/null || git -C "$1" remote set-url origin "$REPO_URL"
    git -C "$1" fetch --quiet origin "$2"
    git -C "$1" checkout --quiet -f -B "$2" "origin/$2"   # remplace les fichiers créés par cPanel (passenger_wsgi.py…)
    git -C "$1" branch --quiet --set-upstream-to="origin/$2" "$2"
  fi
}

code_present() {
  [ -f "$O2/commun.sh" ] && return 0
  erreur "le code n'est pas encore installé dans $REPO_DIR : choisissez d'abord « 1. Installer »."
  return 1
}

# Charge les chemins (environnement Python, racine Passenger…) calculés par commun.sh
charger() {
  code_present || return 1
  # commun.sh se repère avec $0 : on le lit dans un sous-shell dont $0 est commun.sh lui-même
  eval "$(sh -c '. "$1/commun.sh"; printf "VENV=%s\nPASSENGER_ROOT=%s\n" "$VENV" "$PASSENGER_ROOT"' "$O2/commun.sh" "$O2" 2>/dev/null)" || true
}

django() { # django COMMANDE...  (dans l'environnement Python de l'application)
  charger || return 1
  [ -n "${VENV:-}" ] || { erreur "environnement Python introuvable : créez l'application dans cPanel > Setup Python App"; return 1; }
  ( . "$VENV/bin/activate" && cd "$APP_DIR" && python manage.py "$@" )
}

api_host() { grep '^ALLOWED_HOSTS=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2 | cut -d, -f1; }

# ---------------------------------------------------------------- actions

installer() {
  titre "Installation"
  command -v git >/dev/null || { erreur "git est absent du serveur"; return 1; }
  echo "1. Code de l'API  -> $REPO_DIR"
  recuperer "$REPO_DIR" main && ok "   OK"
  # le site est placé par l'installateur dans le dossier du sous-domaine du site
  AUTO="${AUTO:-1}" sh "$O2/installer.sh"
  cp "$O2/gerer.sh" "$HOME/gerer.sh.nouveau" && mv "$HOME/gerer.sh.nouveau" "$HOME/gerer.sh" 2>/dev/null || true
}

mise_a_jour() {
  titre "Mise à jour depuis GitHub"
  code_present || return 1
  sh "$O2/mise-a-jour.sh" && ok "Mise à jour terminée."
  # le menu lui-même se met à jour (sans gêner le script en cours)
  [ -f "$O2/gerer.sh" ] && cp "$O2/gerer.sh" "$HOME/gerer.sh.nouveau" && mv "$HOME/gerer.sh.nouveau" "$HOME/gerer.sh" || true
}

sauvegarder() { titre "Sauvegarde"; code_present || return 1; sh "$O2/sauvegarde.sh"; }

restaurer() {
  titre "Restaurer une sauvegarde"
  code_present || return 1
  set -- $(ls -1t "$SAUV_DIR"/ecole-*.dump 2>/dev/null | head -n 10)
  [ $# -gt 0 ] || { attention "Aucune sauvegarde dans $SAUV_DIR"; return 0; }
  i=1; for f in "$@"; do printf '  %2d. %s  (%s)\n' "$i" "$(basename "$f")" "$(du -h "$f" | cut -f1)"; i=$((i+1)); done
  printf 'Numéro de la sauvegarde (vide = annuler) : '; read -r n
  [ -n "$n" ] || return 0
  case "$n" in *[!0-9]*) erreur "numéro invalide"; return 1;; esac
  eval "f=\${$n:-}"; [ -n "$f" ] || { erreur "numéro invalide"; return 1; }
  m="$SAUV_DIR/media-$(basename "$f" .dump | sed 's/^ecole-//').tar.gz"
  if [ -f "$m" ]; then sh "$O2/restaurer.sh" "$f" "$m"; else sh "$O2/restaurer.sh" "$f"; fi
}

etat() {
  titre "État"
  if [ -d "$REPO_DIR/.git" ]; then echo "Code      : $(git -C "$REPO_DIR" log -1 --format='%h %cd  %s' --date=format:'%d/%m/%Y %H:%M')"; else attention "Code      : non installé"; fi
  if [ -d "$SITE_DIR/.git" ]; then echo "Site      : $(git -C "$SITE_DIR" log -1 --format='%h %cd' --date=format:'%d/%m/%Y %H:%M')"; else attention "Site      : non installé ($SITE_DIR)"; fi
  charger 2>/dev/null || true
  echo "Python    : ${VENV:-introuvable}"
  echo "Appli     : ${PASSENGER_ROOT:-?}"
  if [ -f "$APP_DIR/.env" ]; then
    h="$(api_host)"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$h/api/v1/health/" || echo 000)"
    if [ "$code" = 200 ]; then ok "API       : https://$h  répond (200)"; else attention "API       : https://$h  -> code $code (voir « Erreurs »)"; fi
    echo "Site      : $(grep '^PUBLIC_BASE_URL=' "$APP_DIR/.env" | cut -d= -f2)"
    echo "Admin     : https://$h/$(grep '^ADMIN_URL=' "$APP_DIR/.env" | cut -d= -f2)"
  else attention "Réglages  : .env absent (installation à faire)"; fi
  d="$(ls -1t "$SAUV_DIR"/ecole-*.dump 2>/dev/null | head -n 1)"
  if [ -n "$d" ]; then echo "Sauvegarde: $(basename "$d") ($(ls "$SAUV_DIR"/ecole-*.dump | wc -l) conservées)"; else attention "Sauvegarde: aucune"; fi
  if crontab -l 2>/dev/null | grep -q "o2switch/sauvegarde.sh"; then echo "Auto      : sauvegarde quotidienne programmée"; else attention "Auto      : sauvegarde quotidienne NON programmée (option 8)"; fi
  echo "Espace    : $(du -sh "$HOME" 2>/dev/null | cut -f1) utilisés dans $HOME"
}

erreurs() {
  titre "Dernières erreurs de l'application"
  charger 2>/dev/null || true
  for f in "${PASSENGER_ROOT:-$REPO_DIR}/stderr.log" "$APP_DIR/stderr.log"; do
    [ -f "$f" ] && { echo "--- $f"; tail -n 40 "$f"; return 0; }
  done
  ok "Aucun journal d'erreurs (stderr.log) : rien à signaler."
}

redemarrer() {
  charger || return 1
  mkdir -p "$PASSENGER_ROOT/tmp" && touch "$PASSENGER_ROOT/tmp/restart.txt" && ok "Application redémarrée (au prochain accès)."
}

programmer_sauvegarde() {
  titre "Sauvegarde automatique"
  code_present || return 1
  ligne="0 2 * * * sh $O2/sauvegarde.sh >> $SAUV_DIR/sauvegarde.log 2>&1"
  mkdir -p "$SAUV_DIR"
  if crontab -l 2>/dev/null | grep -q "o2switch/sauvegarde.sh"; then ok "Déjà programmée :"; crontab -l | grep "o2switch/sauvegarde.sh"; return 0; fi
  if { crontab -l 2>/dev/null; echo "$ligne"; } | crontab - 2>/dev/null; then
    ok "Programmée chaque nuit à 2 h 00 (visible dans cPanel > Tâches Cron)."
  else
    attention "Impossible ici. Ajoutez-la dans cPanel > Tâches Cron (une fois par jour) :"; echo "  $ligne"
  fi
}

tester_email() { titre "Test de l'e-mail"; printf 'Adresse qui doit recevoir le test : '; read -r a; [ -n "$a" ] && django test_email "$a"; }

creer_admin() {
  titre "Nouvel administrateur de la plateforme"
  printf 'Identifiant : '; read -r u; printf 'Nom complet : '; read -r n
  [ -n "$u" ] && django create_platform_admin --username "$u" --name "${n:-$u}"
}

reset_2fa() { titre "Retirer la double authentification"; printf 'Identifiant : '; read -r u; [ -n "$u" ] && django reset_2fa "$u"; }

console() { titre "Console Django (quitter : exit())"; django shell; }

# ---------------------------------------------------------------- menu

menu() {
  while :; do
    printf '\n\033[1m==== Plateforme scolaire : gestion O2switch ====\033[0m\n'
    echo "  1. Installer (première fois)"
    echo "  2. Mettre à jour depuis GitHub"
    echo "  3. Sauvegarder maintenant"
    echo "  4. Restaurer une sauvegarde"
    echo "  5. État (API, site, sauvegardes)"
    echo "  6. Voir les erreurs"
    echo "  7. Redémarrer l'application"
    echo "  8. Programmer la sauvegarde automatique"
    echo "  9. Tester l'envoi d'e-mail"
    echo " 10. Créer un administrateur de la plateforme"
    echo " 11. Retirer la double authentification d'un compte"
    echo " 12. Console Django (avancé)"
    echo "  0. Quitter"
    printf 'Votre choix : '; read -r c || exit 0
    case "$c" in
      1) installer || true; pause;;
      2) mise_a_jour || true; pause;;
      3) sauvegarder || true; pause;;
      4) restaurer || true; pause;;
      5) etat || true; pause;;
      6) erreurs || true; pause;;
      7) redemarrer || true; pause;;
      8) programmer_sauvegarde || true; pause;;
      9) tester_email || true; pause;;
      10) creer_admin || true; pause;;
      11) reset_2fa || true; pause;;
      12) console || true;;
      0|q) exit 0;;
      *) attention "Choix inconnu.";;
    esac
  done
}

case "${1:-menu}" in
  menu) menu;;
  installer) installer;;
  mise-a-jour|maj) mise_a_jour;;
  sauvegarder) sauvegarder;;
  restaurer) restaurer;;
  etat) etat;;
  erreurs) erreurs;;
  redemarrer) redemarrer;;
  *) echo "Usage : sh $0 [installer|mise-a-jour|sauvegarder|restaurer|etat|erreurs|redemarrer]"; exit 1;;
esac
