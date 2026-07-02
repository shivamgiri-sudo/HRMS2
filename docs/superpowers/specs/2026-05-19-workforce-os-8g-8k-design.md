# MAS Callnet Workforce OS — Phases 8G–8K Full Design
**Date:** 2026-05-19  
**Author:** Shuvam Giri  
**Scope:** Phase 8G (foundation + LMS bridge) through Phase 8K (UAT + go-live)  
**Approach:** Parallel Track 2 — Track 1 (core platform) runs alongside Track 2 (dashboards)  
**Project:** `shivamgiri-sudo/mas-callnet-hrms` + `mcn-lms` + `call-master-backend`

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 MAS Callnet Workforce OS                        │
│           React + TypeScript + Vite (HRMS Frontend)            │
│                                                                 │
│  ┌──────────────────┐   ┌────────────────────────────────────┐  │
│  │   HRMS Shell     │   │  WorkforcePageGate                 │  │
│  │  (DashboardLayout│──▶│  Checks role_page_access.can_view  │  │
│  │   + Sidebar)     │   │  before every Workforce OS route   │  │
│  └──────────────────┘   └────────────────────────────────────┘  │
│            │                                                    │
│   ┌────────┴─────────────────────────────────────────────┐     │
│   │                  Module Routes                        │     │
│   │  ATS | WFM | Quality | Operations | Performance CC   │     │
│   │                                                       │     │
│   │  LMS Route ──────────────────────────────────────┐   │     │
│   └──────────────────────────────────────────────────┼───┘     │
│                                                       │         │
└───────────────────────────────────────────────────────┼─────────┘
                                                        │ API Bridge
                              ┌─────────────────────────▼──────────┐
                              │   MCN-LMS Backend (Node/Express)   │
                              │   POST /api/auth/bridge            │
                              │   LMS API served locally :3001     │
                              └─────────────────────────┬──────────┘
                                                        │
                              ┌─────────────────────────▼──────────┐
                              │   call-master-backend (Node/Express)│
                              │   Quality | Operations | Perf CC   │
                              │   endpoints (stub now, MySQL later) │
                              └─────────────────────────┬──────────┘
                                                        │
                    ┌───────────────────────────────────▼──────────┐
                    │              Supabase PostgreSQL              │
                    │  HRMS | ATS | WFM | Access Control | Scope   │
                    └───────────────────────────────────────────────┘
                                         │ (future — when access available)
                    ┌────────────────────▼──────────────────────────┐
                    │              MySQL (call-master-backend)       │
                    │  db_audit (QA scores) | db_external (Ops data)│
                    └───────────────────────────────────────────────┘
```

### Key Architectural Decisions

1. **v5 is source of truth** — `hrms-native-workforce-os-foundation-v5-live-schema-fixed` replaces `mas-callnet-hrms-main` entirely. Its `src/`, `App.tsx`, `DashboardLayout.tsx` and SQL schema become the GitHub repo contents.

2. **Two-tier access control** — `ProtectedRoute` handles auth (is user logged in?) for HRMS self-service pages. `WorkforcePageGate` handles authorization (does this role have `can_view` for this page?) for all Workforce OS module routes.

3. **LMS API Bridge** — Single sign-on without rewriting LMS auth. HRMS Supabase session → `POST /api/auth/bridge` on LMS backend → `PortalSession` created → `lms_token` returned and cached in `sessionStorage`. No second login for the user.

4. **LMS local first** — LMS backend runs on `http://localhost:3001` during development. `VITE_LMS_API_URL` env var controls the target. Switching to production = changing one env var.

5. **Performance data from MySQL via call-master-backend** — Quality, Operations, and Command Center data comes from `call-master-backend` API endpoints. MySQL queries are stubbed now (return empty arrays) and wired when server/MySQL access is available.

6. **Track 2 is purely additive** — new SQL tables and new page components only. Does not touch Track 1 tables or components.

---

## 2. Track 1 — Foundation, Critical Fixes & LMS Bridge

### 2.1 Merge v5 into GitHub Repo

