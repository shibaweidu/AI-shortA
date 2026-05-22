@echo off
setlocal
title Koala AI Launcher

set "ROOT=%~dp0"
set "FRONTEND_SCRIPT=%ROOT%start-frontend.cmd"
set "BACKEND_SCRIPT=%ROOT%start-backend.cmd"

echo ========================================
echo Koala AI Launcher
echo ========================================
echo.

if not exist "%FRONTEND_SCRIPT%" (
  echo [ERROR] Missing file: "%FRONTEND_SCRIPT%"
  pause
  exit /b 1
)

if not exist "%BACKEND_SCRIPT%" (
  echo [ERROR] Missing file: "%BACKEND_SCRIPT%"
  pause
  exit /b 1
)

echo Stopping old services on ports 8787 and 5173...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports = 8787,5173; foreach ($port in $ports) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Write-Host \"Stopping PID $_ on port $port\"; Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"
echo.

echo Opening backend window...
start "Koala AI Backend 8787" cmd /k call "%BACKEND_SCRIPT%"

timeout /t 2 /nobreak >nul

echo Opening frontend window...
start "Koala AI Frontend 5173" cmd /k call "%FRONTEND_SCRIPT%"

echo.
echo Two service windows should now be open:
echo - Koala AI Backend 8787
echo - Koala AI Frontend 5173
echo.
echo If a service fails, its own window will stay open and show the error.
echo Browser will open after a short delay.
echo.
timeout /t 5 /nobreak >nul
start http://127.0.0.1:5173

echo.
echo You can close this launcher window. Keep the frontend/backend windows open.
pause
