"""Prépare sur votre PC les fichiers à envoyer sur O2switch (lancé par preparer-o2switch.bat).

Produit le dossier livraison-o2switch/ :
  site.zip            interface Angular compilée + .htaccess + config.js de production  -> dossier du domaine du site
  ecole-backend.zip   API Django, sans environnement Python, base de test, .env, photos  -> ~/ecole-backend
  ecole-deploy.zip    scripts d'installation, de mise à jour et de sauvegarde           -> ~/ecole-deploy
  GUIDE-O2SWITCH.md
Les archives utilisent des chemins Linux (/) et des fins de ligne Unix pour les scripts : elles s'extraient
telles quelles avec le Gestionnaire de fichiers de cPanel ou `unzip`.
"""
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACK, FRONT, DEPLOY = ROOT / "ecole-backend", ROOT / "ecole-horizon", ROOT / "ecole-deploy"
O2 = DEPLOY / "o2switch"
OUT = ROOT / "livraison-o2switch"

EXCLUDE_DIRS = {".venv", "venv", "__pycache__", ".pytest_cache", ".ruff_cache", "media", "staticfiles", "node_modules", ".git", "tmp"}
EXCLUDE_FILES = {".env", "db.sqlite3", "stderr.log"}
EXCLUDE_SUFFIX = {".pyc", ".pyo", ".log", ".sqlite3"}
UNIX_TEXT = {".sh", ".htaccess", ".example", ".py", ".txt", ".md", ".js", ".html", ".css", ".json", ".yml", ".webmanifest", ".conf"}


def keep(rel: Path) -> bool:
    if any(p in EXCLUDE_DIRS for p in rel.parts[:-1]):
        return False
    return rel.name not in EXCLUDE_FILES and rel.suffix not in EXCLUDE_SUFFIX and not rel.name.startswith(".env.ancien")


def add(z: zipfile.ZipFile, src: Path, name: str):
    data = src.read_bytes()
    if src.suffix in UNIX_TEXT or src.name in {".htaccess", "media.htaccess", ".htaccess-a-ajouter"} or src.suffix == "":
        if b"\0" not in data[:1024]:
            data = data.replace(b"\r\n", b"\n")
    info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (0o755 if src.suffix == ".sh" else 0o644) << 16
    z.writestr(info, data)


def zip_tree(target: Path, base: Path, prefix: str, filt=keep, extra=()):
    n = 0
    with zipfile.ZipFile(target, "w") as z:
        for f in sorted(base.rglob("*")):
            rel = f.relative_to(base)
            if f.is_file() and filt(rel):
                add(z, f, f"{prefix}{rel.as_posix()}")
                n += 1
        for src, name in extra:
            add(z, src, name)
            n += 1
    return n


def main():
    print("1/4 Compilation de l'interface (ng build --configuration production)...")
    npx = "npx.cmd" if sys.platform == "win32" else "npx"
    r = subprocess.run([npx, "ng", "build", "--configuration", "production"], cwd=FRONT)
    if r.returncode:
        sys.exit("ERREUR : la compilation de l'interface a échoué (voir ci-dessus).")
    browser = FRONT / "dist" / "ecole-horizon" / "browser"
    if not (browser / "index.html").exists():
        sys.exit(f"ERREUR : {browser / 'index.html'} introuvable.")

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()

    print("2/4 site.zip")
    n = zip_tree(OUT / "site.zip", browser, "", filt=lambda rel: rel.name != "config.js",
                 extra=[(O2 / "site" / ".htaccess", ".htaccess"), (O2 / "site" / "config.js", "config.js")])
    print(f"    {n} fichiers")

    print("3/4 ecole-backend.zip")
    for must in ("passenger_wsgi.py", "manage.py", "requirements.txt"):
        if not (BACK / must).exists():
            sys.exit(f"ERREUR : ecole-backend/{must} manquant.")
    n = zip_tree(OUT / "ecole-backend.zip", BACK, "ecole-backend/")
    print(f"    {n} fichiers (sans .venv, .env, db.sqlite3, media)")

    print("4/4 ecole-deploy.zip")
    n = zip_tree(OUT / "ecole-deploy.zip", DEPLOY, "ecole-deploy/", filt=lambda rel: keep(rel) and rel.name != "preparer_envoi.py")
    print(f"    {n} fichiers")
    shutil.copy2(O2 / "GUIDE-O2SWITCH.md", OUT / "GUIDE-O2SWITCH.md")

    # Garde-fou : aucun secret ni donnée de test dans les archives
    for zf in OUT.glob("*.zip"):
        with zipfile.ZipFile(zf) as z:
            bad = [x for x in z.namelist() if x.rsplit("/", 1)[-1] in EXCLUDE_FILES or "/.venv/" in x or "/media/" in x]
            if bad:
                sys.exit(f"ERREUR : {zf.name} contient {bad[:3]}")
    print(f"\nPrêt : {OUT}\nSuivez GUIDE-O2SWITCH.md (étapes 2 à 6).")


if __name__ == "__main__":
    main()
