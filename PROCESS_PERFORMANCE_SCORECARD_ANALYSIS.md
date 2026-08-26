# Process Performance Health Report Card — Findings & Plan

Investigation date: 2026-08-26. All counts below were read from the live `mas_hrms`
database, read-only, not inferred from code.

---

## Phase 1 — Findings

### 1. Existing KPI / process infrastructure

**`process_metric_definition` already models exactly the per-process flexibility this
page needs — and it is completely empty.**

- Columns: `process_id`, `metric_id` (canonical, FK to `kpi_metric_master`), `local_code`
  (process-local), `display_name`, `unit`, `direction`, `display_order`, `weightage`,
  `is_fatal`, `effective_from` / `effective_to`, `active_status`, `metric_scope_key`.
- **Effective-dated: confirmed.** `getProcessMetricDefinitions(processId, asOf)` filters
  `effective_from <= asOf AND (effective_to IS NULL OR effective_to >= asOf)`. The service's
  own comment explains why: renaming or retiring a parameter must not rewrite what earlier
  periods were measured against, which is the flaw `kpi_master_config` has.
- Canonical vs local is already handled: `comparableAcrossProcesses` is true only when
  `metric_id` is set, and `getComparableDefinitions()` filters to those so a process-local
  parameter cannot leak into a cross-process average.
- **Row count: 0.** No process has any definition. `COUNT(DISTINCT process_id)` = 0.

**Consequence:** the flexibility layer exists in code but has no data behind it. A page
built purely on `process_metric_definition` would render nothing for every process. This is
the single most important finding and it shapes the whole design (see Plan §A).

**Section/category grouping — needs to be added.** `kpi_metric_master.category` exists but
its enum is `('operations','quality','sales','hr','custom')`, which does not map onto the
requested sections (Headcount, Mandate, Buffer, Shrinkage, Attrition, Quality, Operations,
Hygiene, Late Comers %, P&L). Distribution: custom 70, operations 9, sales 7, quality 6,
hr 1. So the existing column is neither the right vocabulary nor usefully populated —
70 of 93 metrics are `custom`.

### 2. Which metrics actually have data — measured, metric by metric

`kpi_daily_actual` holds **69,698 rows**, `2026-05-31` → `2026-08-24`, across 3,326
employees. But **only 13 of 93 active metrics have any data at all; 80 are configured and
empty.**

| Metric | Category | Rows | Employees | Latest |
|---|---|---|---|---|
| ATTENDANCE_PCT | hr | 47,706 | 3,308 | 2026-08-24 |
| DIALS | sales | 4,877 | 300 | 2026-08-24 |
| TALK_TIME | operations | 4,877 | 300 | 2026-08-24 |
| AHT | operations | 4,579 | 274 | 2026-08-24 |
| ACW | operations | 4,578 | 274 | 2026-08-24 |
| CONVERSION_RATE | sales | 1,221 | 65 | 2026-08-24 |
| FATAL_RATE | quality | 476 | 61 | 2026-08-24 |
| QUALITY_SCORE | quality | 474 | 60 | 2026-08-24 |
| SALES_COUNT / AOV / COD_SHARE / RTO_RATE / REVENUE | sales | 182 each | 51 | **2026-07-11 (stale)** |

Two further gaps in this table that constrain the design:

- **`team_leader_id_at_event` is NULL on all 69,698 rows.** It cannot supply the
  manager→agent hierarchy.
- **`process_id_at_event` is populated on only 19,530 of 69,698 rows (28%).** Rolling a
  metric up to a process from this column alone would silently drop 72% of the data.

### 3. The real hierarchy — process → manager → agent

Not from `kpi_daily_actual`. It is on `employees`, and it is well populated:

- 1,121 active employees; **998 have `reporting_manager_id`** (78 distinct managers);
  **1,046 have `process_id`** (40 distinct processes); **997 have both** (the full chain).
- `process_master` holds 132 processes across 33 clients.
- Verified the three-level chain resolves against real rows, e.g. Godfrey Philips India Ltd
  → CHAVDA RANJANBEN → 128 agents; Bluevine Technologies → MOHD ZAID ABDUL WAHAB SHAIKH → 63.

**Design decision (recorded, not assumed):** a manager's own `process_id` frequently differs
from their agents' — 562 mismatched vs 435 matched — and at least one manager (BILAL ANWAR)
appears under two processes. So **process → managers must be derived from the agents'
`process_id`, not the manager's own.** A manager row is scoped to *their agents within that
process*, which also makes a manager legitimately appear under more than one process.

`employees` also has a separate `manager_id` column alongside `reporting_manager_id`.
`reporting_manager_id` is the populated one (998) and is what this feature uses.

### 4. RBAC and scoping

Two mechanisms exist and they disagree in reach:

- `GET /api/processes/my-processes` → `listAssignedToUser()` reads `user_assignment_scope`,
  requiring `active_status=1`, `process_id IS NOT NULL`, process active, and
  `branch_id IS NOT NULL`. Live: `user_assignment_scope` has 98 rows / 84 users, but only
  **26 carry a process, and only 20 users have an active process scope**. The repository's
  own comment says only 10 of 26 clear all three filters.
