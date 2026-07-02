# MAS Callnet PeopleOS — Phase 0 Audit Report

> **Audit date:** 2026-05-29  
> **Auditor:** Claude Code (automated codebase audit, human-approved)  
> **Repo:** `shivamgiri-sudo/mas-callnet-hrms`  
> **Branch audited:** `main`  
> **Status:** Approved — implementation in progress

---

## ⚠️ Process-Control Deviation Record — 2026-05-29

**What occurred:** During Package 0-A execution, `backend/sql/010_kpi.sql` and `backend/sql/012_client_portal.sql` were applied to the `mas_hrms` PeopleOS application database before the approval checkpoint was completed.

**Correct characterisation:** `mas_hrms` is the target writable PeopleOS application database. The KPI and Client Portal schema objects created are intended PeopleOS application tables. No changes were authorised or made to upstream operational source databases. This is recorded as a process-control deviation, not a source-system breach.

**What was applied:**
- `010_kpi.sql` — created 5 KPI tables (`kpi_metric_master`, `kpi_template`, `kpi_template_metric`, `kpi_assignment`, `kpi_score`) + seeded 15 KPI metric master reference rows
- `012_client_portal.sql` — created 10 Client Portal tables + seeded `governance_activity_master` reference rows
- Total tables in `mas_hrms`: 63 → 78

**Status:**
- No rollback approved or required — these are intended application tables
- No further schema execution may occur without explicit written approval
- Credential rotation completed outside repository — do not store or display credentials
- Repository merge frozen pending reconciliation and review
- The applied SQL scripts add schema and reference master records only; any post-execution table-content reconciliation requires separately authorised read-only verification.

**Corrective controls in effect:**
- All further `mas_hrms` schema execution requires explicit written approval per file, per session
- Local/staging validation must precede any future schema operation on `mas_hrms`
- No manual production deployment command was executed. Opening/updating the pull request triggered an automatic Vercel preview build/deployment through the repository integration. No frontend application-source changes are included in this PR.
- No DDL, DML, or manual deployment command executed without confirmation

---

## Production Safety Restrictions

> **Approval-control rule:** Every implementation task that changes code, schema, API behaviour, environment/configuration, data writes, access control, integrations, deployment settings or user-visible functionality requires an approved package before execution, even when local-only.

The following actions require **explicit written approval** before execution. They are **never** performed autonomously:

| Action | Restriction |
|---|---|
| Run SQL on production MySQL (production MySQL host) | Explicit approval per file |
| Run `supabase db push` or apply migrations to prod Supabase | Explicit approval per migration |
| `git push` to `main` | Explicit approval |
| Deploy to Vercel (frontend) | Explicit approval |
| Deploy to Railway (backend) | Explicit approval |
| Modify `.env` files with real credentials | Never — example files only |
| Drop tables, truncate data, or run destructive DDL | Explicit approval + tested backup |
| Modify Supabase Edge Functions in production | Explicit approval |

---

## Architecture Overview

