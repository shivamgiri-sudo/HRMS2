# AON Analytics — final whole-branch review fixes

Worktree: `aon-analytics-correctness`. All five must-fix findings plus the test-design fix
applied, verified against the live database.

---

## CRITICAL 1 — drill-down tenure predicates also matched In Training

**File:** `backend/src/modules/reporting/executors/aon-drilldown.executor.ts`

**Before** (`aonBucketClause`, and the mirror `aonBucketAtExitClause`):
```ts
case "0-30": return `${AON_DAYS_SQL("e", "CURDATE()")} <= 30`;
case "31-60": return `${AON_DAYS_SQL("e", "CURDATE()")} BETWEEN 31 AND 60`;
case "61-90": return `${AON_DAYS_SQL("e", "CURDATE()")} BETWEEN 61 AND 90`;
case "90+": return `${AON_DAYS_SQL("e", "CURDATE()")} > 90`;
```
`AON_DAYS_SQL` clamps a negative DATEDIFF to 0 via `GREATEST(...,0)`. An In Training employee's
reference date (salary_start_date) is in the future, so their clamped tenure is 0, and `0 <= 30`
is true — they matched the 0-30 predicate as well as their own "In Training" predicate.

**After:**
```ts
case "0-30": return `NOT (${IN_TRAINING_SQL("e", "CURDATE()")}) AND ${AON_DAYS_SQL("e", "CURDATE()")} <= 30`;
case "31-60": return `NOT (${IN_TRAINING_SQL("e", "CURDATE()")}) AND ${AON_DAYS_SQL("e", "CURDATE()")} BETWEEN 31 AND 60`;
case "61-90": return `NOT (${IN_TRAINING_SQL("e", "CURDATE()")}) AND ${AON_DAYS_SQL("e", "CURDATE()")} BETWEEN 61 AND 90`;
case "90+": return `NOT (${IN_TRAINING_SQL("e", "CURDATE()")}) AND ${AON_DAYS_SQL("e", "CURDATE()")} > 90`;
```
Same `NOT (...)` guard applied to `aonBucketAtExitClause`, with `asOf = "e.date_of_exit"`.

**Verification (live DB, mas_hrms):** before the fix, calling the real executor for the "0-30"
bucket on the largest matching branch returned **107** rows against an aggregate cell of **95** —
exactly the 12-person In Training leak. After the fix both agree at 95. See RED/GREEN evidence
under the test-design fix section below (same run).

---

## CRITICAL 2 — drill-down still used the old population rule

**File:** same file, two sites.

**Before:**
```ts
// site 1, headcount/shrinkage branch
if (!cohortMonth) {
  clauses.push("e.active_status = 1");
}
...
// site 2, SELECT list
(e.active_status = 1) AS is_active
```

**After:**
```ts
if (!cohortMonth) {
  clauses.push(ACTIVE_EMPLOYEE_SQL("e"));
}
...
(${ACTIVE_EMPLOYEE_SQL("e")}) AS is_active
```
`ACTIVE_EMPLOYEE_SQL` imported from `../workforce-population.js` (added to the existing import
of `AON_DAYS_SQL`/`IN_TRAINING_SQL`). This is the same rule `aon.executor.ts` already uses:
`active_status = 1 AND LOWER(COALESCE(employment_status,'active')) = 'active'` — excludes the 30
stale-flag leavers (resigned/terminated, active_status never cleared) that the bare
`active_status = 1` rule let back in. It also fixes the `is_active` column that drives the
"Flag for Retention Review" button, so it is no longer offered on employees who already left.

**Verification:** existing unit test `aon-drilldown.executor.test.ts` asserted the literal
substring `(e.active_status = 1) AS is_active`; since `ACTIVE_EMPLOYEE_SQL("e")` still begins
with `e.active_status = 1 AND ...`, that specific substring assertion was updated to assert the
full `ACTIVE_EMPLOYEE_SQL("e")` fragment instead (see test-file changes below). All other
`active_status = 1`-substring assertions in that file remained true unchanged, because the new
rule's SQL text still contains that substring as its first clause.

