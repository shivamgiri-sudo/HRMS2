# KPI Live Performance (P4) - employee and team performance per process

Date: 2026-10-01. Builds on the KPI Catalogue (2026-10-01-kpi-catalogue-design.md). Approved by the owner ("build next phase").

## Goal
One page, `/kpi/performance`, that shows real KPI values for a process, for the caller's role and scope: today / week-to-date /
month-to-date / last 30 days, trends by day, and breakdowns by employee, team, branch. Every KPI shown comes from the catalogue;
a KPI with no data feed says so and states its source and freshness instead of showing 0.

## Data (real, existing)
- `kpi_daily_actual` (per employee per day) joined to `kpi_metric_master` by `metric_code` - used for every catalogue KPI that
  names a `metric_code` and is employee-level.
- Direct computations from `attendance_daily_record`: `wf_login_hours` (dialler_minutes) and `wf_late_login_pct` (late_mark).
- `process_metric_actual` (process grain) for catalogue KPIs without an employee grain, matched on `metric_key`.
- Targets: average of `kpi_employee_resolved.target_value` over the employees in view, else the catalogue `default_target`.

## Rules
- Scope: `resolveDashboardScope` + `buildScopeWhereEmployees`; self-only roles see themselves, team leaders their team, branch roles their
  branch(es); org-wide roles see all. Employees are further limited to the process's `process_master` ids.
- Aggregation per metric follows `kpi_metric_master.aggregation_method` (average default; sum for volume metrics).
- Attainment: higher-is-better = actual / target x 100 capped at 120; lower-is-better = target / actual x 100 (actual 0 -> 100). No target
  -> no attainment and no rating. Rating from the one S/A/B/C/D scale.
- Availability per KPI: `ok`, `no_data` (feed mapped, no rows in window), `not_tracked` (no feed). `last_data_date` and staleness shown.
- Window max 93 days; breakdown rows capped at 200.

## API
`GET /api/kpi-catalogue/performance/:processKey?period=today|yesterday|wtd|mtd|last30|custom&from=&to=&groupBy=employee|team|branch&role=&employeeId=`
Returns window, viewer scope, headcount, per-KPI value / target / attainment / rating / series / breakdown / availability, and a summary.

## UI
Process picker, period toggle, role view (viewers only), KPI cards with trend sparkline and freshness badge, breakdown table
(employee / team / branch), auto-refresh every 60 s. Page code `KPI_PERFORMANCE` (granted to all employees; data scope is server-side).

## Out of scope
Per-client upload tables with no `metric_code` (their KPIs are listed as not_tracked with source) - wiring each into the daily sync is a
separate data-feed task; dialer live reads per project.
