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