**Files to replace in `mas-callnet-hrms`:**

| Source (v5 folder) | Destination (GitHub repo) |
|---|---|
| `src/pages/` (all 11 new pages) | `src/pages/` — add alongside existing HRMS pages |
| `src/components/layout/DashboardLayout.tsx` | Replace existing |
| `src/App.tsx` | Replace existing |
| `supabase/sql/hrms_native_workforce_os_foundation_v5_live_schema.sql` | `supabase/sql/` — add |
| `docs/` | `docs/` — add |
| `samples/` | `samples/` — add |

**After file merge — run v5 SQL against live Supabase:**
```sql
-- Execute full file in Supabase SQL editor:
supabase/sql/hrms_native_workforce_os_foundation_v5_live_schema.sql
```

---

### 2.2 Critical Bug Fixes (4 items — do before anything else)

#### Bug 1 — ATS Recruiter Submission Field Mismatch
**File:** `src/pages/NativeATSRecruiterDashboard.tsx`  
**Problem:** Form submits `stage_name` but SQL column is `walkin_end_stage` — silently saves NULL.  
**Fix:** Rename field key in the submission object from `stage_name` to `walkin_end_stage`.

#### Bug 2 — LMS Batch Code Field Mismatch
**File:** `src/pages/NativeLMSCoordinator.tsx`  
**Problem:** Form writes to `batch_code` but Prisma schema defines `batch_no` as the unique column.  
**Fix:** Rename field key from `batch_code` to `batch_no` in form submission. Verify against live LMS DB schema.

#### Bug 3 — 7 Bulk Upload RPC Functions Missing
**File:** `src/pages/BulkUploadHub.tsx` calls 7 Supabase RPCs that do not exist yet.  
**Fix:** Create 7 SQL RPC functions in Supabase:
```sql
import_employee_upload_batch(p_batch_id uuid)
import_process_upload_batch(p_batch_id uuid)
import_department_upload_batch(p_batch_id uuid)
import_asset_upload_batch(p_batch_id uuid)
import_branch_upload_batch(p_batch_id uuid)
import_lob_upload_batch(p_batch_id uuid)
import_designation_upload_batch(p_batch_id uuid)
```
Each RPC reads from `upload_batch_row` where `batch_id = p_batch_id` and `status = 'pending'`, inserts/upserts into the target master table, updates row status to `imported` or `error`.

#### Bug 4 — No Route-Level Access Enforcement
**File:** `src/App.tsx`  
**Problem:** All Workforce OS routes use bare `ProtectedRoute` — auth only, no permission check. Direct URL access bypasses role control.  
**Fix:** Build `WorkforcePageGate` (Section 2.3) and wrap all Workforce OS routes.

---

### 2.3 WorkforcePageGate Component

**New file:** `src/components/auth/WorkforcePageGate.tsx`

**Flow:**
```
User navigates to /ats/dashboard
        ↓
WorkforcePageGate receives pageCode="ATS_DASHBOARD"
        ↓
1. Check Supabase session → no session → redirect /auth
2. Call usePageAccess("ATS_DASHBOARD")
   → query role_page_access WHERE role = user.role AND page_code = 'ATS_DASHBOARD'
   → cache result in memory for session (no repeated DB calls)
        ↓
3. can_view = true → render children
   can_view = false or no record → render <AccessDeniedScreen />
```

**New hook:** `src/hooks/usePageAccess.ts`
```typescript
usePageAccess(pageCode: string): {
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  loading: boolean
}
```
- Queries `role_page_access` once per `pageCode` per session
- Results cached in a module-level Map — no redundant Supabase calls
- `loading = true` during fetch → `WorkforcePageGate` shows skeleton, not blank page

**Update `src/App.tsx`:** Replace `protectedPage()` wrapper for all Workforce OS routes with `workforcePage(pageCode)` wrapper:
```typescript
const workforcePage = (pageCode: string, element: JSX.Element) => (
  <WorkforcePageGate pageCode={pageCode}>{element}</WorkforcePageGate>
)

// Example:
<Route path="/ats/dashboard" element={workforcePage("ATS_DASHBOARD", <NativeATSDashboard />)} />
```

