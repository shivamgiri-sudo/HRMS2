@echo off
echo ============================================
echo  HRMS Local Deploy
echo ============================================

cd /d C:\Users\shivamg\HRMS1

echo [1/5] Installing frontend dependencies...
call npm install --no-audit --no-fund
if %errorlevel% neq 0 (echo FAILED: frontend npm install & pause & exit /b 1)

echo [2/5] Building frontend...
call npm run build
if %errorlevel% neq 0 (echo FAILED: frontend build & pause & exit /b 1)

echo [3/5] Installing backend dependencies...
cd backend
call npm install --no-audit --no-fund
if %errorlevel% neq 0 (echo FAILED: backend npm install & pause & exit /b 1)

echo [4/5] Building backend...
call npm run build
if %errorlevel% neq 0 (echo FAILED: backend build & pause & exit /b 1)

cd ..

echo [5/5] Starting/restarting PM2 processes...
call pm2 startOrRestart ecosystem.config.cjs --update-env
call pm2 save

echo.
echo ============================================
echo  DONE - Services running:
echo  Frontend : http://localhost:8080
echo  Backend  : http://localhost:5055
echo  PM2 logs : pm2 logs
echo  PM2 status: pm2 status
echo ============================================
pause
