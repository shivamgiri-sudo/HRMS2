# MAS Callnet HRMS — Complete Project Overview

> **Repo**: `shivamgiri-sudo/mas-callnet-hrms` (private)  
> **Local**: `/home/shuvam/mas-callnet-hrms`  
> **Production**: `mas-callnet-hrms.vercel.app`  
> **Last updated**: 2026-05-29

---

## 1. What Is This

Full-stack HRMS (Human Resource Management System) built for MAS Callnet — a BPO/call-centre operator. Manages the complete employee lifecycle from hiring (ATS) through onboarding, daily operations (attendance, WFM, leave), payroll, performance (KPIs), exit, and client-facing reporting (Portal).

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + Vite + Tailwind)  — Vercel           │
│  /src → pages, components, hooks, lib                   │
│  Auth: Supabase Auth (JWT)                              │
└────────────────────┬────────────────────────────────────┘
                     │  HTTPS  (VITE_HRMS_API_URL)
                     │  Bearer <supabase_access_token>
┌────────────────────▼────────────────────────────────────┐
│  Backend API (Express + TypeScript)  — Railway          │
│  /backend/src → app.ts, modules, middleware             │
│  Port: 5055 (dev) / env PORT (prod)                    │
│  Auth: Supabase Admin SDK validates JWT                 │
│  Role check: MySQL user_roles table                     │
└──────────────┬──────────────────────┬───────────────────┘
               │                      │
    ┌──────────▼──────┐    ┌──────────▼──────────┐
    │  MySQL          │    │  Supabase            │
    │  mas_hrms DB    │    │  PostgreSQL + Auth   │
    │  <mas_hrms DB host — see backend/.env> │    │  + Storage           │
    │  (primary ops)  │    │  (auth + files)      │
    └─────────────────┘    └─────────────────────-┘
