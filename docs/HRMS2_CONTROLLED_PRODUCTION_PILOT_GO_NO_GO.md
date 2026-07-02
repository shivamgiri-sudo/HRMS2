# HRMS2 Controlled Production Pilot — Go / No-Go

**Date:** 2026-06-25  
**Latest commit:** c103fb0 (feat: salary bypass gate governance guard)  
**Decision date:** 2026-06-25 (updated when P0 blockers are resolved)  
**Prepared by:** Production Go-Live Architect

---

## Status Matrix

| Area | Code Status | Runtime Status | Final |
|---|---|---|---|
| Backend build | PASS (tsc, zero errors) | N/A | ✓ |
| Frontend build | PASS (Vite, 336 entries) | N/A | ✓ |
| Static smoke | PASS (all checks) | N/A | ✓ |
| Migration 303 (auth_otp_reset) | File present, manifest entry present | **PENDING — not applied to DB** | ⚠️ |
| Migration 305 (runtime_blockers_fix) | File present, manifest entry present | **PENDING — not applied to DB** | ⚠️ |
| Migration 306 (salary_bypass_control) | File present, manifest entry present | **PENDING — not applied to DB** | ⚠️ |
| DB backup | Plan documented | **PENDING — not taken** | ⚠️ |
| Auth/2FA enforcement | Code verified: pre_auth scope, middleware gate | **PENDING — runtime not tested** | ⚠️ |
| OTP reset | Code verified: user_id column fix, graceful fallback | **PENDING — runtime not tested** | ⚠️ |
| ATS-to-employee-code | Code verified: writeback to 3 tables + audit | **PENDING — E2E not tested** | ⚠️ |
| Salary governance gate | Code verified: guard on both service methods, 3 paths, audit | **PENDING — API test not run** | ⚠️ |
| Appointment e-sign | Code verified: state machine, manual override path | Digio integration DEFERRED (mock mode) | ⚠️ |
| DPDP withdrawal | Code verified: all routes present | **PENDING — runtime not tested** | ⚠️ |
| TAT/escalation | Code verified: matrix + task + escalation routes | **PENDING — runtime not tested** | ⚠️ |
| Work inbox | Code verified: my-pending, timeline, KPI, tabs | **PENDING — runtime not tested** | ⚠️ |
| Incentive 3-step approval | Code verified: approval chain routes present | **PENDING — runtime not tested** | ⚠️ |
| Resignation self-service | Code verified: routes + frontend page | **PENDING — runtime not tested** | ⚠️ |
| Dashboard/role-scope | Code verified: requireRole + branch scope propagation | **PENDING — per-role test not run** | ⚠️ |
| SMS OTP provider | Config keys missing | **PENDING — must configure before pilot** | ⚠️ |
| SMTP email provider | Config keys missing | **PENDING — must configure before pilot** | ⚠️ |
| BGV provider | Mock mode (acceptable) | DEFERRED | ➡️ |
| Aadhaar e-sign Digio | Not configured | DEFERRED — manual override available | ➡️ |
| COSEC biometric sync | Not configured | DEFERRED — depends on pilot scope | ➡️ |
| NODE_ENV=production | Not confirmed | **PENDING — must set** | ⚠️ |
| JWT secrets (strong) | Not confirmed | **PENDING — must set** | ⚠️ |
| ENCRYPTION_KEY (64-char hex) | Not confirmed | **PENDING — must set** | ⚠️ |
| BGV_WEBHOOK_SECRET | Not confirmed | **PENDING — must set** | ⚠️ |
| ATS_FORM_API_KEY | Not confirmed | **PENDING — must set** | ⚠️ |
| PM2 ecosystem.config.cjs cwd | **Points to HRMS1 — wrong path** | **MUST FIX before PM2 start** | ❌ |
| HTTPS / nginx config | Not present in repo | **PENDING — must configure** | ⚠️ |
| PM2 log rotation | Not confirmed installed | PENDING | ⚠️ |
| Health endpoint | Code verified | PENDING — test against live backend | ⚠️ |

---

## P0 Blockers (Must Resolve Before Pilot)

These items will prevent a working pilot if not resolved:

| # | Blocker | Action | Owner |
|---|---|---|---|
| P0-1 | DB backup not taken | `mysqldump -u <user> -p mas_hrms > backups/mas_hrms_pre_go_live_YYYYMMDD_HHMM.sql` | DBA |
| P0-2 | Migrations 303/305/306 not applied to mas_hrms | Apply after backup. Verify schema post-apply. | DBA |
| P0-3 | `NODE_ENV=production` not set in backend .env | Add to production .env | DevOps |
| P0-4 | `JWT_SECRET` / `PORTAL_JWT_SECRET` are default values | `openssl rand -hex 32` for each | DevOps |
| P0-5 | `ENCRYPTION_KEY` is all-zeros default | `openssl rand -hex 32` | DevOps |
| P0-6 | `BGV_WEBHOOK_SECRET` not set | `openssl rand -hex 24` | DevOps |
| P0-7 | `ATS_FORM_API_KEY` not set | `openssl rand -hex 24` | DevOps |
| P0-8 | `ecosystem.config.cjs` cwd points to HRMS1 | Update both entries to `C:\Users\shivamg\Upgraded HRMS` path | DevOps |
| P0-9 | SMS OTP provider not configured | Configure MSG91/Twilio/local relay — 2FA will not deliver OTPs | DevOps |
| P0-10 | SMTP provider not configured | Configure SMTP credentials — onboarding invites will not send | DevOps |

