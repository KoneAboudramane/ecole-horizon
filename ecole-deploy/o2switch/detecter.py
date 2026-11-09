"""Trouve sur cPanel (O2switch) l'adresse de l'application Python de ce dépôt et l'écrit en variables shell.

L'adresse est le domaine dont le .htaccess lance l'application (PassengerAppRoot), tel que cPanel l'a créé dans
« Setup Python App ». Le site et l'API sont servis ensemble sur cette adresse. Ne modifie rien.
Usage : python3 detecter.py /home/user/ecole-horizon
"""
import json
import os
import re
import shlex
import subprocess
import sys

repo = os.path.realpath(sys.argv[1])


def out(**kw):
    print(" ".join(f"{k}={shlex.quote(str(v))}" for k, v in kw.items()))
    sys.exit(0)


try:
    r = subprocess.run([*os.environ.get("UAPI_CMD", "uapi").split(), "--output=json", "DomainInfo", "domains_data"],
                       capture_output=True, text=True, timeout=90)
    data = (json.loads(r.stdout or "{}").get("result") or {}).get("data") or {}
except (OSError, ValueError, subprocess.SubprocessError) as e:
    out(ERREUR_DETECTION=f"lecture des domaines cPanel impossible ({e})")

docroots = {}
for d in [data.get("main_domain") or {}, *(data.get("addon_domains") or []), *(data.get("sub_domains") or [])]:
    if d.get("domain"):
        docroots[d["domain"]] = os.path.realpath(d.get("documentroot") or "")

trouves = []
for dom, root in docroots.items():
    try:
        txt = open(os.path.join(root, ".htaccess"), encoding="utf-8", errors="ignore").read()
    except OSError:
        continue
    m = re.search(r'PassengerAppRoot\s+"?([^"\s]+)', txt)
    if m and os.path.realpath(m.group(1)) in (repo, os.path.join(repo, "ecole-backend")):
        trouves.append(dom)
if not trouves:
    out(ERREUR_DETECTION="application Python introuvable : dans cPanel > Setup Python App, l'application "
        "« ecole-horizon » doit avoir une « Application URL » (votre sous-domaine).")
api = min(trouves, key=len)  # plusieurs noms pour le même dossier : le plus court
out(API_HOST=api, API_ROOT=docroots[api])
