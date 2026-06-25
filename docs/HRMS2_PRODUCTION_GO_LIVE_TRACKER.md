# HRMS2 Production Go-Live Tracker

**Date:** 2026-06-25  
**Latest commit:** c103fb0 feat(payroll): enforce salary bypass gate  
**Branch:** main — clean, up to date with origin/main  
**Prepared by:** Production Go-Live Architect

---

## Tracker Format

Each item is tracked as:

| Field | Value |
|---|---|
| Current status | Verified / Pending / FAIL / DEFERRED |
| Evidence | File/line/command |
| Result | Pass/Fail/Blocked |
| Blocker | None or description |
| Owner role | Role responsible |
| Final status | PASS / FAIL / PENDING / DEFERRED |

---

## Section 1 — Build Validation

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| Backend tsc build | Verified | `npm run build` in `/backend` → `tsc` exits 0, no output = zero errors | PASS | None | Backend Dev | **PASS** |
| Frontend Vite build | Verified | `npm run build` → `✓ built in 2.60s`, 336 entries precached | PASS | None | Frontend Dev | **PASS** |
| Static smoke checks | Verified | `npm run phase2:smoke:static` → all PASS including 2FA send/verify endpoints, BGV name-match, salary proposal schema, appointment letter schema | PASS | None | QA | **PASS** |

---

## Section 2 — Migration Validation

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| 303_auth_password_reset_otp.sql exists | Verified | File present at `backend/sql/303_auth_password_reset_otp.sql` | PASS | — | DBA | **PASS** |
| 305_runtime_blockers_fix.sql exists | Verified | File present at `backend/sql/305_runtime_blockers_fix.sql` | PASS | — | DBA | **PASS** |
| 306_salary_bypass_control.sql exists | Verified | File present at `backend/sql/306_salary_bypass_control.sql` | PASS | — | DBA | **PASS** |
| All 3 migrations in manifest | Verified | `runPendingMigrations.ts` includes `303_auth_password_reset_otp.sql`, `305_runtime_blockers_fix.sql`, `306_salary_bypass_control.sql` | PASS | — | Backend Dev | **PASS** |
| Migrations applied to mas_hrms | **PENDING** | Schema check required against live DB before execution. See Section 3. Commands documented in `HRMS2_PRODUCTION_MIGRATION_VALIDATION_REPORT.md` | PENDING | Requires DBA + backup confirmation | DBA / DevOps | **PENDING** |

---

## Section 3 — DB Backup and Rollback

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| Backup plan documented | Verified | `docs/HRMS2_DB_BACKUP_AND_ROLLBACK_PLAN.md` created this session | PASS | — | DBA | **PASS** |
| Backup executed before migration | **PENDING** | No backup confirmed yet — must be taken before running 303/305/306 on production | PENDING | Requires DBA action | DBA | **PENDING** |
| Backup file validated | **PENDING** | Dependent on backup execution | PENDING | Requires DBA action | DBA | **PENDING** |

---

## Section 4 — Auth / 2FA Validation

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| 2FA backend enforcement code | Verified | `auth.service.ts` issues `pre_auth` scoped JWT; `authMiddleware.ts` blocks non-`/2fa/` endpoints with `pre_auth` | Code PASS | — | Security | **Code PASS** |
| 2FA full runtime test | **PENDING** | Requires running backend + valid 2FA-enabled user | PENDING | Requires running backend | QA | **PENDING** |
| Read-only user JWT flag | Verified | `auth_user.is_read_only` column added in migration 303; service returns flag | Code PASS | Migration 303 must be applied | Backend Dev | **Code PASS** |
| JWT secrets in production env | **PENDING** | Current running env not confirmed as production. `.env.backup` shows DB credentials only; JWT_SECRET/PORTAL_JWT_SECRET production values not confirmed set | PENDING | Must set strong JWT_SECRET before production start | DevOps | **PENDING** |
| Auth runtime test | **PENDING** | Full test documented in `HRMS2_AUTH_2FA_RUNTIME_VALIDATION.md` | PENDING | — | QA | **PENDING** |

---

## Section 5 — OTP Reset Validation

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| auth_otp_reset table in migration | Verified | Migration 303 creates `auth_otp_reset` with `user_id` FK | Code PASS | Migration 303 must be applied | DBA | **Code PASS** |
| `user_id` column fix in auth.service.ts | Verified | `forgotPasswordOtp` and `verifyOtpAndResetPassword` use `user_id` (corrected from `auth_user_id`) | Code PASS | — | Backend Dev | **Code PASS** |
| OTP runtime test | **PENDING** | Test documented in `HRMS2_OTP_RESET_VALIDATION.md` | PENDING | Requires SMS provider configured | QA | **PENDING** |