**Page codes for all routes:**

| Route | Page Code |
|---|---|
| `/ats/dashboard` | `ATS_DASHBOARD` |
| `/ats/candidate-registration` | `ATS_CANDIDATE_REGISTRATION` |
| `/ats/recruiter/my-candidates` | `ATS_RECRUITER_QUEUE` |
| `/lms/my-learning` | `LMS_MY_LEARNING` |
| `/lms/coordinator` | `LMS_COORDINATOR` |
| `/lms/admin` | `LMS_ADMIN` |
| `/lms/management-dashboard` | `LMS_MANAGEMENT_DASHBOARD` |
| `/wfm/roster` | `WFM_ROSTER` |
| `/wfm/live-tracker` | `WFM_LIVE_TRACKER` |
| `/quality/dashboard` | `QUALITY_DASHBOARD` |
| `/operations/dashboard` | `OPERATIONS_DASHBOARD` |
| `/performance/command-center` | `WORKFORCE_COMMAND_CENTER` |
| `/settings/access-control` | `ACCESS_CONTROL` |

---

### 2.4 LMS API Bridge

#### LMS Backend — New Endpoint

**File:** `backend/src/routes/auth.js` (add to existing)  
**Endpoint:** `POST /api/auth/bridge`

```
Request:
  Authorization: Bearer <supabase_access_token>
  Body: { employee_id: string, role: string }

Flow:
  1. Extract supabase_access_token from Authorization header
  2. Call supabase.auth.getUser(token) → verify token is valid
  3. Confirm returned user.email matches an existing TraineeMaster.employeeId
     (or create TraineeMaster record if first-time LMS access)
  4. Map HRMS role to LMS session type:
     employee / trainee / recruiter → "trainee"
     training_coordinator            → "coordinator"
     lms_admin / admin / hr          → "admin"
     branch_head / process_head /
     management / ceo                → "management"
  5. Create PortalSession { userId, userType, token: uuid, expiresAt: +6h }
  6. Return { ok: true, lms_token, user_type, expires_at }

Error cases:
  - Invalid Supabase token → 401
  - employee_id not found in TraineeMaster and role is not admin → 403
  - DB error → 500
```

**LMS backend `.env` additions:**
```
SUPABASE_URL=<same as HRMS>
SUPABASE_ANON_KEY=<same as HRMS>
```

#### HRMS Frontend — useLMSSession Hook

**New file:** `src/hooks/useLMSSession.ts`

```typescript
useLMSSession(): {
  lmsToken: string | null
  userType: string | null
  isReady: boolean
  error: string | null
  refresh: () => void
}
```

**Logic:**
1. On mount — check `sessionStorage.getItem('lms_token')` and `lms_token_expires`
2. If token exists and not expired → `isReady = true`, return cached token
3. If missing or expired → call `POST ${VITE_LMS_API_URL}/api/auth/bridge` with current Supabase session token + employee_id + role from auth context
4. On success → store `lms_token` and `lms_token_expires` in `sessionStorage` → `isReady = true`
5. On failure → `error = "LMS connection failed"` → show reconnect UI

**LMS pages in HRMS** — all pages that call LMS API:
- Call `useLMSSession()` at top
- Show `<LMSConnecting />` skeleton while `isReady = false`
- Pass `lmsToken` as Bearer header to all LMS API calls via `VITE_LMS_API_URL`
- Wrapped in HRMS `DashboardLayout` — shared nav, notifications, user profile

**LMS routes remain as-is in `App.tsx`** — they now render LMS React components imported from the LMS frontend codebase (co-located or symlinked), not iframed.

#### Environment Variables Required

**HRMS `.env`:**
```
VITE_LMS_API_URL=http://localhost:3001
VITE_BACKEND_API_URL=http://localhost:4000
```

**LMS backend `.env`:**
```
SUPABASE_URL=<project url>
SUPABASE_ANON_KEY=<anon key>
```