- `buildScopeWhereClause(userId, allowedRoles, aliases, options)` in
  `backend/src/shared/scopeAccess.ts` — supports `branchId`, `processId`, `lobId`,
  `departmentId`, `managerEmployeeId`, `employeeId`; short-circuits `1=1` for `super_admin`,
  optional `allowAdminBypass` / `allowCeoAllRead`, and returns `1=0` when a caller has no
  scope. Already used by `payroll-head-review`.

**Decision:** use `buildScopeWhereClause` as the server-side gate at *every* level, because
it can scope by `processId` **and** `managerEmployeeId` **and** `employeeId` — which is what
"a manager only ever sees their own scope at every drill level" actually requires.
`my-processes` is kept only to populate the process picker. `requireRole` already
short-circuits for `super_admin`, so it is never listed explicitly.

### 5. Root-cause data — what is real today

| Section | Value source | Root-cause breakdown |
|---|---|---|
| **Headcount** | `employees` (active, by process/manager) | **Yes** — by attendance status |
| **Late Comers %** | `attendance_daily_record.late_mark` / `late_by_minutes` | **Yes** — 98,699 rows Jun–Aug; 19,698 late marks among `present`, avg 34.9 min |
| **Shrinkage** | `attendance_daily_record` (absent + leave ÷ scheduled) | **Yes** — by `attendance_status` (present / absent / half_day / leave_approved / missing_punch / week_off) |
| **Attrition** | `employees.date_of_exit` — 497 exits in last 90 days | **NO.** `employees` has only `date_of_exit`, `resignation_date`, `previous_exit_date` — there is **no categorised exit-reason column**. Root-cause tab must be omitted. |
| **Quality** | `kpi_daily_actual` QUALITY_SCORE / FATAL_RATE | Thin — 60 employees only |
| **Operations** | `kpi_daily_actual` AHT / ACW / TALK_TIME / DIALS | Thin — ~300 employees |
| **P&L** | existing process P&L hooks | Out of scope to reimplement — link to existing |
| **Mandate** | **none found** | Not tracked |
| **Buffer** | **none found** | Not tracked |
| **Hygiene** | **none found** | Not tracked |

`attendance_reason_master` holds 12 categorised reasons (BIOMETRIC_MISMATCH,
DIALLER_NOT_LOGGED, LATE_ARRIVAL_VALID, SYSTEM_OUTAGE, …) but these attach to
*reconciliation issues*, not to every attendance row, so they support a root-cause tab for
reconciliation/hygiene-style metrics only — not a general one.

"Shrinkage" appears in WFM (`auto-roster-synced`) purely as a **planning input**
(`shrinkage_pct` fed into roster sizing), never as a measured actual. Measured shrinkage
therefore has to be derived from attendance, which is what this page does.

### 6. UI precedent — reuse

- `src/components/performance-scorecard/PerformanceScorecardTable.tsx` (173 lines) — closest
  pattern. Its 403 handling is the convention to copy: a 403 is an intentional role
  restriction rendered as a calm slate panel, never a red error. Visual language:
  `rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm`.
- `src/components/dashboard/DashboardDrilldownDrawer.tsx` (344 lines) — **decision: do not
  extend.** It is a Sheet wrapping a single flat table. This page's detail view needs three
  co-resident panels (trend / root cause / records) plus in-place navigation one level
  deeper without closing. Bending it would change its shape for its existing callers. A new
  component is built instead, borrowing its visual language.
- P&L: `useProcessPnl.ts` / `useBpoProcessPnl.ts` + `CeoProcessScorecard.tsx` already exist.
  The P&L section links to these rather than recomputing process P&L.
- `src/pages/NativeOperationsKPI.tsx` (733 lines) — **kept separate.** It is a
  metric-configuration and ops-KPI surface, not a per-process report card; this page links
  to it rather than superseding it.

### 7. Routing

Routes are registered per-domain under `src/config/routes/*.routes.tsx`. This page belongs
in the performance/operations domain and is gated with `ProtectedRoute roles={...}` plus
`Gate pageCode`, matching the convention used by the payroll routes.

---

## Phase 2 — Plan

### A. The central design decision

`process_metric_definition` is empty, and the requested sections do not correspond to
`kpi_daily_actual` metrics anyway (Headcount, Shrinkage, Attrition and Late Comers % all
come from `employees` / `attendance_daily_record`, not from the KPI pipeline).

So the page is built on a **section registry in code**, where each section declares how to
compute itself from a real table, and declares honestly whether it has a root-cause
breakdown. Per-process flexibility comes from **which sections actually resolve data for
that process** — a process with no QA audits shows Quality as "not tracked", distinctly
styled from a bad score.

`process_metric_definition` is read where it exists (it is the right long-term home for
per-process naming) but the page does not depend on it being populated. No migration is
added to backfill it — inventing 132 processes' worth of metric definitions would be
fabricating configuration.

**No new tables. No schema migration.** Everything resolves from `employees`,
`attendance_daily_record`, `leave_request`, `kpi_daily_actual`, `process_master` and the
existing P&L services.

### B. Sections at launch

