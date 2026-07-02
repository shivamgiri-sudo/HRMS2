# HRMS1 — Developer Setup Guide

> **MAS Callnet PeopleOS / HRMS** — Full-stack workforce platform.
> Frontend: React 18 + Vite | Backend: Express + TypeScript | DB: MySQL `mas_hrms`

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | **20 LTS** | ⚠️ Node 24 breaks npm binaries — use 20 exactly |
| npm | ≥ 9 | Comes with Node 20 |
| Git | any | |
| MySQL | 8.0 client | For running migrations |
| PM2 | 7.x | For production / auto-start: `npm install -g pm2` |

### Install Node 20 (recommended: nvm-windows)

1. Download nvm-windows from https://github.com/coreybutler/nvm-windows/releases
2. Install, then in a new terminal:

```bat
nvm install 20
nvm use 20
node --version   # should show v20.x.x
```

> Both `HRMS1/.nvmrc` and `HRMS1/backend/.nvmrc` are set to `20`.
> nvm-windows does NOT read `.nvmrc` automatically — run `nvm use 20` before working.

---

## 1 — Clone the Repository

```bat
git clone https://github.com/shivamgiri-sudo/HRMS1.git
cd HRMS1
```

---

## 2 — Environment File

The backend requires a `.env` file at `backend/.env`.

**Get the file:** Ask the project owner for `HRMS1-backend.env` (kept in a secure location,
not committed to git). Copy it into place:

```bat
copy HRMS1-backend.env HRMS1\backend\.env
```

### Key variables

| Variable | Description |
|----------|-------------|
| `DB_HOST` | MySQL server IP (internal network: `192.168.10.6`) |
| `DB_USER` / `DB_PASSWORD` | MySQL credentials |
| `DB_NAME` | `mas_hrms` |
| `JWT_SECRET` | Change in production |
| `ENCRYPTION_KEY` | 64-char hex — never rotate without migrating encrypted rows |
| `ENABLE_SCHEDULERS` | `true` to start COSEC sync worker on boot |
| `NCOSEC_DB_*` | MSSQL connection for biometric COSEC sync — fill in server details |
| `SMTP_*` | Email (optional — leave blank to disable notifications) |
| `DIALER_DB_*` | Read-only connection to dialer DB (same MySQL host) |

The frontend has no `.env` — Vite proxies `/api` to `localhost:5055` in dev mode.

---

## 3 — Install Dependencies

Run both from the repo root:

```bat
cd HRMS1

REM Frontend
npm install

REM Backend
cd backend
npm install
cd ..
```

If npm install fails or binaries are missing, verify you are on Node 20:

```bat
node --version   # must be v20.x.x
nvm use 20       # if using nvm-windows
```

---

## 4 — Database Migrations

Migrations are numbered SQL files in `backend/sql/`. They are **applied once**; each run
is tracked in `schema_migrations` table.

### Run pending migrations

```bat
cd backend
npm run migrate
```

This runs `backend/src/migrations/runPendingMigrations.ts` which applies any `.sql` files
not yet recorded in `schema_migrations`.

> ⚠️ Never edit an already-applied migration. Add a new numbered file instead.

### Migration numbers reference

| Range | Description |
|-------|-------------|
| 001–125 | Applied via runner (org masters, payroll, WFM, ATS base) |
| 126–134 | Applied manually (integration hub, external DB credentials) |
| 135–136 | Payroll masters + incentive module |
| 138–141 | ATS complete journey + enhanced journey |
| 143 | ATS missing columns and portal tables |
| 144 | Campaign master seed (91 campaigns from dialer) |

---

## 5 — Development Mode (Hot Reload)

### Option A — One-click (opens two CMD windows)

```bat
start-dev.bat
```

### Option B — Manual

**Terminal 1 — Backend:**

```bat
cd HRMS1\backend
npm run dev
```

Backend starts on `http://localhost:5055`

**Terminal 2 — Frontend:**

```bat
cd HRMS1
npm run dev
```

