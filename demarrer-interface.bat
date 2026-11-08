@echo off
chcp 65001 >nul
title Ecole Horizon - Interface
cd /d "%~dp0ecole-horizon"

where node >nul 2>nul
if errorlevel 1 (
  echo ERREUR : Node.js est introuvable. Installez Node.js 22 ou plus depuis nodejs.org,
  echo puis relancez ce script.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installation des dependances ^(premiere fois, 2 a 5 minutes^)...
  call npm install
  if errorlevel 1 (
    echo ERREUR pendant npm install.
    pause
    exit /b 1
  )
)

echo.
echo ==============================================================
echo  L'interface se prepare. Le navigateur s'ouvrira dans environ 30 secondes
echo  sur : http://localhost:4200/?api=http://127.0.0.1:8000
echo  Laissez cette fenetre OUVERTE pendant vos tests.
echo ==============================================================
echo.
start "" /min "%~dp0ouvrir-navigateur.bat"
call npx ng serve
pause
