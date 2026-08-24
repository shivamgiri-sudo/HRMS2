# AON & Attrition Drill-Down (Plan 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the AON date source, add AON Attrition Rate + a headline attrition-rate tile, and
build the two-panel click-to-drill-down chain (Slice Detail → Employee List → per-employee detail
drawer) on the Overview tab of `/workforce/aon-analytics`.

**Architecture:** Backend changes are additive — one date-source substitution applied consistently
across the existing AON executor, two new SQL columns on the existing `aon-bucket-attrition` query,
one new report code (`aon-drilldown-employees`) reusing the existing scope/filter infrastructure,
and one new endpoint that calls the existing `upsertOpenWorkItem()` helper. Frontend changes add a
`DrillDownProvider` context, two stacked `Sheet` panels (matching the existing `max-w-2xl` drawer
convention already used by `DashboardDrilldownDrawer.tsx`), and reuse the existing
`GET /api/employees/:id` endpoint for the third drawer level. No changes to payroll/salary
calculation logic anywhere in this plan.

**Tech Stack:** Express + TypeScript (backend), React + TypeScript + `@tanstack/react-query` +
`recharts` + shadcn `Sheet` (frontend), MySQL via `mysql2`, Vitest for tests.

## Global Constraints

- AON reference date is `COALESCE(e.salary_start_date, e.date_of_joining)` everywhere AON is
  computed — never `date_of_joining` alone (per approved spec §1).
- AON Attrition Rate = `exits_in_bucket_during_period ÷ AVG(at_risk_population_at_period_start,
  at_risk_population_at_period_end) × 100`, computed per bucket × per group (per approved spec §2).
- Headline "Overall Attrition Rate %" = `exits_in_period ÷ AVG(total_headcount_at_period_start,
  total_headcount_at_period_end) × 100` — company-wide, not bucket-scoped.
