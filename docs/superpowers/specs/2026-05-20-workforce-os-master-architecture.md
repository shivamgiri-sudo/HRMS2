# MAS Callnet Workforce OS — Master Architecture Spec
**Date:** 2026-05-20  
**Author:** Senior Design Session  
**Status:** Approved — basis for all Phase 9+ implementation plans

---

## 1. System Boundaries (What Owns What)

This is the definitive ownership map. Nothing in HRMS duplicates what another system owns.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    MAS CALLNET WORKFORCE OS                              │
│                    Frontend: React 18 + TypeScript + Vite                │
│                    Repo: mas-callnet-hrms (GitHub, Vercel)               │
└────────┬─────────────────┬──────────────────┬────────────────────────────┘
         │                 │                  │
         ▼                 ▼                  ▼
┌─────────────────┐ ┌────────────────┐ ┌──────────────────────────┐
│   SUPABASE      │ │  mas-hrms-     │ │  call-master-backend     │
│   Auth ONLY     │ │  backend       │ │  (existing, port 5050)   │
│                 │ │  NEW REPO      │ │                          │
│  - JWT sessions │ │  Node/TS/      │ │  MySQL: Shivamgiri DB    │
│  - user_roles   │ │  Express       │ │                          │
│  - auth.users   │ │  port 5055     │ │  Owns:                   │
│                 │ │                │ │  - Quality scores        │
│  NO business    │ │  MySQL:        │ │  - Call KPIs             │
│  data           │ │  mas_hrms DB   │ │  - Coaching queue        │
│                 │ │  (NEW)         │ │  - Operations KPIs       │
│                 │ │                │ │  - AI call insights      │
│                 │ │  Owns ALL      │ │                          │
│                 │ │  HRMS data     │ │  HRMS reads via REST     │
│                 │ │  (see §3)      │ │  — never owns this data  │
└─────────────────┘ └────────────────┘ └──────────────────────────┘
         │
         ▼