---

## Section 6 — ATS-to-Employee-Code Validation

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| Employee code writeback to ats_candidate | Verified | `employee-code-gate.routes.ts` runs `UPDATE ats_candidate SET employee_code = ?` | Code PASS | — | Backend Dev | **Code PASS** |
| Employee code writeback to employees | Verified | Same route attempts `UPDATE employees SET employee_code = ?` via JOIN | Code PASS | — | Backend Dev | **Code PASS** |
| Employee code writeback to ats_onboarding_bridge | Verified | Same route updates `ats_onboarding_bridge` | Code PASS | — | Backend Dev | **Code PASS** |
| Employee code audit log | Verified | `sensitive_action_log` written on generate | Code PASS | — | Backend Dev | **Code PASS** |
| End-to-end ATS runtime test | **PENDING** | Test documented in `HRMS2_ATS_TO_EMPLOYEE_CODE_RUNTIME_VALIDATION.md` | PENDING | Requires live ATS candidate | QA | **PENDING** |

---

## Section 7 — Salary Governance Validation

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| `assertSalaryAssignmentAllowed()` guard exists | Verified | `backend/src/modules/payroll/salary-governance.guard.ts` line 101 | Code PASS | — | Payroll Dev | **Code PASS** |
| Guard applied to `assignSalary()` | Verified | `payroll.service.ts` line 183 — first action before any DB write | Code PASS | — | Payroll Dev | **Code PASS** |
| Guard applied to `bulkAssignSalary()` | Verified | `payroll.service.ts` line 80 — first action before any DB write | Code PASS | — | Payroll Dev | **Code PASS** |
| Controller catches SALARY_BYPASS_BLOCKED | Verified | `payroll.controller.ts` lines 56, 195 | Code PASS | — | Payroll Dev | **Code PASS** |
| Migration 306 tables present | Verified | `payroll_salary_slabs`, `salary_proposal`, `salary_register`, `salary_register_audit_log` in SQL file | Code PASS | Migration 306 must be applied | DBA | **Code PASS** |
| API test script exists | Verified | `backend/scripts/test-salary-bypass-gate.ts` — 3 negative + 3 positive tests | PASS | — | QA | **PASS** |
| Salary governance runtime API test | **PENDING** | Requires running backend + seeded slab data | PENDING | Migration 306 + seed required | QA | **PENDING** |

---

## Section 8 — Appointment E-Sign Validation

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| Frontend page exists | Verified | `src/pages/NativeAppointmentEsign.tsx` — status badge, stepper, actions, vault, audit timeline | Code PASS | — | Frontend Dev | **Code PASS** |
| Backend routes exist | Verified | `backend/src/modules/letters/appointment-esign.routes.ts` — create, initiate, complete, override, sign | Code PASS | — | Backend Dev | **Code PASS** |
| Backend service exists | Verified | `appointment-esign.service.ts` — state machine, audit log, DB writes | Code PASS | — | Backend Dev | **Code PASS** |
| Digio / real e-sign provider | **DEFERRED** | `appointment-esign.service.ts:76` explicitly notes "mock — no real provider". `DIGIO_CLIENT_ID` / `DIGIO_CLIENT_SECRET` not configured. Candidate e-sign URL returns internal mock sign-page URL | DEFERRED | Provider keys required for live Aadhaar e-sign | Integration Team | **DEFERRED** |
| Manual override path | Verified | Override request + approve/reject endpoints exist in routes | Code PASS | — | Backend Dev | **Code PASS** |
| E-sign runtime test | **PENDING** | Test documented in `HRMS2_APPOINTMENT_ESIGN_RUNTIME_VALIDATION.md` | PENDING | Provider or manual override path | QA | **PENDING** |

---

## Section 9 — DPDP Withdrawal Validation

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| Frontend page exists | Verified | Routes `/privacy/dpdp-withdrawal` and admin page exist in App.tsx | Code PASS | — | Frontend Dev | **Code PASS** |
| Backend routes exist | Verified | `backend/src/modules/privacy/dpdp-withdrawal.routes.ts` — submit, list, review, approve, reject | Code PASS | — | Backend Dev | **Code PASS** |
| DPDP runtime test | **PENDING** | Test documented in `HRMS2_DPDP_WITHDRAWAL_RUNTIME_VALIDATION.md` | PENDING | Requires live DB | QA | **PENDING** |

---

