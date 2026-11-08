@echo off
timeout /t 30 /nobreak >nul
start "" "http://localhost:4200/?api=http://127.0.0.1:8000"
