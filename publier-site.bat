@echo off
chcp 65001 >nul
title Publication du site sur GitHub (O2switch)
cd /d "%~dp0"
set PY=ecole-backend\.venv\Scripts\python.exe
if not exist "%PY%" set PY=py -3
%PY% ecole-deploy\o2switch\publier_site.py
echo.
pause
