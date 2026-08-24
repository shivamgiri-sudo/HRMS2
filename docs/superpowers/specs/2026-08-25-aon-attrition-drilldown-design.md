# AON & Attrition Analytics — Drill-Down and Deeper Analysis Design Spec

**Date:** 2026-08-25
**Author:** Claude, in collaboration with the user (design approved section-by-section)
**Page:** `/workforce/aon-analytics` (shared component `AonAnalyticsView.tsx`, also embedded as the
"AON" tab in the Reports hub)

---

## Executive Summary

The AON & Attrition Analytics page today shows three static tabs (Overview heatmap, Cohort
Survival, Attrition Deep Dive) with no click-through — every number is a dead end. This spec adds:

1. A click-to-drill-down interaction (two-panel model) reaching all the way to a named employee
   list, from any chart/table/heatmap value on any of the three tabs.
2. Proactive anomaly surfacing, benchmark/trend context on every number, in-panel driver
   breakdowns, a "Flag for Retention Review" action wired into the existing Work Inbox, a cost
   impact estimate, and an exit-reason data-quality nudge — turning the page from a report into a
   tool Ops/HR actually act on.
3. A corrected AON (Age on Network) date source — `salary_start_date` with fallback to
   `date_of_joining`, not `date_of_joining` alone — and a new, carefully-defined AON Attrition
   Rate metric.

No changes to payroll/salary calculation logic. No fabricated data — every new number is either a
real aggregate or is explicitly labeled as an estimate.

---

## 1. AON (Age on Network) — corrected date source

**Reference date for every AON calculation is now `COALESCE(employees.salary_start_date,
employees.date_of_joining)`**, not `date_of_joining` alone.

Verified live (2026-08-25, read-only): `salary_start_date` is populated on 1,554 of 58,918
employees (2.6%); of those, only 19 actually differ from `date_of_joining` (6–41 day gaps, all
recent joiners). The column's own type comment already documents it as "defaults to
date_of_joining when null" — this is the existing, established convention in this codebase
(`running-salary.service.ts` already reads it this way), not a new invented rule. Because 97.4%
of employees have no `salary_start_date`, this change is safe today (identical output to before
for all but 19 people) and correctly future-proofed as more employees get a real
`salary_start_date` set going forward.

This substitution applies everywhere the old `DATEDIFF(reference, date_of_joining)` pattern was
used:

