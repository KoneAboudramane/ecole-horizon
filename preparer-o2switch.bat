@echo off
chcp 65001 >nul
title Preparation de l'envoi sur O2switch
cd /d "%~dp0"
set PY=ecole-backend\.venv\Scripts\python.exe
if not exist "%PY%" set PY=py -3
%PY% ecole-deploy\o2switch\preparer_envoi.py
echo.
pause