```
Frontend (React 18 + Vite + Tailwind + shadcn/ui)
  Deploy: Vercel (mas-callnet-hrms.vercel.app)
  Auth: Supabase JWT — stored and refreshed by Supabase client
  API: hrmsApi.ts → Bearer token → Railway backend (VITE_HRMS_API_URL)
  UI RBAC: useUserRole.ts → Supabase role_page_access + user_assignment_scope
  Page gate: WorkforcePageGate component (frontend visibility only)

Backend API (Express 5 + TypeScript, port 5055)
  Deploy: Railway (nixpacks.toml)
  Auth middleware: requireAuth → supabaseAdmin.auth.getUser(token)
  Role middleware: requireRole → MySQL user_roles (AUTHORITY for API access)
  Modules: 11 (employees, ats, leave, payroll, wfm, kpi, portal, exit,
            integration-hub, process, migration)

MySQL mas_hrms
  Role: Writable PeopleOS application database (target for all HRMS operational data)
  Schema: 15 SQL files (backend/sql/001–012); 78 tables as of 2026-05-29
  Owns: employees, ATS, attendance, leave, WFM, payroll, KPI, portal, exit, integration hub, migration

Existing operational SQL database(s) — upstream source systems
  Role: Read-only data sources; integrated later via controlled connectors into mas_hrms
  No schema or data modifications permitted without separate explicit approval

Supabase (project: bebminxoqdjzzfhnrsge — CONFIRMED)
  PostgreSQL: auth + transitional flows + lms_* (native, preserved per Decision 2A)
  Storage: employee documents, assets (protected until MySQL convergence tested)
  Edge Functions: 13 (email, notifications, version-check)
  RBAC mirror: role_page_access, user_assignment_scope (UI visibility only — not API authority)

Deployed LMS (separate repo, company domain)
  Role: External LMS system of record for all LMS operations
  Integration: HRMS connects via bridge only; approved summary/status synced into mas_hrms
  HRMS must not rebuild LMS operational functionality
  Status: LMS integration mode is pending discovery and design — integration mechanism not yet approved.
```

---

## Supabase Project Reference Analysis

Three project IDs found in repo. Documented here — no changes made yet.

| ID | Location | Classification | Notes |
|---|---|---|---|
| `bebminxoqdjzzfhnrsge` | `src/integrations/supabase/client.ts` (hardcoded fallback), `NativeMigrationConsole.tsx`, `PROJECT_OVERVIEW.md` | **Production — owner-confirmed** | Active production project |
| `ppdsxgkmnmjfwmpnamts` | `supabase/config.toml` line 1 | **Unresolved Supabase CLI/config reference** | Purpose not yet confirmed — verify before any change |
| `unanckifivwkziwvnjtc` | `backend/.env.example` line 6 | **Mismatched backend example reference** | Verify whether obsolete or staging reference before any replacement |

**Phase 0 action for project IDs:**
- `bebminxoqdjzzfhnrsge` — owner-confirmed active production Supabase project reference; use in all documentation
- `ppdsxgkmnmjfwmpnamts` — unresolved; do NOT change `supabase/config.toml` until purpose verified
- `unanckifivwkziwvnjtc` — mismatched; investigate `backend/.env.example` environment purpose before replacement; any config edit requires approval
- No production environment variables changed

---

## System Ownership / Source-of-Truth Matrix (Approved 2026-05-29)

| System | Ownership / Purpose |
|---|---|
| MySQL `mas_hrms` | Writable PeopleOS application database — target for all HRMS operational data |
| Existing operational SQL database(s) | Upstream read-only data sources; integrated later through controlled connectors into `mas_hrms` only |
| Supabase Auth | Authentication and session identity — permanent, not decommissioned |
| Supabase Storage / transitional flows | Existing storage and native flows preserved until tested convergence path to `mas_hrms` exists |
| Deployed internal LMS | External LMS system of record; HRMS integrates via bridge only; no LMS operational rebuild in HRMS |

---

## Three Approved Architecture Decisions

### Decision 1 — RBAC Authority (Option B with controls)

- **Supabase Auth** = identity and authentication source only
- **MySQL `user_roles`** = authority for all API-level and sensitive-data access
- **Supabase `role_page_access`** = transitional frontend UI/menu visibility mirror only; NOT authoritative for security
- No generic backend fallback from MySQL roles to Supabase page-access roles
- Phase 0 must include:
  - Role reconciliation/backfill plan (identify users in Supabase but not MySQL, and vice versa)
  - Mismatch reporting endpoint or script
  - Negative API access tests (assert 403 returned when role missing from MySQL even if present in Supabase)
- Future RBAC implementation candidate: after Phase 0-B design approval, propose controlled role-management endpoints and synchronisation behaviour. No endpoint structure or Supabase mirror-write behaviour is approved yet.

### Decision 2 — LMS Ownership (Option A with transition controls)

