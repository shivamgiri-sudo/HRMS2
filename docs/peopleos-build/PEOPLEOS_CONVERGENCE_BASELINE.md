# PeopleOS Enterprise Convergence — Baseline Audit

> Branch: `refactor/peopleos-enterprise-convergence`
> Created: 2026-07-18
> Preceding commit SHA: `95d861baf072e77b0597122ab2b932816e91b8bc`

---

## 1. Environment Summary

| Item | Value |
|---|---|
| Branch | `refactor/peopleos-enterprise-convergence` |
| Base commit SHA | `95d861baf072e77b0597122ab2b932816e91b8bc` |
| Platform | Windows 11 / Node 20 / npm / bun |
| Frontend framework | React 18 + Vite + TypeScript + Tailwind + shadcn/Radix |
| Backend framework | Express + TypeScript (ESM) |
| Database | MySQL `mas_hrms` on `192.168.10.6` |
| Auth | MySQL-based JWT (`/api/auth/*`) |

---

## 2. Frontend Build Status

| Check | Status | Notes |
|---|---|---|
| `npm run typecheck` | **PASS** (0 errors) | Pre-existing clean |
| `npm run lint` | **WARNINGS ONLY** | 316 errors (all `no-explicit-any` + missing deps) + 16,267 warnings — no blocking errors; `lint \|\| true` in CI means failures silently ignored |
| `npm run build` | **FAIL** | `[MISSING_EXPORT] "useDepartments" is not exported by "src/hooks/useEmployees.ts"` — pre-existing build breakage. File `src/hooks/useDepartments.ts` exists but re-export line in `useEmployees.ts` may not match Vite/rolldown resolution |

### Pre-existing frontend build failure (not introduced by this branch)
- `src/pages/Settings.tsx:15` imports `useDepartments` from `@/hooks/useEmployees`
- `useEmployees.ts` line 6 has `export { useDepartments } from "./useDepartments"` but rolldown bundler fails to resolve it
- **Classification: Pre-existing failure**

---

## 3. Backend Build Status

| Check | Status | Notes |
|---|---|---|
| `npm run typecheck` | **1 error** | `src/modules/operations/operations-websocket.handler.ts(56,68): error TS2769` — pino logger overload mismatch; pre-existing |
| `npm run build` | **COMPLETES with warning** | `--noEmitOnError false` so build emits despite TS error; "path not found" warning on Windows |

### Pre-existing backend typecheck error
- `operations-websocket.handler.ts:56` — `logger.warn(msg, error)` — wrong pino overload (Error passed as 2nd arg where string expected)
- **Classification: Pre-existing failure**

---

## 4. Backend Test Status

| Metric | Value |
|---|---|
| Test files total | 121 (40 failed, 77 passed, 4 skipped) |
| Tests total | 1,638 (289 failed, 1,251 passed, 94 skipped, 4 todo) |
| Pre-existing failures | **289 tests / 40 files** |

### Notable pre-existing test failures (sample)
- `customization-api.test.ts` — 404 expectation mismatch
- Multiple ATS, employee, payroll, WFM service tests — DB connection failures (no live DB in test environment)
- **Classification: Pre-existing / Environment-dependent (no live DB)**

---

## 5. CI Workflow Analysis

### `.github/workflows/ci.yml`
| Gate | Status | Finding |
|---|---|---|
| Frontend lint | ⚠️ IGNORED | `bun run lint \|\| true` + `continue-on-error: true` — lint failures never block |
| Frontend typecheck | Runs | `bunx tsc --noEmit` — blocks build job |
| Frontend build | Runs | Blocked by typecheck; uses placeholder Supabase env vars |
| Backend typecheck | NOT in ci.yml | Only in deploy.yml ci-gate |
| Backend tests | **MISSING** | No backend test job in any CI workflow |
| Migration tests | **MISSING** | No migration test job |
| Playwright tests | **MISSING** | No Playwright CI job |
| Secret scanning | **MISSING** | No gitleaks/trufflehog job |
| Dependency scan | **MISSING** | No npm audit / Snyk job |

