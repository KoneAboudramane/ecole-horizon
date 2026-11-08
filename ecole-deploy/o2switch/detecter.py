"""Détecte les adresses sur cPanel (O2switch) et les écrit en variables shell.

- API  : le domaine dont le .htaccess lance l'application Python de ce dépôt (PassengerAppRoot), tel que cPanel l'a créé.
- SITE : le domaine dont la racine est ~/ecole-site ; sinon un sous-domaine libre « ecole.<domaine> » à créer.
Ne modifie rien : le script shell crée le sous-domaine si CREER_SITE est rempli.
Usage : python3 detecter.py /home/user/ecole-horizon
"""
import json
import os
import re
import shlex
import subprocess
import sys

home = os.environ.get("HOME") or os.path.expanduser("~")
repo = os.path.realpath(sys.argv[1])
site_dir = os.path.realpath(os.path.join(home, "ecole-site"))


def out(**kw):
    print(" ".join(f"{k}={shlex.quote(str(v))}" for k, v in kw.items()))
    sys.exit(0)


try:
    r = subprocess.run([*os.environ.get("UAPI_CMD", "uapi").split(), "--output=json", "DomainInfo", "domains_data"], capture_output=True, text=True, timeout=90)
    data = (json.loads(r.stdout or "{}").get("result") or {}).get("data") or {}
except (OSError, ValueError, subprocess.SubprocessError) as e:
    out(ERREUR_DETECTION=f"lecture des domaines cPanel impossible ({e})")

main = data.get("main_domain") or {}
addons = data.get("addon_domains") or []
subs = data.get("sub_domains") or []
docroots = {}
for d in [main, *addons, *subs]:
    if d.get("domain"):
        docroots[d["domain"]] = os.path.realpath(d.get("documentroot") or "")
racines = [d["domain"] for d in [main, *addons] if d.get("domain")]


def racine_de(dom):
    return max((r for r in racines if dom == r or dom.endswith("." + r)), key=len, default=main.get("domain", ""))


# 1. API : domaine qui lance l'application Python de ce dépôt
api = []
for dom, root in docroots.items():
    try:
        txt = open(os.path.join(root, ".htaccess"), encoding="utf-8", errors="ignore").read()
    except OSError:
        continue
    m = re.search(r'PassengerAppRoot\s+"?([^"\s]+)', txt)
    if m and os.path.realpath(m.group(1)) in (repo, os.path.join(repo, "ecole-backend")):
        api.append(dom)
if not api:
    out(ERREUR_DETECTION="application Python introuvable : dans cPanel > Setup Python App, l'application "
        "« ecole-horizon » doit avoir une « Application URL » (un domaine ou sous-domaine).")
api = min(api, key=len)  # plusieurs noms pour le même dossier : le plus court

# 2. SITE : domaine dont la racine est ~/ecole-site, sinon sous-domaine libre à créer
site = next((d for d, r in docroots.items() if r == site_dir), "")
creer = ""
if not site:
    racine = racine_de(api)
    for etiquette in ("ecole", "ecole-horizon", "ecole-site", "site-ecole"):
        candidat = f"{etiquette}.{racine}"
        if candidat not in docroots and candidat != api:
            site, creer = candidat, f"{etiquette} {racine}"
            break
    if not site:
        out(ERREUR_DETECTION="aucun nom libre pour le site : créez un sous-domaine dont la racine est « ecole-site ».")

out(API_HOST=api, API_ROOT=docroots[api], SITE=site, CREER_SITE=creer)