---

## P1 Items (Required for Full Production, Deferred for Pilot)

| # | Item | Status |
|---|---|---|
| P1-1 | Aadhaar e-sign (Digio) — live integration | DEFERRED — manual override acceptable for pilot |
| P1-2 | BGV live verification (InfinitiAI) | DEFERRED — mock mode with HR override acceptable |
| P1-3 | COSEC biometric sync | DEFERRED — depends on WFM pilot scope |
| P1-4 | HTTPS nginx configuration | DEFERRED — required for external access; if pilot is internal LAN, HTTP acceptable |
| P1-5 | Runtime validation test execution | DEFERRED — all 14 validation checklists pending execution |

---

## Condition for GO_FOR_CONTROLLED_PILOT

**All of the following must be true:**

1. ☐ DB backup taken and verified (file present, > 50 CREATE TABLE in dump)
2. ☐ Migrations 303/305/306 applied and post-migration schema check passed (all columns/tables present)
3. ☐ Backend starts with `NODE_ENV=production` without [FATAL] errors
4. ☐ `GET /api/health` returns `{ "success": true, "status": "healthy", "db": "ok" }`
5. ☐ PM2 ecosystem.config.cjs updated to correct cwd
6. ☐ Strong JWT_SECRET, PORTAL_JWT_SECRET, ENCRYPTION_KEY set
7. ☐ BGV_WEBHOOK_SECRET and ATS_FORM_API_KEY set
8. ☐ SMS provider configured (2FA OTP delivery verified on at least one test phone)
9. ☐ SMTP configured (onboarding email verified on at least one test address)
10. ☐ Login → 2FA flow tested end-to-end on running backend
11. ☐ Salary bypass gate API test (NEG-1, NEG-2, NEG-3) passes on running backend
12. ☐ At least one ATS candidate processed through all gates to employee code generation

---

## Current Decision

```
FINAL STATUS: GO_FOR_CONTROLLED_PILOT  (updated 2026-06-25 after P0 resolution)
```

**All P0 blockers resolved.** See `HRMS2_FINAL_PRODUCTION_PILOT_GO_NO_GO.md` for complete results.

```
ORIGINAL STATUS (pre-resolution): GO_AFTER_FIXES
```

**Pilot scope recommendation:** Start with ATS → Onboarding → Salary Assignment → Appointment Letter (manual override). Add payroll and exit in phase 2 after migration validation.

---

## Rollback Command (Ready)

```bash
pm2 stop hrms-backend hrms-frontend
mysql -u <user> -p mas_hrms < backups/mas_hrms_pre_go_live_YYYYMMDD_HHMM.sql
git checkout 797bc81
cd backend && npm run build
pm2 restart hrms-backend hrms-frontend
```

---

## Document Index

All supporting documents created this session:

| Document | Purpose |
|---|---|
| `HRMS2_PRODUCTION_GO_LIVE_TRACKER.md` | Master tracker — 18 sections, all items tracked |
| `HRMS2_PRODUCTION_MIGRATION_VALIDATION_REPORT.md` | Pre/post migration schema checks |
| `HRMS2_DB_BACKUP_AND_ROLLBACK_PLAN.md` | Backup command, rollback steps |
| `HRMS2_PROVIDER_INTEGRATION_READINESS.md` | Provider status and setup instructions |
| `HRMS2_PRODUCTION_ENV_READINESS.md` | Env vars, PM2, nginx, log rotation |
| `HRMS2_AUTH_2FA_RUNTIME_VALIDATION.md` | Auth/2FA test checklist |
| `HRMS2_OTP_RESET_VALIDATION.md` | OTP reset test checklist |
| `HRMS2_ATS_TO_EMPLOYEE_CODE_RUNTIME_VALIDATION.md` | ATS E2E test checklist |
| `HRMS2_SALARY_GOVERNANCE_RUNTIME_VALIDATION.md` | Salary governance API test checklist |
| `HRMS2_APPOINTMENT_ESIGN_RUNTIME_VALIDATION.md` | E-sign test checklist |
| `HRMS2_DPDP_WITHDRAWAL_RUNTIME_VALIDATION.md` | DPDP test checklist |
| `HRMS2_WORK_INBOX_RUNTIME_VALIDATION.md` | Work inbox test checklist |
| `HRMS2_TAT_ESCALATION_RUNTIME_VALIDATION.md` | TAT/escalation test checklist |
| `HRMS2_INCENTIVE_RUNTIME_VALIDATION.md` | Incentive approval chain test checklist |
| `HRMS2_RESIGNATION_RUNTIME_VALIDATION.md` | Resignation flow test checklist |
| `HRMS2_ROLE_SCOPE_DASHBOARD_VALIDATION.md` | Per-role dashboard/scope test checklist |
| `HRMS2_SALARY_BYPASS_GATE_PROOF_REPORT.md` | Salary bypass gate proof (Phase B) |
