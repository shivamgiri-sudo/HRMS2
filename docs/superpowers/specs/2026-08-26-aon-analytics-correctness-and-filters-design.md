# AON Analytics — Correctness, Filters, RBAC and Drill-Down Validation

**Date:** 2026-08-26
**Page:** `/workforce/aon-analytics`
**Scope:** Workstreams A (correctness defects) + C (filters and recursive drill-down validation)
**Explicitly out of scope:** Workstream B (shrinkage timeout), Workstream D (new insights)

## Problem

The AON Analytics page is not trusted, for four reasons that were each confirmed against the
live database on 2026-08-26.

### 1. Headcount counts people who have left

`aon.executor.ts` defines an active employee as `active_status = 1` alone. Live:

| Definition | Count |
| --- | --- |
| AON page (`active_status = 1`) | **1,121** |
| Every other page (`active_status = 1 AND employment_status = 'active'`) | **1,091** |
| Difference | 24 `resigned` + 6 `terminated` |

All 30 carry a `date_of_exit` between 2026-06-30 and 2026-07-10. The inverse case —
`employment_status = 'active'` with `active_status <> 1` — returns **zero rows**. So
`active_status` is the stale flag and `employment_status` is correct.

The rehire hypothesis was tested and rejected: only 8 of the 30 have any attendance after their
exit date, all 5–11 days after, and every one last worked 2026-07-15 — six weeks before this
audit. None has a `date_of_joining` later than their `date_of_exit`. They left; the flag was
never cleared.

### 2. Thirteen employees have negative AON

The bucket test is `DATEDIFF(...) <= 30 THEN '0-30'`. A **negative** DATEDIFF satisfies `<= 30`,
so employees whose AON reference date is in the future are silently counted as the newest
joiners. Live: 13 active employees have a `salary_start_date` after today, e.g. `MAS63430`
joined 2026-08-25 with salary starting 2026-09-01 (AON = −6).

This is not a data error. 1,063 of 1,091 active employees have `salary_start_date =
date_of_joining`; 28 have a later salary date, most commonly by exactly 6 days; **none** has a
salary date before joining. The gap is a training week — the employee has joined and is on the
floor but is not yet on payroll.

### 3. Filters are partly decorative

- The From/To date pickers are not passed to `aon-bucket-headcount`, the default metric. The
  user changes the dates and nothing happens.
- `appendFilterConditions` already supports `branchId`, `processId`, `departmentId`,
  `costCentreId` and `managerId`. The page exposes **Branch only**. Four working filter
  dimensions are built and unreachable.

### 4. COO cannot see the organisation

`reporting.scope.ts` sets `SUPER_ADMIN_ROLES = ['super_admin', 'admin', 'ceo']`. A COO would be
restricted to their own branch. The file is internally inconsistent: `SENSITIVE_ROLES` in the
same function does include `coo`. No `coo` users exist yet, so the defect is latent — it appears
the day the role is first granted.

## Approach

Three options were considered.

1. **Patch the AON executor in place.** Smallest diff. Rejected because the population rule stays
   copy-pasted per executor, so the 1,121-vs-1,091 divergence can reappear in the next report.
2. **Extract a shared workforce-population module and adopt it in AON now.** Chosen.
3. **Fix the data, not the code** — clear the 30 stale flags. Rejected: the executor stays
   vulnerable to the next stale flag, and it addresses neither In Training nor the filters.

The page disagreeing with the rest of the system by 30 people is not an AON bug. It is what
happens when every executor spells out its own population rule. Fixing it once, with a test,
is barely more work and stops the next report inheriting it.

## Design

### Shared population module

New file `backend/src/modules/reporting/workforce-population.ts`. It exports SQL fragments, not
query builders, so executors keep control of their own joins.

| Export | Definition |
| --- | --- |
| `ACTIVE_EMPLOYEE_SQL(alias)` | `alias.active_status = 1 AND LOWER(COALESCE(alias.employment_status,'active')) = 'active'` |
| `IN_TRAINING_SQL(alias, asOf)` | `alias.date_of_joining <= asOf AND alias.salary_start_date > asOf` |
| `AON_BUCKET_SQL(alias, asOf)` | `'In Training'` when `IN_TRAINING_SQL` holds, otherwise the existing four buckets over `COALESCE(salary_start_date, date_of_joining)` |
| `AON_BUCKET_ORDER_SQL(alias, asOf)` | `In Training` = 0, then 1–4, so buckets sort in tenure order |

`LOWER()` is mandatory, not stylistic: reactivation writes `employment_status = 'Active'` with a
capital A, and the column already holds `'Active'` 273 against `'active'` 1,039.

**The bucket list becomes five: `In Training`, `0-30`, `31-60`, `61-90`, `90+`.**

Negative AON becomes structurally impossible, by two independent mechanisms:

1. A joined-but-unpaid employee is In Training by definition rather than `<= 30` by accident.
2. The four tenure buckets wrap their DATEDIFF in `GREATEST(..., 0)`.