| Metric | AON days = |
|---|---|
| Headcount (who's on roll now) | `DATEDIFF(CURDATE(), COALESCE(salary_start_date, date_of_joining))` |
| Attrition (who left) | `DATEDIFF(date_of_exit, COALESCE(salary_start_date, date_of_joining))` |
| Shrinkage (day-by-day) | `DATEDIFF(attendance_record_date, COALESCE(salary_start_date, date_of_joining))`, per day in range |

Buckets are unchanged: `0-30` / `31-60` / `61-90` / `90+`.

---

## 2. AON Attrition Rate — new metric, precise definition

A naive `exits ÷ total headcount` is wrong here because the denominator must be the population
that actually occupied that specific tenure bucket during the period — not the whole company.
Every employee passes through 0-30 → 31-60 → 61-90 exactly once, early in their tenure, then sits
in 90+ permanently.

**Per bucket × per group (branch/cost-centre/process) × per period:**

```
AON Attrition Rate = exits_in_bucket_during_period
                      ÷ AVG(at_risk_population_at_period_start, at_risk_population_at_period_end)
                      × 100
```

- `exits_in_bucket_during_period` — already computed today: exits in the period whose AON-at-exit
  (using the corrected date source above) falls in that bucket.
- `at_risk_population_at_period_start` / `..._end` — headcount, evaluated at each endpoint date,
  who were (a) already employed by that date, (b) still employed or exiting on/after that date,
  and (c) whose tenure at that date fell within the bucket's day-range. This reuses the same
  cohort-window idea the existing Cohort Survival tab already computes (joining-cohort →
  days-since-joining), applied per-period instead of per-cohort.
- Average the two endpoints, matching the average-of-endpoints approach already agreed for the
  headline rate below, just scoped to one tenure bucket.
- The `90+` bucket needs no special case — same formula, permanently larger population.

**Additionally, a separate, simpler headline "Overall Attrition Rate %" tile** (company-wide, not
bucket-scoped): `exits_in_period ÷ AVG(total_headcount_at_period_start, total_headcount_at_period_end) × 100`.
Sits above the bucketed heatmap as a single top-level number; the bucketed rate inside the heatmap
is for diagnosing *where* in the tenure curve attrition concentrates. Both use the same
average-of-endpoints formula, one company-wide and one bucket-scoped — deliberately consistent,
not two different statistical approaches on one page.

Both rates are computed server-side (added as new columns to the existing `aon-bucket-attrition`
executor query, not a new report code) and go through the existing `appendScopeConditions` so a
Branch Head only ever sees their own branch's rate.

---

## 3. Drill-down interaction — two-panel model

Rejected an N-stacked-panel model (one panel per dimension: branch → cost-centre → process →
employee list) as too cluttered. Instead:

- **Panel 1 — "Slice Detail"**: opens on any click (a heatmap cell, a chart point/line-dot, a
  table row) on any of the three tabs. Shows:
  - A **filter chip bar** representing the current drill state, e.g. `Cost Centre: Kolkata ×`
    `AON Bucket: 61-90d ×` — chips are removable (click × to pop back one level) and addable
    (click a value inside the panel's own driver-breakdown mini-charts to add another chip and
    refresh the panel in place, without opening a new panel).
  - A **benchmark/trend header**: this slice's value vs. company average and vs. last period,
    with a trend arrow (reuses the KPI-tile trend pattern already used elsewhere).
  - An **in-panel driver breakdown**: small manager/shift/tenure mini-charts computed from the
    slice's underlying employee-level data, answering "what's different about this slice" inline
    rather than in a separate tab.
  - A **cost impact line** when the slice concerns exits (see §5).
  - A **"View employees"** button.
- **Panel 2 — "Employee List"**: the only additional stacked panel, opened from Panel 1. Named
  rows matching the current chip set — `employee_code`, name, AON days/bucket, and status
  (active-with-risk-score, or exited-with-reason if captured). Each active/high-risk row carries
  a **"Flag for Retention Review"** action (see §6).

No matter how many chips are stacked, at most 2 panels are ever open at once.

Each tab supplies its own ordered list of chip-able dimensions (its "drill path"), since the three
tabs have different natural hierarchies:

| Tab | Drill path (chips available, in order) |
|---|---|
| Overview | group-by dimension (branch/cost-centre/process, whichever is currently selected) → AON bucket |
| Cohort Survival | joining cohort month → branch/cost-centre/process |
| Attrition Deep Dive | dimension value (e.g. a specific department) → AON bucket |

Every intermediate chip re-queries the *existing* report codes (`aon-bucket-headcount`,
`aon-bucket-attrition`, `aon-bucket-shrinkage`, `aon-cohort-survival`, `attrition-deep-dive`) with
one more filter param added (`costCentreId`, `processId`, `departmentId` — already supported
server-side via `ExecFilters`/`appendFilterConditions`, just never passed by the frontend until
now). Only Panel 2 (the employee list) needs a new backend query.

---

## 4. Anomaly surfacing and data-quality nudge

Two slim, collapsible, dismissible-per-item banners sit above the three tabs (not inside any one
tab, since they're page-level, cross-cutting signals):

- **Anomaly banner**: server-computed list of groups (branch/cost-centre/process) whose AON
  Attrition Rate for the current period is ≥2× the company-wide average for the same bucket.
  Threshold and multiplier are named constants, stated in the code, not hidden magic numbers.
  Each listed anomaly is a direct link that opens Panel 1 already filtered to that exact slice.
- **Data-quality nudge**: extends the existing `GapBanner` component (cost-centre coverage,
  attendance coverage, exit-reason capture rate are already shown there) with one more line:
  the exit-reason capture rate framed as an actionable to-do (e.g. "13% of exits have a captured
  reason — see [wherever reason capture happens] to close the gap"), rather than silently working
  around the gap as the page does today.

---

## 5. Cost impact estimate

Shown as one new stat tile on the Overview tab, and as one line inside Panel 1 whenever the slice
concerns exits: `exits_in_slice × average_CTC_for_that_slice × replacement_cost_multiplier`. The
multiplier is a single named, documented constant (a common HR rule-of-thumb range is 0.5–1× annual
CTC for replacement cost — exact value to be confirmed during implementation planning, sourced
from `employee_salary_assignment` for average CTC). The tile and every appearance of this number is
labeled **"(estimate)"** in the UI — this is never presented as an authoritative figure, consistent
with this codebase's existing discipline against fabricating compliance/financial numbers.

---

## 6. Flag for Retention Review — reuses existing Work Inbox

New action button (Panel 2, per employee row, and optionally per anomalous slice in Panel 1) calls
a new endpoint that calls the **existing, already-tested** `upsertOpenWorkItem()` helper
(`backend/src/shared/workItem.ts`) — the same idempotent Work Inbox writer already used by 7+
producers in this codebase (exit follow-up, AWOL detection, roster publish, etc.). No new
work-item plumbing is introduced:

- `itemType: 'RETENTION_REVIEW'`
- `entityType: 'employee'`, `entityId`: the employee's id
- `assignedToRole`: the employee's reporting manager's role if resolvable, else `branch_head`,
  else `hr` — existing row-scope on Work Inbox reads (branch/process) already ensures only the
  relevant manager/branch head sees it, without needing to extend `WorkItemInput` with a specific
  user id.
- `priority`: mapped from the employee's risk band if available (`High` → `high`, `Medium` →
  `normal`, `Low` → `low`), else `normal`.

Reusing `upsertOpenWorkItem` means flagging the same employee twice while a review is still open
is a no-op refresh, not a duplicate — this idempotency is already tested and proven for this
helper; no new de-duplication logic is needed.

---

## 7. Manager accountability — folded into existing Deep Dive selector, no new tab

Attrition Deep Dive's existing dimension selector already includes "Reporting Manager" as one of
its `DIMENSIONS` options. When that dimension is selected, the same ranked table gains:
- a **"vs peer average"** column (this manager's early-quit rate vs. the average across all
  managers with a comparable team size), and
- a flag icon per row, reusing the same Flag-for-Retention-Review action, scoped to that manager's
  team as a group rather than one employee (creates one work item per at-risk employee under that
  manager, or a single team-level review item — exact behavior to be pinned down in the
  implementation plan).

No 4th tab is added. This keeps the page at 3 tabs plus 2 top banners, matching the explicit
requirement for a clean, non-cluttered layout.

---

## 8. Top attrition drivers — reframes existing Deep Dive chart, no new view

The existing horizontal bar chart in Attrition Deep Dive (early-quit rate by dimension slice) is
reframed as **ranked by deviation from the overall average**, not raw counts — this alone answers
"what's driving attrition" without a separate correlation/drivers view. No new backend aggregation
beyond what `attritionDeepDive` already computes; the ranking/sorting is a display-layer change.

---

## 9. Backend surface — what's actually new

Everything not listed here reuses an existing report code with new filter params already supported
by `ExecFilters`/`appendFilterConditions`/`appendScopeConditions`.

1. **`aon-drilldown-employees`** (new report code/executor function) — employee-level rows for
   Panel 2. Takes `branchId`/`costCentreId`/`processId`/`aonBucket`/`metric` filters (same shape as
   existing filters). Two response shapes depending on metric context:
   - Headcount/Shrinkage context → active employees, largely reusing the existing (currently
     unwired) `attritionRiskScore` query shape (`attrition-risk.executor.ts`) filtered further by
     the drilled slice — mostly a filter addition to existing SQL, not new SQL from scratch.
   - Attrition context → exited employees (`employee_code`, name, `date_of_joining`,
     `salary_start_date`, `date_of_exit`, tenure days, AON-at-exit bucket).
2. **New columns on `aon-bucket-attrition`**: AON Attrition Rate (per bucket/group) and the
   at-risk-population figures behind it.
3. **New small aggregation for the anomaly banner**: company-wide average per bucket vs. each
   group's rate, with the ≥2× threshold check — either inside `aon-bucket-attrition` or a small
   sibling executor function.
4. **New endpoint**: `POST` to flag an employee for retention review, calling `upsertOpenWorkItem()`.
5. **Cost impact**: either computed in the same query as (2) or client-side from data already
   fetched — decided during implementation planning based on where average-CTC data is cheapest
   to join.

All new/modified queries go through the existing `appendScopeConditions()` — a Branch Head only
ever sees their own branch's slices, anomalies, and employee lists; nothing new bypasses row-level
scope.

---

## 10. Data flow, loading/error states

- Chart/table loading states use shape-matching skeletons (no bare spinner in a chart slot),
  matching the existing UX guideline already in use elsewhere in this codebase's Reports module.
- Empty and error states get dedicated components, consistent with existing Reports patterns.
- The slow `aon-bucket-shrinkage` query stays lazy-loaded only when that metric is selected
  (unchanged) — the new AON Attrition Rate rides on the cheaper `aon-bucket-attrition` query.

---

## 11. Testing

- Backend: unit tests for the new at-risk-population SQL (hand-checkable fixture periods/buckets),
  the anomaly threshold logic, and a test proving the retention-flag endpoint calls
  `upsertOpenWorkItem` with the right payload (reusing the existing test-double pattern from
  `workItem.test.ts`).
- Frontend: component tests for chip add/remove behavior in Panel 1 (re-queries with the right
  filters), and the Flag-for-Retention-Review button firing the right payload.
- No changes to payroll/salary calculation logic. Migrations are additive only (new columns/report
  code; no altered tables beyond possibly one new index for the at-risk query, to be confirmed
  during planning).

---

## What NOT changing

- The 3-tab structure stays exactly as-is; no 4th tab is added.
- No changes to `salary_start_date`/`date_of_joining` semantics elsewhere in the codebase — this
  is scoped entirely to how AON is *computed for this page's reports*.
- No backfill or fabrication of exit reasons, verification dates, or any other historical data.
- No change to `upsertOpenWorkItem`'s existing signature/behavior — only a new call site.
- No change to RBAC/page gating for this page in this pass (the existing `REPORTS_CENTER` gate
  and its `hr`/`wfm` discrepancy noted during exploration is a separate, pre-existing issue, out of
  scope here unless the user asks for it separately).

---

## Open items to pin down during implementation planning (not blocking spec approval)

- Exact replacement-cost multiplier constant for the cost-impact estimate.
- Exact anomaly threshold constant (this spec assumes ≥2× company average, stated as an example).
- Whether the manager-accountability flag action creates one work item per at-risk employee or one
  team-level review item per manager.
- Where the at-risk-population query needs a new index for acceptable performance at the existing
  120s report gateway timeout.
