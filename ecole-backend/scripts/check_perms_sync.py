"""Vérifie que la matrice des permissions du serveur est identique à celle du prototype Angular.

Usage : python scripts/check_perms_sync.py ../ecole-horizon/src/app/models.ts
Les permissions « stats.* » n'existent que côté serveur pour l'instant : elles sont ignorées.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from apps.core.permissions import PERMS  # noqa: E402

src = open(sys.argv[1], encoding="utf-8").read()
block = src[src.index("export const PERMS"):]
block = block[: block.index("};")]
front = {m.group(1): set(re.findall(r"'([\w.]+)'", m.group(2))) for m in re.finditer(r"(\w+): \[([^\]]*)\]", block)}

ok = True
for role, perms in PERMS.items():
    server = {p for p in perms if not p.startswith("stats.")}
    if server != front.get(role, set()):
        ok = False
        print(f"ÉCART pour {role} : serveur-seul={sorted(server - front.get(role, set()))} interface-seule={sorted(front.get(role, set()) - server)}")
print("Matrices alignées." if ok else "Matrices différentes.")
sys.exit(0 if ok else 1)
