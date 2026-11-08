# Réglages communs aux scripts O2switch (lu par « . commun.sh », ne se lance pas seul).
# Fonctionne avec le dépôt GitHub cloné (~/ecole-horizon/ecole-backend + ~/ecole-horizon/ecole-deploy)
# comme avec les archives zip (~/ecole-backend + ~/ecole-deploy) : tout est déduit de l'emplacement de ce dossier.

O2_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$O2_DIR/.." && pwd)"
APP_DIR="${APP_DIR:-$(cd "$DEPLOY_DIR/../ecole-backend" 2>/dev/null && pwd || echo "$HOME/ecole-backend")}"
REPO_DIR="$(cd "$APP_DIR/.." && pwd)"
# Copie du site compilé (branche site-o2switch du dépôt), mise à jour par mise-a-jour.sh
SITE_DIR="${SITE_DIR:-$HOME/ecole-site}"

# Environnement Python créé par cPanel (« Setup Python App ») : ~/virtualenv/<racine de l'application>/<version>
trouver_venv() {
  _rel="${APP_DIR#"$HOME"/}"
  for _d in $(ls -d "$HOME/virtualenv/$_rel"/3.* "$HOME"/virtualenv/*/ecole-backend/3.* "$HOME"/virtualenv/ecole-backend/3.* 2>/dev/null | sort -V -r); do
    [ -f "$_d/bin/activate" ] && { echo "$_d"; return; }
  done
}
VENV="${VENV:-$(trouver_venv)}"

die() { echo "ERREUR : $*" >&2; exit 1; }

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
