# Employee Performance Scorecard — Design Spec

Date: 2026-08-25
Status: Approved for planning

## Problem

There is no single page where a reporting manager (or HR/Ops/CEO) can see an
employee's complete performance in one row — Attendance, Quality, Operations,
Latecoming, Unplanned Leave, PIP status, plus role-specific metrics
(Attrition, Shrinkage, Revenue) — filterable by date range, with drill-down
into trend and detail per metric.

The closest existing page, `src/components/my-team/TeamPerformanceTab.tsx`
(inside `MyTeamPage.tsx`), only shows KPI/quality score, calls handled, risk
level, and a coaching flag — sourced from `GET /api/management/agent-performance`,
which itself only reads `kpi_daily_actual` for a single month with no
date-range support, no attendance/latecoming/unplanned-leave fields, no PIP
visibility, and no row drill-down (violates the repo's Drill-Down Mandate).

## Goals

- One row per employee, all relevant metrics visible, filtered by date range.
- Each metric cell drills down into a trend chart + underlying records.
- A compare panel to overlay 2-4 metrics as line graphs.
- Metric columns per row are determined by the employee's KPI role template
  (10 live templates in `kpi_master_config`), not hardcoded per department.
- Usable by: Reporting Managers (own team), HR/Ops (branch/process scope),
  CEO/leadership (org-wide) — same table, RBAC-scoped differently.
- Reuse existing infrastructure: `useWorkforceAccess`, `DashboardDrilldownDrawer`,
  the KPI template system, and existing attrition/shrinkage/revenue/PIP
  services — do not recompute what already exists.

## Non-goals

- No new RBAC system — reuse `useWorkforceAccess`/`useWfmScopeFilter`.
- No changes to payroll/salary calculation logic.
- No live/real-time computation on page load — batch snapshot only (see below).
- Not replacing `NativeEmployee360.tsx`, `MyKpiDashboard.tsx`, or
  `NativePIPManagement.tsx` — this is a new rollup view, not a detail-page
  redesign. Those pages remain the deep-detail destinations if needed later.

## Architecture

One row-table component (`PerformanceScorecardTable`, replacing the guts of
`TeamPerformanceTab.tsx`) used in two places:

1. **My Team → Performance** tab — existing entry point for managers,
   `MANAGER_ROLES`-gated as today.
2. **New "Performance Command Center" page** — new route, `WorkforcePageGate`-gated,
   for HR/Ops/CEO roles, showing the same table scoped wider.

RBAC decides which employee rows are visible; the component and API are shared.

### Data flow

- A nightly scheduled worker aggregates each employee's daily metrics into a
  new snapshot table (see below). Registered in **both** `server.ts` and
  `all-workers.ts` (per known single-registration pitfall).
- The scorecard API reads the snapshot table for the requested date range —
  fast, pre-aggregated, no live joins on page load (matches the P&L batch
  pattern; avoids load on the shared 45-worker DB pool).
- Row drill-down and the compare panel query on demand only when opened.

## Data model

New table: `employee_performance_daily_snapshot`
- `employee_id`, `snapshot_date` (composite key)
- Baseline columns every role gets: `attendance_status`, `late_minutes`,
  `unplanned_leave_flag`, `pip_status` (from `pip_record`, mirrors the
  existing `isManagerOf` scoping used by `career.service.ts`)
- `role_template_id` (which `kpi_master_config` template applied that day)
- `template_metrics` JSON column — holds the role-specific metric values
  (Attrition, Shrinkage, Revenue, Quality, etc.) keyed by metric code, so the
  schema doesn't need to change as templates evolve
- Rollup metrics (Attrition/Shrinkage/Revenue) on a Process Manager/Team
  Leader's own row show **their team's rollup**, sourced from the existing
  attrition/shrinkage/revenue services (`management.service.ts`,
  `bi.service.ts`, `cost-centre-management.service.ts`, attrition modules
  under `analytics/`) — not recomputed.

Column selection per row: read the employee's assigned KPI role template
from `kpi_master_config`/`kpi_metric_master`, render the baseline columns
plus that template's declared metrics.

Backfill: one-time script populates historical snapshot rows on first deploy
so date-range queries work immediately, not just going forward.

## Drill-down

Reuse `DashboardDrilldownDrawer.tsx` unchanged (fully generic, no frontend
work needed on the drawer itself). New backend-only work per metric:

1. Register a new `dashboardCode` (e.g. `PERFORMANCE_SCORECARD`) with its
   metric codes in `DASHBOARD_METRICS`
   (`dashboard-definition.service.ts`).
2. Add a `case` + `drillXxx()` handler per metric in
   `dashboard-drilldown.service.ts` — ATTENDANCE, LATECOMING,
   UNPLANNED_LEAVE, PIP_STATUS, ATTRITION, SHRINKAGE, REVENUE, QUALITY.
   Most wrap existing services already identified — this is plumbing, not
   new business logic.
3. Clicking a metric cell opens the drawer with
   `filters: {employeeId, dateFrom, dateTo}`.

## Compare panel

New lightweight component (not the drawer). A "Compare" action opens a panel
where the user selects 2-4 metrics and sees them as overlaid line charts
over the selected date range, sourced from the snapshot table (cheap —
historical points already aggregated, no live queries).

## RBAC

- Manager: reporting-manager chain (`employees.reporting_manager_id`),
  mirrors the existing PIP `isManagerOf` guard.
- HR/Ops: `useWorkforceAccess` branch/process scope rows.
- CEO/org-wide: existing bypass role list (`super_admin, admin, hr, wfm, ceo`).
- Page gate: `WorkforcePageGate` on the new Command Center route; existing
  `MANAGER_ROLES` gate stays on the My Team tab.

## Frontend UX

- Dense data-table: sticky employee column + sticky header row, horizontal
  scroll wrapper for metric columns (count varies 4–14 by role template).
- Date-range picker + role/branch filter chips at top.
- GlassCard container, gradient header matching existing page conventions.
- Metric cells: value + tone-colored trend arrow (green/amber/red bands),
  clickable to drill down.
- PIP column: status badge (Active / At Risk / None), not a number.
- Row identity: avatar + name (Employee Profile Card pattern, #116) — no
  sensitive data (salary/PAN/Aadhaar) on the row surface.
- Mobile: card-based fallback or horizontal scroll per repo's responsive
  rules; touch targets ≥44px.

## Testing

- Backend: unit tests for the snapshot aggregation job and each new
  drilldown handler, verified against real counts per project convention
  (not assumed).
- RBAC test: a manager cannot see rows outside their reporting-manager
  chain — this mirrors a guard that was itself a prior P0 fix and must not
  regress.
- Frontend test approach to be confirmed during implementation planning.

## Open items for the implementation plan

- Exact list of `kpi_master_config` live target/weight rows (59 rows,
  applied directly to the DB, not in a checked-in SQL file) needs to be
  pulled from the live DB to finalize per-template column definitions.
- Confirm snapshot table naming/migration number with existing migration
  sequence before writing the migration.
- Confirm whether Team Leader (Paytm) / Account Manager / HR Payroll roles
  (excluded from the 10 templates due to missing data) need a fallback
  metric set or should simply get the baseline-only columns.