- Supabase `lms_*` tables preserved — do NOT delete or deprecate in Phase 0
- Current native LMS flows (`NativeLMSMyLearning`, `NativeLMSCoordinator`) remain on Supabase
- `NativeLMSAdmin` writes to Supabase `lms_*` — protected as transitional legacy native LMS
- HRMS must NOT be enhanced as a second operational LMS
- Deployed internal LMS is the future system of record for LMS operations
- Integration path: additive Integration Hub-based bridge in a future phase
- No Supabase LMS deprecation until integration + mapping + reconciliation tested and approved

### Decision 3 — Supabase Project Reference

- Authoritative production project: **`bebminxoqdjzzfhnrsge`**
- All future documentation, configuration examples, and deployment references use this ID
- Existing environment files inspected before any replacement (see analysis above)
- `supabase/config.toml` `ppdsxgkmnmjfwmpnamts` — unresolved reference; verify purpose before any change

---

## Module Status Matrix

| Module | Status | Notes |
|---|---|---|
| Employees | foundation present / runtime and security validation pending | `/api/employees` ↔ MySQL |
| ATS | foundation present / runtime and security validation pending | `/api/ats` ↔ MySQL |
| Leave | foundation present / runtime and security validation pending | `/api/leave` ↔ MySQL |
| WFM Roster | foundation present / runtime and security validation pending | `/api/wfm/roster` ↔ MySQL; `NativeWFMRoster` uses hrmsApi |
| WFM Live Tracker | ⚠️ Backend-only | `liveTracker.service.ts` + `/api/wfm/live` exist; App.tsx routes `/wfm/live-tracker` → `NativePlaceholderPage` — current route resolves through an active wrapper; runtime and data behaviour requires validation; direct route wiring is optional refactoring deferred to Phase 4 or later |
| Payroll | ⚠️ Partial | Structure/runs/calc exist; TDS=0; no advance deduction; working_days hardcoded=26; `salary_payslip` table missing — all payroll coding tasks deferred to Phase 5 |
| KPI | foundation present / runtime and security validation pending | `/api/kpi` ↔ MySQL |
| Client Portal | foundation present / runtime and security validation pending | OTP auth, dual JWT, 9 service files, 3 frontend pages |
| Exit | foundation present / runtime and security validation pending | `/api/exit` ↔ MySQL |
| Integration Hub | foundation present / runtime and security validation pending | `/api/integration-hub` ↔ MySQL |
| Process | foundation present / runtime and security validation pending | `/api/processes` ↔ MySQL |
| Migration Console | ⚠️ Partial | Row count only; no Supabase→MySQL migration logic |
| Assets | 🔵 Frontend/Supabase only | `useAssets.ts` → Supabase `assets`+`asset_assignments`; no backend route; **PROTECTED — do not remove** |
| Documents | 🔵 Frontend/Supabase only | `useEmployeeDocuments.ts` → Supabase Storage + `employee_documents`; **PROTECTED — do not remove** |
| Performance/Goals | 🔵 Frontend/Supabase only | Supabase `goals`, `performance_reviews`; **PROTECTED** |
| Attendance (legacy) | 🔵 Frontend/Supabase only | Legacy Supabase `attendance_records` pages; **PROTECTED** |
| LMS Admin | ⚠️ Wrapper route | App.tsx routes `/lms/admin` → `NativePlaceholderPage`; transitional native LMS route already resolves through wrapper. Direct routing is optional refactoring only after LMS integration design and runtime validation. Not a Phase 0 defect — deferred to Phase 6 or later as optional refactor. |
| LMS My Learning | ⚠️ Partial | Renders; reads Supabase `lms_*` directly; **PROTECTED as legacy native LMS** |
| LMS Coordinator | ⚠️ Partial | Supabase direct; **PROTECTED as legacy native LMS** |
| LMS Management Dashboard | ⚠️ Wrapper route | Routes to placeholder; LMS integration mode is pending discovery and design — integration mechanism not yet approved |
| Quality Dashboard | ❌ Placeholder | — |
| Operations Dashboard | ❌ Placeholder | — |
| ATS Onboarding Bridge | ❌ No route | `NativeATSOnboardingBridge.tsx` exists, not in router |
| ATS Waiting Queue | ❌ No route | `NativeATSWaitingQueue.tsx` exists, not in router |
| ATS Candidate Master | ❌ No route | `NativeATSCandidateMaster.tsx` exists, not in router |
| ATS Recruiter Workspace | ❌ No route | `NativeATSRecruiterWorkspace.tsx` exists, not in router |
| ATS Dashboard V2 / Replica | ❌ No route | Both page components exist, neither in router |
| Unified Perf Command Center | foundation present / runtime and security validation pending | `/performance/command-center` |
| Access Control | foundation present / runtime and security validation pending | `/settings/access-control` |
| Bulk Upload Hub | foundation present / runtime and security validation pending | `/bulk-upload` |

