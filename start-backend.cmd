@echo off
setlocal
title Koala AI Backend 8787

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"

echo ========================================
echo Koala AI Backend
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Install Node.js from https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found in PATH.
  pause
  exit /b 1
)

if not exist "%BACKEND%\package.json" (
  echo [ERROR] Backend package.json not found:
  echo "%BACKEND%\package.json"
  pause
  exit /b 1
)

cd /d "%BACKEND%"
if errorlevel 1 (
  echo [ERROR] Could not enter backend directory:
  echo "%BACKEND%"
  pause
  exit /b 1
)

echo Directory: %CD%
echo Node: 
node --version
echo npm:
call npm --version
echo.

if not exist node_modules (
  echo Installing backend dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] Backend dependency install failed.
    pause
    exit /b 1
  )
)

echo Checking port 8787...
for /f %%P in ('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique" 2^>nul') do (
  echo Stopping old backend process on port 8787, PID %%P...
  powershell -NoProfile -Command "Stop-Process -Id %%P -Force -ErrorAction SilentlyContinue" >nul 2>nul
)
echo.

echo Starting backend at http://127.0.0.1:8787
echo.
call npm run dev

echo.
echo [ERROR] Backend process stopped. Exit code: %errorlevel%
pause