**call-master-backend `.env`** (already exists, confirm present):
```
DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME  (MySQL main)
DB_AUDIT_*, DB_EXTERNAL_*                    (MySQL read-only sources)
JWT_SECRET
```

---

## 3. Track 2 — Dashboards & Missing Module Screens

### 3.1 WFM Live Tracker

**New SQL tables (Supabase):**
```sql
wfm_attendance_session (
  id uuid PRIMARY KEY,
  employee_id uuid REFERENCES employees(id),
  shift_id uuid REFERENCES wfm_shift_master(id),
  roster_date date,
  login_time timestamptz,
  logout_time timestamptz,
  status text CHECK (status IN ('on_shift','on_break','completed','absent')),
  punched_by text CHECK (punched_by IN ('manual','facial_device')),
  created_at timestamptz DEFAULT now()
)

wfm_break_log (
  id uuid PRIMARY KEY,
  session_id uuid REFERENCES wfm_attendance_session(id),
  break_in timestamptz NOT NULL,
  break_out timestamptz,
  duration_minutes integer GENERATED ALWAYS AS
    (EXTRACT(EPOCH FROM (break_out - break_in))/60) STORED,
  is_breach boolean GENERATED ALWAYS AS
    (EXTRACT(EPOCH FROM (break_out - break_in))/60 > 60) STORED
)

wfm_external_punch_staging (
  id uuid PRIMARY KEY,
  device_id uuid REFERENCES wfm_facial_device_master(id),
  employee_id uuid REFERENCES employees(id),
  punch_time timestamptz,
  punch_type text CHECK (punch_type IN ('login','logout','break_in','break_out')),
  raw_payload jsonb,
  status text DEFAULT 'pending' CHECK (status IN ('pending','applied','error')),
  error_message text,
  created_at timestamptz DEFAULT now()
)
```

**Page: `/wfm/live-tracker`**
```
Filters: Branch | Process | Team | Date (defaults today)
        ↓
Supabase Realtime subscription on wfm_attendance_session
        ↓
4-lane status board:
  ON SHIFT  |  ON BREAK  |  COMPLETED  |  ABSENT
  
Each card shows:
  Employee name | Shift name | Login time | Break count
  Break > 60 min → card border red (breach flag)
        ↓
Manual punch panel (WFM Admin role only):
  Employee selector + action: Login / Logout / Break In / Break Out
  Writes to wfm_attendance_session or wfm_break_log
  punched_by = 'manual'
        ↓
Facial punch panel (WFM Admin):
  Shows pending rows from wfm_external_punch_staging
  "Apply Pending Punches" button → calls RPC native_wfm_apply_pending_punches()
```

---

### 3.2 Quality Dashboard

**Data source:** `call-master-backend` → MySQL `db_audit`  
**Now:** Stub endpoint returns `{ ok: true, data: [] }` with correct shape  
**Later:** MySQL query wired to return real audit scores

**New endpoint in call-master-backend:**
```
GET /api/quality/dashboard
Query params: branch_id, process_id, team_id, date_from, date_to, page, limit

Response shape:
{
  ok: true,
  summary: {
    audit_count: number,
    avg_score: number,
    fatal_count: number,
    defect_count: number,
    coaching_required_count: number,
    low_score_count: number
  },
  trend: [{ date, avg_score, audit_count }],
  defect_breakdown: [{ category, count }],
  employee_rows: [{
    employee_id, name, process, audit_count,
    avg_score, fatal_count, defect_count,
    coaching_required, last_audit_date
  }]
}
```

**Page: `/quality/dashboard`**
```
Filters: Branch | Process | Team | Date Range
        ↓
6 KPI cards:
  Audit Count | Avg Score | Fatal Count | Defect Count | Coaching Required | Low Score (<75%)
        ↓
Two chart panels:
  Left:  Score trend line chart (by date)
  Right: Defect category bar chart
        ↓
Employee drill-down table:
  Name | Process | Audits | Avg Score | Fatals | Defects | Coaching Flag | Action
  "Coaching Flag" → opens side drawer with coaching history
```

---

