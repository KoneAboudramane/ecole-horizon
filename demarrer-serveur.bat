@echo off
chcp 65001 >nul
title Ecole Horizon - Serveur (API)
cd /d "%~dp0ecole-backend"

if not exist ".venv\Scripts\python.exe" (
  echo Creation de l'environnement Python ^(premiere fois, 1 a 2 minutes^)...
  where py >nul 2>nul && (py -3 -m venv .venv) || (python -m venv .venv)
)
if not exist ".venv\Scripts\python.exe" (
  echo.
  echo ERREUR : Python est introuvable. Installez Python 3.12 ou plus depuis python.org
  echo et cochez "Add python.exe to PATH", puis relancez ce script.
  pause
  exit /b 1
)

call ".venv\Scripts\activate.bat"
echo Installation des dependances...
python -m pip install -q -r requirements-dev.txt
if errorlevel 1 (
  echo.
  echo ERREUR pendant l'installation des dependances. Verifiez votre connexion internet.
  pause
  exit /b 1
)

if not exist ".env" copy /y ".env.local.example" ".env" >nul

python manage.py migrate
if errorlevel 1 (
  pause
  exit /b 1
)
python manage.py seed_demo --complet

echo.
echo ==============================================================
echo  Serveur pret : http://127.0.0.1:8000
echo  Laissez cette fenetre OUVERTE pendant vos tests.
echo  Comptes : directeur, secretariat, fondateur, enseignant,
echo            educateur, comptable, parent, eleve  ^(mot de passe : demo^)
echo ==============================================================
echo.
python manage.py runserver 127.0.0.1:8000
pause