┌──────────────────────┐
│  LMS Backend         │
│  (live, company      │
│  domain, separate    │
│  repo)               │
│                      │
│  Owns:               │
│  - Classrooms        │
│  - Modules           │
│  - Assessments       │
│  - Progress          │
│                      │
│  HRMS connects via   │
│  /api/auth/bridge    │
│  (already built)     │
└──────────────────────┘
```

---

## 2. New Backend: `mas-hrms-backend`

### Repo Details
- **Repo name:** `mas-hrms-backend`
- **Runtime:** Node.js + TypeScript + Express
- **Port:** 5055
- **Database:** MySQL — new database `mas_hrms` on production server
- **Auth strategy:** Every request validated via Supabase JWT (`Authorization: Bearer <token>`) — backend calls Supabase `/auth/v1/user` to verify identity, then checks `user_roles` table in MySQL for permissions
- **Deployment target:** Azure Linux server (same as call-master-backend)

### Tech Stack
```
Express 5 + TypeScript
mysql2/promise (connection pool)
jsonwebtoken + Supabase auth verification
multer (file uploads — SFTP/CSV ingestion)
node-cron (scheduled sync jobs)
axios (outbound HTTP to external systems)
ssh2-sftp-client (SFTP adapter)
exceljs (Excel file parsing)
zod (request validation)
```

### Folder Structure
```
mas-hrms-backend/
├── src/
│   ├── config/
│   │   ├── db.ts              — MySQL pool (mas_hrms DB)
│   │   ├── supabaseAuth.ts    — JWT verification via Supabase
│   │   └── env.ts             — typed env vars
│   ├── middleware/
│   │   ├── auth.ts            — verify Supabase JWT, attach user
│   │   └── requireRole.ts     — check role from MySQL user_roles
│   ├── modules/               — one folder per domain
│   │   ├── employees/
│   │   ├── attendance/
│   │   ├── wfm/
│   │   ├── leave/
│   │   ├── payroll/
│   │   ├── ats/
│   │   ├── integration-hub/
│   │   └── migration/
│   ├── shared/
│   │   ├── types.ts
│   │   └── utils.ts
│   └── server.ts
├── sql/
│   ├── 001_employees_core.sql
│   ├── 002_attendance_wfm.sql
│   ├── 003_leave.sql
│   ├── 004_payroll.sql
│   ├── 005_ats.sql
│   ├── 006_integration_hub.sql
│   ├── 007_access_control.sql
│   └── 999_migrate_from_supabase.sql
└── package.json
```

---

## 3. MySQL `mas_hrms` Database — Complete Schema Map

All tables listed below. Grouped by module. Every table gets `id CHAR(36) DEFAULT (UUID())`, `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`, `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`.

### 3.1 Core — Org Structure
```
tenant_config              — company name, settings
tenant_module_config       — module enable/disable per tenant (ATS, LMS, WFM, etc.)
branch_master              — branches/locations
department_master          — departments
process_master             — BPO processes (Inbound, Outbound, Back Office)
lob_master                 — Lines of Business
designation_master         — designations/titles
```

### 3.2 Employees
```
employees                  — master record (emp_code, name, DOJ, DOB, etc.)
employee_documents         — KYC, offer letter, BGV docs
employee_emergency_contact — next of kin
employee_bank_detail       — account for payroll (encrypted)
employee_journey_log       — every status change: onboarded, promoted, transferred, exited
```

### 3.3 Access Control
```
user_roles                 — user_id (Supabase UUID) → role_key
user_assignment_scope      — user_id → branch/process/lob/department scope
role_page_access           — role_key → page_code → can_view/create/edit/delete/export
workforce_role_catalog     — master list of role keys and descriptions
```

### 3.4 ATS — Candidate Pipeline
```
ats_candidate              — candidate master (name, mobile, source, current stage)
ats_interview_slot         — walk-in slots with date, time, branch, process
ats_candidate_stage_log    — journey: applied → screened → selected → onboarded
ats_onboarding_bridge      — link between ats_candidate and employees on selection
ats_sourcing_channel       — portals, referrals, social — master
```

### 3.5 Attendance & WFM
```
wfm_shift_master           — shift definitions (code, name, start_time, end_time, required_mins)
wfm_roster_plan            — process-wise headcount requirement per date range
wfm_roster_assignment      — employee → shift → date (one row per employee per day)
wfm_attendance_session     — actual login/logout per employee per day (punch source: manual/biometric/dialer)
wfm_break_log              — break in/out per session (break_type: break/lunch/bio/training)
wfm_external_punch_staging — raw punches from biometric/dialer before mapping to session
wfm_facial_device_master   — registered biometric devices (secret_name → Vault, not IP+pass in plain text)
attendance_regularization  — employee requests to correct attendance, approval workflow
```

### 3.6 Leave
```
leave_type_master          — CL, SL, EL, ML, PL, LWP (code, name, max_days, carry_forward)
leave_balance_ledger       — employee × leave_type × year → allocated/used/adjusted
leave_request              — employee → from_date, to_date, type, status
leave_approval_log         — every approve/reject action with remarks
leave_holiday_master       — company-wide and branch-specific holidays
```

### 3.7 Payroll Engine (Complete)
```
salary_structure_master    — named structures (e.g. "BPO Grade A", "Team Lead")
salary_component_master    — BASIC, HRA, TA, SPECIAL, PF, ESIC, PT, TDS
salary_structure_component — which components apply to which structure + formula/amount
employee_salary_assignment — employee → salary_structure → effective_date → CTC
salary_prep_run            — monthly run header (month, branch, process, status: draft→locked)
salary_prep_line           — one row per employee per run (present_days, lwp, gross, deductions, net)
salary_deduction_rule      — LWP per day, late marks, dialer shortfall rules
salary_advance_log         — advances taken, recovery schedule
salary_payslip             — generated payslip reference per employee per month
statutory_config           — PF%, ESIC%, PT slabs per state
```

### 3.8 Universal Integration Hub
```
integration_config         — connector registry (key, type: rest/db/sftp/webhook, auth_type, secret_name)
integration_schedule       — cron expression per connector, last_run, next_run
integration_connector_run  — one row per sync execution (status, rows_fetched, duration_ms)
integration_raw_payload    — untouched raw data per run (JSON column, never deleted)
integration_schema_snapshot — detected fields + data types per connector per run
integration_field_map      — confirmed source_field → hrms_table.target_column mappings
integration_field_map_suggestion — auto-suggested mappings pending admin confirmation
integration_event_log      — audit: who triggered what, when, result
```

### 3.9 Migration (Supabase → MySQL)
```
migration_run              — one row per migration session (module, status, rows_read, rows_written)
migration_row_log          — per-row result (source_table, source_id, target_table, status, error)
```

### 3.10 Dialer
```
dialer_session_log         — employee_code, session_date, login_minutes, process, branch, source
```

### 3.11 iSpark Migration
```
ispark_migration_batch     — batch header (batch_ref, status, total/valid/invalid/promoted rows)
ispark_employee_staging    — raw iSpark row + validation_status + mapped fields
```

### 3.12 KPI
```
kpi_target_master          — role_key × kpi_code → target_value, unit
role_kpi_snapshot          — employee × date × kpi_code → actual_value, achievement_pct
```

---

## 4. Frontend API Layer — How HRMS Talks to mas-hrms-backend

**Current:** `supabase.from('table').select()` — direct Supabase client calls  
**Target:** `fetch('/api/employees')` → `mas-hrms-backend` → MySQL

### Migration approach: Feature-flag per module

A `VITE_DATA_SOURCE` env var per module controls whether data comes from Supabase (current) or mas-hrms-backend (new). This allows **per-module cutover** without a big-bang switch.

```typescript
// src/lib/dataSource.ts
export const USE_HRMS_BACKEND = {
  employees:   import.meta.env.VITE_HRMS_EMPLOYEES   === 'backend',
  attendance:  import.meta.env.VITE_HRMS_ATTENDANCE  === 'backend',
  payroll:     import.meta.env.VITE_HRMS_PAYROLL     === 'backend',
  wfm:         import.meta.env.VITE_HRMS_WFM         === 'backend',
  leave:       import.meta.env.VITE_HRMS_LEAVE       === 'backend',
  integration: import.meta.env.VITE_HRMS_INTEGRATION === 'backend',
};
```

Each module's React hook checks this flag:
```typescript
// Example: useEmployees hook
const useEmployees = () => {
  if (USE_HRMS_BACKEND.employees) {
    return useQuery({ queryFn: () => hrmsApi.get('/employees') });
  }
  return useQuery({ queryFn: () => supabase.from('employees').select('*') });
};
```

When a module is fully tested in MySQL, flip `VITE_HRMS_EMPLOYEES=backend` in `.env`. Zero downtime, zero big-bang risk.

---

## 5. One-Click Supabase → MySQL Migration Service

### Architecture

A dedicated migration module in `mas-hrms-backend` at `src/modules/migration/`.

**Endpoint:** `POST /api/migration/run`  
**Auth:** Super Admin only  
**Body:** `{ module: 'employees' | 'attendance' | 'wfm' | 'leave' | 'ats' | 'all' }`

### How it works per module:

```
Step 1: CONNECT
  — Open Supabase REST client (service role key)
  — Open MySQL pool (mas_hrms)

