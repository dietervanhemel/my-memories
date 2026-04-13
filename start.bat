@echo off
title My Memories
echo.
echo  === My Memories – Fotoapp ===
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

:: Kill any existing node process on port 3000 so we can restart cleanly
echo  Vorige server stoppen (als die nog actief is)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Install dependencies if needed
if not exist "node_modules" (
    echo  Installeren van benodigde bestanden...
    npm install
    echo.
)

echo  App wordt gestart...
echo.
node server.js
pause