The second guard exists because the first does not cover everything. `IN_TRAINING_SQL` requires
`date_of_joining <= asOf`, so an employee who has not yet joined — pre-boarded with a future
joining date — would fall through to the tenure branch and produce a negative AON again. Live
today that population is zero (0 active employees have a future `date_of_joining`), so this is
latent rather than a present defect, but the clamp costs nothing and closes it permanently. A
not-yet-joined employee then reads as day 0, i.e. `0-30`, which is the correct answer for
someone whose first day has not arrived.

### Rehire safety

The design must survive reactivation, which already exists end to end
(`employee-reactivation.routes.ts`, `/employees/reactivation`, 30-day rule, branch-head then HR
approval) but has never been used — `employee_reactivation_request` holds 0 rows.

On approval it sets `employment_status = 'Active'`, `active_status = 1`, `date_of_exit = NULL`
and a new `date_of_joining`. Under this design a rehired employee therefore re-enters as In
Training or 0-30 under their original employee code, with AON restarting from the new joining
date. That is correct behaviour and needs no special case.

Note that `date_of_exit IS NULL` alone must **not** be used as an active test: 28,426 inactive
employees carry no exit date at all and would all be counted as active.

### RBAC

1. Add `coo` to `SUPER_ADMIN_ROLES` in `reporting.scope.ts`. This is the only change required —
   `appendScopeConditions` already enforces scope inside the SQL, so COO gains org-wide access to
   every report immediately, not only this page.
2. Branch scoping is already correct and is left alone: restricted to the user's scope-row branch
   IDs, falling back to their own `branch_id`, failing closed on a sentinel when neither exists.
   This path is live — 5 `branch_admin` users and 20 branch scope rows.
3. A contract test pins the role list and proves a branch-scoped user's query carries a
   `branch_id IN (...)` clause rather than running unfiltered.

Accepted consequence: granting `coo` org-wide affects all reports, not just AON. This is
intended.

### Filters

The filter bar goes from one dimension to four, plus dates: From · To · Branch · Process ·
Department · Cost Centre. All four are already supported server-side; this is UI wiring only.

Dropdown sources, all existing endpoints:

- `/api/org/branches`
- `/api/org/processes`
- `/api/org/departments`
- `/api/finance/cost-centres`

`managerId` is deliberately **not** exposed. There is no manager list endpoint, and the Deep Dive
tab already slices by manager as a dimension, which is the more useful shape — rank every manager
by early attrition, then drill in. A dropdown would be a second, worse way to do the same thing.

The From/To inputs are **disabled with an explanatory note when the metric is Headcount**, which
is an as-of-today snapshot. The current behaviour — accepting the input and ignoring it — is
indistinguishable from a bug.

Every filter participates in the react-query `queryKey`, so changing one refetches rather than
serving a stale cell.

### Drill-down validation harness

An integration suite asserting invariants rather than fixed numbers, so it survives data change.

**Level reconciliation**

- Σ(all group rows) = the headline total
- Σ(the five buckets within a group) = that group's total
- `count(drill-down employee rows)` = the exact aggregate cell that was clicked

**Filter efficacy** — for each of the five filters, using a value known to exist:

- result with the filter is a subset of the result without it
- result is **strictly smaller** — this is what catches a filter that is accepted and ignored,
  which is precisely the headcount/date defect
- the same filter applied at group level and at drill-down level yields consistent counts

**Population agreement**

- AON page total equals `active_status = 1 AND LOWER(employment_status) = 'active'`, and equals
  the number the Employee Directory reports
- no employee appears in two buckets
- no negative AON anywhere

These run against the live database read-only. The defects found in this audit are data-shaped;
a suite built on fixtures would have passed through every one of them.

## Testing

- Contract tests on `workforce-population.ts`, the RBAC role list, and the five-bucket logic
  including In Training
- The reconciliation harness above
- Every fix proven by reversion: the test must fail with the fix removed
- One commit per concern — population, RBAC, filters, harness — so any can be reverted alone

## Risks

| Risk | Mitigation |
| --- | --- |
| Headcount visibly drops 1,121 → 1,091 | Expected and correct; call it out in the commit and to users. The 30 are people who left in Jun/Jul |
| Adding a fifth bucket breaks callers that assume four | Grep every consumer of the bucket labels before changing; the drill-down and export paths both read them |
| `coo` org-wide affects all reports | Intended and explicitly approved |
| Live-data harness is brittle if data shifts | Assert invariants (sums reconcile, filters narrow), never fixed counts |
| Shared module invites a big-bang migration | AON executors adopt it now; the other ~130 reports keep their own rules until touched |

## Out of scope

- **Shrinkage tab 504** — it scans 12 months of `attendance_daily_record` (141,677 rows) and
  reliably exceeds the 120s gateway limit. Needs pre-aggregation; its own spec.
- **The 13 depth insights** — separate workstream, each with its own query and design.
- **Exit reasons** — cannot be built at all. `exit_interview_response` and `attrition_record` are
  empty, `exit_request` holds 4 rows, and `legacy_history_snapshot` yields a reason for 10 of
  2,796 recent exits. This is a capture problem, not a reporting one.
