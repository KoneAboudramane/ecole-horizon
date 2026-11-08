"""Compile l'interface et la publie sur la branche GitHub « site-o2switch » (lancé par publier-site.bat).

O2switch clone cette branche dans le dossier du site : elle ne contient que les fichiers compilés, le .htaccess et le
config.js de production. Chaque publication ajoute un commit (jamais d'écrasement de l'historique), donc
« git pull » sur le serveur suffit pour mettre le site à jour (mise-a-jour.sh le fait).
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONT = ROOT / "ecole-horizon"
O2 = ROOT / "ecole-deploy" / "o2switch"
BRANCH = "site-o2switch"


def git(*args, cwd=ROOT, check=True, capture=False):
    r = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=capture)
    if check and r.returncode:
        sys.exit(f"ERREUR : git {' '.join(args)}\n{(r.stderr or '') if capture else ''}")
    return r


def main():
    if git("status", "--porcelain", "--", "ecole-horizon", "ecole-deploy/o2switch/site", capture=True).stdout.strip():
        print("ATTENTION : l'interface a des modifications non enregistrées dans git ; elles seront publiées quand même.")
    source = git("rev-parse", "--short", "HEAD", capture=True).stdout.strip()

    print("1/3 Compilation de l'interface (ng build --configuration production)...")
    npx = "npx.cmd" if sys.platform == "win32" else "npx"
    if subprocess.run([npx, "ng", "build", "--configuration", "production"], cwd=FRONT).returncode:
        sys.exit("ERREUR : la compilation a échoué (voir ci-dessus).")
    browser = FRONT / "dist" / "ecole-horizon" / "browser"
    if not (browser / "index.html").exists():
        sys.exit(f"ERREUR : {browser / 'index.html'} introuvable.")

    print(f"2/3 Préparation de la branche {BRANCH}...")
    existe = git("ls-remote", "--exit-code", "--heads", "origin", BRANCH, check=False, capture=True).returncode == 0
    tmp = Path(tempfile.mkdtemp(prefix="site-o2switch-"))
    shutil.rmtree(tmp)
    try:
        if existe:
            git("fetch", "--quiet", "origin", f"{BRANCH}:refs/remotes/origin/{BRANCH}")
            git("worktree", "add", "--quiet", "-B", BRANCH, str(tmp), f"origin/{BRANCH}")
        else:
            git("worktree", "add", "--quiet", "--orphan", "-b", BRANCH, str(tmp))
        for p in tmp.iterdir():
            if p.name != ".git":
                shutil.rmtree(p) if p.is_dir() else p.unlink()
        shutil.copytree(browser, tmp, dirs_exist_ok=True)
        shutil.copy2(O2 / "site" / ".htaccess", tmp / ".htaccess")
        shutil.copy2(O2 / "site" / "config.js", tmp / "config.js")
        (tmp / "LISEZMOI.txt").write_text(
            "Site compilé de la plateforme scolaire, pour O2switch (dossier du site).\n"
            f"Généré automatiquement depuis la branche main ({source}) par publier-site.bat : ne pas modifier ici.\n",
            encoding="utf-8")

        print("3/3 Envoi sur GitHub...")
        git("add", "-A", cwd=tmp)
        if git("diff", "--cached", "--quiet", cwd=tmp, check=False).returncode == 0:
            print("Aucun changement : le site publié est déjà à jour.")
            return
        git("commit", "--quiet", "-m", f"Site compilé depuis main ({source})", cwd=tmp)
        git("push", "--quiet", "origin", BRANCH, cwd=tmp)
        print(f"\nSite publié sur la branche {BRANCH}.")
        print("Sur O2switch :  sh ~/ecole-horizon/ecole-deploy/o2switch/mise-a-jour.sh")
    finally:
        git("worktree", "remove", "--force", str(tmp), check=False, capture=True)
        git("worktree", "prune", check=False)


if __name__ == "__main__":
    main()
