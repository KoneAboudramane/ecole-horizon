"""Point d'entrée de l'hébergement O2switch (cPanel « Setup Python App », serveur Passenger).

Ce fichier doit rester à la racine de l'application (à côté de manage.py). cPanel en crée un au premier lancement :
remplacez son contenu par celui-ci. Les réglages viennent du fichier .env placé à côté (voir ecole-deploy/o2switch).
Après une modification du code : bouton « Restart » dans cPanel, ou `touch tmp/restart.txt`.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from config.wsgi import application  # noqa: E402,F401
