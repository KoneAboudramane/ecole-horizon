"""Point d'entrée O2switch quand l'application Python de cPanel a pour racine le dépôt entier (ecole-horizon).

L'API se trouve dans ecole-backend/ ; ses réglages viennent de ecole-backend/.env.
(Si la racine de l'application est ecole-horizon/ecole-backend, c'est ecole-backend/passenger_wsgi.py qui sert.)
"""
import os
import sys

BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ecole-backend")
sys.path.insert(0, BACKEND)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from config.wsgi import application  # noqa: E402,F401