### `.github/workflows/deploy.yml`
| Gate | Status | Finding |
|---|---|---|
| Backend typecheck | Runs on ci-gate | `npx tsc --noEmit` but proceeds with `--noEmitOnError false` for build |
| Frontend build | Runs on ci-gate | Blocks deploy |
| Backend build | Runs on ci-gate | Blocks deploy |
| Deployment atomicity | ⚠️ PARTIAL | No health-check before PM2 restart; no automatic rollback |
| Migration pre-check | **MISSING** | No migration version check before deploy |
| Deployment lock | **MISSING** | `cancel-in-progress: false` but no exclusive lock mechanism |
| Rollback | **MISSING** | No documented automatic rollback step |

---

## 6. Critical Security Findings (Pre-existing, from prior audit)

| # | Finding | Severity | Status |
|---|---|---|---|
| S1 | Auth brute-force lockout | HIGH | Fixed (commit c2a9bcf7) |
| S2 | OTP HMAC upgrade | HIGH | Fixed (commit c2a9bcf7) |
| S3 | CORS hard-coded IP bypass | MEDIUM | Fixed (commit c2a9bcf7) |
| S4 | `/uploads` static exposure for non-photos | MEDIUM | Fixed (commit c2a9bcf7) |
| S5 | Payroll audit actor always "system" | MEDIUM | Fixed (commit c2a9bcf7) |
| S6 | `change-password` missing rate limit | MEDIUM | Fixed (commit c2a9bcf7) |
| S7 | Statutory self-edit with no audit trail | LOW | Fixed (commit c2a9bcf7) |

---

## 7. Route Fragmentation Findings

### Duplicate / parallel routes (same business action)
| Issue | Routes | Status |
|---|---|---|
| Two ATS walkin queue routes | `/ats/walkin-queue` (line 461) + `/ats/walkin-queue` (line 643) | **DUPLICATE** — exact same path declared twice |
| Two ATS dashboards | `/ats/dashboard` (Replica) + `/ats/dashboard-v2` + `/ats/command-center` + `/ats/command-centre` | 4 variants |
| Two branch head approval journeys | `/ats/offer-approvals` (NativeBranchHeadApproval) + `/ats/branch-head-approval` (BranchHeadApproval) | Different tables |
| Two employee lifecycle pages | `/employee-lifecycle` (NativeLifecycle) + `/employee-lifecycle-v2` (NativeEmployeeLifecycle) | Parallel |
| Two recruiter entry points | `/ats/recruiter/calling-entry` + `/ats/recruiter/hiring-entry` | Same component |
| Two recruiter dashboards | `/ats/recruiter/calling-dashboard` + `/ats/recruiter/hiring-dashboard` | Same component |
| Two HR onboarding requests | `/ats/onboarding-requests` + `/hr-onboarding-requests` | Same component |
| Two break-desk devices routes | `/break-management/devices` + `/wfm/break-desk-devices` | Same component |
| Two onboarding full forms | `/onboard-full` + `/candidate-onboarding-full` | Same component |
| Two attendance regularization | `/attendance-regularization` + `/attendance/regularizations` | Same component |
| Two provisioning tracker variants | `/provisioning/wfm-alignment` + `/provisioning/it` + `/provisioning/admin` + `/provisioning/appointment-letter` + `/it-provisioning` | 5 routes, same component |
| Two payroll HR validation | `/ats/payroll-hr` + `/ats/payroll-hr-validation` | Same component |
| Candidate registration variants | `/onboard` + `/onboard-full` + `/onboard-full-legacy` + `/onboard-v1` + `/interview-registration` | 5 public entry points |