### 3.3 Operations Dashboard

**Data source:** `call-master-backend` → MySQL `db_external`  
**Now:** Stub endpoint returns `{ ok: true, data: [] }` with correct shape  
**Later:** MySQL query wired using existing `v_call_master_unified_kpi` view

**New endpoint in call-master-backend:**
```
GET /api/operations/dashboard
Query params: branch_id, process_id, date_from, date_to

Response shape:
{
  ok: true,
  summary: {
    active_employees: number,
    handled_volume: number,
    target_volume: number,
    achievement_pct: number,
    productive_pct: number,
    avg_aht: number,
    sla_pct: number,
    shrinkage_pct: number
  },
  trend: [{ date, achievement_pct, shrinkage_pct }],
  process_rows: [{
    process, active_employees, handled_volume,
    target_volume, achievement_pct, sla_pct,
    avg_aht, shrinkage_pct
  }]
}
```

**Page: `/operations/dashboard`**
```
Filters: Branch | Process | Date Range
        ↓
8 KPI cards:
  Active Employees | Handled Volume | Target Volume | Achievement %
  Productive % | Avg AHT | SLA % | Shrinkage %
        ↓
Two chart panels:
  Left:  Achievement % trend line chart (by date)
  Right: Shrinkage vs Productive % stacked bar chart
        ↓
Process drill-down table:
  Process | Employees | Volume | Target | Achievement | SLA | AHT | Shrinkage
```

---

### 3.4 Performance Command Center (Completion)

**Data source:** `call-master-backend` — aggregates from Supabase + MySQL  
**Now:** Stub endpoint, existing Supabase snapshot queries remain functional  
**Later:** MySQL metrics wired in

**New endpoint in call-master-backend:**
```
GET /api/performance/command-center
Query params: branch_id, process_id, month, date_from, date_to, trend_view

Response shape:
{
  ok: true,
  summary: {
    active_employees: number,
    ats_walkins: number,
    ats_selected: number,
    ats_client_pending: number,
    lms_completed: number,
    wfm_on_shift: number,
    avg_quality_score: number,
    operations_achievement_pct: number,
    shrinkage_pct: number
  },
  alerts: [{
    type, severity, message, branch_id, process_id, created_at
  }],
  branch_rows: [{
    branch, headcount, hiring_count, training_completed,
    avg_quality, ops_achievement, shrinkage, risk_flag
  }],
  process_rows: [{
    process, active, volume, sla_pct, avg_quality,
    shrinkage, status
  }]
}
```

**Updates to `UnifiedPerformanceCommandCenter.tsx`:**
```
Add filters: Branch | Process | Role | Month | Trend View
        ↓
Top summary row (8 cards from /api/performance/command-center):
  Active Employees | ATS Walk-ins | ATS Selected | LMS Completed
  WFM On Shift | Avg Quality | Ops Achievement | Shrinkage
        ↓
Alert panel (right side — auto-generated threshold breaches):
  "Branch X: Quality below 75% for 3 days"
  "Process Y: Shrinkage above 15% today"
  "Team Z: 4 employees on break > 60 min"
        ↓
Branch performance grid (improved existing):
  Branch | Headcount | Hiring | Training | Quality | Ops | Risk Flag
        ↓
Process performance grid (new):
  Process | Active | Volume | SLA | Quality | Shrinkage | Status
```

---

## 4. Phase 8H — Real Data Import & Sync Layer

All import infrastructure built now. MySQL/server wiring happens when access is available.

### Import Pipeline Pattern
```
Source export (CSV/Excel/DB dump)
        ↓
Upload via BulkUploadHub (existing UI, extended with new types)
        ↓
Staging table insert (Supabase)
        ↓
Validation RPC — flags bad rows (missing IDs, wrong formats, duplicates)
        ↓
Error report download (CSV of rejected rows with reason)
        ↓
Admin approves → production table insert RPC
        ↓
Dashboard count validation (before vs after shown in UI)
```

### Staging Tables (new SQL)