Frontend starts on `http://localhost:8080`

---

## 6 — Production Mode (PM2)

### First deploy

```bat
deploy-local.bat
```

This does:
1. `npm install` (frontend + backend)
2. `npm run build` (frontend + backend)
3. `pm2 startOrRestart ecosystem.config.cjs`
4. `pm2 save`

Frontend served at `http://localhost:8080`  
Backend API at `http://localhost:5055`

### PM2 quick commands

```bat
pm2 status              # show process list
pm2 logs                # tail all logs
pm2 logs hrms-backend   # backend logs only
pm2 restart all         # restart both
pm2 stop all            # stop both
```

### Auto-start on Windows boot (run once as Administrator)

```bat
setup-autostart.bat
```

This registers PM2 as a Windows Service via `pm2-windows-startup`. After this, HRMS
starts automatically every time Windows boots — no manual action needed.

---

## 7 — COSEC Biometric Sync

The backend sync worker (`cosec-sync.worker.ts`) runs every 5 minutes when:

1. `ENABLE_SCHEDULERS=true` in `backend/.env`
2. `NCOSEC_DB_HOST`, `NCOSEC_DB_USER`, `NCOSEC_DB_PASSWORD` are all filled in `.env`

If NCOSEC credentials are blank, the worker logs `[cosec-sync] disabled` and skips silently.

---

## 8 — Useful Scripts

| Command | From | Purpose |
|---------|------|---------|
| `npm run dev` | `HRMS1/` | Start frontend dev server |
| `npm run build` | `HRMS1/` | Build frontend for production |
| `npm run dev` | `HRMS1/backend/` | Start backend with tsx hot-reload |
| `npm run build` | `HRMS1/backend/` | Compile TypeScript to `dist/` |
| `npm run migrate` | `HRMS1/backend/` | Run pending SQL migrations |
| `pm2 status` | anywhere | PM2 process status |

---

## 9 — Project Structure

```
HRMS1/
├── src/                   # React frontend source
│   ├── pages/             # Page components (NativeDashboard, NativePayroll, …)
│   ├── components/        # Shared UI components
│   └── App.tsx            # Routes
├── backend/
│   ├── src/
│   │   ├── modules/       # Feature modules (payroll, ats, wfm, …)
│   │   ├── middleware/    # requireAuth, requireRole
│   │   └── server.ts      # Entry point
│   ├── sql/               # Numbered migration files
│   └── .env               # ⚠️ Not committed — get from project owner
├── ecosystem.config.cjs   # PM2 process config
├── deploy-local.bat        # One-click production deploy
├── setup-autostart.bat     # One-time Windows Service registration
├── start-dev.bat           # One-click dev mode
└── SETUP.md               # This file
```

---

## 10 — Common Issues

### `tsx` / `vite` not found after npm install

You are on Node 24. Switch to Node 20:

```bat
nvm use 20
npm install
```

### Cannot connect to DB

- You must be on the internal network (192.168.10.x) or VPN
- Check `DB_HOST`, `DB_USER`, `DB_PASSWORD` in `backend/.env`
- Test: `mysql -h192.168.10.6 -P3306 -ushivam_user -p mas_hrms -e "SELECT 1"`

### Port already in use

```bat
netstat -ano | findstr :5055
taskkill /PID <pid> /F
```

### PM2 process not starting

```bat
pm2 logs hrms-backend --lines 50
```

Check the error log at `HRMS1\logs\backend-err.log`.

---

## 11 — Security Notes

- **Never commit `backend/.env`** — it contains DB credentials and JWT secrets
- JWT secrets in `.env` are labelled `change-in-prod` — replace for any shared/internet-facing deployment
- `ENCRYPTION_KEY` encrypts payroll bank data in DB — never change it without a migration plan
- DB user `shivam_user` has write access to `mas_hrms` and read access to `dialer_db`

---

## Contact

Project: MAS Callnet PeopleOS  
Repo: https://github.com/shivamgiri-sudo/HRMS1