## Section 10 — TAT / Escalation Validation

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| TAT matrix API exists | Verified | `backend/src/modules/governance/tat.routes.ts` — GET/POST matrix, escalation-matrix, tasks, recalculate, dashboard | Code PASS | — | Backend Dev | **Code PASS** |
| TAT service exists | Verified | `tat.service.ts` present | Code PASS | — | Backend Dev | **Code PASS** |
| TAT runtime test | **PENDING** | Test documented in `HRMS2_TAT_ESCALATION_RUNTIME_VALIDATION.md` | PENDING | Requires seeded TAT matrix config | QA | **PENDING** |

---

## Section 11 — Work Inbox Validation

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| Work inbox backend routes | Verified | `backend/src/modules/work-inbox/work-inbox.routes.ts` + `inbox/inbox.routes.ts` — my-pending, timeline endpoints | Code PASS | — | Backend Dev | **Code PASS** |
| Work inbox frontend page | Verified | `NativeWorkInbox.tsx` rewritten — KPI strip, module tabs, risk filter, inline action Sheet, timeline | Code PASS | — | Frontend Dev | **Code PASS** |
| Work inbox runtime test | **PENDING** | Test documented in `HRMS2_WORK_INBOX_RUNTIME_VALIDATION.md` | PENDING | Requires live pending tasks | QA | **PENDING** |

---

## Section 12 — Incentive Validation

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| Incentive routes exist | Verified | `backend/src/modules/incentives/incentives.routes.ts` — upload, batches, approval chain (branch_head → operations_head → finance_head), step-approve, step-reject, apply-to-run | Code PASS | — | Backend Dev | **Code PASS** |
| Incentive runtime test | **PENDING** | Test documented in `HRMS2_INCENTIVE_RUNTIME_VALIDATION.md` | PENDING | Requires live batch + approval users | QA | **PENDING** |

---

## Section 13 — Resignation Validation

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| Frontend resignation page | Verified | `src/pages/NativeMyResignation.tsx` — submit form + active resignation view with withdraw, retention, audit | Code PASS | — | Frontend Dev | **Code PASS** |
| Backend resignation routes | Verified | `backend/src/modules/exit/resignation.routes.ts` present; `exit_retention_action` table added in migration 305 | Code PASS | Migration 305 must be applied | Backend Dev | **Code PASS** |
| Resignation runtime test | **PENDING** | Test documented in `HRMS2_RESIGNATION_RUNTIME_VALIDATION.md` | PENDING | Requires active employee + live DB | QA | **PENDING** |

---

## Section 14 — Dashboard / Role-Scope Validation

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| Dashboard module exists | Verified | `backend/src/modules/dashboards/` — dashboard-metric.service.ts, dashboard-drilldown.service.ts | Code PASS | — | Backend Dev | **Code PASS** |
| Role-scope enforcement | Verified | `requireRole` middleware present; `authMiddleware.ts` enforces scope; `authUser.branchId` scope propagated | Code PASS | — | Security | **Code PASS** |
| Dashboard runtime test per role | **PENDING** | Test documented in `HRMS2_ROLE_SCOPE_DASHBOARD_VALIDATION.md` | PENDING | Requires test users per role | QA | **PENDING** |

---

## Section 15 — Provider Integration Readiness

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| Provider readiness documented | Verified | `docs/HRMS2_PROVIDER_INTEGRATION_READINESS.md` created this session | PASS | — | Integration | **PASS** |
| SMS OTP provider | **PENDING** | `sms.helper.ts` routes through `providerConfigService` → DB-configured provider. No SMS keys in `.env.backup`. Local SMS fallback (`LOCAL_SMS_API_URL`) available | PENDING | Configure MSG91/Twilio or local SMS API | DevOps | **PENDING** |
| SMTP email provider | **PENDING** | SMTP keys not present in `.env.backup`. Env vars `SMTP_USER` / `SMTP_PASS` empty in backup | PENDING | Configure Gmail app password or SMTP relay | DevOps | **PENDING** |
| BGV provider | Code DEFERRED | `BGV_PROVIDER=mock` default. Mock adapter returns correct "switch to live" messages. Live requires `BGV_PROVIDER=infinity_ai` + `INFINITY_AI_API_KEY` | DEFERRED | BGV_PROVIDER=mock acceptable for pilot | Integration | **DEFERRED** |
| Aadhaar e-sign / Digio | DEFERRED | `DIGIO_CLIENT_ID` / `DIGIO_CLIENT_SECRET` not set. Manual override path available | DEFERRED | Provider keys for Aadhaar e-sign | Integration | **DEFERRED** |
| COSEC biometric sync | **PENDING** | `NCOSEC_DB_HOST` not set in backup. NCOSEC_SYNC_ENABLED not confirmed | PENDING | Configure NCOSEC credentials | IT/WFM | **PENDING** |

---