---

## Source-of-Truth Matrix

| Domain | Authority | Tables / Location |
|---|---|---|
| Auth sessions / identity | Supabase Auth | `auth.users` |
| Staff role assignments (API access) | **MySQL** | `user_roles`, `workforce_role_catalog` |
| Page visibility / UI RBAC | Supabase (mirror) | `role_page_access`, `user_assignment_scope` |
| Page access permission assignment scope | Supabase (mirror) | `user_assignment_scope` |
| Employees | MySQL | `employees` |
| ATS pipeline | MySQL | `ats_candidate`, `ats_candidate_stage_log` |
| Leave | MySQL | `leave_request`, `leave_balance_ledger`, `leave_type_master` |
| Attendance / WFM | MySQL | `wfm_attendance_session`, `wfm_roster_assignment`, `wfm_shift_master` |
| Payroll | MySQL | `salary_prep_run`, `salary_prep_line`, `employee_salary_assignment` |
| KPI | MySQL | `kpi_metric_master`, `role_kpi_snapshot` |
| Client Portal | MySQL | `client_master`, `client_user`, `portal_otp`, `glide_path_commitment` |
| Exit | MySQL | `exit_request` |
| Integrations | MySQL | `integration_config`, `integration_field_map` |
| Assets | Supabase PostgreSQL | `assets`, `asset_assignments` — **protected** |
| Documents | Supabase Storage + PostgreSQL | `employee_documents` + storage — **protected** |
| Goals / Performance | Supabase PostgreSQL | `goals`, `performance_reviews`, `review_kpi_ratings` — **protected** |
| Notifications | Supabase PostgreSQL | `notifications`, `push_subscriptions` |
| LMS content (native transitional) | Supabase PostgreSQL | `lms_*` tables — **protected, Decision 2** |
| LMS content (target system) | Deployed LMS backend | Bridge only — integration mechanism pending discovery and design |

---

## P0 — Blocking Defects

| ID | Problem | File(s) | Severity |
|---|---|---|---|
| P0-4 | **RBAC authority split**: frontend RBAC reads Supabase `role_page_access`; backend `requireRole` reads MySQL `user_roles`. Users in Supabase but not MySQL get 403 on all API calls. | `src/hooks/useUserRole.ts`, `backend/src/middleware/requireRole.ts` | Access failure |
| P0-5 | `salary_payslip` table absent from all SQL files; payroll disbursement/payslip has no write target — gap noted; implementation deferred to Phase 5 | All `backend/sql/*.sql` | Missing schema |

## P1 — Significant Gaps