Step 2: READ (Supabase → memory in pages)
  — Page size: 500 rows
  — Read all rows from source Supabase table
  — Log: migration_run row created

Step 3: TRANSFORM
  — Map Supabase UUID format to MySQL CHAR(36) 
  — Map JSONB → JSON
  — Map timestamptz → DATETIME
  — Apply field renames where schema evolved

Step 4: VALIDATE
  — Required fields present
  — FK references exist in already-migrated tables
  — No duplicates on unique keys

Step 5: WRITE (MySQL — batched INSERT)
  — 100 rows per INSERT batch
  — Each row logged in migration_row_log
  — Failed rows logged with error, skip and continue

Step 6: VERIFY
  — COUNT(*) Supabase source vs MySQL target
  — Report: total_read, total_written, total_failed

Step 7: REPORT
  — Update migration_run status to 'complete' or 'partial'
  — Return summary JSON to frontend
```

### Frontend: `NativeMigrationConsole.tsx`

```
┌─────────────────────────────────────────────────┐
│  Database Migration Console           SUPER ADMIN│
├─────────────────────────────────────────────────┤
│  Module          Supabase Rows  MySQL Rows  Status│
│  ─────────────────────────────────────────────── │
│  Employees            342          342      ✅ Done│
│  Attendance          1,204            0     ⬜ Ready│
│  WFM Roster            89             0     ⬜ Ready│
│  Leave                 56             0     ⬜ Ready│
│  ATS Candidates       891             0     ⬜ Ready│
│                                                 │
│  [Migrate Attendance ▶]   [Migrate All ▶]       │
│                                                 │
│  Last run: 2026-05-20 14:32  •  342 rows  •  ✅  │
└─────────────────────────────────────────────────┘
```

---

## 6. Universal Integration Hub — Full Design

### Connector Types Supported

| Type | How it connects | Example vendors |
|---|---|---|
| `rest_pull` | HTTP GET/POST to external API | Most modern dialers, BGV APIs |
| `rest_push` | Receives POST webhook from external | Any webhook-enabled system |
| `database` | TCP to MySQL/PostgreSQL/MSSQL IP+port | Legacy dialer DBs, payroll DBs |
| `sftp` | SFTP login → download file | Payroll vendors, BGV reports |
| `file_upload` | Admin uploads CSV/Excel manually | iSpark, legacy spreadsheets |

### Credential Security Model

```
Admin enters credentials in UI
          ↓