| Section | Value | Root cause | Notes |
|---|---|---|---|
| Headcount | real | real | active employees in scope |
| Late Comers % | real | real | `late_mark` over present days |
| Shrinkage | real | real | absence ÷ scheduled, split by status |
| Attrition | real | **omitted** | no categorised exit reason exists |
| Quality | real where audited | omitted | 60 employees only; "not tracked" elsewhere |
| Operations | real where dialled | omitted | ~300 employees; AHT/ACW/Talk/Dials |
| Mandate / Buffer / Hygiene | **not tracked** | — | no data source; rendered as such |
| P&L | link | — | existing process P&L owns this |

### C. Files

**Backend (new)**
- `backend/src/modules/process-performance/process-performance.service.ts` — section
  registry + scoped queries at process / manager / agent grain.
- `backend/src/modules/process-performance/process-performance.routes.ts` — scoped
  endpoints; literal routes registered above any `:id` route.
- `backend/src/modules/process-performance/__tests__/*.contract.test.ts` — including an
  explicit cross-scope leak test.

**Frontend (new)**
- `src/pages/ProcessPerformancePage.tsx` — filter bar + table.
- `src/components/process-performance/ProcessPerformanceTable.tsx` — three-level expandable
  rows, lazy-loaded per level.
- `src/components/process-performance/KpiCellDetail.tsx` — trend / root cause / records.

**Modified**
- `src/config/routes/` — register the route.

### D. Task order

1. Backend section registry + process-grain query
2. Manager grain + agent grain (lazy, per-parent)
3. Routes with `buildScopeWhereClause` enforcement at every grain
4. Contract tests incl. cross-scope denial
5. Frontend table with three-level expansion
6. KPI cell detail (trend + root cause + records)
7. Route registration + nav
8. Regression run

---

## Phase 3 — Status

| # | Task | Status |
|---|---|---|
| 1 | Section registry + process-grain query | **Done** |
| 2 | Manager grain + agent grain, lazy per parent | **Done** |
| 3 | Routes with `buildScopeWhereClause` at every grain | **Done** |
| 4 | Contract tests incl. cross-scope denial | **Done** — 20 tests |
| 5 | Three-level expandable table | **Done** |
| 6 | KPI cell detail: trend / root cause / records | **Done** |
| 7 | Route registration | **Done** — `/performance/process-performance` |
| 8 | Regression run | **Done** — route composition 27, backend tsc, frontend build |

### Verified against live data, not mocks

The shipped aggregate was run against `mas_hrms` (read-only) at all three grains for
July 2026:

- **Process:** Onfido 220 head / 20 managers, Godfrey Philips 154 / 3, Housing.com 97 / 8.
- **Manager (inside Onfido):** DEEPANSHU BISHT 25 head, 38.74% late, 10.52% shrinkage;
  SACHIN AHUJA 19 / 57.89% / 40.91%; UDIT JAIN 17 / 1.91% / 8.16%.
- **Agent (under DEEPANSHU BISHT):** SRAJAL SHARMA (MAS59278) 29.41%, SANDHYA KUMARI
  (MAS62587) 95.83%, over 30–31 attendance days each.

### A real bug caught by looking at the output

The first run produced late-comer percentages **above 100%** (232.61% for Godfrey Philips,
138.75% for Bluevine). `late_mark` is also set on `absent`, `half_day` and `missing_punch`
rows, so counting every late mark over *present* days alone is not a percentage of anything.
Numerator and denominator now agree — `SUM(attendance_status='present' AND late_mark=1)` —
and the values fall in range (Onfido 36.39%, Housing.com 59.98%). A contract test pins the
corrected expression.

### Deviations from the plan, and why

- **Page gate is `OPERATIONS_DASHBOARD`, not `PROCESS_MANAGER_DASHBOARD`.** The obvious code
  carries only 3 role grants (accounts_head / super_admin / tq_head) and would have blocked
  process managers from their own report card. `OPERATIONS_DASHBOARD` already grants the 11
  roles this page is for. The route's `roles={...}`, the backend `VIEWER_ROLES` and the page
  grant are kept identical so no role passes one gate and is refused by another.
- **No migration was written.** The plan anticipated possibly adding a `section` column or a
  manager→agent mapping. Neither is needed: the hierarchy is already on `employees`
  (`process_id` + `reporting_manager_id`, 997/1,121 complete) and sections live in code.
  Adding a column nothing reads would have been churn.

### Known limits, stated rather than hidden

- **Quality and Operations are thin.** QUALITY_SCORE covers 60 employees and AHT ~274, out
  of 1,121 active. Most process rows will legitimately show "no data" for these — that is
  the true state of the pipeline, not a rendering fault.
- **Attrition has no root cause and cannot get one** until an exit-reason column exists.
- **Mandate / Buffer / Hygiene render "not tracked"** in every row. They stay in the layout
  so the gap is visible and the columns are ready the day a source appears.
- **The P&L cell links out** rather than recomputing; process P&L already has an owner.
- **Not browser-verified.** The queries were exercised against the live database and the
  build and tests pass, but the page has not been opened in a browser against a logged-in
  session.