```

### Dual-DB strategy
- **MySQL** (`mas_hrms`): All operational data — employees, payroll, attendance, leave, ATS, KPI, portal, exit, WFM
- **Supabase PostgreSQL**: Auth (users, sessions), file storage, 45 migration files (schema-only), edge functions
- **Module toggle**: Each module can independently switch between MySQL backend and Supabase via `VITE_HRMS_*=backend` env flags (`/src/lib/dataSource.ts`)

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui + Radix UI |
| State / data fetching | TanStack Query (React Query) |
| Backend framework | Express 5 + TypeScript (tsx watch) |
| Primary DB | MySQL 8 via `mysql2/promise` (connection pool) |
| Auth DB | Supabase PostgreSQL |
| Auth | Supabase Auth — JWT validated via `supabase.auth.getUser(token)` |
| Email | SMTP via Nodemailer + Supabase Edge Functions via Resend |
| File handling | multer (in-memory, 5MB limit) — roster CSV upload |
| Validation | Zod (backend env, all request schemas) |
| Security | Helmet, CORS (allowlist: localhost + FRONTEND_URL) |
| Build | tsc → dist/, nixpacks (Railway deploy) |
| Testing | Vitest + supertest |
| Deployment | Frontend → Vercel, Backend → Railway |

---

## 4. Backend Modules

All routes live under `/api/*`, all protected by `requireAuth` (Supabase JWT validation).

### 4.1 Employees — `/api/employees`

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List employees (paginated, filterable: status/processId/branchId/search) |
| POST | `/` | Create employee + optional salary auto-assignment |
| GET | `/:id` | Get single employee |
| PATCH | `/:id` | Update employee fields |
| DELETE | `/:id` | Soft-deactivate (`active_status = 0`) |
| GET | `/:id/journey` | Employee journey log (filterable by module/eventType/date range) |
| POST | `/:id/journey` | Append journey event |

**Key logic**: `salary_start_date` defaults to `date_of_joining`. On create, if `structureId + ctcAnnual` provided, auto-assigns salary structure. Employee code uniqueness enforced at DB level.

---

### 4.2 ATS (Applicant Tracking) — `/api/ats`

| Method | Path | Purpose |
|---|---|---|
| GET | `/candidates` | List candidates |
| POST | `/candidates` | Create candidate |
| GET | `/candidates/:id` | Get candidate detail |
| PUT | `/candidates/:id` | Update candidate |
| POST | `/candidates/:id/move-stage` | Advance/retreat candidate stage with log |
| GET | `/candidates/:id/stage-logs` | Stage history |
| POST | `/onboarding-bridge` | Convert candidate to onboarding record |
| PATCH | `/onboarding-bridge/:id` | Update onboarding bridge record |
| GET | `/sourcing-channels` | Reference data |
| GET | `/stats` | Dashboard stats |

---

### 4.3 Leave — `/api/leave`

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/types` | Leave type definitions |
| POST | `/requests` | Submit leave request |
| GET | `/requests` | List requests (filterable) |
| PATCH | `/requests/:id/review` | Approve / reject |
| GET | `/balance/:employeeId` | Leave balance per employee |
| GET/POST | `/holidays` | Company holiday calendar |

---

### 4.4 Payroll — `/api/payroll`

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/structures` | Salary structure definitions |
| GET/POST | `/components` | Salary component definitions |
| POST | `/salary-assignments` | Assign structure to employee |
| POST | `/salary-assignments/bulk` | Bulk assign |
| GET | `/salary-assignments/:employeeId` | Employee's active salary |
| GET/POST | `/runs` | Payroll prep runs (monthly cycles) |
| GET/PATCH | `/runs/:id` + `/runs/:id/status` | Run detail + status update |
| GET | `/runs/:id/lines` | Per-employee prep lines |
| POST | `/runs/:id/calculate` | **Trigger payroll calculation** |
| PATCH | `/lines/:id` | Manual adjust prep line |
| POST/GET | `/advances` | Salary advances |
| GET | `/statutory-config` | PF/ESIC/PT config |

**Payroll calculation engine** (`payrollCalculate.service.ts`):
1. Load run + statutory config
2. Query all employees in run's org scope with active salary assignments
3. Per employee: fetch attendance from `wfm_attendance_session` for run month
4. Calculate: `gross = CTC/12`, apply `basic_pct/hra_pct`, deduct PF (12%), ESIC (0.75% if wage ≤ limit), Professional Tax
5. Upsert `salary_prep_line` (UPSERT ON DUPLICATE KEY)
6. Update run totals; run status → `processing`
7. Locked/disbursed runs cannot be recalculated

---

### 4.5 WFM (Workforce Management) — `/api/wfm` + `/api/wfm/roster`

**Shifts & Attendance:**

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/shifts` | Shift definitions |
| GET/PUT | `/shifts/:id` | Shift detail/update |
| POST | `/sessions/clock-in` | Employee clock-in |
| POST | `/sessions/clock-out` | Employee clock-out |
| GET | `/sessions` | Session list |
| POST | `/sessions/break` | Log break |
| POST/GET | `/regularizations` | Attendance regularization requests |
| PATCH | `/regularizations/:id/review` | Approve/reject regularization |
| GET | `/live` | **Live tracker** (real-time status by process/branch/date) |

**Roster:**

| Method | Path | Purpose |
|---|---|---|
| POST/GET | `/plans` | Roster plan create/list |
| PATCH | `/plans/:id/publish` | Publish plan |
| POST/GET | `/assignments` | Assign employees to roster slots |
| POST | `/upload` | **CSV bulk roster upload** (multer, 5MB, CSV only) |

**Live Tracker**: Joins `wfm_roster_assignment` → `wfm_attendance_session` → `employees` → `shifts`. Computes `adherence_pct` per employee and aggregate summary (total/logged-in/logged-out/absent + overall adherence).

---

### 4.6 KPI — `/api/kpi`

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/metrics` | KPI metric definitions |
| GET/POST | `/templates` | KPI template definitions |
| GET/POST | `/templates/:id/metrics` | Metrics in a template |
| POST | `/assignments` | Assign template to employee |
| GET | `/assignments/employee/:employeeId` | Employee's active template |
| POST | `/scores` + `/scores/bulk` | Record KPI scores |
| GET | `/summary/:employeeId/:templateId/:period` | Score summary for period |
| GET | `/leaderboard` | Ranked leaderboard |

---

### 4.7 Portal (Client Portal) — `/api/portal`

Two-tier auth system:

| Auth | Middleware | Used for |
|---|---|---|
| Supabase JWT | `requireAuth` | Internal staff endpoints |
| Portal JWT (OTP-issued) | `requireClientAuth` | Client-facing endpoints |

**Public (no auth):**
- `POST /auth/request-otp` — send OTP to client email
- `POST /auth/verify-otp` — validate OTP, return portal JWT

**Internal (staff JWT):**
- `POST /internal/glide-paths` — set glide path commitments
- `POST /internal/action-plans` + `PUT /internal/action-plans/:id` — manage action plans
- `POST /internal/governance` — update governance records
- `POST /internal/commentary` — create management commentary
- `GET/POST /internal/client-users` — manage portal user accounts

**Client (portal JWT):**
- `GET /overview` — process list with summary metrics
- `GET /processes/:id/kpis` — KPI scorecards with RAG + sparklines
- `GET /processes/:id/glide-paths` — target vs actual trend
- `GET /processes/:id/action-plans` — improvement action plans
- `GET /processes/:id/governance` — governance dashboard
- `GET /processes/:id/attrition` — attrition analysis (headcount, voluntary/involuntary, exit reasons)
- `GET /processes/:id/commentary` — management commentary thread
- `POST /commentary/:id/acknowledge` + `/reply` — commentary interactions

**Portal logic**: All client data is scoped to `processIds` in the portal JWT. Demo mode (`p-demo-1`) returns hardcoded realistic data for sales/demo purposes.

---

### 4.8 Exit Management — `/api/exit`

| Method | Path | Purpose |
|---|---|---|
| GET | `/stats` | Exit statistics (must be before `/:id`) |
| GET | `/` | List exit requests |
| POST | `/` | Create exit request |
| GET | `/:id` | Exit request detail |
| PATCH | `/:id/status` | Update exit status |

---

### 4.9 Integration Hub — `/api/integration-hub`

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/` | List/create integration connectors |
| GET/PUT | `/:key` | Get/update connector |
| POST | `/:key/run` | Trigger connector run |
| GET | `/:key/field-maps` | Field mapping config |
| GET | `/:key/suggestions` | Auto-suggested field mappings |
| GET/PUT | `/:key/schedule` | Sync schedule config |
| POST | `/field-maps/confirm` | Confirm a suggested field map |
| GET | `/runs` | List integration run history |
| POST | `/:key/db-sync` | **Pull from external DB → write to mas_hrms** |
| GET | `/db-connectors` | List database-type connectors only |

**DB Sync** (`dbSyncService.ts`): Connects to external databases (dialer/iSpark) via `databaseAdapter.ts`. Credentials resolved from env vars by `secret_name` convention (`DIALER_DB_CREDS_USER/PASS`). Falls back to shared server credentials. Supports sync modes: `daily_aggregate`, `daily_snapshot`, `incremental`.

**Schema Analyzer** (`schemaAnalyzer.ts`): Auto-detects field types (string/number/boolean/date/unknown) from sample rows for field mapping suggestions.

---

### 4.10 Process Management — `/api/processes`

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List processes |
| GET | `/:id` | Process detail |
| POST | `/` | Create process |
| PUT | `/:id` | Update process |
| PATCH | `/:id/status` | Toggle process active status |

---

### 4.11 Migration Console — `/api/migration`

Module status check — returns row count per table (`employees`, `wfm_attendance_session`, `wfm_roster_assignment`, `leave_request`, `ats_candidate`, `salary_prep_run`) with `empty`/`has_data` status. Used by the frontend Migration Console page to show data population state.

---

## 5. Database Schema

### MySQL (`mas_hrms`) — SQL files in `/backend/sql/`

| File | Tables |
|---|---|
| `001_core_org.sql` | branches, departments, designations, processes |
| `002_employees.sql` | employees, employee_salary_assignment, employee_journey_log |
| `003_access_control.sql` | user_roles, user_permissions |
| `004_ats.sql` | ats_candidate, ats_stage_log, ats_onboarding_bridge, ats_sourcing_channel |
| `005_attendance_wfm.sql` | wfm_shift, wfm_attendance_session, wfm_break_log, wfm_regularization |
| `006_leave.sql` | leave_type, leave_request, leave_balance, holiday_calendar |
| `007_payroll.sql` | salary_structure, salary_component, salary_prep_run, salary_prep_line, salary_advance, statutory_config |
| `008_integration_hub.sql` | integration_config, integration_connector_run, integration_field_map, integration_field_map_suggestion, integration_schedule |
| `009_dialer_ispark.sql` | Dialer/iSpark sync tables |
| `010_kpi.sql` | kpi_metric, kpi_template, kpi_template_metric, kpi_assignment, kpi_score |
| `011_exit_management.sql` | exit_request, exit_records |
| `012_client_portal.sql` | portal_access_log, management_commentary, glide_path, action_plan, governance_record, client_user |
| `012_roster_shift_times.sql` | wfm_roster_plan, wfm_roster_assignment |

### Supabase PostgreSQL — 45 migrations in `/supabase/migrations/`

Covers frontend-native features: Supabase Auth users, document storage, notifications, push subscriptions, employee profile data used by Supabase-native frontend hooks.

---

## 6. Frontend Structure

### Pages (`/src/pages/`) — 50+ pages

**Core HR:**
- `Dashboard.tsx` — main overview
- `Employees.tsx` — employee directory + CRUD
- `Leaves.tsx` — leave management
- `Attendance.tsx` — clock in/out + history
- `AttendanceRegularization.tsx` — regularization requests
- `Payroll.tsx` — payroll runs + payslips
- `Performance.tsx` — KPI dashboard
- `Onboarding.tsx` — onboarding workflow
- `Assets.tsx` — asset tracking
- `BulkUploadHub.tsx` — bulk CSV uploads
- `Reports.tsx` — reporting
- `Settings.tsx`, `Profile.tsx`, `Security.tsx`

**Native ATS:**
- `NativeATSDashboard.tsx` / `NativeATSDashboardV2.tsx` — ATS overview
- `NativeATSRecruiterDashboard.tsx` / `NativeATSRecruiterWorkspace.tsx`
- `NativeATSCandidateMaster.tsx` — candidate database
- `NativeATSCandidateRegistration.tsx`
- `NativeATSOnboardingBridge.tsx` — ATS→Onboarding handoff
- `NativeATSWaitingQueue.tsx`

**WFM & Operations:**
- `NativeWFMLiveTracker.tsx` — real-time attendance tracker
- `NativeWFMRoster.tsx` — roster planning
- `NativeOperationsDashboard.tsx`
- `NativeQualityDashboard.tsx`

**LMS (Learning Management):**
- `NativeLMSAdmin.tsx` — admin view
- `NativeLMSCoordinator.tsx` — coordinator view
- `NativeLMSMyLearning.tsx` — employee view
- `NativeLMSManagementDashboard.tsx`

**Portal & Governance:**
- `portal/` — client portal pages (KPI, governance, attrition, commentary, action plans)
- `NativeExitManagement.tsx`
- `UnifiedAccessControl.tsx`
- `UnifiedPerformanceCommandCenter.tsx`

**System:**
- `NativeMigrationConsole.tsx` — data migration status
- `ModuleLauncher.tsx` — module navigation hub
- `Changelog.tsx`, `CompanyCalendar.tsx`

---

## 7. Auth Flow

```
1. User logs in → Supabase Auth → access_token (JWT)
2. Frontend stores session in Supabase client
3. All API calls: Authorization: Bearer <access_token>
4. Backend middleware (requireAuth):
   → supabaseAdmin.auth.getUser(token) → validates token
   → attaches req.authUser = { id, email }
5. Role check (requireRole): queries MySQL user_roles table
   → user_id + active_status = 1 → allowed roles array

Portal (client-facing):
1. Client enters email → POST /api/portal/auth/request-otp
2. OTP validated → POST /api/portal/auth/verify-otp → portal JWT
3. Portal JWT stored in localStorage as "portal_token"
4. requireClientAuth middleware validates portal JWT (PORTAL_JWT_SECRET)
   → attaches req.portalUser = { clientUserId, processIds }
5. All portal data scoped to processIds in token
```

---

## 8. Frontend API Clients

### `hrmsApi.ts`
Used by internal staff. Gets Supabase access token from active session. Generic `get/post/put/delete` wrappers.

```
Base URL: VITE_HRMS_API_URL (default: http://localhost:5055)
Auth: Bearer <supabase_access_token>
```

### `portalApi.ts`
Used by client portal pages. Gets token from `localStorage.portal_token`.

```
Endpoints: requestOtp, verifyOtp, getOverview, getKpis, getGlidePaths,
           getActionPlans, getGovernance, getAttrition, getCommentary,
           acknowledgeCommentary, replyCommentary, createActionPlan,
           updateActionPlan, setGlideCommitment, updateGovernance,
           createCommentary
```

### Module toggle (`dataSource.ts`)
```
VITE_HRMS_EMPLOYEES=backend → use Express API
(default) → use Supabase direct
Works per-module independently.
```

---

## 9. Supabase Edge Functions

Located in `/supabase/functions/`:

| Function | Trigger |
|---|---|
| `attendance-reminders` | Scheduled — remind employees to clock in |
| `event-notification` | Event-driven — notify on calendar events |
| `goal-reminders` | Scheduled — KPI goal reminders |
| `invite-employee` | On employee invite — send onboarding email |
| `leave-status-notification` | On leave approve/reject |
| `leave-submission-notification` | On leave submission to manager |
| `onboarding-notification` | Onboarding step notifications |
| `onboarding-reminders` | Scheduled onboarding task reminders |
| `onboarding-request-notification` | On new onboarding request |
| `review-acknowledgment-notification` | On review acknowledged |
| `review-notification` | On performance review assigned |
| `send-push-notification` | Generic push notification sender |
| `version-check` | Returns latest app version for update prompts |

---

## 10. Deployment

| Service | Platform | Config |
|---|---|---|
| Frontend | Vercel | `vercel.json`, `vite.config.ts` |
| Backend | Railway | `railway.json`, `nixpacks.toml` |
| DB | Self-hosted MySQL | `<mas_hrms DB host — see backend/.env> / mas_hrms` |
| Auth/Storage | Supabase | Project: `bebminxoqdjzzfhnrsge` |

**Build**: `npm run build` → tsc → `dist/`  
**Dev**: `npm run dev` → tsx watch  
**CORS**: Backend allows `localhost:*` and `FRONTEND_URL` only

---

## 11. What Is NOT Yet Built / Gaps

- **LMS backend**: LMS pages exist in frontend but no backend module (`/api/lms`)
- **Asset management backend**: Assets page exists, no dedicated API module
- **Document management backend**: Frontend hooks exist, Supabase storage used directly
- **Payroll disbursement**: Calculation done, no payment gateway integration
- **Push notification sending**: Edge function exists but no VAPID setup documented
- **TDS calculation**: Noted as `0` in payroll engine ("computed separately at annual projection" — not implemented)
- **Salary advance deduction from payroll**: Advances tracked but not auto-deducted in `calculatePayrollRun`

---

## 12. Key Files Reference

| File | Purpose |
|---|---|
| `backend/src/app.ts` | Express app setup, all route mounts |
| `backend/src/config/env.ts` | Zod-validated env schema |
| `backend/src/db/mysql.ts` | MySQL connection pool |
| `backend/src/db/supabaseAdmin.ts` | Supabase admin client (auth validation) |
| `backend/src/middleware/authMiddleware.ts` | JWT → `req.authUser` |
| `backend/src/middleware/requireRole.ts` | MySQL role check |
| `backend/src/middleware/requireClientAuth.ts` | Portal JWT → `req.portalUser` |
| `backend/src/modules/payroll/payrollCalculate.service.ts` | Full payroll engine |
| `backend/src/modules/wfm/liveTracker.service.ts` | Real-time attendance tracker |
| `backend/src/modules/integration-hub/adapters/dbSyncService.ts` | External DB sync |
| `backend/sql/000_run_all.sql` | Run all MySQL migrations |
| `src/lib/hrmsApi.ts` | Frontend → backend API client |
| `src/lib/portalApi.ts` | Frontend → portal API client |
| `src/lib/dataSource.ts` | Per-module backend/supabase toggle |
| `src/lib/domain.ts` | Production domain detection |
| `src/lib/payslipPdfGenerator.ts` | PDF payslip generation |