```sql
import_staging_ats_candidate     -- historical ATS candidate records
import_staging_lms_trainee       -- historical LMS trainee records  
import_staging_employee          -- historical employee master records
import_staging_quality           -- historical quality scores (MySQL later)
import_staging_operations        -- historical operations data (MySQL later)
```

### BulkUploadHub Extensions

Add 5 new upload types to `BulkUploadHub.tsx`:

| Upload Type | Staging Table | Target |
|---|---|---|
| ATS Historical Candidates | `import_staging_ats_candidate` | `ats_candidate` |
| LMS Historical Trainees | `import_staging_lms_trainee` | LMS `TraineeMaster` via bridge |
| Employee Historical Master | `import_staging_employee` | `employees` |
| Quality Historical Data | `import_staging_quality` | MySQL (when available) |
| Operations Historical Data | `import_staging_operations` | MySQL (when available) |

Each type gets: sample CSV template, field validation rules, error report download, import execution button.

---

## 5. Phase 8I — Hard Row-Level Security

**Applied last** — after all data flows confirmed working. Enforcing too early breaks development.

### Policy Pattern

```sql
-- Example: Branch Head sees only their branch
CREATE POLICY "branch_scope_select" ON ats_candidate
FOR SELECT USING (
  current_user_is_admin_hr()
  OR branch_id IN (
    SELECT scope_value::uuid
    FROM user_assignment_scope
    WHERE user_id = auth.uid()
    AND scope_type = 'branch'
  )
);
```

### Scope Hierarchy

| Role | Data Scope |
|---|---|
| CEO, Admin, HR | All data — no filter |
| Branch Head | Own `branch_id` only |
| Process Manager | Own `process_id` only |
| Team Leader | Own `team_id` only |
| Recruiter | Own `recruiter_employee_id` candidates only |
| Employee | Own `employee_id` records only |

### Tables Receiving RLS Policies

- **ATS:** `ats_candidate`, `ats_recruiter_submission`, `ats_candidate_status_log`
- **LMS:** `lms_content_progress`, `lms_batch_master`, `lms_batch_trainee`
- **WFM:** `wfm_roster_daily`, `wfm_attendance_session`, `wfm_break_log`
- **Performance:** `employee_performance_snapshot`, `branch_performance_snapshot`
- **Access:** `user_assignment_scope` (users can only read own scope)

### RLS Helper Functions (already in v5 SQL — confirm present)
```sql
current_user_roles_text()       -- returns user's roles as text[]
current_user_has_role(p_role)   -- boolean
current_user_is_admin_hr()      -- boolean shortcut
```

---

## 6. Phase 8J — Reports & Email Automation

All reports generated by `call-master-backend` using existing document services (`xlsxService`, `pdfService`, `pptxService`).

### Report Catalog

| Report | Schedule | Format | Recipients |
|---|---|---|---|
| CEO Daily Command Summary | Cron 08:00 daily | PDF | CEO, Admin |
| Branch Performance Report | Cron Monday 08:00 | Excel | Branch Heads |
| ATS Hiring Report | Cron Friday 18:00 | Excel | HR, Recruiters |
| Training Progress Report | Cron Wednesday 08:00 | PDF | Training Coordinators |
| WFM Shift/Break Exception | Cron end-of-shift | PDF | WFM Admin, Branch Heads |
| Quality Coaching Report | Cron 09:00 daily | Excel | Quality Head, Team Leaders |
| Operations Productivity Report | Cron 09:00 daily | Excel | Ops Head, Process Managers |

### Architecture

```
node-cron in call-master-backend
        ↓
Fetch data: Supabase (HRMS/WFM/ATS) + MySQL db_audit + MySQL db_external
        ↓
Generate document via existing xlsxService / pdfService
        ↓
Two delivery paths (configurable per report):
  Path A: Send via Resend API (email with attachment)
  Path B: Save to Supabase Storage → in-app notification to recipient
```

### Manual Trigger

