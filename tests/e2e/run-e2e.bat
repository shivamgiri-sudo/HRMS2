@echo off
cd /d C:\Users\ADMIN\Desktop\HRMS2-latest
if "%E2E_BASE_URL%"=="" set "E2E_BASE_URL=http://localhost:8080"
if "%E2E_BACKEND_URL%"=="" set "E2E_BACKEND_URL=http://localhost:5055"
if "%E2E_DB_HOST%"=="" set "E2E_DB_HOST=localhost"
if "%E2E_DB_PORT%"=="" set "E2E_DB_PORT=3306"

if "%E2E_DB_USER%"=="" (
  echo Missing E2E_DB_USER. Set staging/local DB credentials before running.
  exit /b 1
)

if "%E2E_DB_NAME%"=="" (
  echo Missing E2E_DB_NAME. Set staging/local DB name before running.
  exit /b 1
)

if "%E2E_ADMIN_EMAIL%"=="" (
  echo Missing role credentials. Set E2E_ADMIN_EMAIL/PASSWORD, E2E_HR_EMAIL/PASSWORD, E2E_RECRUITER_EMAIL/PASSWORD, E2E_BRANCH_HEAD_EMAIL/PASSWORD, and E2E_PAYROLL_EMAIL/PASSWORD.
  exit /b 1
)

npx playwright test --config=playwright.config.ts %* > C:\Users\ADMIN\AppData\Local\Temp\e2e-output.log 2>&1
