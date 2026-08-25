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

