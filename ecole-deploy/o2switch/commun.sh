# Réglages communs aux scripts O2switch (lu par « . commun.sh », ne se lance pas seul).
# Fonctionne avec le dépôt GitHub cloné (~/ecole-horizon/ecole-backend + ~/ecole-horizon/ecole-deploy)
# comme avec les archives zip (~/ecole-backend + ~/ecole-deploy) : tout est déduit de l'emplacement de ce dossier.

O2_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$O2_DIR/.." && pwd)"
APP_DIR="${APP_DIR:-$(cd "$DEPLOY_DIR/../ecole-backend" 2>/dev/null && pwd || echo "$HOME/ecole-backend")}"
REPO_DIR="$(cd "$APP_DIR/.." && pwd)"
# Copie du site compilé (branche site-o2switch du dépôt), mise à jour par mise-a-jour.sh
SITE_DIR="${SITE_DIR:-$HOME/ecole-site}"

# Environnement Python créé par cPanel (« Setup Python App ») : ~/virtualenv/<racine de l'application>/<version>.
# La racine de l'application peut être le dépôt (ecole-horizon) ou ecole-horizon/ecole-backend.
trouver_venv() {
  _app="${APP_DIR#"$HOME"/}"; _repo="${REPO_DIR#"$HOME"/}"
  for _d in $(ls -d "$HOME/virtualenv/$_app"/3.* "$HOME/virtualenv/$_repo"/3.* "$HOME"/virtualenv/ecole-backend/3.* 2>/dev/null | sort -V -r); do
    [ -f "$_d/bin/activate" ] && { echo "$_d"; return; }
  done
}
VENV="${VENV:-$(trouver_venv)}"
# Racine de l'application Passenger (là où il lit passenger_wsgi.py et tmp/restart.txt) : déduite du chemin de VENV
if [ -n "$VENV" ]; then
  _r="${VENV#"$HOME"/virtualenv/}"; PASSENGER_ROOT="$HOME/${_r%/*}"
else
  PASSENGER_ROOT="$APP_DIR"
fi

die() { echo "ERREUR : $*" >&2; exit 1; }

redemarrer() { mkdir -p "$PASSENGER_ROOT/tmp" && touch "$PASSENGER_ROOT/tmp/restart.txt"; }

# cPanel réécrit passenger_wsgi.py quand on crée ou modifie l'application : on remet ceux du projet
restaurer_passenger() {
  [ -d "$REPO_DIR/.git" ] && git -C "$REPO_DIR" checkout -- passenger_wsgi.py ecole-backend/passenger_wsgi.py 2>/dev/null || true
}

# Lit DATABASE_URL dans le .env et exporte les variables de pg_dump / pg_restore
charger_base() {
  [ -f "$APP_DIR/.env" ] || die "$APP_DIR/.env absent"
  eval "$(python3 - "$APP_DIR/.env" <<'PY'
import shlex, sys, urllib.parse
url = next((l.split("=", 1)[1].strip().strip("'\"") for l in open(sys.argv[1], encoding="utf-8") if l.startswith("DATABASE_URL=")), "")
u = urllib.parse.urlsplit(url)
if not u.scheme.startswith("postgres"):
    sys.exit("DATABASE_URL n'est pas une base PostgreSQL")
q = lambda v: shlex.quote(urllib.parse.unquote(v or ""))
print(f"export PGHOST={q(u.hostname or 'localhost')} PGPORT={q(str(u.port or 5432))} "
      f"PGUSER={q(u.username)} PGPASSWORD={q(u.password)} PGDATABASE={q(u.path.lstrip('/'))}")
PY
)"
}