Every report also has an **on-demand download button** in its relevant page:
- CEO Command Center → "Download Command Summary"
- Quality Dashboard → "Download Coaching Report"
- Operations Dashboard → "Download Productivity Report"
- ATS Dashboard → "Download Hiring Report"
- LMS Management → "Download Training Report"
- WFM Live Tracker → "Download Shift Exception Report"

---

## 7. Phase 8K — Production UAT & Go-Live

### UAT Checklist by Role

**CEO / Admin:**
- [ ] Command Center loads with all 8 summary cards
- [ ] Branch and process grids show scoped data
- [ ] Alert panel shows threshold breaches
- [ ] Can filter by branch, process, month, trend view
- [ ] Reports download correctly
- [ ] Cannot see individual employee private data

**Branch Head:**
- [ ] Sees only own branch across all modules
- [ ] ATS pipeline shows branch candidates only
- [ ] WFM live tracker shows branch employees only
- [ ] Quality and Operations scoped to branch
- [ ] Direct URL to another branch's data → denied (RLS test)

**Process Manager:**
- [ ] All views scoped to own process only
- [ ] Cannot see other process data via direct API call

**Team Leader:**
- [ ] WFM live tracker scoped to own team
- [ ] Quality drill-down shows own team only

**Recruiter:**
- [ ] Candidate queue shows own candidates only
- [ ] Can submit interview decisions with all fields
- [ ] `walkin_end_stage` saves correctly (bug fix verified)
- [ ] LMS My Learning accessible

**Training Coordinator:**
- [ ] Batch creation works — `batch_no` saves correctly (bug fix verified)
- [ ] Trainee onboarding via bulk CSV works
- [ ] LMS coordinator portal accessible via bridge (no second login)

**LMS Admin:**
- [ ] Curriculum builder accessible
- [ ] Google Drive sync works
- [ ] Question bank management works

**Employee:**
- [ ] HRMS self-service: attendance, leaves, payroll, profile
- [ ] LMS My Learning: content loads, progress saves, sequential unlock works
- [ ] Cannot navigate to ATS, WFM, Quality, Operations
- [ ] Direct URL to restricted page → AccessDenied screen

**WFM Admin:**
- [ ] Shift master CRUD works
- [ ] Roster daily assignment works
- [ ] Manual punch (login/logout/break) saves correctly
- [ ] Facial punch staging shows pending records
- [ ] Apply pending punches RPC works

### Go-Live Gates (all must pass)

```
1.  v5 merge complete — all files in GitHub repo
2.  v5 SQL applied to Supabase — all tables present
3.  All 4 critical bugs fixed and verified
4.  WorkforcePageGate enforces access on all Workforce OS routes
5.  LMS bridge works — single login, no second prompt
6.  WFM live tracker shows real-time updates
7.  Quality and Operations dashboards show clean empty state (MySQL stubs)
8.  Performance Command Center shows Supabase snapshot data
9.  Bulk upload works for all 7 master types (RPCs deployed)
10. All 5 historical import staging tables created
11. RLS policies active and verified — out-of-scope query returns empty
12. All 7 reports generate and deliver correctly
13. UAT sign-off obtained for each role type
14. No existing HRMS working flows broken (attendance, leaves, payroll, profile)
```

---

## 8. External Integrations Registry

> **⚠️ PLACEHOLDER — Owner: Shuvam Giri**
> Fill in vendor names, API docs, and credentials format when available.