| ID | Problem | File(s) |
|---|---|---|
| P1-1 | TDS hardcoded `0` in payroll calculation — gap noted; deferred to Phase 5 | `backend/src/modules/payroll/payrollCalculate.service.ts` |
| P1-2 | Salary advance not deducted in payroll run — gap noted; deferred to Phase 5 | `payrollCalculate.service.ts` + `salary_advance_log` |
| P1-3 | Working days hardcoded `26`; holiday calendar not integrated — gap noted; deferred to Phase 5 | `payrollCalculate.service.ts` |
| P1-4 | `portal_access_log` table never written — audit trail broken | All `backend/src/modules/portal/portal.*.service.ts` |
| P1-5 | `backend/.env.example` `SUPABASE_URL` contains mismatched reference `unanckifivwkziwvnjtc` — environment purpose unverified; investigate before replacing | `backend/.env.example:6` |
| P1-6 | `employee_bank_detail` table missing encryption at rest | `backend/sql/002_employees.sql` |
| P1-7 | `migration_run` + `migration_row_log` tables — these tables already exist, created by `backend/sql/010_kpi_migration.sql` which is included in the schema runner. Task is VERIFICATION ONLY, not new schema build. Status: ⬜ PENDING (verify via read-only query after approval). Approval Required: NO. | All SQL files |
| P1-8 | SQL file numbering conflicts: two `010_*` files, two `012_*` files; `000_run_all.sql` will fail partially | `backend/sql/` |
| P1-9 | LWP deduction not applied in payroll calc; `lwp_days` populated but deduction not computed — gap noted; deferred to Phase 5 | `payrollCalculate.service.ts` |
| P1-10 | Demo portal bypass (`demo@mascallnet.com`) not env-gated — active in production | `backend/src/modules/portal/portal.auth.service.ts` |

## P2 — Quality / Incomplete

| ID | Problem | File(s) |
|---|---|---|
| P2-1 | 6 ATS pages (`NativeATSOnboardingBridge`, `NativeATSWaitingQueue`, `NativeATSCandidateMaster`, `NativeATSRecruiterWorkspace`, `NativeATSDashboardV2`, `NativeATSDashboardReplica`) exist but have no routes | `src/App.tsx` |
| P2-2 | PT (Professional Tax) fixed ₹200; should read state slab from `statutory_config` — deferred to Phase 5 | `payrollCalculate.service.ts` |
| P2-3 | `portal_otp` records never purged — table grows indefinitely | `portal.auth.service.ts` |
| P2-4 | `process_master` exists in both MySQL and Supabase — dual-write risk | `001_core_org.sql` + Supabase migrations |
| P2-5 | `NativeLMSAdmin.tsx` writes directly to Supabase `lms_*` tables — conflicts with deployed LMS as future system of record | `src/pages/NativeLMSAdmin.tsx` |
| P2-6 | Payslip PDF client-side only (jsPDF); no server-side generation or secure storage — deferred to Phase 5 | `src/lib/payslipPdfGenerator.ts` |
| P2-7 | `/lms/admin` transitional wrapper route — direct routing is optional refactoring only after LMS integration design and runtime validation | `src/App.tsx` |
| P2-8 | `/wfm/live-tracker` routes through `NativePlaceholderPage` wrapper — runtime and data behaviour requires validation before direct route wiring | `src/App.tsx` |

---

## Phase 0 Safe Implementation Order

All steps operate on local Docker MySQL + local dev server only. No production changes.

**Phase 0: Stabilisation, database boundary and security design**

| Step | Action | Unblocks |
|---|---|---|
| 1 | Rename SQL files: `010_kpi_migration.sql` → `010a_kpi_migration.sql`; `012_roster_shift_times.sql` → `013_roster_shift_times.sql` | D2/D3 file conflicts |
| 2 | Update `000_run_all.sql` to reflect new numbering | Clean migration runs |
| 3 | Fix `backend/.env.example` `SUPABASE_URL` → `https://bebminxoqdjzzfhnrsge.supabase.co` | P1-5 |
| 4 | Verify `migration_run` + `migration_row_log` tables exist in `backend/sql/010_kpi_migration.sql` via read-only query (no new SQL file required) | P1-7 |
| 5 | Design MySQL-authoritative backend RBAC transition with Supabase UI visibility mirror after verifying actual role/page/scope tables, reconciliation rules, mismatch reporting and negative API tests. No code implementation approved yet. Status: ⬜ PENDING design. Approval Required: YES before any implementation. | P0-4 |
| 6 | Write `portal_access_log` INSERT in portal controller | P1-4 |
| 7 | Env-gate `demo@mascallnet.com` bypass via `DEMO_MODE` env var | P1-10 |