### Backend router fragmentation (app.ts)
| Issue | Routes | Risk |
|---|---|---|
| Multiple payroll routers under `/api/payroll` | 18 separate routers | Ordering-dependent; collision risk |
| Multiple WFM routers under `/api/wfm` | `wfmRegularizationSecureRouter` + `wfmRouter` + `rosterActualSecureRouter` + `rosterRouter` + `auto-roster` | Ordering-dependent |
| Multiple exit routers | `exitSecureRouter` + `exitCompatRouter` + `ffApprovalGuardCompatRouter` + `exitStatusGuardCompatRouter` + `exitRouter` | Compat debt |
| Multiple employee routers | `employeeReportMasterRouter` + `employeeSecureRouter` + `employeeGovernanceRouter` + `employeePhotoCompatRouter` + `employee360Router` + `employeeRouter` + ... | 7+ routers |
| Multiple leave routers | `leaveSecureRouter` + `leaveRouter` | Ordering-dependent |
| `clientRouter` mounted at `/api` (catch-all) | Could catch unintended paths | Ordering risk |
| `atsPublicRouter` (no auth) mounted with comment | Public file uploads | Risk if ordering changes |
| `payrollStatutoryConfigCompatRouter` + `payrollLinesCompatRouter` | Legacy compat | Compat debt |

---

## 8. Authorization Coverage Assessment

| Dimension | Coverage | Notes |
|---|---|---|
| Role check | PARTIAL | `requireRole` used on most routes; some use `ProtectedRoute roles=[]` frontend-only |
| Branch scope | PARTIAL | `buildScopeWhereClause` exists; not consistently applied to all employee endpoints |
| Process scope | PARTIAL | Portal has process isolation; internal modules inconsistent |
| Row-level employee ownership | PARTIAL | `getEmployeeForUser` used in payslip/tax; not universal |
| Field-level masking | MISSING | No server-side field masking for Aadhaar/PAN/bank |
| Cross-employee access denial | PARTIAL | Some endpoints tested; comprehensive tests missing |
| Client portal isolation | DONE | Process scope enforced at controller + service |
| Audit logging | PARTIAL | `logSensitiveAction` exists; not called from all sensitive endpoints |

---

## 9. Document Security Assessment

| Category | Exposure | Notes |
|---|---|---|
| `/uploads/employee-photos/*` | PUBLIC (intentional) | Allowlist-gated via last security fix |
| `/uploads/tax-documents/*` | BLOCKED | Fixed in last security commit |
| `/uploads/onboarding/*` | BLOCKED | Fixed |
| `/api/files/*` | Auth-gated | `filesRouter` requires auth |
| Payslips | Route-gated | `/api/payroll/payslip/:runId/:employeeId` has role check |
| Generated letters | Route-gated | `/api/letters/*` requires auth |
| BGV documents | Token-gated | `bgvVerificationRouter` uses consent token |
| Public doc endpoint | ⚠️ REVIEW | `/api/public/employee-documents` — scope unclear |

---

## 10. Known Production-Readiness Blockers

| # | Blocker | Domain | Priority |
|---|---|---|---|
| B1 | Frontend build fails (`useDepartments` re-export) | Platform | CRITICAL |
| B2 | Backend TS error (`operations-websocket.handler.ts`) | Platform | HIGH |
| B3 | Lint failures silently ignored in CI | CI/CD | HIGH |
| B4 | No backend tests in CI | CI/CD | HIGH |
| B5 | No migration tests in CI | CI/CD | HIGH |
| B6 | Duplicate `/ats/walkin-queue` route | ATS | MEDIUM |
| B7 | `CORS_ALLOWED_ORIGINS` not set in production `.env` | Security | HIGH |
| B8 | `BGV_WEBHOOK_SECRET` required in production | Security | HIGH |
| B9 | No deployment rollback automation | CI/CD | MEDIUM |
| B10 | Field-level masking missing for PAN/Aadhaar | Security | HIGH |
| B11 | 18 payroll routers under one path — ordering risk | Backend | MEDIUM |
| B12 | No OpenAPI / contract docs for any API | Governance | LOW |

---

## 11. Migration File Inventory

| Range | Count | Notes |
|---|---|---|
| 000–099 | ~35 files | Core schema, org, employees, payroll foundation |
| 100–299 | ~0 files | Gap — no migrations in this range |
| 300–411 | ~90 files | Feature additions (ATS, WFM, payroll, compliance, etc.) |
| 500–504 | 5 files | AI, lifecycle, designation BGV, PT dedup, auth lockout |
| 999_* | 7 files | Backfill / hotfix migrations |
| Other | 5 files | Named special-purpose files |
| **Total** | **~142 files** | `000_run_all.sql` is the runner |

---

*End of baseline report.*
