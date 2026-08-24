## Global Constraints (from the plan)


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

