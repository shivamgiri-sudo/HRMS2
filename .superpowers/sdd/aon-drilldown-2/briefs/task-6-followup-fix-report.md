# Task 6 Follow-up Fix Report — two real bugs from Plan 2's Task 6 review

## Status: DONE

## Files changed

- `backend/src/modules/reporting/executors/aon-drilldown.executor.ts` — Bug 1 fix
- `backend/src/modules/reporting/executors/aon.executor.ts` — Bug 2 fix
- `backend/src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts` — 2 new regression tests
- `backend/src/modules/reporting/executors/__tests__/aon.executor.test.ts` — 1 new regression test

## Bug 1 — cohort drill-down silently excluded since-left employees

`aonDrilldownEmployees`'s non-exit ("headcount") branch unconditionally pushed
`e.active_status = 1`, even when the caller passed `cohortMonth` (drilling from Cohort
Survival). Documented intent (this file's own comment, `aonCohortSurvival`'s doc comment,
and `AonAnalyticsView.tsx`'s `CohortRow`/`CohortSurvival` doc comment) is "everyone who
joined that month, INCLUDING those who have since left."

Fix: the `cohortMonth` value is now computed first in the `else` (non-exit) branch, and
`e.active_status = 1` is pushed only in the `if (!cohortMonth)` case. The `aonBucket`
clause and the `cohortMonth` filter clause are unaffected and still both apply
independently as before.

### Live verification (before/after, via tsx against live mas_hrms)

- `aonDrilldownEmployees({ metric: "headcount", cohortMonth: "2026-06" }, SCOPE, OPTIONS)`:
  - **Before fix:** `rowCount: 126` (only active employees of the 2026-06 cohort).
  - **After fix:** `rowCount: 315` (all 315 joiners of that cohort — 126 active + 189
    exited — matching the cohort's own total from a direct
    `SELECT SUM(active_status=1), SUM(active_status=0) ... GROUP BY cohort_month` query).
  - Confirmed a specific exited employee, `MAS62959` (NITISH, `active_status = 0`, cohort
    2026-06), is present in the fixed result and was absent before the fix.
- Control (Overview heatmap headcount call, `{ metric: "headcount", aonBucket: "90+" }`,
  no `cohortMonth`): `rowCount: 716` **before and after** the fix — unchanged, confirming
  this call path still filters by `active_status = 1` exactly as before.

### Test coverage added

`aon-drilldown.executor.test.ts`:
- `"does NOT filter by active_status when cohortMonth is present (drilling from Cohort
  Survival)"` — asserts the generated SQL contains no `active_status` reference at all
  when `cohortMonth` is passed.
- `"still filters by active_status = 1 for a headcount call with aonBucket and no
  cohortMonth"` — asserts the Overview-heatmap call shape is unchanged.

## Bug 2 — `aonCohortSurvival` grouped by the wrong date column

The `cohort_month` SELECT expression and its matching `GROUP BY` used raw
`DATE_FORMAT(e.date_of_joining, '%Y-%m')`, while every sibling AON query in the file and
the `cohortMonth` drill-down filter in `aon-drilldown.executor.ts` use
`AON_REFERENCE_JOIN_DATE_SQL` (`COALESCE(e.salary_start_date, e.date_of_joining)`). For any
employee whose `salary_start_date` differs from `date_of_joining`, the cohort shown on
screen (raw joining date) disagreed with what clicking that cohort actually filtered for
(COALESCE'd date).

Fix: both the `SELECT ... AS cohort_month` expression and the matching `GROUP BY` clause
now use `DATE_FORMAT(${AON_REFERENCE_JOIN_DATE_SQL}, '%Y-%m')`. The range-filter clauses
`e.date_of_joining >= ?` / `e.date_of_joining <= ?` (which correctly restrict which
employees are IN the report period based on raw joining date) were read and confirmed
untouched — those are a different, correct use of `date_of_joining` and are not part of
this bug.

### Live verification (before/after, via tsx against live mas_hrms)

- Found employee `MAS62921`: `date_of_joining = 2026-06-19`, `salary_start_date =
  2026-07-07` — confirmed directly via SQL that this employee's raw-joining-date cohort
  month is `2026-06` (the buggy grouping) and its COALESCE'd cohort month is `2026-07`
  (the correct grouping matching the drill-down filter).
- `aonCohortSurvival({ from: "2026-05-01", to: "2026-08-31" }, SCOPE, OPTIONS)`:
  - **Before fix:** cohort months present `['2026-06', '2026-07']`; `2026-06` total
    `joined` = 269, `2026-07` total `joined` = 143.
  - **After fix:** cohort months present `['2026-06', '2026-07', '2026-08']` (a new
    2026-08 cohort group appears, because some employees whose raw `date_of_joining` is in
    July now COALESCE into August); `2026-06` total `joined` = 262, `2026-07` total
    `joined` = 148 — the shift matches employees (including MAS62921) moving cohort
    months under the corrected grouping.

### Test coverage added

`aon.executor.test.ts`:
- `"cohort_month is grouped/labelled by AON_REFERENCE_JOIN_DATE_SQL, not raw
  date_of_joining"` — asserts the SELECT expression is
  `DATE_FORMAT(COALESCE(e.salary_start_date, e.date_of_joining), '%Y-%m') AS cohort_month`,
  that no bare `DATE_FORMAT(e.date_of_joining, '%Y-%m')` appears anywhere, and that the
  `GROUP BY` clause text also uses the COALESCE'd expression.
  - Note: this test uses `mockExecute.mock.calls[mockExecute.mock.calls.length - 1][0]`
    rather than the file's existing (and, on inspection, already-broken) convention of
    `mock.calls[0][0]` — this mock's call log is file-scoped with no `beforeEach` reset, so
    `calls[0]` is whichever executor ran *first in the whole file*, not necessarily the
    calling test's own invocation. The pre-existing tests happened to still pass under that
    pattern only because the assertions they check (`COALESCE(...)`, no bare
    `DATEDIFF(...,e.date_of_joining)`) are also true of `aonBucketHeadcount`'s SQL, which
    runs first in the file. Not fixed in the pre-existing tests (out of scope for this fix
    pass, and they still pass) — flagged here so it isn't mistaken for something this task
    broke.

## Test suite runs

- `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon.executor.test.ts src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts`
  → **15 passed** (12 pre-existing + 3 new), 2 test files passed.
- `cd backend && npx vitest run src/modules/reporting/`
  → **49 files passed, 305 tests passed, 1 skipped** (baseline was 49 files / 302 passed +
  1 skipped; the +3 is exactly the 3 new regression tests added here — no regressions).
- `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon\.executor|aon-drilldown"`
  → no output (clean).

## Git / commit notes (shared tree)

`git status --porcelain` before staging showed many unrelated dirty/untracked files from
other concurrent sessions (`.superpowers/sdd/*` briefs/reports/diffs from other in-flight
tasks — `rollup-metrics`, `employee-performance-scorecard`, etc.). Staged and committed
**only** the four files listed at the top of this report, by explicit path — no `git add
-A` / `.` used. Verified via `git show --stat HEAD` that only these four files are in the
commit.

Commit: see top-level report handed back to the caller for the SHA; pushed directly to
`main` per this repo's standing convention (no feature branches).
