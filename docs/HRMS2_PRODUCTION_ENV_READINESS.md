# HRMS2 Production Environment Readiness

**Date:** 2026-06-25  
**Target server:** Production host running PM2  
**Source of truth for env schema:** `backend/src/config/env.ts`

---

## Critical: env.ts Production Guards

The backend has hard-coded production startup guards. If any of these fail at startup, the backend process exits with a `[FATAL]` error and PM2 will attempt restarts until the env is corrected. These are not optional:

```
[FATAL] PORTAL_JWT_SECRET must be changed from the default value in production.
[FATAL] JWT_SECRET must be changed from the default value in production.
[FATAL] PAYROLL_BANK_KEY must be set to a secure value in production.
[FATAL] ENCRYPTION_KEY must be set to a secure 64-char hex value in production.
[FATAL] INTERNAL_DEMO_BYPASS must not be 'true' in production.
[FATAL] PORTAL_DEMO_BYPASS must not be 'true' in production.
[FATAL] OUTBOUND_ALLOW_PRIVATE_URLS must not be 'true' in production.
[FATAL] BGV_WEBHOOK_SECRET must be set in production.
[FATAL] ATS_FORM_API_KEY must be set in production.
```

---

## Required Production .env Variables

Create `backend/.env` on the production server with these values:

```bash
# ── Runtime ──────────────────────────────────────────────────────────────────
NODE_ENV=production
PORT=5056
FRONTEND_URL=https://<your-production-domain>
BACKEND_URL=https://<your-production-domain>

# ── Database (mas_hrms) ───────────────────────────────────────────────────────
ACTIVE_DB_PROVIDER=mysql
DB_HOST=<production-db-host>
DB_PORT=3306
DB_USER=<production-db-user>
DB_PASSWORD=<production-db-password>
DB_NAME=mas_hrms
DB_POOL_MAX=25

# ── JWT Secrets (MUST be changed — 32+ chars each) ────────────────────────────
# Generate: openssl rand -hex 32
JWT_SECRET=<GENERATE: openssl rand -hex 32>
PORTAL_JWT_SECRET=<GENERATE: openssl rand -hex 32>

# ── Encryption Keys ───────────────────────────────────────────────────────────
# Generate: openssl rand -hex 32 (bank key, 16+ chars)
PAYROLL_BANK_KEY=<GENERATE: openssl rand -hex 16>
# Generate: openssl rand -hex 32 (64-char hex for ENCRYPTION_KEY)
ENCRYPTION_KEY=<GENERATE: openssl rand -hex 32>

# ── Security flags ────────────────────────────────────────────────────────────
INTERNAL_DEMO_BYPASS=false
PORTAL_DEMO_BYPASS=false
OUTBOUND_ALLOW_PRIVATE_URLS=false
SEED_DEMO_DATA=false

# ── Scheduler ─────────────────────────────────────────────────────────────────
ENABLE_SCHEDULERS=true

# ── Webhook / ATS keys ────────────────────────────────────────────────────────
BGV_WEBHOOK_SECRET=<GENERATE: openssl rand -hex 24>
ATS_FORM_API_KEY=<GENERATE: openssl rand -hex 24>

# ── BGV Provider (set to mock for pilot) ──────────────────────────────────────
BGV_PROVIDER=mock
# For live: BGV_PROVIDER=infinity_ai + INFINITY_AI_API_KEY=...

# ── SMTP ──────────────────────────────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<hrms-email@mascallnet.com or Gmail>
SMTP_PASS=<app-specific password>
SMTP_FROM=noreply@mascallnet.com
SMTP_FROM_NAME=MAS Callnet HRMS

# ── Dialer DB (Read-only APR data) ────────────────────────────────────────────
DIALER_DB_HOST=<host>
DIALER_DB_PORT=3306
DIALER_DB_USER=<user>
DIALER_DB_PASSWORD=<password>
DIALER_DB_NAME=dialer_db

# ── NCOSEC Biometric (optional for pilot) ─────────────────────────────────────
NCOSEC_DB_HOST=<host>
NCOSEC_DB_PORT=1433
NCOSEC_DB_USER=<user>
NCOSEC_DB_PASSWORD=<password>
NCOSEC_DB_NAME=NCOSEC
NCOSEC_DB_ENCRYPT=false
NCOSEC_SYNC_ENABLED=true

# ── CORS extra origins (if needed) ────────────────────────────────────────────
CORS_ALLOWED_ORIGINS=https://<production-domain>

# ── LMS integration DB (read-only) ────────────────────────────────────────────
LMS_DB_HOST=<lms-host>
LMS_DB_PORT=3306
LMS_DB_USER=<lms-user>
LMS_DB_PASSWORD=<lms-password>
LMS_DB_NAME=lms_mcn
```