mas-hrms-backend receives via HTTPS (never logged)
          ↓
Stored in: MySQL integration_config.secret_name = 'dialer_prod_key'
           + Supabase Vault secret named 'dialer_prod_key' = {actual credentials}
          ↓
At sync time: backend reads secret_name, fetches from Vault, uses in-memory only
              Credential NEVER written to any log table
```

### Sync Flow (scheduled + on-demand)

```
[Scheduler/Manual trigger]
         ↓
ConnectorService.run(integration_key)
         ↓
1. Load config from integration_config (MySQL)
2. Fetch secret from Supabase Vault
3. Execute adapter (Rest/DB/SFTP/FileUpload)
4. Store raw response → integration_raw_payload (JSON, untouched)
5. SchemaAnalyzer.inspect(raw) → integration_schema_snapshot
6. Check integration_field_map for confirmed mappings
   ├── All mapped → run PromotionEngine
   └── Unmapped fields → create integration_field_map_suggestion rows
7. PromotionEngine: transform + write to target staging table
8. Log result → integration_connector_run + integration_event_log
```

### Field Mapper UI — `NativeFieldMapper.tsx`

```
┌──────────────────────────────────────────────────────────────┐
│  Field Mapper — Dialer System                    Last sync: 2m│
├─────────────────────────┬────────────────────────────────────┤
│  SOURCE FIELDS          │  HRMS TARGET                       │
│  (from raw payload)     │                                     │
├─────────────────────────┼────────────────────────────────────┤
│  emp_id          string │→ [employees.employee_code    ✅ Auto]│
│  login_date      date   │→ [dialer_session_log.session_date ✅]│
│  duration_mins   int    │→ [dialer_session_log.login_minutes✅]│
│  process         string │→ [dialer_session_log.process_name ✅]│
│  branch_code     string │→ [── Select HRMS field ──     ⚠️  ]│
│  campaign_id     string │→ [── Not mapped / Skip ──     ❓  ]│
├─────────────────────────┴────────────────────────────────────┤
│  5 fields detected  •  4 auto-mapped  •  1 needs review      │
│  [Confirm All Mappings ▶]                                     │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Process-wise WFM Roster Builder

