@echo off
setlocal
title Koala AI Frontend 5173

set "ROOT=%~dp0"
set "FRONTEND=%ROOT%frontend"

echo ========================================
echo Koala AI Frontend
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

if not exist "%FRONTEND%\package.json" (
  echo [ERROR] Frontend package.json not found:
  echo "%FRONTEND%\package.json"
  pause
  exit /b 1
)

cd /d "%FRONTEND%"
if errorlevel 1 (
  echo [ERROR] Could not enter frontend directory:
  echo "%FRONTEND%"
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
  echo Installing frontend dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] Frontend dependency install failed.
    pause
    exit /b 1
  )
)

echo Checking port 5173...
for /f %%P in ('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique" 2^>nul') do (
  echo Stopping old frontend process on port 5173, PID %%P...
  powershell -NoProfile -Command "Stop-Process -Id %%P -Force -ErrorAction SilentlyContinue" >nul 2>nul
)
echo.

echo Starting frontend at http://127.0.0.1:5173
echo.
call npm run dev -- --host 127.0.0.1 --port 5173 --strictPort

echo.
echo [ERROR] Frontend process stopped. Exit code: %errorlevel%
pause
