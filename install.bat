@echo off
setlocal EnableDelayedExpansion
title My Memories – Installatie
color 0A
cls

echo.
echo  ============================================================
echo   My Memories – Installatie
echo  ============================================================
echo.
echo  Dit script installeert alles wat nodig is om de app te starten.
echo  - Controleert Node.js (installeert automatisch via winget)
echo  - Installeert npm-pakketten
echo  - Genereert app-iconen (voor iPhone / PWA)
echo  - Maakt een snelkoppeling op het bureaublad
echo.
pause

:: ─── Check for admin (needed for winget install) ─────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo  [!] Start dit script als Administrator voor automatische Node.js installatie.
  echo.
  echo  Klik rechts op install.bat en kies "Uitvoeren als administrator".
  echo.
  pause
  exit /b 1
)

:: ─── Check / install Node.js ──────────────────────────────────────────────────
echo  Stap 1/4  Controleren Node.js...
where node >nul 2>&1
if %errorlevel% equ 0 (
  for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
  echo  [OK] Node.js !NODE_VER! gevonden.
) else (
  echo  [..] Node.js niet gevonden. Automatisch installeren via winget...
  echo.
  winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if !errorlevel! neq 0 (
    echo.
    echo  [!] Automatische installatie mislukt.
    echo.
    echo  Download Node.js handmatig van: https://nodejs.org
    echo  Kies de LTS versie, installeer het, en start dit script opnieuw.
    echo.
    pause
    exit /b 1
  )
  :: Refresh PATH so node is found in this session
  for /f "tokens=*" %%i in ('where node 2^>nul') do set "NODE_PATH=%%i"
  if "!NODE_PATH!"=="" (
    echo.
    echo  [!] Node.js geinstalleerd maar nog niet gevonden in PATH.
    echo  Sluit dit venster, open een nieuw cmd-venster en start install.bat opnieuw.
    echo.
    pause
    exit /b 1
  )
  for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
  echo  [OK] Node.js !NODE_VER! geinstalleerd.
)

:: ─── Install npm packages ─────────────────────────────────────────────────────
echo.
echo  Stap 2/4  npm-pakketten installeren...
cd /d "%~dp0"
if not exist "node_modules" (
  call npm install
  if !errorlevel! neq 0 (
    echo  [!] npm install mislukt.
    pause
    exit /b 1
  )
  echo  [OK] Pakketten geinstalleerd.
) else (
  echo  [OK] node_modules bestaat al, overgeslagen.
)

:: ─── Generate PWA icons ───────────────────────────────────────────────────────
echo.
echo  Stap 3/4  App-iconen genereren (iPhone / PWA)...
if not exist "public\icons\icon-192.png" (
  node scripts\generate-icons.js
  if !errorlevel! neq 0 (
    echo  [!] Iconen genereren mislukt (niet kritiek, app werkt nog steeds).
  ) else (
    echo  [OK] Iconen aangemaakt in public\icons\
  )
) else (
  echo  [OK] Iconen bestaan al, overgeslagen.
)

:: ─── Create desktop shortcut ──────────────────────────────────────────────────
echo.
echo  Stap 4/4  Snelkoppeling aanmaken op bureaublad...

set "SHORTCUT=%USERPROFILE%\Desktop\My Memories.lnk"
set "APP_DIR=%~dp0"
:: Remove trailing backslash
if "!APP_DIR:~-1!"=="\" set "APP_DIR=!APP_DIR:~0,-1!"
set "TARGET=!APP_DIR!\start.bat"

powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT%');" ^
  "$s.TargetPath='%TARGET%';" ^
  "$s.WorkingDirectory='%APP_DIR%';" ^
  "$s.Description='My Memories Fotoapp starten';" ^
  "$s.Save()" >nul 2>&1

if exist "%SHORTCUT%" (
  echo  [OK] Snelkoppeling aangemaakt: %SHORTCUT%
) else (
  echo  [..] Snelkoppeling aanmaken mislukt (niet kritiek).
)

:: ─── Done ─────────────────────────────────────────────────────────────────────
echo.
echo  ============================================================
echo   Installatie voltooid!
echo  ============================================================
echo.
echo  Start de app door te dubbelklikken op "My Memories" op je
echo  bureaublad, of open start.bat in deze map.
echo.
echo  Dashboard:      http://localhost:3000/dashboard.html
echo  Wachtwoord:     bruid2024
echo  Landingspagina: http://localhost:3000/landing.html
echo.

set /p START_NOW=App nu starten? (J/N):
if /i "!START_NOW!"=="J" (
  start "" "!APP_DIR!\start.bat"
)

endlocal
exit /b 0
