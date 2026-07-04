@echo off
set E2E_BASE_URL=http://localhost:8080
set E2E_BACKEND_URL=http://localhost:5055
set E2E_DB_HOST=192.168.10.6
set E2E_DB_PORT=3306
set E2E_DB_USER=shivam_user
set E2E_DB_PASSWORD=qwersdfg!@#hjk
set E2E_DB_NAME=mas_hrms

npx playwright test --config=playwright.config.ts %*
