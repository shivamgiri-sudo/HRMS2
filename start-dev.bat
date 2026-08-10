@echo off
echo Starting HRMS in DEV mode (hot reload)...
echo Frontend: http://localhost:8080
echo Backend:  http://localhost:5055
echo.
echo Press Ctrl+C in each window to stop.
echo.

REM Open backend in new window
start "HRMS Backend" cmd /k "cd /d C:\Users\shivamg\HRMS1\backend && npm install --no-audit --no-fund && npm run dev"

REM Wait 3 seconds then open frontend
timeout /t 3 /nobreak >nul
start "HRMS Frontend" cmd /k "cd /d C:\Users\shivamg\HRMS1 && npm install --no-audit --no-fund && npm run dev"
