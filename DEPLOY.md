# Deployment Guide — HRMS (Self-Hosted, PM2 on Windows)

## ⚠️ URGENT — Deploy Now

All pages (Login, Payroll, Attendance, Employees, etc.) are broken on production.
Run the deploy commands below immediately to restore service.

## Server Setup

- Backend: PM2 running `node dist/server.js` from `backend/`
- Frontend: PM2 running `vite preview` OR static files served via Nginx
- Database: MySQL (`mas_hrms`)
- Config: `ecosystem.config.cjs` at repo root

---

## Deploy Latest Code

Run the following on the server (Command Prompt or PowerShell):

```bat
cd C:\Users\shivamg\HRMS1

:: 1. Pull latest from GitHub
git pull origin main

:: 2. Build backend
cd backend
npm install
npm run build

:: 3. Build frontend
cd ..
npm install
npm run build

:: 4. Restart PM2 processes
pm2 restart ecosystem.config.cjs
```

Single-line version:
```bat
cd C:\Users\shivamg\HRMS1 && git pull origin main && cd backend && npm install && npm run build && cd .. && npm install && npm run build && pm2 restart ecosystem.config.cjs
```

---

## Pending Database Migrations

Run these SQL migrations once on the production `mas_hrms` database.
They are **additive** — safe to run, will not affect existing data.

### Migration 215 — Inactive Employee Access + OTP Auth
**Required to activate:** read-only grace period for inactive employees, OTP password reset via SMS.

```bat
mysql -u root -p mas_hrms < C:\Users\shivamg\HRMS1\backend\sql\215_inactive_access_and_otp_auth.sql
```

> Until this migration runs, all pages work normally for active users.
> Inactive-access and OTP features are safely disabled until migration runs.

### Migration 070 — Legacy Sync Maps
```bat
mysql -u root -p mas_hrms < C:\Users\shivamg\HRMS1\backend\sql\070_legacy_sync_maps.sql
```

---

## Workers (Optional — Run Separately)

To start all background workers (biometric sync, leave credit, KPI sync, SLA breach, etc.):

```bat
cd C:\Users\shivamg\HRMS1\backend
npx tsx src/workers/all-workers.ts
```

Or add it to `ecosystem.config.cjs` as a third PM2 process.

---

## Check PM2 Status

```bat
pm2 status
pm2 logs hrms-backend --lines 50
pm2 logs hrms-frontend --lines 50
```

---

## Recent Fixes (Latest Deployment)

| Commit | Fix |
|--------|-----|
| `a471f51` | Fix all pages broken — guard `access_end_date` queries for prod (migration 215 not yet run) |
| `e686d5f` | Fix payslip/payroll tab crash — missing `TrendingUp` import |
| `214d403` | Fix TypeScript build errors in `auth.service` and `sms.helper` |
| `64b4366` | Inactive employee access + OTP auth + ReadOnly banner |
| `8bd9bf6` | Unified worker runner with biometric COSEC sync |
