@echo off
title Trouw Fotoapp
echo.
echo  === Trouw Fotoapp ===
echo.

:: Check if node is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Node.js niet gevonden!
    echo.
    echo  Download en installeer Node.js van: https://nodejs.org
    echo  Kies de LTS versie en herstart daarna dit bestand.
    echo.
    pause
    exit /b
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo  Installeren van benodigde bestanden...
    npm install
    echo.
)

echo  App wordt gestart op http://localhost:3000
echo  Dashboard: http://localhost:3000/dashboard.html
echo  Wachtwoord: bruid2024
echo.
echo  Druk op Ctrl+C om de app te stoppen.
echo.

node server.js
pause