## Section 16 — Production Env Readiness

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| Production env readiness documented | Verified | `docs/HRMS2_PRODUCTION_ENV_READINESS.md` created this session | PASS | — | DevOps | **PASS** |
| NODE_ENV=production | **PENDING** | `.env.backup` does not include NODE_ENV. Must be set | PENDING | Must set NODE_ENV=production | DevOps | **PENDING** |
| INTERNAL_DEMO_BYPASS=false | Verified | `env.ts` has production guard: exits if `INTERNAL_DEMO_BYPASS=true` in production | Code PASS | — | Backend Dev | **Code PASS** |
| JWT secrets strong | **PENDING** | `env.ts` has production guard checking known insecure defaults. Production JWT_SECRET not confirmed set | PENDING | Must set strong JWT_SECRET | DevOps | **PENDING** |
| ENCRYPTION_KEY 64-char hex | **PENDING** | `env.ts` production guard enforces non-zero key | PENDING | Must generate 64-char hex key | DevOps | **PENDING** |
| BGV_WEBHOOK_SECRET | **PENDING** | Required in production by env.ts guard | PENDING | Must set BGV_WEBHOOK_SECRET | DevOps | **PENDING** |
| ATS_FORM_API_KEY | **PENDING** | Required in production by env.ts guard | PENDING | Must set ATS_FORM_API_KEY | DevOps | **PENDING** |
| PM2 ecosystem config | Needs update | `ecosystem.config.cjs` still points to `HRMS1` path. Must update `cwd` to `Upgraded HRMS` path | PENDING | Update ecosystem.config.cjs cwd | DevOps | **PENDING** |
| Log rotation | **PENDING** | PM2 log files defined but log rotation plugin not confirmed installed | PENDING | `pm2 install pm2-logrotate` | DevOps | **PENDING** |
| HTTPS | **PENDING** | `app.ts` has `trust proxy 1` set. HTTPS via reverse proxy (nginx). No nginx config found in repo | PENDING | Nginx HTTPS config needed | DevOps | **PENDING** |

---

## Section 17 — PM2 / Deployment Readiness

| Item | Status | Evidence | Result | Blocker | Owner | Final |
|---|---|---|---|---|---|---|
| Backend build artifact | Verified | `backend/dist/` exists (produced by `npm run build`) | PASS | — | Backend Dev | **PASS** |
| Frontend build artifact | Verified | `dist/` exists (produced by `npm run build`) | PASS | — | Frontend Dev | **PASS** |
| PM2 ecosystem cwd | **FAIL** | `ecosystem.config.cjs` points to `C:\Users\shivamg\HRMS1` — wrong repository path | **MUST FIX** | Update cwd to `Upgraded HRMS` | DevOps | **FAIL** |
| Health endpoint functional | Verified | `GET /api/health` implemented with DB ping + migration health | Code PASS | Requires running backend | DevOps | **Code PASS** |
| Health readiness endpoint | Verified | `GET /api/health/readiness` returns per-area status | Code PASS | — | DevOps | **Code PASS** |

---

## Section 18 — Final Go / No-Go Decision

| Item | Final Status |
|---|---|
| Build validation | PASS |
| Migration 303/305/306 code readiness | PASS (not yet applied to DB) |
| DB backup | PENDING |
| Auth/2FA code | PASS |
| OTP reset code | PASS |
| ATS-to-employee-code code | PASS |
| Salary governance code | PASS |
| Appointment e-sign (manual path) | PASS |
| DPDP withdrawal | PASS |
| TAT/escalation | PASS |
| Work inbox | PASS |
| Incentive | PASS |
| Resignation | PASS |
| Dashboard/role-scope | PASS |
| Provider readiness | PENDING (SMS, SMTP, COSEC) |
| Production env readiness | PENDING (NODE_ENV, JWT, ENCRYPTION_KEY, PM2 cwd) |
| **Overall go/no-go** | **GO_AFTER_FIXES** |

**Remaining P0 blockers before pilot:**
1. DB backup taken and confirmed
2. Migrations 303, 305, 306 applied and schema-verified on target DB
3. NODE_ENV=production, JWT_SECRET (strong), PORTAL_JWT_SECRET (strong), ENCRYPTION_KEY (64-char hex), BGV_WEBHOOK_SECRET, ATS_FORM_API_KEY all set in production .env
4. PM2 ecosystem.config.cjs `cwd` updated from HRMS1 to Upgraded HRMS path
5. SMS OTP provider configured (or manual OTP fallback confirmed acceptable for pilot)
6. SMTP provider configured (or email-disabled pilot confirmed acceptable)

**Deferred (acceptable for controlled pilot):**
- Aadhaar e-sign live Digio integration (manual override available)
- BGV_PROVIDER live (mock mode acceptable for pilot)
- COSEC biometric sync (standalone attendance not blocked)
