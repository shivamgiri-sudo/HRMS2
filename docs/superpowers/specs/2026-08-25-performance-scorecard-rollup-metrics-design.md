# Performance Scorecard — Real Attrition/Shrinkage/Revenue — Design Spec

Date: 2026-08-25
Status: Approved for planning
Follow-up to: `docs/superpowers/specs/2026-08-25-employee-performance-scorecard-design.md`

## Problem

The Employee Performance Scorecard's Attrition, Shrinkage, and Revenue columns exist in the
UI and drilldown system but are hardcoded `null` forever — `performance-scorecard-snapshot.service.ts`
never populates `teamAttritionPct`, `teamShrinkagePct`, or `teamRevenue`. A prior fix made the
frontend stop pretending these work (grayed out, non-clickable) rather than shipping fake
"—" values. This spec makes them real.

## Goals

- Populate the 3 existing columns with real values, reusing existing, already-correct services
  — no new calculation logic.
- Only for employees who actually manage a team (have direct reports) — individual
  contributors show `null` (not applicable), not a copy of their process's numbers.
- Be honest about each metric's natural grain rather than forcing a false daily precision.

## Non-goals

- The full KPI-role-template dynamic column system (10 templates, each with distinct
  role-specific metrics like "Order vs Delivery" or "Planner Achievement") — stays deferred,
  a separate, much larger follow-up if ever wanted.
- No new revenue/attrition/shrinkage calculation logic — this only wires in existing services.

## Data sources (researched against the live codebase, not guessed)

- **Shrinkage** — `backend/src/modules/rta/rta.service.ts`'s `shrinkageService.listSnapshots({fromDate, toDate, processId})`.
  Read-only, no side effects. Genuinely daily grain (`shrinkage_daily_snapshot.snapshot_date`).
  If no snapshot exists yet for that process/day (the RTA nightly cron may not have run),
  leave `null` — do not force-compute one from a snapshot-write path.
- **Attrition** — `backend/src/modules/management/management.service.ts`'s
  `getDashboardSummary(processId, employeeIds)`, called with the manager's actual direct
  report IDs (not the whole process) for closer-to-"their team" scoping. Returns a
  **rolling 30-day rate**, not a true daily figure — day-over-day snapshot rows will look
  nearly identical, and that's expected, not a bug.
- **Revenue** — `backend/src/modules/process-pnl/pnl-statement.service.ts`'s
  `getStatement({period: currentMonthYYYYMM, processId}, "process")`. Monthly P&L grain —
  there is no daily revenue-by-process service in this codebase. A "daily" value refreshed
  every day will naturally repeat the current month's figure until the next invoice posts;
  this is accepted as correct behavior (a month-to-date revenue reading), not hidden or
  restricted to month-end only.

## Manager-tier detection

Before calling any of the 3 services, check whether the employee has direct reports:
```sql
SELECT EXISTS(
  SELECT 1 FROM employees WHERE reporting_manager_id = ? OR manager_id = ?
) AS has_reports
```
(Dual-column check matches the established, already-reviewed convention from
`resolveDashboardScope`'s `resolveTeamEmployeeIds` — both columns are legitimate,
schema-backed reporting-relationship sources in this codebase.)

If `has_reports` is false: all 3 fields stay `null` (individual contributor — not applicable).
If true: derive the manager's own `process_id`/`branch_id` via
`SELECT process_id, branch_id FROM employees WHERE id = ?`, fetch their direct report IDs via
the same query used for the `has_reports` check (select `id` instead of `EXISTS`), and call
the 3 services above.

## Architecture

All logic lives inside `computeEmployeeSnapshot(employeeId, date)` in
`performance-scorecard-snapshot.service.ts` — no new files, no new tables. The existing
per-employee try/catch isolation in `writeEmployeePerformanceSnapshots` already protects
against one manager's rollup-service failure aborting the whole batch; these 3 new calls
inherit that protection for free.

## Frontend

Revert the "coming soon"/non-clickable treatment added to `TEMPLATE_COLUMNS` (Attrition,
Shrinkage, Revenue) in `performanceScorecardColumns.ts`/`PerformanceScorecardTable.tsx` back
to normal rendering — real values, clickable into the existing drilldown handlers (already
correctly scope-checked, no changes needed there). Restore `teamAttritionPct` and
`teamShrinkagePct` as selectable series in `PerformanceCompareModal.tsx`'s
`COMPARABLE_METRICS`. For a row where these are `null` (an IC), render "N/A" — distinct in
meaning from the prior "not yet built" gray state, though may reuse similar styling.

## Testing

Unit tests for the 3 new service-call branches in `computeEmployeeSnapshot`: has-reports vs
no-reports, each service returning a value vs. returning nothing (missing shrinkage snapshot
for the day, `getDashboardSummary` erroring, `getStatement` for a period with no data) —
each should degrade to `null` for that one field, not throw and abort the whole snapshot row
(consistent with the existing per-field-null defaults already in the function).