**Steps 1–4:** Documentation + config only. Zero runtime risk.  
**Step 5:** Design only. No code. Approval required before any implementation.  
**Steps 6–7:** Isolated changes to existing service files.

---

## Deferred Tasks by Phase

**Phase 1: Organisation masters, roles/scopes, workflow engine and audit framework**
- (Assign tasks here as Phase 1 planning proceeds)

**Phase 2: Employee lifecycle, documents, assets and helpdesk**
- (Assign tasks here as Phase 2 planning proceeds)

**Phase 3: ATS and joining ecosystem**
- Route ATS pages (`NativeATSOnboardingBridge`, `NativeATSWaitingQueue`, `NativeATSCandidateMaster`, `NativeATSRecruiterWorkspace`, `NativeATSDashboardV2`, `NativeATSDashboardReplica`) once ATS design is confirmed

**Phase 4: Attendance, leave, WFM, roster, shrinkage and attrition**
- `/wfm/live-tracker` direct route wiring — optional refactoring after runtime and data behaviour validation

**Phase 5: Payroll, statutory, payslip, gratuity and F&F**
- `salary_payslip` table creation (P0-5 gap — schema build deferred here)
- LWP deduction implementation (P1-9)
- TDS calculation from `statutory_config` annualized taxable income (P1-1 — gap note only, not a basic stub)
- Salary advance recovery into payroll calc (P1-2)
- Working days integration with holiday calendar (P1-3)
- PT state slab from `statutory_config` (P2-2)
- Payslip PDF server-side generation and secure storage (P2-6)

**Phase 6: LMS integration only**
- Determine approved LMS integration mechanism (secured backend API, scheduled sync, connector, deep-link, or SSO) and required configuration. Do not add frontend LMS API variables during Phase 0. Status: 🔵 DEFERRED to Phase 6. No code approved.
- `/lms/admin` direct route wiring — optional refactoring only after LMS integration design and runtime validation (P2-7)

**Phase 7: Operations, Quality, Call Master and performance**
- Quality Dashboard implementation
- Operations Dashboard implementation

**Phase 8: Client Portal hardening**
- `portal_otp` purge mechanism (P2-3)

**Phase 9: ERP extensions**
- (Assign tasks here as Phase 9 planning proceeds)

**Phase 10: Migration, security, UAT and deployment readiness**
- (Assign tasks here as Phase 10 planning proceeds)

---

## Local Testing Plan

```bash
# 1. Start local MySQL
docker run --name mas-mysql-local \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=mas_hrms \
  -p 3307:3306 -d mysql:8

# 2. Apply migrations in order (local only)
for f in backend/sql/00{1..9}_*.sql backend/sql/01[0-9]*.sql; do
  mysql -h 127.0.0.1 -P 3307 -u root -proot mas_hrms < "$f"
done

# 3. Backend local .env overrides
# DB_HOST=127.0.0.1  DB_PORT=3307  SUPABASE_URL=https://bebminxoqdjzzfhnrsge.supabase.co

# 4. Run backend
cd backend && npm run dev      # :5055

# 5. Run frontend
npm run dev                    # :5173 (root)
# VITE_HRMS_API_URL=http://localhost:5055

# 6. Typecheck
cd backend && npm run typecheck
cd ../ && npm run lint

# 7. Tests
cd backend && npm run test
```

## Rollback Plan

- All SQL changes use `CREATE TABLE IF NOT EXISTS` — safe to re-run
- All SQL adds new tables only — no column drops or table renames in Phase 0
- Rollback new tables: `DROP TABLE IF EXISTS <new_table>` (local only; never on production without approval)
- Frontend/backend changes: `git revert <commit>` per commit
- Never run `000_run_all.sql` on production — apply individual numbered files only
- Never ALTER existing columns on production without a separate migration file + approval
