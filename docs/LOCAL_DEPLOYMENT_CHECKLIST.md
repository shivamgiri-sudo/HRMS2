# Local Deployment Checklist — HRMS1

Use this checklist when setting up the project locally for the first time or
after a fresh clone. Do not follow this guide against any production, staging,
or shared database.

## Prerequisites

- Node.js 20 or later (`node --version`)
- npm 10 or later (`npm --version`)
- Docker Desktop — or a locally running MySQL 8 instance
- Git

---

## 1. Clone and environment files

```bash
git clone https://github.com/shivamgiri-sudo/HRMS1.git
cd HRMS1
```

Copy environment files:

```bash
# Frontend
cp .env.example .env.local

# Backend
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set at minimum:

```
DB_HOST=localhost
DB_PASSWORD=<your mysql root password>
JWT_SECRET=<any 32+ character random string>
PORTAL_JWT_SECRET=<any 32+ character random string>
```

Leave `ENABLE_SCHEDULERS=false` and `SEED_DEMO_DATA=false` unless you need them.

---

## 2. Local ports

| Service | URL |
|---------|-----|
| Frontend | http://localhost:8080 |
| Backend API | http://localhost:5055 |
| Adminer (Docker) | http://localhost:8081 |

---

## 3. Option A — Docker Compose (recommended)

Starts MySQL, Adminer, backend, and frontend in one command:

```bash
docker compose -f docker-compose.local.yml up --build
```

The backend automatically creates the `mas_hrms` database and runs all
migrations on first startup. Wait for:

```
MCN HRMS backend running on http://localhost:5055
```

Then open http://localhost:8080.

---

## 4. Option B — Manual start (no Docker)

Install dependencies:

```bash
npm ci
cd backend && npm ci && cd ..
```

Start backend (terminal 1):

```bash
cd backend
npm run dev
```

Start frontend (terminal 2, from repo root):

```bash
npm run dev
```

Or start both from root with:

```bash
npm run dev:all
```

---

## 5. Health check

```bash
npm run health:backend
```

Expected output: JSON with `"status":"ok"` and migration health summary.

---

## 6. Demo seed — create test accounts

Run this once after the database is up and migrations have applied:

```bash
cd backend
npm run seed:demo
```

This creates bcrypt-hashed auth accounts for all demo roles. Safe to re-run —
it uses `ON DUPLICATE KEY UPDATE`.

---

## 7. Demo login test accounts

| Email | Password | Role |
|-------|----------|------|
| admin@mascallnet.com | Admin@123 | Admin |
| hr@mascallnet.com | Hr@123456 | HR Manager |
| recruiter@mascallnet.com | Recruiter@1 | Recruiter |
| manager@mascallnet.com | Manager@1 | Process Manager |
| tl@mascallnet.com | TeamLead@1 | Team Leader |
| qa@mascallnet.com | Quality@1 | QA Analyst |
| wfm@mascallnet.com | Workforce@1 | WFM Analyst |
| finance@mascallnet.com | Finance@1 | Finance |
| employee@mascallnet.com | Employee@1 | Employee |
| ceo@mascallnet.com | Ceo@12345 | CEO / Leadership |
| trainer@mascallnet.com | Trainer@1 | Trainer / L&D |

---

## 8. Build for production preview

```bash
npm run build:all
```

Builds backend (`backend/dist/`) and frontend (`dist/`).

---

## 9. Important notes

- `ENABLE_SCHEDULERS=false` — schedulers are off by default locally. Set to
  `true` only if you need tenure badges, attendance sweeps, or legacy sync.
- `SEED_DEMO_DATA=false` — `043_demo_data.sql` is not run unless explicitly
  enabled. Use `npm run seed:demo` instead for auth accounts.
- Do not use production DB credentials (`DB_PASSWORD`, `SMTP_PASS`, etc.) in
  your local `backend/.env`. Keep them separate.
- Do not run against the live dialer DB, NCOSEC biometric DB, or any upstream
  production system during local testing.
- If migrations fail on startup, check `/api/health` for which file failed, fix
  the schema, then restart. The migration runner is idempotent — already-applied
  files are skipped.
- The backend auto-creates the `mas_hrms` database on first run if it does not
  exist (requires `DB_USER` to have `CREATE DATABASE` permission).