| Integration | Purpose | Direction | Connection Type | Status | Config Needed |
|---|---|---|---|---|---|
| Google Sheets | Legacy ATS + LMS data migration | Read once | Google Sheets API v4 | Migration source | Service account JSON |
| Google Drive | LMS content storage (videos, PDFs) | Read/Write | Drive API v3 + OAuth2 | Active in LMS | Service account + OAuth credentials |
| **Dialler** | Call routing, agent activity | Read | REST API / Webhook | TBD | `DIALLER_API_URL`, `DIALLER_API_KEY` |
| **Facial Biometric Device** | WFM punch in/out | Read (device push) | REST API or SDK | TBD — vendor: `___` | `FACIAL_DEVICE_API_URL`, `FACIAL_DEVICE_SECRET` (stored as Supabase secret, not DB field) |
| **CRM** | Agent/customer data | Read | REST API | TBD | `CRM_API_URL`, `CRM_API_KEY` |
| **BGV Provider** | Candidate background verification | Read/Write | REST API | TBD — vendor: `___` | `BGV_API_URL`, `BGV_API_KEY` |
| **SMS Gateway** | Candidate OTP / alerts | Write | REST API | TBD | `SMS_API_URL`, `SMS_API_KEY` |
| **WhatsApp Business** | Candidate communication | Write | WhatsApp Business API | TBD | `WA_TOKEN`, `WA_PHONE_NUMBER_ID` |
| **Payroll Processor** | External payroll sync | Read/Write | REST API or SFTP | TBD | `PAYROLL_API_URL`, `PAYROLL_KEY` |
| **Call Recording System** | QA audit playback | Read | REST API / stream URL | TBD | `RECORDING_API_URL`, `RECORDING_KEY` |
| MySQL db_audit | QA call assessment scores | Read | MySQL2 (call-master-backend) | Built — wiring pending | `DB_AUDIT_HOST/USER/PASS/NAME` |
| MySQL db_external | Call volume, AHT, SLA, ops data | Read | MySQL2 (call-master-backend) | Built — wiring pending | `DB_EXTERNAL_HOST/USER/PASS/NAME` |
| Supabase PostgreSQL | Core HRMS/ATS/WFM/Access data | Read/Write | Supabase JS client + REST | Active | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| Resend API | Email reports + notifications | Write | REST API | Active (edge functions) | `RESEND_API_KEY` |
| Claude AI API | Call insights, coaching AI | Read/Write | Anthropic SDK | Active (call-master-backend) | `ANTHROPIC_API_KEY` |
| Azure Blob Storage | Future file storage | Read/Write | Azure SDK | Planned | `AZURE_STORAGE_CONNECTION_STRING` |
| Azure / Linux Server | Production hosting | N/A | SSH + deploy scripts | Planned | SSH credentials, deploy config |

---

## 9. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Performance | Dashboards load under 2s with branch/process filters applied |
| Scalability | 1000+ employees, 10+ concurrent branch head sessions |
| Security | WorkforcePageGate (UI) + RLS (DB) — two-layer enforcement |
| Auditability | All CRUD on ATS, LMS, WFM logged with user + timestamp |
| Reliability | No existing HRMS flows broken during any phase |
| Data Quality | Staging → validation → approval before any production import |
| UI Quality | CEO-class: crisp, readable, action-oriented, no data clutter |
| Maintainability | Phase-wise SQL files, complete replaceable page files |
| Extensibility | All backends behind env-var URLs — swap endpoints without frontend changes |

---

## 10. Phase Execution Summary

| Phase | Track | Scope | Depends On |
|---|---|---|---|
| **8G-T1a** | Track 1 | Merge v5 + run SQL + fix 4 bugs | Nothing — start here |
| **8G-T1b** | Track 1 | Build WorkforcePageGate + usePageAccess | 8G-T1a |
| **8G-T1c** | Track 1 | LMS bridge endpoint + useLMSSession hook | 8G-T1a |
| **8G-T2a** | Track 2 | WFM Live Tracker (SQL + page) | 8G-T1a SQL merged |
| **8G-T2b** | Track 2 | Quality Dashboard (stub endpoint + page) | call-master-backend running |
| **8G-T2c** | Track 2 | Operations Dashboard (stub endpoint + page) | call-master-backend running |
| **8G-T2d** | Track 2 | Performance Command Center completion | 8G-T2b + 8G-T2c stubs |
| **8H** | Both | Data import staging tables + BulkUploadHub extensions | 8G-T1a complete |
| **8I** | Track 1 | Hard RLS policies | All data flows verified |
| **8J** | Track 1 | Reports + email automation (node-cron) | 8I complete |
| **8K** | Both | UAT + go-live gates | All phases complete |
| **INT-REGISTRY** | Ongoing | Fill vendor details + wire integrations as access arrives | Per vendor availability |