---

## CRITICAL 3 — Cost Centre dropdown pointed at the wrong endpoint

**File:** `src/components/reports/views/AonAnalyticsView.tsx` (~line 1261)

**Before:**
```ts
"/api/finance/cost-centres?active_status=1&limit=1000"
```
That route is role-gated to super_admin/admin/finance_head/accounts_head/finance/branch_head/
branch_admin — every other AON-eligible role (hr, hr_head, payroll, wfm, manager,
process_manager, ceo) got a silent 403 (code reads `costCentres.data?.data ?? []`, swallowing
the failure). It also ignores `active_status`, caps at 100 rows ordered by `created_at DESC`.

**After:**
```ts
"/api/org/cost-centres?active_status=1&limit=1000"
```
Confirmed live in `backend/src/modules/org/org.routes.ts`: `router.use(requireAuth)` only (no
role gate beyond authentication), honours `active_status`/`limit`, caps at 500, returns
`{ data: rows }` — the exact shape the component already reads. Only the URL changed.

**Verification:** frontend test `AonAnalyticsView.filters.test.tsx` ("loads each dropdown from a
real endpoint") hard-coded the old URL as an expected substring; updated to assert the new URL
and to assert the old role-gated URL is **absent**. Full run:
```
Test Files  2 passed (2)
     Tests  7 passed (7)
```

---

## IMPORTANT 1 — RosterAnalyticsPanel.tsx still assumed four buckets

**File:** `src/pages/wfm/RosterAnalyticsPanel.tsx` (~line 365)

**Before:**
```ts
const AON_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
```
`AON_BUCKETS.map(b => head[b] ?? 0)` silently dropped "In Training" rows, so `totalHeadcount`
reconciled to neither the old (1,121) nor the corrected (1,090) figure.

**After:**
```ts
import { AON_BUCKETS } from "../../../backend/src/modules/reporting/workforce-population";
```
placed with the file's other imports, plus a comment at the removed local declaration site
naming `backend/src/modules/reporting/workforce-population.ts` as the source of truth.

**Approach taken and why:** imported rather than mirrored. This repo already has an established
precedent of frontend files importing type/constant-only modules directly from `backend/src/`
(e.g. `src/pages/dashboards/reference-dashboard-model.ts` imports
`backend/src/shared/dashboardMetricContract`; `src/lib/rbacPageMatrix.ts` re-exports
`backend/src/shared/rbacPageMatrix`). `workforce-population.ts` has zero imports of its own — it
is pure string-building functions and a constant array — so pulling it into the client bundle
carries no backend runtime dependencies. I verified the import resolves cleanly under the
frontend's own tsconfig/Vite bundler resolution (`moduleResolution: "bundler"`) with no new
`tsc` errors and no new test failures (see verification below), so the "clean import" branch of
the instructed approach applies, and a mirrored copy was not needed. The downstream `.map`/chart
rendering in the file has no hardcoded 4-bucket assumption (bars render generically off the
`bucket` field), so no further changes were needed there.

**Verification:**
```
npm run typecheck 2>&1 | grep -E "AonAnalyticsView|RosterAnalyticsPanel"
src/components/reports/views/AonAnalyticsView.tsx(942,28): error TS2322: ... (pre-existing, not ours — cohort-survival row typing)
```
No line for `RosterAnalyticsPanel.tsx` — zero new errors.

---

## IMPORTANT 2 — the COO fix was inert

**Files:** `backend/src/modules/reporting/report-catalog.ts` (fix),
`backend/src/modules/reporting/reporting.scope.ts` (already correct, checked for consistency).

**Before:**
```ts
const ROLES_ALL_MANAGEMENT = ["super_admin", "admin", "hr", "hr_head", "finance", "payroll", "wfm", "manager", "process_manager", "branch_head", "ceo"];
```
`reporting.scope.ts` grants `coo` the same org-wide `SCOPE` as `ceo` (`SUPER_ADMIN_ROLES` and
`SENSITIVE_ROLES` both already list `'coo'`), but `reportCatalogAccessMiddleware` runs *before*
scope resolution and 403s on `viewRoles` — so a COO was refused every one of the ~130
`ROLES_ALL_MANAGEMENT`-gated reports (including every AON report) before the scope grant was
ever consulted.

**After:**
```ts
const ROLES_ALL_MANAGEMENT = ["super_admin", "admin", "hr", "hr_head", "finance", "payroll", "wfm", "manager", "process_manager", "branch_head", "ceo", "coo"];
```

**Other `coo` references checked:** grepped the whole file for `coo` before the fix — there were
**zero** other occurrences (no other role list in `report-catalog.ts` mentions `ceo` without
`coo`, because no other role list in this file mentions `ceo` at all; `ROLES_ALL_MANAGEMENT` is
the only set that carried `ceo`). So this is the only site that needed the addition — nothing
else in this file plausibly needed `coo` added.

**Verification:** added `report-catalog-coo-access.contract.test.ts` (new file), asserting the
list contains both `"ceo"` and `"coo"`.
```
Test Files  1 passed (1)
     Tests  1 passed (1)
```

---

## TEST-DESIGN FIX — the harness couldn't see either Critical

**File:** `backend/src/modules/reporting/__tests__/aon-reconciliation.live.test.ts`

**Root cause:** the last test re-derived the drill-down's SQL from `ACTIVE`/`BUCKET` constants
instead of calling `aonDrilldownEmployees`, so it was asserting the executor's logic against a
copy of itself. It also always picked the single largest `(branch, bucket)` cell, which was
`90+` — the one bucket where Critical 1 (extra In Training leakage) and Critical 2 (extra
stale-flag leavers) happen not to occur, since both defects are concentrated in 0-30 and 31-60
respectively.

**Fix:** import the real executor and unrestricted scope/options fixtures (mirroring the pattern
in `aon-drilldown.executor.test.ts`), pick a live `(bucket, branch)` cell for `"In Training"` and
`"0-30"` specifically, call `aonDrilldownEmployees` for that cell, and assert `result.rowCount`
equals the aggregate's count for the same cell.

```ts
it.each(["In Training", "0-30"])(
  "a drill-down list for the \"%s\" bucket is exactly as long as the cell it came from",
  async (bucket) => {
    const cell = await cellForBucket(bucket);
    expect(cell.n, `no live data in the "${bucket}" bucket to reconcile against`).toBeGreaterThan(0);
    const filters: Record<string, unknown> = { metric: "headcount", aonBucket: bucket };
    if (cell.branchId) filters.branchId = cell.branchId;
    const result = await aonDrilldownEmployees(filters, UNRESTRICTED_SCOPE, DRILLDOWN_OPTIONS);
    expect(result.rowCount, `drill-down row count for bucket "${bucket}" diverges from the aggregate cell`)
      .toBe(cell.n);
  }
);
```

The original largest-cell test was kept alongside it (renamed "legacy coverage") rather than
deleted, since it still exercises a real reconciliation property, just not one that catches
these two regressions.

**A blocking discovery during setup:** the global test setup (`backend/tests/setup.ts`)
auto-mocks `../src/db/mysql.js` for every test file to return empty results by default (to keep
Express bootstrap from hitting a real DB in unrelated tests). Since this live test's other
assertions use their own hand-rolled `mysql.createConnection`, they never noticed this — but
calling the real `aonDrilldownEmployees` executor goes through the shared `db` pool, which was
getting the global auto-mock and silently returning zero rows for everything. Fixed by adding
`vi.unmock("../../../db/mysql.js")` at the top of this test file, so the executor hits the same
live database as the file's own `conn`.

### RED — before the Critical 1/2 fixes (with the test correctly wired to the real executor)

```
❯ src/modules/reporting/__tests__/aon-reconciliation.live.test.ts (12 tests | 1 failed) 3207ms
     × a drill-down list for the "0-30" bucket is exactly as long as the cell it came from 696ms

AssertionError: drill-down row count for bucket "0-30" diverges from the aggregate cell: expected 107 to be 95

- Expected
+ Received

- 95
+ 107

Test Files  1 failed (1)
     Tests  1 failed | 11 passed (12)
```
(The "In Training" bucket sub-case passed even pre-fix, because Critical 1's leak runs one
direction — In Training rows leaking INTO 0-30 — which doesn't change the In Training cell's own
count. The 0-30 sub-case is the one that catches it, exactly as expected: 107 received vs 95
expected is the 12-person leak described in the finding.)

Before that, on the very first attempt (before discovering the `db` auto-mock issue), the same
test went red for the wrong reason — `result.rowCount` was `0` for both buckets because the
mocked pool returned no rows at all, which was a giveaway that the executor wasn't hitting real
data yet:
```
AssertionError: ... expected +0 to be 12   // "In Training"
AssertionError: ... expected +0 to be 95   // "0-30"
```
That was resolved by the `vi.unmock` fix described above before treating the run as meaningful.

### GREEN — after the Critical 1/2 fixes

```
Test Files  1 passed (1)
     Tests  12 passed (12)
```

---

## Full suite verification

**Backend reporting suite** (`cd backend && npx vitest run src/modules/reporting`):
```
Test Files  57 passed (57)
     Tests  344 passed | 1 skipped (345)
```
(1 skip is pre-existing, unrelated to this branch.)

**Frontend reports views** (`npx vitest run src/components/reports/views/__tests__/` from repo
root):
```
Test Files  2 passed (2)
     Tests  7 passed (7)
```

**Frontend typecheck** (`npm run typecheck 2>&1 | grep -E "AonAnalyticsView|RosterAnalyticsPanel"`):
```
src/components/reports/views/AonAnalyticsView.tsx(942,28): error TS2322: Type '{ cohort: string; joined: number; left30: number; left90: number; "Survived 30d": number; "Survived 60d": number; "Survived 90d": number; }' is not assignable to type '{ cohort: string; joined: number; left30: number; } & Record<string, number>'.
```
This is the pre-existing cohort-survival row-typing error called out in the task brief — not
introduced by this work. No line for `RosterAnalyticsPanel.tsx`, confirming no new error there.

Did **not** run a full backend `npx tsc --noEmit` (per constraint — ~94 pre-existing unrelated
errors).

---

## Files changed

- `backend/src/modules/reporting/executors/aon-drilldown.executor.ts` — Critical 1 + Critical 2
- `backend/src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts` — updated
  one assertion to match the corrected `is_active` SQL fragment (Critical 2 side-effect)
- `backend/src/modules/reporting/report-catalog.ts` — Important 2
- `backend/src/modules/reporting/__tests__/report-catalog-coo-access.contract.test.ts` — new,
  regression-guards Important 2
- `backend/src/modules/reporting/__tests__/aon-reconciliation.live.test.ts` — test-design fix
- `src/components/reports/views/AonAnalyticsView.tsx` — Critical 3
- `src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx` — updated hard-coded
  URL assertion to match Critical 3
- `src/pages/wfm/RosterAnalyticsPanel.tsx` — Important 1

## Commits

1. `fix(aon): drill-down criticals — In Training leaking into tenure buckets, stale active_status rule` —
   the two drill-down executor fixes (Critical 1 + 2) plus the one dependent unit-test update,
   plus the frontend Cost Centre URL fix (Critical 3) plus its dependent frontend test update.
2. `fix(aon): COO refused every management report despite org-wide scope grant` — Important 2
   plus its new regression test.
3. `fix(wfm): Roster Analytics headcount silently dropped the In Training bucket` — Important 1.
4. `test(aon): make the reconciliation harness call the real drill-down executor` — the
   test-design fix, isolated so its RED-before/GREEN-after history stays legible on its own.