This is the WFM feature most critical for BPO operations.

### Concept: Process-wise Headcount Planning → Roster Build

```
Step 1: HEADCOUNT PLAN (wfm_roster_plan)
  Manager/WFM defines: For Process X, Branch Y, on date range Z:
  — Shift A needs 15 agents
  — Shift B needs 10 agents
  — Shift C needs 5 agents

Step 2: ROSTER BUILD (wfm_roster_assignment)
  WFM team assigns specific employees to fill the plan:
  — Auto-suggest based on last week's roster + leave status
  — Manual drag-assign employees to slots
  — Coverage meter shows: Planned 15, Assigned 12, Gap 3

Step 3: LOCK (wfm_roster_assignment.status = 'locked')
  Once locked, roster is published to employees
  — Employee sees their shift in WFM Live Tracker
  — Attendance engine knows what sessions to expect

Step 4: LIVE TRACKING (wfm_attendance_session)
  On shift day: actual login vs scheduled shift
  — Adherence % = actual_login_minutes / required_minutes
  — Shrinkage tracked in real time
```

### Tables (extends existing, additive only):

`wfm_roster_plan` — **NEW** (process+branch+date_range+shift → required_headcount)  
`wfm_roster_assignment` — **EXISTS**, add `plan_id` FK + `publish_status`  
`wfm_attendance_session` — **EXISTS**, no changes needed  
`wfm_break_log` — **EXISTS**, no changes needed  

---

## 8. Complete Payroll Engine

### Salary Structure Philosophy (BPO context)

```
CTC = BASIC + HRA + TA + SPECIAL ALLOWANCE
Deductions = PF (employee 12% of BASIC) + ESIC (0.75% of gross if ≤21000) + PT (state slab) + TDS + LWP + Late Marks
Net = Gross Earnings − Total Deductions
```

### Monthly Run Lifecycle

```
DRAFT → PROCESSING → REVIEWED → APPROVED → LOCKED → DISBURSED

DRAFT:       Run created, employees listed
PROCESSING:  System calculates: fetches attendance (present_days, lwp_days),
             leave deductions, dialer shortfall, applies deduction rules
REVIEWED:    HR reviews each salary line, can override
APPROVED:    Manager/CEO approves the run
LOCKED:      No more changes, payslips generated
DISBURSED:   Bank transfer reference recorded
```

### Payslip Generation

Payslip = PDF generated server-side in `mas-hrms-backend` using `pdfkit` or `html-pdf`.  
Stored as a file reference in `salary_payslip` table.  
Employee can download their payslip from the Employee Journey view.

---

## 9. Employee Journey View

A single timeline view showing every event in an employee's lifecycle:

```
[ATS: Applied] → [ATS: Selected] → [Onboarded] → [Promoted: TL] → 
[Process Transfer: Inbound→Outbound] → [Salary Revision] → 
[Leave: Maternity 90d] → [Training: LMS Completed] → [Exit]
```

Powered by `employee_journey_log` table — every module writes an event here:
- ATS writes: `applied`, `selected`, `offer_sent`
- HR writes: `onboarded`, `transferred`, `promoted`, `exited`
- Payroll writes: `salary_revised`, `increment`
- LMS writes: `certification_earned`
- Attendance writes: `regularization_approved`

---

## 10. Attendance Regularization

### Flow