---

## PM2 Ecosystem Config Fix Required

**Current problem:** `ecosystem.config.cjs` has `cwd` pointing to `C:\Users\shivamg\HRMS1` — the old repository. This MUST be updated before running `pm2 start ecosystem.config.cjs`.

**Required change:**
```javascript
// ecosystem.config.cjs — update both app entries:
{
  name: "hrms-backend",
  cwd: "C:\\Users\\shivamg\\Upgraded HRMS\\backend",  // ← was HRMS1
  script: "node",
  args: "dist/server.js",
  env: {
    NODE_ENV: "production",
    ENABLE_SCHEDULERS: "true",
  },
  ...
},
{
  name: "hrms-frontend",
  cwd: "C:\\Users\\shivamg\\Upgraded HRMS",           // ← was HRMS1
  script: "node",
  args: "node_modules/.bin/vite preview --host 0.0.0.0 --port 8085",
  ...
}
```

---

## HTTPS / Reverse Proxy

The backend uses `app.set("trust proxy", 1)` — it is designed to run behind a reverse proxy (nginx or IIS).  
HTTPS must be terminated at the reverse proxy layer, not in Node.js directly.

**Minimum nginx config for pilot:**
```nginx
server {
    listen 443 ssl;
    server_name <production-domain>;

    ssl_certificate     /path/to/cert.crt;
    ssl_certificate_key /path/to/cert.key;

    location /api/ {
        proxy_pass http://localhost:5056;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location / {
        proxy_pass http://localhost:8085;   # Vite preview / nginx static
        proxy_set_header Host $host;
    }
}

server {
    listen 80;
    server_name <production-domain>;
    return 301 https://$host$request_uri;
}
```

---

## Log Rotation

PM2 log rotation via pm2-logrotate:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'  # daily at midnight
```

---

## Health Endpoint Validation

```bash
# After PM2 start:
curl http://localhost:5056/api/health
# Expected: { "success": true, "status": "healthy", "db": "ok" }

curl http://localhost:5056/api/health/readiness
# Expected: { "success": true, "status": "ready_with_warnings" }
# (warnings on attendance/payroll reports are expected — they require manual sign-off)
```

---

## Checklist

| Item | Required | Status |
|---|---|---|
| `NODE_ENV=production` | Yes | PENDING |
| `INTERNAL_DEMO_BYPASS=false` | Yes (enforced by code) | PENDING |
| `PORTAL_DEMO_BYPASS=false` | Yes (enforced by code) | PENDING |
| `JWT_SECRET` (strong, non-default) | Yes (enforced by code) | PENDING |
| `PORTAL_JWT_SECRET` (strong, non-default) | Yes (enforced by code) | PENDING |
| `PAYROLL_BANK_KEY` (non-default) | Yes (enforced by code) | PENDING |
| `ENCRYPTION_KEY` (64-char hex, non-zero) | Yes (enforced by code) | PENDING |
| `BGV_WEBHOOK_SECRET` set | Yes (enforced by code) | PENDING |
| `ATS_FORM_API_KEY` set | Yes (enforced by code) | PENDING |
| `SMTP_USER` / `SMTP_PASS` set | Required for email | PENDING |
| SMS provider configured | Required for 2FA OTP | PENDING |
| `ecosystem.config.cjs` cwd updated to Upgraded HRMS | Yes | **MUST FIX** |
| PM2 log rotation installed | Recommended | PENDING |
| HTTPS reverse proxy configured | Required | PENDING |
| DB backup confirmed before migration | Required | PENDING |
| Migrations 303/305/306 applied | Required | PENDING |
| Health endpoint returns 200 | Required before pilot | PENDING |
| `CORS_ALLOWED_ORIGINS` = production domain only | Required | PENDING |

---

## Rollback Command (Full)

```bash
# Stop services
pm2 stop hrms-backend hrms-frontend

# Restore DB from backup (see HRMS2_DB_BACKUP_AND_ROLLBACK_PLAN.md)
mysql -u <user> -p mas_hrms < backups/mas_hrms_pre_go_live_YYYYMMDD_HHMM.sql

# Checkout pre-migration commit if needed
git checkout 797bc81

# Rebuild
cd backend && npm run build
cd .. && npm run build

# Restart
pm2 restart hrms-backend hrms-frontend
```
