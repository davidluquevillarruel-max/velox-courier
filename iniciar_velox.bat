@echo off
title Velox Courier - Servidor
color 0A
echo.
echo  ==========================================
echo   VELOX COURIER - Iniciando servidor...
echo  ==========================================
echo.

cd /d "%~dp0server"

echo  Iniciando Node.js...
echo  No cierres esta ventana mientras uses el sistema.
echo.
echo  Abre tu navegador en:
echo  http://localhost:3000/index.html
echo.
echo  ==========================================
echo.

start "" "http://localhost:3000/index.html"
node server.js

pause