```
Employee: "I was present on 15-May but system shows Absent"
    ↓
Employee submits regularization request:
  — date, reason, supporting_note, manager_note
    ↓
Direct manager reviews → Approve/Reject
    ↓
If approved: wfm_attendance_session updated
             (punch_source = 'REGULARIZATION', regularization_id FK)
    ↓
Payroll run picks up corrected present_days
```

`attendance_regularization` table — **NEW in MySQL**  
Existing `AttendanceRegularization.tsx` (800 lines, Supabase) — refactored to hit `mas-hrms-backend`

---

## 11. Implementation Sequence (Sub-Projects)

Given the MySQL-first decision, the build sequence is:

### Phase A: Foundation (do first, everything depends on it)
1. `mas-hrms-backend` repo scaffolding — Express + TypeScript + MySQL pool + Supabase auth middleware
2. MySQL `mas_hrms` schema — all tables from §3
3. Data source feature flags in frontend (`VITE_HRMS_*`)

### Phase B: Sub-Project 1 — Integration Hub
1. Connector adapters (Rest, DB, SFTP, File)
2. Raw payload store + Schema analyzer
3. Field mapper UI + Promotion engine
4. Schedule config + Sync log UI

### Phase C: Sub-Project 2 — Time, Attendance & WFM
1. Process-wise Roster Plan + Builder
2. Attendance session engine (biometric + manual + regularization)
3. Live break management
4. Attendance regularization workflow

### Phase D: Sub-Project 3 — Payroll Engine
1. Salary structure + components master
2. Monthly run: calculate → review → approve → lock
3. Payslip generation + download
4. Statutory deductions (PF, ESIC, PT, TDS)

### Phase E: Sub-Project 4 — Employee Journey + Intelligence
1. Employee journey timeline
2. KPI dashboard (reads from call-master-backend for quality, mas-hrms-backend for attendance/payroll)
3. Role-aware reports

### Phase F: Migration
1. Supabase → MySQL one-click migration per module
2. Frontend feature flag flip per module
3. Supabase decommission (auth stays)

---

## 12. Security Constraints (Non-Negotiable)

These were established earlier and govern all implementation:

1. **Biometric/API credentials** — never in plain database fields. Always: store `secret_name` in table, actual credential in Supabase Vault. Referenced by name at runtime, never logged.
2. **All old data migration** — staging table first, validation pass, then promotion to production. No direct production insert from external data.
3. **Payroll data** — employee bank details encrypted at rest (`AES_ENCRYPT` in MySQL or application-layer encryption before insert).
4. **Auth** — every `mas-hrms-backend` endpoint validates Supabase JWT. No endpoint is unauthenticated except `/health`.
5. **Role enforcement** — `requireRole` middleware checks MySQL `role_page_access` for every sensitive route.

---

## 13. What Is NOT In This System (Explicit Exclusions)

| System | Why excluded |
|---|---|
| LMS (classrooms, training, assessments) | Live on company domain, separate backend. HRMS connects via bridge only. |
| Call quality scoring | Owned by call-master-backend / Call Master system. HRMS reads via REST. |
| Call KPIs, coaching queue | Same — Call Master owns, HRMS displays. |
| CRM | External integration via Integration Hub connector. HRMS does not own CRM data. |
| SMS / WhatsApp gateway | Outbound notification only via Integration Hub. Not an HRMS data domain. |

---

## 14. Repos & Deployment Summary

| Repo | Purpose | Port | DB | Deploy |
|---|---|---|---|---|
| `mas-callnet-hrms` | React frontend | — | — | Vercel (auto on push to main) |
| `mas-hrms-backend` | **NEW** HRMS API | 5055 | MySQL mas_hrms | Azure Linux |
| `call-master-backend` | Call center KPI API | 5050 | MySQL Shivamgiri | Azure Linux |
| `mcn-lms` / LMS backend | Training platform | 4000 | PostgreSQL | Company domain |

---

*This spec is the single source of truth. All implementation plans for Phase 9+ derive from this document. Any deviation requires updating this spec first.*