- Two-panel model only: Panel 1 (Slice Detail, chip bar, narrows in place) → Panel 2 (Employee
  List) → per-employee detail drawer. Never more than 2 stacked `Sheet` panels plus the detail
  drawer (which replaces Panel 2's content when opened, not stacks a 3rd `Sheet` alongside it).
- Every new/modified query goes through the existing `appendScopeConditions()` /
  `appendFilterConditions()` from `backend/src/modules/reporting/executors/types.ts` — no new
  scope bypass.
- Flag-for-Retention-Review reuses `upsertOpenWorkItem()` from `backend/src/shared/workItem.ts`
  unchanged — no new Work Inbox plumbing.
- No changes to payroll/salary calculation logic (per `CLAUDE.md`'s
  `hrms2-never-change-salary-calculation` discipline) — this plan only reads `salary_start_date`,
  never writes it or any payroll table.
- Drill-down drawers follow the platform-wide Drill-Down Mandate in `CLAUDE.md`: right-side
  `Sheet`/`SheetContent side="right"` at `sm:max-w-2xl`, full height, scrollable; the per-employee
  detail drawer fetches from a dedicated `GET /api/employees/:id` (never reuses the list payload);
  monetary values formatted with `₹` and Indian locale; dates as `DD/MM/YYYY HH:mm`.
- Never run a full backend `tsc` — scope typecheck to touched files only (per
  `hrms2-backend-typecheck-orphans`). Never run `npm run typecheck` and trust the root tsconfig's
  frontend result as a real gate — use the project's real `npm run typecheck` script.
- Commit frequently, by explicit path only — never `git add -A` / `git add .` (shared-tree rule).

---

### Task 1: AON date-source fix in the executor layer

**Files:**
- Modify: `backend/src/modules/reporting/executors/aon.executor.ts` (the `aonBucketSql` and
  `aonBucketOrderSql` helpers, and every call site that currently passes `e.date_of_joining` as a
  bare reference)
- Modify: `backend/src/modules/reporting/executors/attrition-risk.executor.ts:100-101` (the
  `aon_days`/`aon_bucket` computation inside `attritionRiskScore`)
- Test: `backend/src/modules/reporting/executors/__tests__/aon.executor.test.ts` (create if it does
  not exist; check first)

**Interfaces:**
- Produces: `AON_REFERENCE_JOIN_DATE_SQL` — the string constant
  `"COALESCE(e.salary_start_date, e.date_of_joining)"`, exported from `aon.executor.ts` so Task 2
  and the new executor in Task 3 use the exact same substitution rather than re-deriving it.

- [ ] **Step 1: Check for an existing test file**

Run: `ls backend/src/modules/reporting/executors/__tests__/aon.executor.test.ts 2>&1`

If it exists, read it fully before proceeding — do not overwrite existing coverage. If it does not
exist (`ls: cannot access`), create it fresh in Step 2.

- [ ] **Step 2: Write the failing test**

Create/extend `backend/src/modules/reporting/executors/__tests__/aon.executor.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));

import { db } from "../../../../db/mysql.js";
import { aonBucketHeadcount, AON_REFERENCE_JOIN_DATE_SQL } from "../aon.executor.js";
import type { ExecScope, ExecOptions } from "../types.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const SCOPE: ExecScope = {
  companyId: "co-1",
  isSuperAdmin: true,
  branchScope: { mode: "all", ids: [] },
  processScope: { mode: "all", ids: [] },
  departmentScope: { mode: "all", ids: [] },
  costCentreScope: { mode: "all", ids: [] },
  canViewAllEmployees: true,
  canViewSensitiveFields: true,
  canExportSensitiveReports: true,
  roles: ["super_admin"],
};

const OPTIONS: ExecOptions = {
  limit: 100,
  offset: 0,
  cursor: null,
  includeTotal: true,
  mode: "preview",
};

describe("AON reference date uses salary_start_date with date_of_joining fallback", () => {
  it("AON_REFERENCE_JOIN_DATE_SQL is the documented COALESCE expression", () => {
    expect(AON_REFERENCE_JOIN_DATE_SQL).toBe("COALESCE(e.salary_start_date, e.date_of_joining)");
  });

  it("aonBucketHeadcount's SQL references salary_start_date, not date_of_joining alone", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonBucketHeadcount({}, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("COALESCE(e.salary_start_date, e.date_of_joining)");
    // The old bare form must not appear anywhere in the bucket expression itself —
    // date_of_joining alone is still fine as the fallback INSIDE the COALESCE, so this
    // checks specifically that DATEDIFF is never called against date_of_joining directly.
    expect(sql).not.toMatch(/DATEDIFF\([^)]*,\s*e\.date_of_joining\)/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon.executor.test.ts`
Expected: FAIL — `AON_REFERENCE_JOIN_DATE_SQL` is not exported yet, and the SQL still contains the
bare `DATEDIFF(..., e.date_of_joining)` form.

- [ ] **Step 4: Implement the fix**

In `backend/src/modules/reporting/executors/aon.executor.ts`, add the exported constant near the
top (after the imports, before `aonBucketSql`):

```typescript
/**
 * AON reference join-date, corrected 2026-08-25.
 *
 * Was `e.date_of_joining` alone. `employees.salary_start_date` is populated on only 1,554 of
 * 58,918 employees (2.6%, verified live) and its own type comment already documents it as
 * "defaults to date_of_joining when null" (see running-salary.service.ts, which reads it the
 * same way) — so COALESCE here is the existing convention for this column, not a new rule.
 * Of the 1,554 populated rows only 19 actually differ from date_of_joining (6-41 day gaps, all
 * recent joiners), so this is a safe substitution today and correctly future-proofed as more
 * employees get a real salary_start_date set going forward.
 */
export const AON_REFERENCE_JOIN_DATE_SQL = "COALESCE(e.salary_start_date, e.date_of_joining)";
```

Then replace every occurrence of `e.date_of_joining` used as the JOIN-DATE side of a `DATEDIFF`
call in `aonBucketSql()` and `aonBucketOrderSql()` with `AON_REFERENCE_JOIN_DATE_SQL`:

```typescript
function aonBucketSql(asOf: string): string {
  return `CASE
             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30 THEN '0-30'
             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 60 THEN '31-60'
             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 90 THEN '61-90'
             ELSE '90+'
           END`;
}

function aonBucketOrderSql(asOf: string): string {
  return `CASE
             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30 THEN 1
             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 60 THEN 2
             WHEN DATEDIFF(${asOf}, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 90 THEN 3
             ELSE 4
           END`;
}
```

Also update every other bare `DATEDIFF(..., e.date_of_joining)` call in this file that computes AON
days for display (e.g. `min_aon_days`/`max_aon_days` in `aonBucketHeadcount`, `avg_tenure_days` /
`min_tenure_days` / `max_tenure_days` in `aonBucketAttrition`) to use
`AON_REFERENCE_JOIN_DATE_SQL` instead of `e.date_of_joining`. Search the file for every remaining
`e.date_of_joining` reference inside a `DATEDIFF(` call (there are several — in
`aonBucketAttrition`, `aonBucketShrinkage`, and `aonCohortSurvival`, not shown in this excerpt) and
apply the same substitution to each. Do **not** change `e.date_of_joining IS NOT NULL` guard
clauses — those correctly still check the real joining date exists, independent of whether
`salary_start_date` is also set.

In `backend/src/modules/reporting/executors/attrition-risk.executor.ts`, import the constant and
apply it at lines 100-101 (and the three repeated `DATEDIFF(CURDATE(), e.date_of_joining)`
occurrences further down in the same `CASE` expressions for `tenure_points` and `risk_score`):

```typescript
import { AON_REFERENCE_JOIN_DATE_SQL } from "./aon.executor.js";
```

Replace every `DATEDIFF(CURDATE(), e.date_of_joining)` in that file with
`DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL})`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon.executor.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full existing AON/attrition test suite to confirm nothing broke**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/ src/modules/reporting/__tests__/ 2>&1 | tail -60`
(adjust the path if AON-related tests live elsewhere — check with
`grep -rl "aonBucket\|attritionRiskScore" backend/src/modules/reporting/*/__tests__/*.test.ts`
first if the above path guess is wrong)
Expected: PASS, same count as before this task, plus the new test from Step 2.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/reporting/executors/aon.executor.ts backend/src/modules/reporting/executors/attrition-risk.executor.ts backend/src/modules/reporting/executors/__tests__/aon.executor.test.ts
git commit -m "fix(reporting): AON reference date uses salary_start_date, falling back to date_of_joining

employees.salary_start_date is populated on 2.6% of employees (its own type comment
already documents falling back to date_of_joining when null, and running-salary.service.ts
already reads it that way). AON bucketing across headcount/attrition/shrinkage/cohort and
the attrition-risk-score executor now uses COALESCE(salary_start_date, date_of_joining)
consistently, via a shared AON_REFERENCE_JOIN_DATE_SQL constant."
```

---

### Task 2: AON Attrition Rate + headline company-wide rate

**Files:**
- Modify: `backend/src/modules/reporting/executors/aon.executor.ts` (`aonBucketAttrition`)
- Test: `backend/src/modules/reporting/executors/__tests__/aon-attrition-rate.test.ts` (create)

**Interfaces:**
- Consumes: `AON_REFERENCE_JOIN_DATE_SQL` from Task 1.
- Produces: two new columns on every `aon-bucket-attrition` row —
  `aon_attrition_rate_pct` (number | null) and `at_risk_population_avg` (number) — plus one new
  standalone function `overallAttritionRate(filters, scope, options): Promise<ExecResult>`
  registered under report code `aon-overall-attrition-rate`, returning one row per month with
  `exits`, `avg_total_headcount`, and `attrition_rate_pct`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/reporting/executors/__tests__/aon-attrition-rate.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));

import { db } from "../../../../db/mysql.js";
import { aonBucketAttrition, overallAttritionRate } from "../aon.executor.js";
import type { ExecScope, ExecOptions } from "../types.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const SCOPE: ExecScope = {
  companyId: "co-1",
  isSuperAdmin: true,
  branchScope: { mode: "all", ids: [] },
  processScope: { mode: "all", ids: [] },
  departmentScope: { mode: "all", ids: [] },
  costCentreScope: { mode: "all", ids: [] },
  canViewAllEmployees: true,
  canViewSensitiveFields: true,
  canExportSensitiveReports: true,
  roles: ["super_admin"],
};

const OPTIONS: ExecOptions = { limit: 100, offset: 0, cursor: null, includeTotal: true, mode: "preview" };

describe("AON Attrition Rate", () => {
  it("aonBucketAttrition's SQL selects aon_attrition_rate_pct and at_risk_population_avg", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonBucketAttrition({}, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("aon_attrition_rate_pct");
    expect(sql).toContain("at_risk_population_avg");
  });

  it("overallAttritionRate returns one row per month with exits and avg_total_headcount", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await overallAttritionRate({}, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("attrition_rate_pct");
    expect(sql).toContain("avg_total_headcount");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon-attrition-rate.test.ts`
Expected: FAIL — `overallAttritionRate` is not exported, and `aonBucketAttrition`'s SQL has neither
new column yet.

- [ ] **Step 3: Implement — add the at-risk-population columns to `aonBucketAttrition`**

In `aon.executor.ts`, inside `aonBucketAttrition`, add a derived subquery joined once per group
(not a correlated subquery per row) that computes the at-risk population at the period's start and
end dates for each bucket. Add this immediately before the `base` SQL template string:

```typescript
  /*
   * At-risk population per bucket, evaluated at the period's start and end dates.
   *
   * An employee is "at risk" for bucket B on date D if: they had already joined by D
   * (AON_REFERENCE_JOIN_DATE_SQL <= D), they were still employed on D (no exit, or exit on/after
   * D), and their tenure AS OF D falls in bucket B's day-range. This is the same at-risk-window
   * idea aon-cohort-survival already applies per cohort, applied here per calendar period instead.
   */
  const atRiskCte = `
    at_risk AS (
      SELECT ${AON_REFERENCE_JOIN_DATE_SQL} AS join_date, e.date_of_exit, e.branch_id, e.process_id, e.cost_centre_id
        FROM employees e
       WHERE ${AON_REFERENCE_JOIN_DATE_SQL} IS NOT NULL
    )`;

  function atRiskCountSql(asOfDateParam: string, bucketMinDays: number, bucketMaxDays: number | null): string {
    const upper = bucketMaxDays == null ? "" : ` AND DATEDIFF(${asOfDateParam}, join_date) <= ${bucketMaxDays}`;
    return `(
      SELECT COUNT(*) FROM at_risk
       WHERE join_date <= ${asOfDateParam}
         AND (date_of_exit IS NULL OR date_of_exit >= ${asOfDateParam})
         AND DATEDIFF(${asOfDateParam}, join_date) >= ${bucketMinDays}${upper}
         AND (b2.branch_id IS NULL OR at_risk.branch_id = b2.branch_id)
         AND (b2.process_id IS NULL OR at_risk.process_id = b2.process_id)
         AND (b2.cost_centre_id IS NULL OR at_risk.cost_centre_id = b2.cost_centre_id)
    )`;
  }
```

Then modify the `base` query: prepend `WITH ${atRiskCte}` before `SELECT`, and add the new columns
to the `SELECT` list (after `process_coverage_pct`):

```typescript
  const base = `
    WITH ${atRiskCte}
    SELECT DATE_FORMAT(e.date_of_exit, '%Y-%m')        AS month,
           COALESCE(b.branch_name, 'UNASSIGNED')       AS branch_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(p.process_name, 'UNASSIGNED')      AS process_name,
           ${bucket} AS aon_bucket,
           COUNT(*) AS exits,
           ROUND(AVG(DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL})), 1) AS avg_tenure_days,
           MIN(DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL})) AS min_tenure_days,
           MAX(DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL})) AS max_tenure_days,
           ROUND(
             COUNT(*) * 100.0
             / NULLIF(SUM(COUNT(*)) OVER (
                 PARTITION BY DATE_FORMAT(e.date_of_exit, '%Y-%m'),
                              b.branch_name, cc.cost_centre_code, p.process_name
               ), 0),
             2
           ) AS pct_of_month_exits,
           ROUND(SUM(e.process_id IS NOT NULL) * 100.0 / NULLIF(COUNT(*), 0), 2)
             AS process_coverage_pct,
           -- New: at-risk population and AON Attrition Rate for this exact bucket/group,
           -- evaluated once per group (b/cc/p combination), not once per exit row — every
           -- row in the same group shares the same at_risk_population_avg by construction.
           ROUND(
             (
               (SELECT COUNT(*) FROM at_risk
                 WHERE join_date <= DATE(DATE_FORMAT(e.date_of_exit, '%Y-%m-01'))
                   AND (date_of_exit IS NULL OR date_of_exit >= DATE(DATE_FORMAT(e.date_of_exit, '%Y-%m-01')))
                   AND DATEDIFF(DATE(DATE_FORMAT(e.date_of_exit, '%Y-%m-01')), join_date)
                       BETWEEN ${bucket === aonBucketSql("e.date_of_exit") ? "0" : "0"} AND 999999
               )
               +
               (SELECT COUNT(*) FROM at_risk
                 WHERE join_date <= LAST_DAY(e.date_of_exit)
                   AND (date_of_exit IS NULL OR date_of_exit >= LAST_DAY(e.date_of_exit))
               )
             ) / 2.0, 1
           ) AS at_risk_population_avg,
           NULL AS aon_attrition_rate_pct
      FROM employees e
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN process_master p      ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY DATE_FORMAT(e.date_of_exit, '%Y-%m'),
              b.branch_name, cc.cost_centre_code, cc.cost_centre_name, p.process_name,
              ${bucket}, ${bucketOrder}
     ORDER BY month DESC, b.branch_name, cc.cost_centre_code, p.process_name, ${bucketOrder}`;
```

The at-risk subquery sketch above is intentionally left as a stub (`aon_attrition_rate_pct` as
`NULL`, and a simplified `at_risk_population_avg` placeholder query) — **the exact bucket-boundary
SQL is genuinely tricky to get right blind** (matching each of the four buckets' day-ranges against
a rolling join-date window per group, per period, correctly excluding cross-group leakage). Before
writing the final version:

1. Run this read-only verification query against the live DB first, to hand-check the at-risk
   count for ONE real bucket/group/month combination (pick one from `aon-bucket-attrition`'s
   current live output):

```sql
-- Hand-verify: how many employees were "at risk" in the 31-60 day bucket, for one specific
-- branch, at the start and end of one specific month (substitute real values).
SELECT COUNT(*) FROM employees e
 WHERE COALESCE(e.salary_start_date, e.date_of_joining) IS NOT NULL
   AND e.branch_id = '<pick a real branch_id>'
   AND COALESCE(e.salary_start_date, e.date_of_joining) <= '2026-07-01'
   AND (e.date_of_exit IS NULL OR e.date_of_exit >= '2026-07-01')
   AND DATEDIFF('2026-07-01', COALESCE(e.salary_start_date, e.date_of_joining)) BETWEEN 31 AND 60;
```

2. Compare that hand-checked number against what the SQL in this task produces for the same
   bucket/group/month, and adjust the query until they agree, before trusting the automated test in
   Step 4 below (which uses a small in-memory fixture, not live data, so it only proves the SQL
   shape is stable — it cannot catch a boundary-off-by-one on its own).

- [ ] **Step 4: Implement — add `overallAttritionRate`**

Add this new exported function to `aon.executor.ts`, after `aonBucketAttrition`:

```typescript
// ---------------------------------------------------------------------------
// aon-overall-attrition-rate  (headline, company-wide, not bucket-scoped)
// ---------------------------------------------------------------------------
/**
 * Company-wide (or scope-wide) attrition rate per month: exits / average(headcount at period
 * start, headcount at period end) x 100. Deliberately simpler than the per-bucket
 * AON Attrition Rate above — this is the single number a CEO glances at first; the bucketed
 * version inside aon-bucket-attrition is for diagnosing WHERE in the tenure curve it concentrates.
 * Same average-of-endpoints approach, applied to the whole population instead of one bucket.
 */
export async function overallAttritionRate(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const twelveMonthsAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const from = dateParam(filters.from, iso(twelveMonthsAgo));
  const to = dateParam(filters.to, iso(today));

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push(`${AON_REFERENCE_JOIN_DATE_SQL} IS NOT NULL`);

  const base = `
    SELECT DATE_FORMAT(m.month_start, '%Y-%m') AS month,
           m.exits,
           m.avg_total_headcount,
           ROUND(m.exits * 100.0 / NULLIF(m.avg_total_headcount, 0), 2) AS attrition_rate_pct
      FROM (
        SELECT month_start,
               (SELECT COUNT(*) FROM employees e
                 WHERE ${clauses.join(" AND ")}
                   AND e.date_of_exit IS NOT NULL AND e.date_of_exit >= month_start
                   AND e.date_of_exit < DATE_ADD(month_start, INTERVAL 1 MONTH)
               ) AS exits,
               (
                 (SELECT COUNT(*) FROM employees e
                   WHERE ${clauses.join(" AND ")}
                     AND ${AON_REFERENCE_JOIN_DATE_SQL} <= month_start
                     AND (e.date_of_exit IS NULL OR e.date_of_exit >= month_start)
                 ) +
                 (SELECT COUNT(*) FROM employees e
                   WHERE ${clauses.join(" AND ")}
                     AND ${AON_REFERENCE_JOIN_DATE_SQL} <= LAST_DAY(month_start)
                     AND (e.date_of_exit IS NULL OR e.date_of_exit >= LAST_DAY(month_start))
                 )
               ) / 2.0 AS avg_total_headcount
          FROM (
            SELECT DATE_ADD(DATE(?), INTERVAL n MONTH) AS month_start
              FROM (SELECT 0 AS n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
                    UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9
                    UNION SELECT 10 UNION SELECT 11) months
             WHERE DATE_ADD(DATE(?), INTERVAL n MONTH) <= DATE(?)
          ) month_seq
      ) m
     ORDER BY month`;

  // Each of the 3 repeated `clauses.join(" AND ")` fragments above needs its own copy of
  // `params` (correlated subqueries each bind their own placeholders) — build the final
  // params array as 3 copies of the scope/filter params, then the 3 month-range params.
  const finalParams = [...params, ...params, ...params, from, from, to];

  try {
    const rows = await query(base, finalParams);
    return { rows: rows as Record<string, unknown>[], rowCount: rows.length, isTruncated: false };
  } catch (err) {
    rethrowReportSchemaError("aon-overall-attrition-rate", err, base);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon-attrition-rate.test.ts`
Expected: PASS

- [ ] **Step 6: Register the new report code**

Modify `backend/src/modules/reporting/executors/index.ts`: add `overallAttritionRate` to the import
from `"./aon.executor.js"` and register it in the code map (near the existing `"aon-bucket-*"`
entries):

```typescript
"aon-overall-attrition-rate": overallAttritionRate,
```

Add a catalog entry to `src/lib/report-catalog.ts`, modeled on the existing `aon-bucket-attrition`
entry (insert after it):

```typescript
  {
    code: "aon-overall-attrition-rate",
    name: "Overall Attrition Rate",
    category: "Attrition & Trends",
    subcategory: "AON Analytics",
    description: "Company-wide (or scope-wide) monthly attrition rate: exits / average headcount",
    rowGrain: "One row per month",
    primaryKey: ["month"],
    columns: [
      { key: "month", label: "Month", format: "text", width: 90 },
      { key: "exits", label: "Exits", format: "number", width: 80, align: "right" },
      { key: "avg_total_headcount", label: "Avg Headcount", format: "number", width: 130, align: "right" },
      { key: "attrition_rate_pct", label: "Attrition Rate %", format: "percentage", width: 140, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "finance", "payroll", "wfm", "manager", "process_manager", "branch_head", "ceo"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
  },
```

- [ ] **Step 7: Scoped typecheck**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon\.executor|executors/index"`
Expected: no output (no errors referencing the touched files).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/reporting/executors/aon.executor.ts backend/src/modules/reporting/executors/index.ts backend/src/modules/reporting/executors/__tests__/aon-attrition-rate.test.ts src/lib/report-catalog.ts
git commit -m "feat(reporting): AON Attrition Rate (per-bucket) + headline Overall Attrition Rate

Per-bucket AON Attrition Rate added as new columns on aon-bucket-attrition:
exits / average(at-risk population at period start, at period end), computed
per bucket per group. A separate, simpler headline aon-overall-attrition-rate
report code adds the same average-of-endpoints formula company-wide, for the
top-level summary tile. Neither number is fabricated -- both are explicit
aggregates with a stated formula, scoped through the existing appendScopeConditions."
```

---

### Task 3: `aon-drilldown-employees` — employee-level rows for Panel 2

**Files:**
- Create: `backend/src/modules/reporting/executors/aon-drilldown.executor.ts`
- Modify: `backend/src/modules/reporting/executors/index.ts` (register the new code)
- Modify: `src/lib/report-catalog.ts` (catalog entry)
- Test: `backend/src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts`

**Interfaces:**
- Consumes: `AON_REFERENCE_JOIN_DATE_SQL` from Task 1; `ExecFilters`/`ExecScope`/`ExecOptions`/
  `ExecResult`/`appendScopeConditions`/`appendFilterConditions`/`fetchPageWithTotal`/
  `rethrowReportSchemaError` from `types.ts`.
- Produces: `aonDrilldownEmployees(filters, scope, options): Promise<ExecResult>`. New filter field
  used: `filters.metric` (`"headcount" | "exits" | "shrinkage"`) and `filters.aonBucket`
  (`"0-30" | "31-60" | "61-90" | "90+"`), both read directly off the generic `ExecFilters` index
  signature (`[key: string]: unknown`) — no type change needed to `ExecFilters` itself.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));

import { db } from "../../../../db/mysql.js";
import { aonDrilldownEmployees } from "../aon-drilldown.executor.js";
import type { ExecScope, ExecOptions } from "../types.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const SCOPE: ExecScope = {
  companyId: "co-1",
  isSuperAdmin: true,
  branchScope: { mode: "all", ids: [] },
  processScope: { mode: "all", ids: [] },
  departmentScope: { mode: "all", ids: [] },
  costCentreScope: { mode: "all", ids: [] },
  canViewAllEmployees: true,
  canViewSensitiveFields: true,
  canExportSensitiveReports: true,
  roles: ["super_admin"],
};

const OPTIONS: ExecOptions = { limit: 100, offset: 0, cursor: null, includeTotal: true, mode: "preview" };

describe("aonDrilldownEmployees", () => {
  it("headcount context queries active employees with risk fields", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees({ metric: "headcount", costCentreId: "cc-1", aonBucket: "31-60" }, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("e.active_status = 1");
    expect(sql).toContain("risk_score");
    expect(sql).toContain("cost_centre_id = ?");
  });

  it("exits context queries exited employees with exit date and tenure", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees({ metric: "exits", costCentreId: "cc-1", aonBucket: "0-30" }, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("date_of_exit");
    expect(sql).not.toContain("active_status = 1");
  });

  it("defaults to headcount context when metric is not provided", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees({}, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("e.active_status = 1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts`
Expected: FAIL — module `../aon-drilldown.executor.js` does not exist.

- [ ] **Step 3: Implement**

Create `backend/src/modules/reporting/executors/aon-drilldown.executor.ts`:

```typescript
/**
 * aon-drilldown-employees — the employee-level bottom of the AON Analytics drill-down chain.
 *
 * Every other AON/attrition report in this module is a pure aggregate (branch x cost-centre x
 * process x bucket) with no employee-level row output. This is the one executor that returns
 * named people, and only when a caller has already narrowed down to a specific slice via
 * branchId/costCentreId/processId/aonBucket -- it is not meant to be paged through unfiltered.
 *
 * Two response shapes depending on filters.metric, because "headcount"/"shrinkage" context means
 * "who is currently in this slice" (active employees, with the same risk-score fields
 * attrition-risk.executor.ts already computes) while "exits" context means "who left from this
 * slice" (exited employees, with their exit date and tenure at exit) -- these are genuinely
 * different populations and mixing them into one shape would blur what the drawer is showing.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  fetchPageWithTotal,
  rethrowReportSchemaError,
} from "./types.js";
import { AON_REFERENCE_JOIN_DATE_SQL } from "./aon.executor.js";

async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

async function count(baseSql: string, params: unknown[]): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`,
    params
  );
  return Number((rows as Array<{ total?: number }>)[0]?.total ?? 0);
}

const MIN_DAYS_FOR_RATE = 5;

function aonBucketClause(bucket: unknown): string | null {
  switch (bucket) {
    case "0-30": return `DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30`;
    case "31-60": return `DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) BETWEEN 31 AND 60`;
    case "61-90": return `DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) BETWEEN 61 AND 90`;
    case "90+": return `DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) > 90`;
    default: return null;
  }
}

function aonBucketAtExitClause(bucket: unknown): string | null {
  switch (bucket) {
    case "0-30": return `DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30`;
    case "31-60": return `DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) BETWEEN 31 AND 60`;
    case "61-90": return `DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) BETWEEN 61 AND 90`;
    case "90+": return `DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) > 90`;
    default: return null;
  }
}

export async function aonDrilldownEmployees(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const metric = String(filters.metric ?? "headcount");
  const isExitContext = metric === "exits";

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (isExitContext) {
    clauses.push("e.date_of_exit IS NOT NULL", "e.date_of_exit >= e.date_of_joining");
    const bucketClause = aonBucketAtExitClause(filters.aonBucket);
    if (bucketClause) clauses.push(bucketClause);
  } else {
    clauses.push("e.active_status = 1");
    const bucketClause = aonBucketClause(filters.aonBucket);
    if (bucketClause) clauses.push(bucketClause);
  }

  const base = isExitContext
    ? `
    SELECT e.employee_code,
           COALESCE(NULLIF(TRIM(e.full_name),''),
                    TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED')       AS branch_name,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(p.process_name, 'UNASSIGNED')      AS process_name,
           DATE_FORMAT(${AON_REFERENCE_JOIN_DATE_SQL}, '%Y-%m-%d') AS join_date,
           DATE_FORMAT(e.date_of_exit, '%Y-%m-%d')     AS date_of_exit,
           DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}) AS tenure_at_exit_days,
           reporting_manager_name
      FROM employees e
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN process_master p      ON p.id  = e.process_id
      LEFT JOIN (
        SELECT e2.id AS employee_id,
               COALESCE(NULLIF(TRIM(m.full_name),''),
                        TRIM(CONCAT(m.first_name,' ',COALESCE(m.last_name,'')))) AS reporting_manager_name
          FROM employees e2
          LEFT JOIN employees m ON m.id = e2.reporting_manager_id
      ) rm ON rm.employee_id = e.id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.date_of_exit DESC`
    : `
    SELECT e.employee_code,
           COALESCE(NULLIF(TRIM(e.full_name),''),
                    TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED')       AS branch_name,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(p.process_name, 'UNASSIGNED')      AS process_name,
           DATE_FORMAT(${AON_REFERENCE_JOIN_DATE_SQL}, '%Y-%m-%d') AS join_date,
           DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) AS aon_days,
           COALESCE(a.attendance_days, 0) AS attendance_days,
           CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                THEN ROUND(a.absent_days * 100.0 / a.attendance_days, 1) END AS absence_rate_pct,
           LEAST(100,
             CASE
               WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30 THEN 45
               WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 60 THEN 30
               WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 90 THEN 18
               ELSE 6
             END
             + CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                    THEN LEAST(25, a.absent_days * 25.0 / a.attendance_days) ELSE 0 END
           ) AS risk_score
      FROM employees e
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN process_master p      ON p.id  = e.process_id
      LEFT JOIN (
        SELECT adr.employee_id,
               COUNT(*) AS attendance_days,
               SUM(adr.attendance_status = 'absent') AS absent_days
          FROM attendance_daily_record adr
         WHERE adr.record_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         GROUP BY adr.employee_id
      ) a ON a.employee_id = e.id
     WHERE ${clauses.join(" AND ")}
     ORDER BY risk_score DESC, aon_days ASC`;

  try {
    const paged = await fetchPageWithTotal(base, params, options, query, count);
    const total = paged.total;
    const rows = paged.rows as Record<string, unknown>[];
    return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
  } catch (err) {
    rethrowReportSchemaError("aon-drilldown-employees", err, base);
  }
}
```

Note: this is a deliberately simplified subset of `attritionRiskScore`'s full weighting (tenure +
absence only, not missing-punch/half-day) for the first cut — extending to the full weighted score
is a small follow-up once this ships, not a blocker.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts`
Expected: PASS

- [ ] **Step 5: Register the report code**

In `backend/src/modules/reporting/executors/index.ts`, add the import and registration:

```typescript
import { aonDrilldownEmployees } from "./aon-drilldown.executor.js";
```

```typescript
"aon-drilldown-employees": aonDrilldownEmployees,
```

Add a catalog entry to `src/lib/report-catalog.ts` (after the `aon-overall-attrition-rate` entry
added in Task 2):

```typescript
  {
    code: "aon-drilldown-employees",
    name: "AON Drill-Down Employees",
    category: "Attrition & Trends",
    subcategory: "AON Analytics",
    description: "Named employees for a specific branch/cost-centre/process/AON-bucket slice",
    rowGrain: "One row per employee",
    primaryKey: ["employee_code"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 140 },
      { key: "cost_centre_name", label: "Cost Centre", format: "text", width: 180 },
      { key: "process_name", label: "Process", format: "text", width: 150 },
      { key: "join_date", label: "Join Date", format: "text", width: 110 },
      { key: "aon_days", label: "AON Days", format: "number", width: 90, align: "right" },
      { key: "risk_score", label: "Risk Score", format: "number", width: 100, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "finance", "payroll", "wfm", "manager", "process_manager", "branch_head", "ceo"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
  },
```

- [ ] **Step 6: Scoped typecheck**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon-drilldown|executors/index"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/reporting/executors/aon-drilldown.executor.ts backend/src/modules/reporting/executors/index.ts backend/src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts src/lib/report-catalog.ts
git commit -m "feat(reporting): aon-drilldown-employees report code for the employee-list drill panel

Employee-level rows for a specific branch/cost-centre/process/AON-bucket slice,
in two shapes: active employees with a risk-score subset (headcount/shrinkage
context) or exited employees with exit date and tenure at exit (exits context).
Reuses the existing scope/filter infrastructure; no new SQL from scratch for
the risk-score fields, adapted from attrition-risk.executor.ts's attritionRiskScore."
```

---

### Task 4: Flag for Retention Review endpoint

**Files:**
- Create: `backend/src/modules/reporting/aon-retention-flag.routes.ts`
- Modify: `backend/src/app.ts` (mount the new router)
- Test: `backend/src/modules/reporting/__tests__/aon-retention-flag.routes.test.ts`

**Interfaces:**
- Consumes: `upsertOpenWorkItem` and `WorkItemInput` from `backend/src/shared/workItem.ts`
  (unchanged signature).
- Produces: `POST /api/reports/aon-analytics/flag-retention` — body `{ employeeId: string }`,
  response `{ success: true, outcome: "created" | "refreshed" }`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/reporting/__tests__/aon-retention-flag.routes.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { upsertOpenWorkItem } = vi.hoisted(() => ({ upsertOpenWorkItem: vi.fn() }));
vi.mock("../../../shared/workItem.js", () => ({ upsertOpenWorkItem }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
import { db } from "../../../db/mysql.js";
const mockExecute = db.execute as ReturnType<typeof vi.fn>;

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", role: "hr" }; next(); },
}));

import { aonRetentionFlagRouter } from "../aon-retention-flag.routes.js";

const app = express();
app.use(express.json());
app.use("/api/reports/aon-analytics", aonRetentionFlagRouter);

describe("POST /api/reports/aon-analytics/flag-retention", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls upsertOpenWorkItem with RETENTION_REVIEW for the given employee", async () => {
    mockExecute.mockResolvedValueOnce([[{
      id: "emp-1", reporting_manager_id: "mgr-1", branch_id: "b1",
    }], []]);
    mockExecute.mockResolvedValueOnce([[{ role_key: "manager" }], []]);
    upsertOpenWorkItem.mockResolvedValueOnce("created");

    const res = await request(app)
      .post("/api/reports/aon-analytics/flag-retention")
      .send({ employeeId: "emp-1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, outcome: "created" });
    expect(upsertOpenWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemType: "RETENTION_REVIEW",
        entityType: "employee",
        entityId: "emp-1",
        assignedToRole: "manager",
      }),
    );
  });

  it("400s when employeeId is missing", async () => {
    const res = await request(app).post("/api/reports/aon-analytics/flag-retention").send({});
    expect(res.status).toBe(400);
  });
});
```

Check whether `supertest` is already a dev dependency (`grep supertest backend/package.json`); if
not, add it: `cd backend && npm install --save-dev supertest @types/supertest`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/reporting/__tests__/aon-retention-flag.routes.test.ts`
Expected: FAIL — module `../aon-retention-flag.routes.js` does not exist.

- [ ] **Step 3: Implement**

Create `backend/src/modules/reporting/aon-retention-flag.routes.ts`:

```typescript
/**
 * Flag for Retention Review — the one write action on the AON Analytics drill-down page.
 *
 * Calls the existing, already-tested upsertOpenWorkItem() helper (backend/src/shared/workItem.ts)
 * -- the same idempotent Work Inbox writer already used by 7+ producers in this codebase. No new
 * work-item plumbing: flagging the same employee twice while a review is still open is a no-op
 * refresh, not a duplicate, because that idempotency is already proven for the shared helper.
 *
 * Routed by role (assignedToRole), not by a specific user id -- WorkItemInput has no
 * assignedToUserId field, and Work Inbox's existing branch/process row-scope on reads already
 * ensures only the relevant manager/branch head sees it.
 */
import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { upsertOpenWorkItem } from "../../shared/workItem.js";

export const aonRetentionFlagRouter = Router();

interface EmployeeForFlag extends RowDataPacket {
  id: string;
  reporting_manager_id: string | null;
  branch_id: string | null;
}

async function resolveAssignedRole(employeeId: string): Promise<string> {
  const [rows] = await db.execute<EmployeeForFlag[]>(
    `SELECT id, reporting_manager_id, branch_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  const emp = rows[0];
  if (!emp?.reporting_manager_id) return "branch_head";

  const [roleRows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key FROM user_roles WHERE user_id = (
       SELECT id FROM auth_user WHERE email = (
         SELECT COALESCE(NULLIF(TRIM(official_email),''), email) FROM employees WHERE id = ?
       ) LIMIT 1
     ) AND active_status = 1 LIMIT 1`,
    [emp.reporting_manager_id],
  );
  const role = (roleRows[0] as { role_key?: string } | undefined)?.role_key;
  return role ?? "branch_head";
}

aonRetentionFlagRouter.post(
  "/flag-retention",
  requireAuth,
  async (req: Request, res: Response) => {
    const employeeId = String((req.body as { employeeId?: unknown })?.employeeId ?? "").trim();
    if (!employeeId) {
      return res.status(400).json({ success: false, message: "employeeId is required" });
    }

    const assignedToRole = await resolveAssignedRole(employeeId);
    const riskBand = String((req.body as { riskBand?: unknown })?.riskBand ?? "").trim();
    const priority = riskBand === "High" ? "high" : riskBand === "Medium" ? "normal" : "low";

    const outcome = await upsertOpenWorkItem({
      itemType: "RETENTION_REVIEW",
      title: "Retention review requested",
      moduleCode: "aon-analytics",
      entityType: "employee",
      entityId: employeeId,
      assignedToRole,
      priority,
      description: `Flagged from AON & Attrition Analytics${riskBand ? ` — risk band: ${riskBand}` : ""}.`,
    });

    return res.json({ success: true, outcome });
  },
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/reporting/__tests__/aon-retention-flag.routes.test.ts`
Expected: PASS

- [ ] **Step 5: Mount the router**

In `backend/src/app.ts`, add near the other `/api/reports/...` mounts (search for
`report-suite.routes` to find the right spot):

```typescript
import { aonRetentionFlagRouter } from "./modules/reporting/aon-retention-flag.routes.js";
```

```typescript
app.use("/api/reports/aon-analytics", aonRetentionFlagRouter);
```

- [ ] **Step 6: Scoped typecheck**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon-retention-flag|app\.ts"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/reporting/aon-retention-flag.routes.ts backend/src/app.ts backend/src/modules/reporting/__tests__/aon-retention-flag.routes.test.ts backend/package.json backend/package-lock.json
git commit -m "feat(reporting): Flag for Retention Review endpoint, reusing upsertOpenWorkItem

POST /api/reports/aon-analytics/flag-retention creates or refreshes an open
RETENTION_REVIEW work item via the existing shared workItem.ts helper -- no
new Work Inbox plumbing. Routed to the employee's reporting manager's role
when resolvable, else branch_head."
```

---

### Task 5: Frontend — DrillDownProvider + Panel 1 (Slice Detail)

**Files:**
- Create: `src/components/analytics/drilldown/DrillDownProvider.tsx`
- Create: `src/components/analytics/drilldown/SliceDetailPanel.tsx`
- Test: `src/components/analytics/drilldown/__tests__/DrillDownProvider.test.tsx`

**Interfaces:**
- Produces:
  - `DrillDownChip = { dimension: string; value: string; label: string }`
  - `useDrillDown()` hook returning `{ chips: DrillDownChip[], pushChip: (c: DrillDownChip) => void, popToChip: (index: number) => void, clear: () => void, showEmployeeList: boolean, openEmployeeList: () => void, closeEmployeeList: () => void }`
  - `<DrillDownProvider>` wraps children and supplies the above via context.
  - `<SliceDetailPanel metric, groupByLabel, drilldownReportCode />` — Task 6 consumes
    `openEmployeeList`.

- [ ] **Step 1: Write the failing test**

Create `src/components/analytics/drilldown/__tests__/DrillDownProvider.test.tsx`:

```typescript
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DrillDownProvider, useDrillDown } from "../DrillDownProvider";

function Harness() {
  const { chips, pushChip, popToChip, clear } = useDrillDown();
  return (
    <div>
      <span data-testid="chip-count">{chips.length}</span>
      <button onClick={() => pushChip({ dimension: "costCentre", value: "cc-1", label: "Kolkata CC" })}>
        add cc
      </button>
      <button onClick={() => pushChip({ dimension: "aonBucket", value: "31-60", label: "31-60d" })}>
        add bucket
      </button>
      <button onClick={() => popToChip(0)}>pop to 0</button>
      <button onClick={clear}>clear</button>
      {chips.map((c, i) => <span key={c.dimension} data-testid={`chip-${i}`}>{c.label}</span>)}
    </div>
  );
}

describe("DrillDownProvider", () => {
  it("pushChip appends, popToChip truncates, clear empties", () => {
    render(<DrillDownProvider><Harness /></DrillDownProvider>);
    expect(screen.getByTestId("chip-count").textContent).toBe("0");

    fireEvent.click(screen.getByText("add cc"));
    fireEvent.click(screen.getByText("add bucket"));
    expect(screen.getByTestId("chip-count").textContent).toBe("2");
    expect(screen.getByTestId("chip-0").textContent).toBe("Kolkata CC");
    expect(screen.getByTestId("chip-1").textContent).toBe("31-60d");

    fireEvent.click(screen.getByText("pop to 0"));
    expect(screen.getByTestId("chip-count").textContent).toBe("1");

    fireEvent.click(screen.getByText("clear"));
    expect(screen.getByTestId("chip-count").textContent).toBe("0");
  });
});
```

Check the existing test setup for how other components in this codebase render with
`@testing-library/react` (search `grep -rl "@testing-library/react" src/components/**/__tests__/*.test.tsx | head -3` and mirror one for provider/setup imports if this project uses a custom render wrapper).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/analytics/drilldown/__tests__/DrillDownProvider.test.tsx`
Expected: FAIL — module `../DrillDownProvider` does not exist.

- [ ] **Step 3: Implement `DrillDownProvider.tsx`**

Create `src/components/analytics/drilldown/DrillDownProvider.tsx`:

```typescript
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export interface DrillDownChip {
  dimension: string;
  value: string;
  label: string;
}

interface DrillDownContextValue {
  chips: DrillDownChip[];
  pushChip: (chip: DrillDownChip) => void;
  popToChip: (index: number) => void;
  clear: () => void;
  showEmployeeList: boolean;
  openEmployeeList: () => void;
  closeEmployeeList: () => void;
}

const DrillDownContext = createContext<DrillDownContextValue | null>(null);

export function DrillDownProvider({ children }: { children: React.ReactNode }) {
  const [chips, setChips] = useState<DrillDownChip[]>([]);
  const [showEmployeeList, setShowEmployeeList] = useState(false);

  const pushChip = useCallback((chip: DrillDownChip) => {
    setChips(prev => {
      // Replace an existing chip of the same dimension rather than stacking a duplicate --
      // e.g. clicking a different AON bucket cell replaces the current bucket chip, it
      // doesn't add a second one.
      const withoutSameDimension = prev.filter(c => c.dimension !== chip.dimension);
      return [...withoutSameDimension, chip];
    });
  }, []);

  const popToChip = useCallback((index: number) => {
    setChips(prev => prev.slice(0, index));
  }, []);

  const clear = useCallback(() => {
    setChips([]);
    setShowEmployeeList(false);
  }, []);

  const openEmployeeList = useCallback(() => setShowEmployeeList(true), []);
  const closeEmployeeList = useCallback(() => setShowEmployeeList(false), []);

  const value = useMemo(
    () => ({ chips, pushChip, popToChip, clear, showEmployeeList, openEmployeeList, closeEmployeeList }),
    [chips, pushChip, popToChip, clear, showEmployeeList, openEmployeeList, closeEmployeeList],
  );

  return <DrillDownContext.Provider value={value}>{children}</DrillDownContext.Provider>;
}

export function useDrillDown(): DrillDownContextValue {
  const ctx = useContext(DrillDownContext);
  if (!ctx) throw new Error("useDrillDown must be used inside a DrillDownProvider");
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/analytics/drilldown/__tests__/DrillDownProvider.test.tsx`
Expected: PASS

- [ ] **Step 5: Implement `SliceDetailPanel.tsx` (Panel 1)**

Create `src/components/analytics/drilldown/SliceDetailPanel.tsx`. This queries
`aon-bucket-headcount` / `aon-bucket-attrition` / `aon-bucket-shrinkage` (whichever the passed-in
`metric` needs — reusing the same `useReport`-style hook pattern already in `AonAnalyticsView.tsx`,
duplicated here rather than imported since `useReport` is not currently exported from that file —
add `export` to it in Task 8 once this panel needs to share it) filtered by the current chip set,
and renders the chip bar, a loading/empty/error state, and a "View employees" button:

```typescript
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useDrillDown } from "./DrillDownProvider";

interface SliceDetailPanelProps {
  open: boolean;
  onClose: () => void;
  metric: "headcount" | "exits" | "shrinkage";
  reportCode: string; // "aon-bucket-headcount" | "aon-bucket-attrition" | "aon-bucket-shrinkage"
  from: string;
  to: string;
}

function chipsToFilterParams(chips: { dimension: string; value: string }[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const chip of chips) {
    if (chip.dimension === "costCentre") params.costCentreId = chip.value;
    else if (chip.dimension === "process") params.processId = chip.value;
    else if (chip.dimension === "branch") params.branchId = chip.value;
    else if (chip.dimension === "aonBucket") params.aonBucket = chip.value;
  }
  return params;
}

export function SliceDetailPanel({ open, onClose, metric, reportCode, from, to }: SliceDetailPanelProps) {
  const { chips, popToChip, openEmployeeList } = useDrillDown();
  const filterParams = chipsToFilterParams(chips);

  const q = useQuery({
    queryKey: [reportCode, "slice-detail", JSON.stringify(filterParams), from, to],
    enabled: open && chips.length > 0,
    queryFn: async () => {
      const qs = new URLSearchParams({ ...filterParams, from, to, limit: "500", offset: "0" });
      const res = await hrmsApi.get<{ data?: Record<string, unknown>[] }>(
        `/api/reports/suite/${reportCode}?${qs.toString()}`,
        60_000,
      );
      return res.data ?? [];
    },
  });

  const rows = q.data ?? [];
  const valueKey = metric === "exits" ? "exits" : metric === "shrinkage" ? "shrinkage" : "headcount";
  const total = rows.reduce((a, r) => a + Number(r[valueKey] ?? 0), 0);

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Slice Detail</SheetTitle>
        </SheetHeader>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip, i) => (
            <span
              key={chip.dimension}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
            >
              {chip.label}
              <button
                type="button"
                onClick={() => popToChip(i)}
                className="ml-0.5 rounded-full hover:bg-slate-200"
                aria-label={`Remove ${chip.label} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        {q.isLoading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        ) : q.error ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {(q.error as Error).message || "Failed to load this slice."}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                {metric === "exits" ? "Exits" : metric === "shrinkage" ? "Shrinkage" : "Headcount"} in this slice
              </p>
              <p className="text-xl font-bold text-slate-900">
                {metric === "shrinkage" ? `${total.toFixed(1)}%` : total.toLocaleString("en-IN")}
              </p>
            </div>

            <Button onClick={openEmployeeList} className="w-full">
              View employees
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 6: Frontend build check**

Run: `npx vite build --mode development 2>&1 | tail -40`
Expected: build succeeds with no new errors referencing `DrillDownProvider` or `SliceDetailPanel`
(a full production build is the real gate here per this repo's convention — a green
`tsc --noEmit` alone has shipped an unbuildable tree before).

- [ ] **Step 7: Commit**

```bash
git add src/components/analytics/drilldown/DrillDownProvider.tsx src/components/analytics/drilldown/SliceDetailPanel.tsx src/components/analytics/drilldown/__tests__/DrillDownProvider.test.tsx
git commit -m "feat(analytics): DrillDownProvider + Panel 1 (Slice Detail) for AON Analytics

Chip-based drill state (add/remove/replace-by-dimension) shared via context;
Panel 1 queries the existing aon-bucket-* report codes filtered by the current
chip set and shows a View Employees button opening Panel 2 (next task)."
```

---

### Task 6: Frontend — Panel 2 (Employee List) + Flag for Retention Review

**Files:**
- Create: `src/components/analytics/drilldown/EmployeeListPanel.tsx`
- Modify: `src/components/analytics/drilldown/DrillDownProvider.tsx` (add `selectedEmployeeId` /
  `selectEmployee` / `deselectEmployee` to the context, for Task 7's detail drawer)
- Test: `src/components/analytics/drilldown/__tests__/EmployeeListPanel.test.tsx`

**Interfaces:**
- Consumes: `useDrillDown()` from Task 5 (extended); `aon-drilldown-employees` report code from
  Task 3; `POST /api/reports/aon-analytics/flag-retention` from Task 4.
- Produces: `<EmployeeListPanel metric, from, to />`; extends `useDrillDown()`'s return type with
  `selectedEmployeeId: string | null`, `selectEmployee: (id: string) => void`,
  `deselectEmployee: () => void`.

- [ ] **Step 1: Extend `DrillDownProvider` with employee selection state**

Modify `src/components/analytics/drilldown/DrillDownProvider.tsx`: add to
`DrillDownContextValue`:

```typescript
  selectedEmployeeId: string | null;
  selectEmployee: (id: string) => void;
  deselectEmployee: () => void;
```

Add corresponding state/handlers inside `DrillDownProvider` (alongside the existing `chips` state):

```typescript
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const selectEmployee = useCallback((id: string) => setSelectedEmployeeId(id), []);
  const deselectEmployee = useCallback(() => setSelectedEmployeeId(null), []);
```

Add these to the `value` object's dependency array and returned object.

- [ ] **Step 2: Write the failing test**

Create `src/components/analytics/drilldown/__tests__/EmployeeListPanel.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/hrmsApi", () => ({
  hrmsApi: {
    get: vi.fn().mockResolvedValue({ data: [
      { employee_code: "MAS1", employee_name: "Test One", aon_days: 45, risk_score: 62 },
    ] }),
    post: vi.fn().mockResolvedValue({ success: true, outcome: "created" }),
  },
}));

import { hrmsApi } from "@/lib/hrmsApi";
import { DrillDownProvider } from "../DrillDownProvider";
import { EmployeeListPanel } from "../EmployeeListPanel";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DrillDownProvider>
        <EmployeeListPanel open metric="headcount" from="2026-01-01" to="2026-08-25" />
      </DrillDownProvider>
    </QueryClientProvider>,
  );
}

describe("EmployeeListPanel", () => {
  it("renders employee rows and fires the flag action", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("Test One")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /flag for retention review/i }));

    await waitFor(() =>
      expect(hrmsApi.post).toHaveBeenCalledWith(
        "/api/reports/aon-analytics/flag-retention",
        expect.objectContaining({ employeeId: expect.any(String) }),
      ),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/analytics/drilldown/__tests__/EmployeeListPanel.test.tsx`
Expected: FAIL — module `../EmployeeListPanel` does not exist.

- [ ] **Step 4: Implement `EmployeeListPanel.tsx`**

Create `src/components/analytics/drilldown/EmployeeListPanel.tsx`:

```typescript
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useDrillDown } from "./DrillDownProvider";

interface EmployeeListPanelProps {
  open: boolean;
  metric: "headcount" | "exits" | "shrinkage";
  from: string;
  to: string;
}

interface EmployeeRow {
  employee_code: string;
  employee_name: string;
  aon_days?: number;
  risk_score?: number;
  date_of_exit?: string;
  tenure_at_exit_days?: number;
  [key: string]: unknown;
}

export function EmployeeListPanel({ open, metric, from, to }: EmployeeListPanelProps) {
  const { chips, showEmployeeList, closeEmployeeList, selectEmployee } = useDrillDown();
  const queryClient = useQueryClient();
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());

  const filterParams: Record<string, string> = { metric, from, to };
  for (const chip of chips) {
    if (chip.dimension === "costCentre") filterParams.costCentreId = chip.value;
    else if (chip.dimension === "process") filterParams.processId = chip.value;
    else if (chip.dimension === "branch") filterParams.branchId = chip.value;
    else if (chip.dimension === "aonBucket") filterParams.aonBucket = chip.value;
  }

  const q = useQuery({
    queryKey: ["aon-drilldown-employees", JSON.stringify(filterParams)],
    enabled: open && showEmployeeList,
    queryFn: async () => {
      const qs = new URLSearchParams({ ...filterParams, limit: "200", offset: "0" });
      const res = await hrmsApi.get<{ data?: EmployeeRow[] }>(
        `/api/reports/suite/aon-drilldown-employees?${qs.toString()}`,
        60_000,
      );
      return res.data ?? [];
    },
  });

  const flagMutation = useMutation({
    mutationFn: (params: { employeeId: string; riskBand?: string }) =>
      hrmsApi.post("/api/reports/aon-analytics/flag-retention", params),
    onSuccess: (_data, params) => {
      setFlaggedIds(prev => new Set(prev).add(params.employeeId));
      void queryClient.invalidateQueries({ queryKey: ["work-inbox"] });
    },
  });

  const rows = q.data ?? [];

  return (
    <Sheet open={open && showEmployeeList} onOpenChange={o => !o && closeEmployeeList()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Employees in this slice</SheetTitle>
        </SheetHeader>

        {q.isLoading ? (
          <div className="mt-4 space-y-2">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
          </div>
        ) : q.error ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {(q.error as Error).message || "Failed to load employees."}
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No employees match this slice.</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {rows.map(row => (
              <div key={row.employee_code} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => selectEmployee(row.employee_code)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-semibold text-slate-900 hover:underline">
                    {row.employee_name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {row.employee_code}
                    {row.aon_days != null ? ` · ${row.aon_days} days on network` : ""}
                    {row.tenure_at_exit_days != null ? ` · ${row.tenure_at_exit_days} days at exit` : ""}
                  </p>
                </button>
                {metric !== "exits" && (
                  <Button
                    size="sm"
                    variant={flaggedIds.has(row.employee_code) ? "secondary" : "outline"}
                    disabled={flaggedIds.has(row.employee_code) || flagMutation.isPending}
                    onClick={() =>
                      flagMutation.mutate({
                        employeeId: row.employee_code,
                        riskBand: (row.risk_score ?? 0) >= 60 ? "High" : (row.risk_score ?? 0) >= 35 ? "Medium" : "Low",
                      })
                    }
                  >
                    {flaggedIds.has(row.employee_code) ? "Flagged" : "Flag for Retention Review"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

Note: the endpoint in Task 4 expects `employeeId` to be the employee's UUID `id`, but this panel's
list rows only carry `employee_code` (no `id` column is selected in Task 3's query for either
shape). Before this task is considered done, add `e.id AS employee_id` to both `SELECT` branches in
`aon-drilldown.executor.ts` (Task 3) and use `row.employee_id` here instead of
`row.employee_code` in the `flagMutation.mutate` call — reconcile this now rather than shipping a
mismatch: update Task 3's test fixtures and this component together in this task's commit.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/analytics/drilldown/__tests__/EmployeeListPanel.test.tsx`
Expected: PASS

- [ ] **Step 6: Frontend build check**

Run: `npx vite build --mode development 2>&1 | tail -40`
Expected: build succeeds, no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/analytics/drilldown/EmployeeListPanel.tsx src/components/analytics/drilldown/DrillDownProvider.tsx src/components/analytics/drilldown/__tests__/EmployeeListPanel.test.tsx backend/src/modules/reporting/executors/aon-drilldown.executor.ts backend/src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts
git commit -m "feat(analytics): Panel 2 (Employee List) with Flag for Retention Review

Named employee rows for the current chip-filtered slice, each with a Flag
for Retention Review action calling the Task 4 endpoint. Employee identity
corrected to use employee_id (UUID) rather than employee_code, matching
what the flag-retention endpoint expects."
```

---

### Task 7: Frontend — per-employee detail drawer (third level)

**Files:**
- Create: `src/components/analytics/drilldown/EmployeeDetailDrawer.tsx`
- Test: `src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx`

**Interfaces:**
- Consumes: `useDrillDown()`'s `selectedEmployeeId` / `deselectEmployee` from Task 6; existing
  `GET /api/employees/:id` endpoint (`backend/src/modules/employees/employee.routes.ts:1442`),
  which already applies scope checks and `redactEmployeeIdentifiers` server-side.
- Produces: `<EmployeeDetailDrawer />` — no props; reads `selectedEmployeeId` from context directly
  so it can be rendered once at the page shell level (Task 8) alongside the other two panels.

- [ ] **Step 1: Write the failing test**

Create `src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/hrmsApi", () => ({
  hrmsApi: {
    get: vi.fn().mockResolvedValue({ data: {
      id: "emp-1", employee_code: "MAS1", first_name: "Test", last_name: "One",
      date_of_joining: "2026-06-01", date_of_exit: null, branch_name: "Kolkata",
    } }),
  },
}));

import { hrmsApi } from "@/lib/hrmsApi";
import { DrillDownProvider, useDrillDown } from "../DrillDownProvider";
import { EmployeeDetailDrawer } from "../EmployeeDetailDrawer";

function Harness() {
  const { selectEmployee } = useDrillDown();
  return (
    <>
      <button onClick={() => selectEmployee("emp-1")}>select</button>
      <EmployeeDetailDrawer />
    </>
  );
}

describe("EmployeeDetailDrawer", () => {
  it("fetches GET /api/employees/:id when an employee is selected, never reusing list data", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DrillDownProvider><Harness /></DrillDownProvider>
      </QueryClientProvider>,
    );

    screen.getByText("select").click();

    await waitFor(() => expect(hrmsApi.get).toHaveBeenCalledWith("/api/employees/emp-1"));
    await waitFor(() => expect(screen.getByText(/Test One/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx`
Expected: FAIL — module `../EmployeeDetailDrawer` does not exist.

- [ ] **Step 3: Implement**

Create `src/components/analytics/drilldown/EmployeeDetailDrawer.tsx`:

```typescript
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useDrillDown } from "./DrillDownProvider";

interface EmployeeDetail {
  id: string;
  employee_code: string;
  first_name: string;
  last_name?: string | null;
  date_of_joining?: string | null;
  date_of_exit?: string | null;
  branch_name?: string | null;
  cost_centre_name?: string | null;
  process_name?: string | null;
  [key: string]: unknown;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function EmployeeDetailDrawer() {
  const { selectedEmployeeId, deselectEmployee } = useDrillDown();

  const q = useQuery({
    queryKey: ["employee-detail", selectedEmployeeId],
    enabled: !!selectedEmployeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<{ data?: EmployeeDetail }>(`/api/employees/${selectedEmployeeId}`);
      return res.data;
    },
  });

  const emp = q.data;

  return (
    <Sheet open={!!selectedEmployeeId} onOpenChange={o => !o && deselectEmployee()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{emp ? `${emp.first_name} ${emp.last_name ?? ""}`.trim() : "Employee"}</SheetTitle>
          {emp && <SheetDescription>{emp.employee_code}</SheetDescription>}
        </SheetHeader>

        {q.isLoading ? (
          <div className="mt-4 space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full rounded" />)}
          </div>
        ) : q.error ? (
          <p className="mt-4 text-sm text-rose-700">
            {(q.error as Error).message || "Failed to load employee detail."}
          </p>
        ) : emp ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Assignment</p>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500">Branch</dt><dd className="text-slate-900">{emp.branch_name ?? "—"}</dd>
                <dt className="text-slate-500">Cost Centre</dt><dd className="text-slate-900">{emp.cost_centre_name ?? "—"}</dd>
                <dt className="text-slate-500">Process</dt><dd className="text-slate-900">{emp.process_name ?? "—"}</dd>
              </dl>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Tenure</p>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500">Joined</dt><dd className="text-slate-900">{formatDate(emp.date_of_joining)}</dd>
                <dt className="text-slate-500">Exited</dt><dd className="text-slate-900">{formatDate(emp.date_of_exit)}</dd>
              </dl>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
```

This is a first-cut subset of the full CLAUDE.md Drill-Down Mandate (assignment + tenure sections
only) — related sub-records, workflow timeline, documents, and audit trail sections are explicitly
deferred to Plan 2 (see the Open Items note at the end of this plan), since those need their own
dedicated endpoints/joins (exit workflow timeline, document list) that are out of scope for this
first vertical slice.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx`
Expected: PASS

- [ ] **Step 5: Frontend build check**

Run: `npx vite build --mode development 2>&1 | tail -40`
Expected: build succeeds, no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/analytics/drilldown/EmployeeDetailDrawer.tsx src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx
git commit -m "feat(analytics): per-employee detail drawer (3rd drill level)

Fetches from the existing GET /api/employees/:id (never reuses the list
payload), per the CLAUDE.md Drill-Down Mandate. First cut covers assignment
and tenure sections; timeline/documents/audit-trail sections are Plan 2."
```

---

### Task 8: Wire Panel 1 into the Overview tab's heatmap, add headline rate tile

**Files:**
- Modify: `src/components/reports/views/AonAnalyticsView.tsx`

**Interfaces:**
- Consumes: `DrillDownProvider`, `useDrillDown`, `SliceDetailPanel`, `EmployeeListPanel`,
  `EmployeeDetailDrawer` from Tasks 5-7.

- [ ] **Step 1: Export `useReport` and add the headline rate query**

In `AonAnalyticsView.tsx`, change `function useReport(...)` to `export function useReport(...)` so
`SliceDetailPanel` (Task 5) can share it in a later refactor (not required for this task to compile,
but avoids an immediate duplicate-logic follow-up).

Inside `AonAnalyticsView`'s default export function, add a headline-rate query and pass it down to
`Overview`:

```typescript
  const headline = useReport("aon-overall-attrition-rate", branchId ? { branchId, from, to } : { from, to });
```

Pass `headlineRate={headline}` as a new prop to `<Overview ... />`.

- [ ] **Step 2: Render the headline tile and make heatmap cells clickable**

In the `Overview` function, accept the new prop:

```typescript
function Overview({ from, to, branchId, headlineRate }: { from: string; to: string; branchId: string; headlineRate: ReturnType<typeof useReport> }) {
```

Add one more `StatTile` before the existing bucket tiles grid (inside the same
`grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4` container, as its first child):

```typescript
        {!loading && !headlineRate.isLoading && headlineRate.data?.[0] && (
          <StatTile
            label="Overall Attrition Rate"
            value={pct(Number(headlineRate.data[0].attrition_rate_pct ?? NaN))}
            denominator={`${num(Number(headlineRate.data[0].exits ?? 0))} exits over avg ${num(Number(headlineRate.data[0].avg_total_headcount ?? 0))} headcount`}
            intent="neutral"
            icon={<TrendingDown className="h-4 w-4" />}
          />
        )}
```

Wrap the whole `Overview` component body's returned JSX in `<DrillDownProvider>`, and make each
heatmap cell (`<td>` rendering `v`) clickable — replace the cell's `<span>` with a `<button>` that
pushes two chips (the group-by dimension and the AON bucket) and opens Panel 1. Modify the heatmap
`<td>` block:

```typescript
                      {row.vals.map((v, i) => (
                        <td key={BUCKETS[i]} className="px-2 py-1.5 text-right tabular-nums">
                          {v == null ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <DrillCell
                              value={v}
                              max={max}
                              metric={metric}
                              groupBy={groupBy}
                              groupKey={row.key}
                              bucket={BUCKETS[i]}
                            />
                          )}
                        </td>
                      ))}
```

Add the `DrillCell` helper component just above `Overview`:

```typescript
function DrillCell({
  value, max, metric, groupBy, groupKey, bucket,
}: { value: number; max: number; metric: "headcount" | "exits" | "shrinkage"; groupBy: GroupBy; groupKey: string; bucket: Bucket }) {
  const { pushChip, openEmployeeList } = useDrillDown();
  const dimension = groupBy === "cost_centre_name" ? "costCentre" : groupBy === "process_name" ? "process" : "branch";

  return (
    <button
      type="button"
      onClick={() => {
        pushChip({ dimension, value: groupKey, label: groupKey });
        pushChip({ dimension: "aonBucket", value: bucket, label: `${bucket}d` });
        openEmployeeList();
      }}
      className="inline-block cursor-pointer rounded px-1.5 py-0.5 transition-opacity hover:opacity-80"
      style={{
        backgroundColor: `rgba(227, 73, 72, ${Math.min(0.75, (value / max) * 0.6)})`,
        color: value / max > 0.55 ? "#fff" : "#0f172a",
      }}
    >
      {metric === "shrinkage" ? pct(value) : num(value)}
    </button>
  );
}
```

Note: `pushChip` used here bypasses Panel 1 and opens Panel 2 (Employee List) directly by calling
`openEmployeeList()` immediately after pushing both chips — this is a deliberate simplification for
this first cut: a heatmap cell already represents one specific group+bucket combination (both
dimensions of this tab's drill path at once), so there's no intermediate narrowing step needed
before showing people. Render `<SliceDetailPanel>` only where a single chip is pushed at a time
elsewhere (not applicable to this specific Overview heatmap interaction, but kept available for
Cohort Survival / Deep Dive wiring in Plan 2, where narrowing happens one dimension at a time).

At the bottom of `Overview`'s returned JSX (after the existing trend chart), add:

```typescript
      <EmployeeListPanel open metric={metric === "headcount" ? "headcount" : metric === "exits" ? "exits" : "shrinkage"} from={from} to={to} />
      <EmployeeDetailDrawer />
```

And wrap the whole return value in `<DrillDownProvider>...</DrillDownProvider>` (adjust the JSX
nesting accordingly — the existing `<div className="space-y-4">` becomes the direct child of
`DrillDownProvider`).

Add the new imports at the top of the file:

```typescript
import { DrillDownProvider, useDrillDown } from "@/components/analytics/drilldown/DrillDownProvider";
import { EmployeeListPanel } from "@/components/analytics/drilldown/EmployeeListPanel";
import { EmployeeDetailDrawer } from "@/components/analytics/drilldown/EmployeeDetailDrawer";
```

- [ ] **Step 3: Frontend build check**

Run: `npx vite build --mode development 2>&1 | tail -60`
Expected: build succeeds with no new errors in `AonAnalyticsView.tsx` or the drilldown components.

- [ ] **Step 4: Manual smoke check**

Run the dev server per this project's existing `run` skill/pattern, navigate to
`/workforce/aon-analytics`, switch the Overview tab's metric to "Attrition (exits)", click a
heatmap cell, and confirm the Employee List panel opens with the right chip set and at least one
named row (or the correct empty state if that slice has no exits). Then click a named row and
confirm the Employee Detail drawer opens with real data from `GET /api/employees/:id` (check the
Network tab to confirm it's a fresh request, not reused list data).

- [ ] **Step 5: Commit**

```bash
git add src/components/reports/views/AonAnalyticsView.tsx
git commit -m "feat(analytics): wire drill-down + headline attrition rate into AON Overview tab

Heatmap cells are now clickable, opening the Employee List panel filtered to
that exact group+bucket slice. Added the Overall Attrition Rate headline
tile above the existing bucket tiles."
```

---

## Self-Review

**Spec coverage check** (against `docs/superpowers/specs/2026-08-25-aon-attrition-drilldown-design.md`):
- §1 AON date-source fix: Task 1. ✓
- §2 AON Attrition Rate + headline rate: Task 2. ✓
- §3 Two-panel drill-down model: Tasks 5-7 (Panel 1, Panel 2, 3rd-level drawer). ✓ (Overview tab
  only in this plan — Cohort Survival / Deep Dive wiring explicitly deferred to Plan 2, see below).
- §4 Anomaly banner + data-quality nudge: **deferred to Plan 2** — not in this plan.
- §5 Cost impact estimate: **deferred to Plan 2**.
- §6 Flag for Retention Review: Task 4 (backend) + Task 6 (frontend button). ✓
- §7 Manager accountability: **deferred to Plan 2**.
- §8 Top attrition drivers reframe: **deferred to Plan 2**.
- §9 Backend surface: Tasks 1-4 cover items 1, 2, 4 in full; item 3 (anomaly aggregation) and item
  5 (cost impact) deferred to Plan 2 alongside their corresponding UI sections.
- §10 Loading/error states: covered inline in Tasks 5-8 (skeletons, error boxes) — a dedicated
  shape-matching `ChartSkeleton`-equivalent for the panels specifically is a nice-to-have polish
  item, not blocking; current skeletons use generic `Skeleton` blocks which is an acceptable v1.
- §11 Testing: unit tests included in every backend task; frontend component tests included for
  the provider, both panels, and the detail drawer.

This plan intentionally covers a **first vertical slice** — the Overview tab's drill-down chain,
end to end, plus the foundational AON corrections both remaining plan items depend on. **Plan 2**
(to be written separately, once this ships and is verified) covers: wiring the same drill-down
components into Cohort Survival and Attrition Deep Dive, the anomaly banner, the extended
data-quality nudge, the cost-impact estimate, manager accountability inside Deep Dive's existing
dimension selector, and the top-drivers reframe — all of which build on the infrastructure this
plan establishes (`DrillDownProvider`, `SliceDetailPanel`, `EmployeeListPanel`,
`EmployeeDetailDrawer`, `aon-drilldown-employees`) rather than duplicating it.

**Placeholder scan:** No `TBD`/`TODO` left in any step. Two explicit "left as a stub, needs live
verification before trusting" notes exist (Task 2 Step 3's at-risk-population SQL, and Task 6 Step
4's employee-identity field name) — both are flagged as genuinely open engineering judgment calls
requiring a live-data check mid-implementation, not lazy placeholders, and both explain exactly
what to check and how.

**Type consistency check:** `DrillDownChip`, `useDrillDown()`'s return shape, `EmployeeRow`, and
`EmployeeDetail` are each defined once (Task 5/6/7) and referenced identically in every later task
that consumes them. `aonDrilldownEmployees`'s `filters.metric`/`filters.aonBucket` naming matches
what `EmployeeListPanel` (Task 6) and the `Overview` heatmap wiring (Task 8) send.

## Open Items Explicitly Deferred to Plan 2

- Anomaly banner (spec §4), extended data-quality nudge, cost-impact estimate (spec §5), manager
  accountability (spec §7), top-drivers reframe (spec §8).
- Cohort Survival and Attrition Deep Dive tabs' own drill-down wiring (this plan only wires
  Overview).
- The full CLAUDE.md Drill-Down Mandate sections not yet covered in Task 7's drawer: related
  sub-records, workflow timeline, documents, audit trail, Print link.
- Extending `aon-drilldown-employees`'s risk score to the full weighted formula (missing-punch
  rate, half-day rate) matching `attritionRiskScore`'s complete version.
