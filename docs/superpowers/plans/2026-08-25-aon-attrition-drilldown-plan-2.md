# AON & Attrition Drill-Down (Plan 2 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add anomaly surfacing, cost-impact estimate, the extended data-quality nudge, manager
accountability, a top-drivers reframe of Attrition Deep Dive, and wire the same drill-down
components Plan 1 built (`DrillDownProvider`, `SliceDetailPanel`, `EmployeeListPanel`,
`EmployeeDetailDrawer`) into the Cohort Survival and Attrition Deep Dive tabs.

**Architecture:** Every new number in this plan is either computed client-side from data the page
already fetches (anomaly threshold, top-drivers ranking, manager peer-average — no new backend
query needed for any of these) or is one additive column on an existing query (cost impact via a
new `avg_ctc_annual` column on `aonBucketAttrition`; drill-down ids via new columns on
`aonCohortSurvival` and `attritionDeepDive`, mirroring the exact fix Plan 1's whole-branch review
required for the Overview heatmap). No new report codes are added in this plan — everything reuses
`aon-bucket-attrition`, `aon-cohort-survival`, `attrition-deep-dive`, and `aon-drilldown-employees`,
all already registered in both the frontend and backend report catalogs (Plan 1's Critical A fix).

**Tech Stack:** Express + TypeScript (backend), React + TypeScript + `@tanstack/react-query` +
`recharts` (frontend), MySQL via `mysql2`, Vitest for tests.

## Global Constraints

- No new report codes. Every task adds columns to an existing, already-catalogued query, or is
  pure client-side computation — this directly avoids repeating Plan 1's Critical A/B defects
  (a new report code registered in only one of the two catalogs, or a filter field dropped at the
  HTTP-layer whitelist in `report-suite.routes.ts`'s `default:` branch).
- Every new/modified backend query goes through the existing `appendScopeConditions()` /
  `appendFilterConditions()` — no new scope bypass.
- Whenever a task adds a new query filter field (e.g. `cohortMonth`, `dimensionId`), it MUST also
  be added to `report-suite.routes.ts`'s `default:` branch `execFilters` object (around line 3153)
  in the SAME task/commit — this is the exact gap the Plan 1 whole-branch review caught, and it is
  restated here as a standing constraint precisely so no task in this plan repeats it.
- AON reference date remains `AON_REFERENCE_JOIN_DATE_SQL` (`COALESCE(salary_start_date,
  date_of_joining)`) everywhere — reuse the existing constant, never recompute.
- No changes to payroll/salary calculation logic. Reading `employee_salary_assignment.ctc_annual`
  for an average is read-only and does not touch any payroll computation path.
- Drill-down panels follow the platform-wide Drill-Down Mandate in `CLAUDE.md`: right-side
  `Sheet`/`SheetContent side="right"` at `sm:max-w-2xl`, full height, scrollable; the per-employee
  detail drawer fetches from a dedicated `GET /api/employees/:id`.
- Never run a full backend `tsc` — scope typecheck to touched files only. Never trust a report's
  own hand-written test as proof of correctness against live data — every task that touches SQL
  must independently verify its query against the live database (read-only) before considering
  itself done, exactly as every task in Plan 1 was required to and as the whole-branch review
  proved is necessary.
- Before writing a backend query filter that will be reachable over HTTP, verify BOTH backend and
  frontend report catalogs (`backend/src/modules/reporting/report-catalog.ts` and
  `src/lib/report-catalog.ts`) list the report code you're touching, and that any new filter field
  is actually threaded through `report-suite.routes.ts`'s `default:` branch — do not assume a field
  reaches the executor just because it exists in `ExecFilters`'s TypeScript type.
- Commit frequently, by explicit path only — never `git add -A` / `git add .` (shared-tree rule;
  this session has already had 3 concurrent-commit-bundling incidents, all non-destructive but
  real — verify your own files' content after every commit with `git show --stat HEAD`).
- Do not paste a literal database password anywhere in code, commits, or reports — use the existing
  `.env`-based `mysql2/promise` connection pattern already used throughout Plan 1's verification
  scripts for any live read-only check.

---

### Task 1: Backend — cost impact column on `aonBucketAttrition`

**Files:**
- Modify: `backend/src/modules/reporting/executors/aon.executor.ts` (`aonBucketAttrition`)
- Test: `backend/src/modules/reporting/executors/__tests__/aon-attrition-rate.test.ts` (extend)

**Interfaces:**
- Produces: one new column, `avg_ctc_annual` (number | null), on every `aon-bucket-attrition` row
  — the average `ctc_annual` (from `employee_salary_assignment`, `active_status = 1`) across the
  exited employees in that row's group/bucket/month. Consumed by Task 3 (cost-impact tile).

- [ ] **Step 1: Live-verify the CTC data source before writing SQL**

Run a read-only check (throwaway script, `.env` credentials, delete after) confirming:
```sql
SELECT AVG(ctc_annual) avg_ctc, COUNT(*) c FROM employee_salary_assignment WHERE active_status = 1;
```
Expect a result close to `avg_ctc = 142351.14`, `c = 30219` (measured live 2026-08-25 — a materially
different number here means the table has changed since this plan was written; re-derive the join
below accordingly). Also confirm `employee_salary_assignment.employee_id` is the join key to
`employees.id` (it is, per the table's own column list: `id, employee_id, structure_id,
salary_slab_id, salary_proposal_id, governance_mode, assigned_by, assignment_reason, ctc_annual,
effective_from, effective_to, active_status, created_at, updated_at`).

- [ ] **Step 2: Write the failing test**

Add to `backend/src/modules/reporting/executors/__tests__/aon-attrition-rate.test.ts`:
```typescript
it("aonBucketAttrition's SQL selects avg_ctc_annual", async () => {
  mockExecute.mockResolvedValueOnce([[], []]);
  await aonBucketAttrition({}, SCOPE, OPTIONS);
  const sql = String(mockExecute.mock.calls[0][0]);
  expect(sql).toContain("avg_ctc_annual");
  expect(sql).toContain("employee_salary_assignment");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon-attrition-rate.test.ts`
Expected: FAIL — `avg_ctc_annual` not in the current SQL.

- [ ] **Step 4: Implement**

In `aonBucketAttrition` (`aon.executor.ts`), add a CTE joining the exited employees' latest active
CTC, and one new SELECT column. Find the function's current `WITH ${atRiskCte}` / `exit_groups`
structure (from Plan 1's Task 2 restructure) and add a sibling CTE:

```sql
ctc_by_employee AS (
  SELECT esa.employee_id, esa.ctc_annual
    FROM employee_salary_assignment esa
   WHERE esa.active_status = 1
)
```

Then join it into `exit_groups` (or the final `SELECT`, whichever the current structure makes
cleaner — read the live file first to see exactly where `exit_groups` aggregates `e.id`/exit rows,
since you need `AVG(ctc.ctc_annual)` grouped the same way as `exits`) and add:

```sql
ROUND(AVG(ctc.ctc_annual), 0) AS avg_ctc_annual
```

to the final SELECT list, with `LEFT JOIN ctc_by_employee ctc ON ctc.employee_id = e.id` added at
the same join level as the existing `branch_master`/`cost_centre_master`/`process_master` joins
inside `exit_groups`'s own aggregation (a LEFT JOIN so a missing salary assignment doesn't drop the
exit row — read the live current structure of `exit_groups`'s FROM/JOIN clause before editing, since
Plan 1's Task 2 fix already restructured this function twice and you must not regress either
restructure).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon-attrition-rate.test.ts`
Expected: PASS

- [ ] **Step 6: Live-verify the final query**

Run the actual `aonBucketAttrition` function (same pattern as Plan 1: `tsx` script importing it
directly with a super_admin scope, realistic options) and confirm:
1. It still completes in well under 120s (Plan 1's Task 2 fixed this function's performance twice
   — confirm this new join doesn't reintroduce a per-row correlated subquery; it must be a single
   additional LEFT JOIN, not a correlated `SELECT AVG(...) FROM ...` per output row).
2. `avg_ctc_annual` is populated and in a sane range (tens of thousands to low lakhs, not `NaN`,
   not wildly larger than the overall average of ~142,351).
3. Existing columns (`exits`, `aon_attrition_rate_pct`, etc.) are unchanged from before this task
   for the same input — re-run the Step 6 check pattern to confirm no regression.

- [ ] **Step 7: Run the full reporting suite**

Run: `cd backend && npx vitest run src/modules/reporting/`
Expected: all passing, same count as Plan 1's final state (297 passed + 1 skipped) plus your new
test.

- [ ] **Step 8: Scoped typecheck**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon\.executor"`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/reporting/executors/aon.executor.ts backend/src/modules/reporting/executors/__tests__/aon-attrition-rate.test.ts
git commit -m "feat(reporting): add avg_ctc_annual column to aon-bucket-attrition for cost impact

Average ctc_annual (from employee_salary_assignment, active assignments only)
per branch/cost-centre/process/AON-bucket/month group, joined additively --
no new correlated subquery, single LEFT JOIN alongside the existing exit_groups
aggregation. Feeds the cost-impact estimate tile in the frontend (next task)."
```

---

### Task 2: Backend — drill-down ids on `aonCohortSurvival`, and a cohort-month filter on `aon-drilldown-employees`

**Files:**
- Modify: `backend/src/modules/reporting/executors/aon.executor.ts` (`aonCohortSurvival`)
- Modify: `backend/src/modules/reporting/executors/aon-drilldown.executor.ts`
- Modify: `backend/src/modules/reporting/report-suite.routes.ts` (add the new filter field to the
  `default:` branch — see Global Constraints)
- Test: `backend/src/modules/reporting/executors/__tests__/aon.executor.test.ts` (extend),
  `backend/src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts` (extend)

**Interfaces:**
- Produces: `branch_id`/`cost_centre_id`/`process_id` columns on every `aon-cohort-survival` row
  (same pattern as Plan 1's Overview heatmap fix). New `ExecFilters` field `cohortMonth` (a
  `YYYY-MM` string) — when present on `aon-drilldown-employees`, filters headcount-context rows to
  employees whose `AON_REFERENCE_JOIN_DATE_SQL` falls in that calendar month, instead of filtering
  by `aonBucket`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/modules/reporting/executors/__tests__/aon.executor.test.ts`:
```typescript
it("aonCohortSurvival's SQL selects branch_id/cost_centre_id/process_id", async () => {
  mockExecute.mockResolvedValueOnce([[], []]);
  await aonCohortSurvival({}, SCOPE, OPTIONS);
  const sql = String(mockExecute.mock.calls[0][0]);
  expect(sql).toContain("b.id");
  expect(sql).toContain("cc.id");
  expect(sql).toContain("p.id");
});
```

Add to `backend/src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts`:
```typescript
it("filters by cohortMonth for a headcount-context call, matching join-date month", async () => {
  mockExecute.mockResolvedValueOnce([[], []]);
  await aonDrilldownEmployees({ metric: "headcount", cohortMonth: "2026-03" }, SCOPE, OPTIONS);
  const sql = String(mockExecute.mock.calls[0][0]);
  expect(sql).toContain("DATE_FORMAT");
  const params = mockExecute.mock.calls[0][1];
  expect(params).toContain("2026-03");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon.executor.test.ts src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts`
Expected: both new cases FAIL.

- [ ] **Step 3: Implement the `aonCohortSurvival` id columns**

In `aon.executor.ts`'s `aonCohortSurvival`, add to the SELECT list (after the existing
`process_name` column) and GROUP BY (mirroring Plan 1's exact fix to the three Overview functions):

```sql
b.id  AS branch_id,
cc.id AS cost_centre_id,
p.id  AS process_id,
```

and add `b.id, cc.id, p.id` to the `GROUP BY` clause alongside the existing
`b.branch_name, cc.cost_centre_code, cc.cost_centre_name, p.process_name`. This is additive only
(same reasoning as Plan 1's fix: these ids are functionally determined by the same joins already
producing the display names).

- [ ] **Step 4: Implement the `cohortMonth` filter in `aonDrilldownEmployees`**

In `aon-drilldown.executor.ts`, in the headcount/shrinkage (non-exit) branch, add an optional
clause when `filters.cohortMonth` is a valid `YYYY-MM` string:

```typescript
const cohortMonth = typeof filters.cohortMonth === "string" && /^\d{4}-\d{2}$/.test(filters.cohortMonth)
  ? filters.cohortMonth
  : null;
if (cohortMonth) {
  clauses.push(`DATE_FORMAT(${AON_REFERENCE_JOIN_DATE_SQL}, '%Y-%m') = ?`);
  params.push(cohortMonth);
}
```

Place this alongside the existing `aonBucketClause`/`aonBucketAtExitClause` application — both
`aonBucket` and `cohortMonth` can coexist as independent narrowing filters (a caller drilling from
Cohort Survival will pass `cohortMonth` and no `aonBucket`; a caller drilling from the Overview
heatmap will pass `aonBucket` and no `cohortMonth` — do not make them mutually exclusive in the SQL
itself, just apply whichever is present).

- [ ] **Step 5: Add `cohortMonth` to the HTTP filter whitelist**

In `backend/src/modules/reporting/report-suite.routes.ts`'s `default:` branch (the same
`execFilters` object Plan 1's Critical B fix added `metric`/`aonBucket` to), add:

```typescript
cohortMonth: req.query.cohortMonth as string | undefined,
```

This step is not optional polish — skipping it reproduces Plan 1's exact Critical B defect for a
new field. Re-read the current state of that object before editing (Plan 1 already modified it
once; confirm your addition doesn't duplicate or conflict with the existing `metric`/`aonBucket`
lines).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon.executor.test.ts src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts`
Expected: PASS

- [ ] **Step 7: Live-verify both changes**

1. Run `aonCohortSurvival` live (same `tsx` direct-invocation pattern as every prior task) and
   confirm `branch_id`/`cost_centre_id`/`process_id` are populated UUIDs matching real
   `branch_master`/`cost_centre_master`/`process_master` rows for a non-UNASSIGNED group, and that
   row counts are unchanged from before this task (grouping grain must not change).
2. Run `aonDrilldownEmployees({ metric: "headcount", cohortMonth: "<a real YYYY-MM with joiners>" })`
   live and confirm it returns only employees whose join date falls in that month — cross-check
   against a plain `SELECT COUNT(*) FROM employees WHERE DATE_FORMAT(COALESCE(salary_start_date,
   date_of_joining), '%Y-%m') = '<that month>'`.

- [ ] **Step 8: Full reporting suite + scoped typecheck**

Run: `cd backend && npx vitest run src/modules/reporting/`
Run: `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon\.executor|aon-drilldown|report-suite"`
Expected: all passing, no new typecheck output.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/reporting/executors/aon.executor.ts backend/src/modules/reporting/executors/aon-drilldown.executor.ts backend/src/modules/reporting/report-suite.routes.ts backend/src/modules/reporting/executors/__tests__/aon.executor.test.ts backend/src/modules/reporting/executors/__tests__/aon-drilldown.executor.test.ts
git commit -m "feat(reporting): cohort-survival drill ids + cohortMonth filter on drill-down employees

aonCohortSurvival now selects branch_id/cost_centre_id/process_id (additive,
same pattern as the Overview heatmap fix). aon-drilldown-employees gains an
optional cohortMonth filter (YYYY-MM, matched against
COALESCE(salary_start_date, date_of_joining)) for drilling from a Cohort
Survival row into its named employees. cohortMonth is added to report-suite
routes.ts's default execFilters whitelist in this same commit -- the exact
step Plan 1's whole-branch review found missing for metric/aonBucket."
```

---

### Task 3: Backend — dimension id on `attritionDeepDive`, for dimensions that have one

**Files:**
- Modify: `backend/src/modules/reporting/executors/aon.executor.ts` (`DEEP_DIVE_DIMENSIONS`,
  `attritionDeepDive`)
- Test: `backend/src/modules/reporting/executors/__tests__/aon.executor.test.ts` (extend, if it
  covers `attritionDeepDive` already — check first; create a case if not)

**Interfaces:**
- Produces: one new column, `dimension_id` (string | null), on every `attrition-deep-dive` row —
  populated for the 6 dimensions with a real master-table FK (`branch`, `cost_centre`, `process`,
  `department`, `designation`, `reporting_manager`), `null` for the 5 that are derived/proxy values
  with no stable id (`source`, `gender`, `age_band`, `ctc_band`, `exit_type_proxy`). Consumed by
  Task 6 (Deep Dive drill wiring — only rows with a non-null `dimension_id` are clickable).

- [ ] **Step 1: Write the failing test**

```typescript
it("attritionDeepDive selects a dimension_id, populated for id-backed dimensions", async () => {
  mockExecute.mockResolvedValueOnce([[], []]);
  await attritionDeepDive({ dimension: "branch" }, SCOPE, OPTIONS);
  const sql = String(mockExecute.mock.calls[0][0]);
  expect(sql).toContain("dimension_id");
  expect(sql).toContain("b.id");
});

it("attritionDeepDive's dimension_id is NULL for a proxy dimension with no master table", async () => {
  mockExecute.mockResolvedValueOnce([[], []]);
  await attritionDeepDive({ dimension: "source" }, SCOPE, OPTIONS);
  const sql = String(mockExecute.mock.calls[0][0]);
  expect(sql).toMatch(/NULL\s+AS\s+dimension_id/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon.executor.test.ts`
Expected: both new cases FAIL.

- [ ] **Step 3: Implement**

Extend the `DEEP_DIVE_DIMENSIONS` record type and each entry to optionally carry an `idExpr`:

```typescript
const DEEP_DIVE_DIMENSIONS: Record<string, { label: string; expr: string; join?: string; idExpr?: string }> = {
  source: { label: "Source of Hire", expr: SOURCE_NORMALISED },
  branch: {
    label: "Branch",
    expr: "COALESCE(b.branch_name, 'UNASSIGNED')",
    join: "LEFT JOIN branch_master b ON b.id = e.branch_id",
    idExpr: "b.id",
  },
  cost_centre: {
    label: "Cost Centre",
    expr: "COALESCE(cc.cost_centre_name, 'UNASSIGNED')",
    join: "LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id",
    idExpr: "cc.id",
  },
  process: {
    label: "Process",
    expr: "COALESCE(p.process_name, 'UNASSIGNED')",
    join: "LEFT JOIN process_master p ON p.id = e.process_id",
    idExpr: "p.id",
  },
  department: {
    label: "Department",
    expr: "COALESCE(d.dept_name, 'UNASSIGNED')",
    join: "LEFT JOIN department_master d ON d.id = e.department_id",
    idExpr: "d.id",
  },
  designation: {
    label: "Designation",
    expr: "COALESCE(des.designation_name, 'UNASSIGNED')",
    join: "LEFT JOIN designation_master des ON des.id = e.designation_id",
    idExpr: "des.id",
  },
  reporting_manager: {
    label: "Reporting Manager",
    expr: `COALESCE(NULLIF(mgr.full_name, ''), mgr.employee_code, 'UNASSIGNED')`,
    join: "LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id",
    idExpr: "mgr.id",
  },
  // gender, age_band, ctc_band, exit_type_proxy: no idExpr -- leave unset, handled below.
  ...
```

(Read the full current file for the remaining entries — `gender`, `age_band`, `ctc_band`,
`exit_type_proxy` — and leave them exactly as they are, without adding `idExpr`.)

Then, in `attritionDeepDive`'s `base` SQL template, add one column using the dimension's `idExpr` if
present, else a literal `NULL`:

```typescript
const dimensionIdExpr = dim.idExpr ?? "NULL";
```

and in the SELECT list (right after the existing `dimension_value` column):
```sql
${dimensionIdExpr} AS dimension_id,
```

Also add `${dimensionIdExpr}` to the `GROUP BY` clause **only when `dim.idExpr` is set** (grouping
by a literal `NULL` is a no-op and safe to always include, so it's simplest to always add
`${dimensionIdExpr}` to `GROUP BY` regardless — confirm this doesn't change grouping grain for the
proxy dimensions, since `NULL` groups as a single value same as today).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon.executor.test.ts`
Expected: PASS

- [ ] **Step 5: Live-verify**

Run `attritionDeepDive` live for `dimension: "branch"` and `dimension: "reporting_manager"` —
confirm `dimension_id` is a real UUID matching a `branch_master`/`employees` row respectively. Run
it for `dimension: "source"` — confirm `dimension_id` is `null` on every row, and that row counts
and every other column are unchanged from before this task (no grouping-grain regression).

- [ ] **Step 6: Full reporting suite + scoped typecheck**

Run: `cd backend && npx vitest run src/modules/reporting/`
Run: `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon\.executor"`
Expected: all passing, no new typecheck output.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/reporting/executors/aon.executor.ts backend/src/modules/reporting/executors/__tests__/aon.executor.test.ts
git commit -m "feat(reporting): dimension_id on attrition-deep-dive for id-backed dimensions

branch/cost_centre/process/department/designation/reporting_manager each
carry their real master-table FK as dimension_id; the 5 derived/proxy
dimensions (source, gender, age_band, ctc_band, exit_type_proxy) emit NULL,
honestly, since there is no stable id to filter by for those. Feeds Task 6's
Deep Dive drill wiring -- only id-backed dimension values become clickable."
```

---

### Task 4: Frontend — Overview anomaly banner + cost-impact tile + extended data-quality nudge

**Files:**
- Modify: `src/components/reports/views/AonAnalyticsView.tsx` (`Overview`)

**Interfaces:**
- Consumes: `avg_ctc_annual` from Task 1; existing `at.data` (`aon-bucket-attrition` rows, each
  already carrying `aon_attrition_rate_pct`, `exits`, `at_risk_population_avg` from Plan 1).
- Produces: no new exports — purely additive JSX/computation inside `Overview`.

- [ ] **Step 1: Compute company-wide bucket averages and anomalies**

Add a new `useMemo` in `Overview`, after the existing `grid` memo:

```typescript
/*
 * Anomaly detection: for each (group, bucket) in the current attrition data, compare its own
 * AON Attrition Rate against the company-wide rate for that SAME bucket across ALL groups in
 * range. A group is anomalous when its rate is >= ANOMALY_MULTIPLIER x the company rate for that
 * bucket, with a floor on exits so a 1-exit group with no peers doesn't get flagged on noise.
 */
const ANOMALY_MULTIPLIER = 2;
const ANOMALY_MIN_EXITS = 3;

const anomalies = useMemo(() => {
  const rows = at.data ?? [];
  // Company-wide totals per bucket, across every group, for the current date range.
  const byBucket = new Map<string, { exits: number; atRisk: number }>();
  for (const r of rows) {
    const b = s(r.aon_bucket);
    const cur = byBucket.get(b) ?? { exits: 0, atRisk: 0 };
    cur.exits += n(r.exits);
    cur.atRisk += n(r.at_risk_population_avg);
    byBucket.set(b, cur);
  }
  const companyRate = (b: string) => {
    const c = byBucket.get(b);
    return c && c.atRisk > 0 ? (c.exits / c.atRisk) * 100 : null;
  };

  // One row per (group, bucket) that clears both the multiplier and the minimum-exits floor.
  return rows
    .filter(r => n(r.exits) >= ANOMALY_MIN_EXITS)
    .map(r => {
      const rate = n(r.aon_attrition_rate_pct);
      const cRate = companyRate(s(r.aon_bucket));
      return { row: r, rate, companyRate: cRate, ratio: cRate && cRate > 0 ? rate / cRate : null };
    })
    .filter(a => a.ratio != null && a.ratio >= ANOMALY_MULTIPLIER)
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
    .slice(0, 5);
}, [at.data]);
```

- [ ] **Step 2: Render the anomaly banner**

Add a new component above `Overview`'s existing `return`, after `GapBanner`:

```typescript
function AnomalyBanner({
  anomalies, groupBy, onJumpTo,
}: {
  anomalies: Array<{ row: Row; rate: number; companyRate: number | null; ratio: number | null }>;
  groupBy: GroupBy;
  onJumpTo: (row: Row) => void;
}) {
  if (anomalies.length === 0) return null;
  const groupLabel = GROUP_BY.find(g => g.value === groupBy)?.label ?? "group";
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-rose-800">
            Anomalies in this window
          </p>
          {anomalies.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onJumpTo(a.row)}
              className="block w-full rounded-md px-2 py-1 text-left text-[11.5px] leading-snug text-rose-900 hover:bg-rose-100"
            >
              <span className="font-semibold">{s(a.row[groupBy]) || "UNASSIGNED"}</span>
              {" — "}
              {s(a.row.aon_bucket)}d bucket running {pct(a.rate)} attrition,
              {" "}{(a.ratio ?? 0).toFixed(1)}x the company rate ({pct(a.companyRate ?? NaN)})
              {" · "}{num(n(a.row.exits))} exits
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

Wire it into `Overview`'s JSX (after the existing `<GapBanner .../>`, before `{failure && ...}`):

```typescript
<AnomalyBanner
  anomalies={anomalies}
  groupBy={groupBy}
  onJumpTo={(row) => {
    // Reuse the exact same push+open the heatmap cells already do — same dimension mapping,
    // same id/label split, DrillCell's own onClick logic duplicated intentionally here rather
    // than extracted, since this is the only other call site and premature extraction would
    // cost more than it saves for one duplicate 4-line block.
  }}
/>
```

For the `onJumpTo` callback body: it needs `pushChip`/`openEmployeeList` from `useDrillDown()`, but
`AnomalyBanner` is rendered OUTSIDE `DrillDownProvider`'s open scope the same way `DrillCell` is
inside it — check the current JSX nesting (the whole `Overview` return is wrapped in
`<DrillDownProvider>`), so `AnomalyBanner` itself needs to be a child of that provider, OR (simpler)
have `Overview` pass down a callback that itself is defined by a small wrapper component rendered
INSIDE the provider (same pattern as `DrillResetOnChange`). Use this pattern: create a companion
component analogous to `DrillResetOnChange`:

```typescript
function AnomalyJumpHandler({
  anomalies, groupBy, children,
}: {
  anomalies: Array<{ row: Row; rate: number; companyRate: number | null; ratio: number | null }>;
  groupBy: GroupBy;
  children: (onJumpTo: (row: Row) => void) => React.ReactNode;
}) {
  const { pushChip, openEmployeeList } = useDrillDown();
  const dimension = groupBy === "cost_centre_name" ? "costCentre" : groupBy === "process_name" ? "process" : "branch";
  const onJumpTo = (row: Row) => {
    const idField = GROUP_BY_ID_FIELD[groupBy];
    pushChip({ dimension, value: s(row[idField]), label: s(row[groupBy]) || "UNASSIGNED" });
    pushChip({ dimension: "aonBucket", value: s(row.aon_bucket), label: `${s(row.aon_bucket)}d` });
    openEmployeeList();
  };
  return <>{children(onJumpTo)}</>;
}
```

and render it inside the `<DrillDownProvider>` block, wrapping just the banner:
```typescript
<AnomalyJumpHandler anomalies={anomalies} groupBy={groupBy}>
  {(onJumpTo) => <AnomalyBanner anomalies={anomalies} groupBy={groupBy} onJumpTo={onJumpTo} />}
</AnomalyJumpHandler>
```

- [ ] **Step 3: Add the cost-impact tile**

Add a new `useMemo` computing total estimated cost impact from `at.data`'s new `avg_ctc_annual`
column:

```typescript
/*
 * Rough replacement-cost estimate: exits x that group's average CTC x a stated multiplier. A
 * common HR rule-of-thumb range is 0.5-1x annual CTC for full replacement cost (sourcing,
 * onboarding, ramp-up productivity loss); 0.75 is used here as a stated midpoint, not a precise
 * figure -- always rendered with "(estimate)" per this feature's no-fabrication discipline.
 */
const REPLACEMENT_COST_MULTIPLIER = 0.75;

const costImpact = useMemo(() => {
  const rows = at.data ?? [];
  let total = 0;
  for (const r of rows) {
    const ctc = n(r.avg_ctc_annual);
    if (ctc > 0) total += n(r.exits) * ctc * REPLACEMENT_COST_MULTIPLIER;
  }
  return total;
}, [at.data]);
```

Add a formatting helper for ₹ lakhs near the top of the file (or check `analytics-kit` for an
existing one first — grep `@/components/analytics/analytics-kit` for a currency formatter before
writing a new one; use it if found):

```typescript
function inrLakhs(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "₹0";
  const lakhs = value / 100_000;
  return `₹${lakhs.toFixed(1)}L`;
}
```

Add one more `StatTile` in the tiles grid (after the headline attrition-rate tile added in Plan 1):

```typescript
{!loading && metric === "exits" && costImpact > 0 && (
  <StatTile
    label="Est. Replacement Cost (estimate)"
    value={inrLakhs(costImpact)}
    denominator={`${num((at.data ?? []).reduce((a, r) => a + n(r.exits), 0))} exits x avg CTC x ${REPLACEMENT_COST_MULTIPLIER}`}
    intent="warning"
    icon={<TrendingDown className="h-4 w-4" />}
  />
)}
```

Only shown when `metric === "exits"`, since the underlying `at.data` is the attrition dataset —
showing a cost-impact number while viewing headcount or shrinkage would misleadingly suggest that
metric drives the cost figure.

- [ ] **Step 4: Extend the data-quality nudge**

`Overview`'s existing `GapBanner` already has 3 items (cost-centre unassigned, attendance coverage,
exit reason). The exit-reason line currently reads as a flat statement
(`"Not captured in this system — under 1% of leavers have one recorded..."`). Reframe it as an
actionable to-do using the same computed-number discipline as the rest of this banner. Compute the
real capture rate from `at.data` isn't possible (that report doesn't carry `reason_captured_pct`,
`attrition-deep-dive` does) — instead of adding a new query for one number, reuse the already-known,
already-verified live figure the same way the file's own header comment states it ("exit reason is
captured for well under 1% of leavers") — change the copy to name it as a to-do rather than a
passive fact:

```typescript
{
  label: "Exit reason",
  detail: "Not captured in this system — under 1% of leavers have one recorded. Bulk reason-capture for pending exits would close this gap; see the Attrition Deep Dive tab's own reason-capture figure for the exact rate in your current date range. This view shows what kind of joiner leaves and when, never why.",
},
```

(This is a copy-only change — the exact live percentage is already computed and shown correctly on
the Deep Dive tab, which this note now points to, rather than duplicating a second, potentially
inconsistent computation of the same figure here.)

- [ ] **Step 5: Frontend build check**

Run: `npx vite build --mode development 2>&1 | tail -40`
Expected: build succeeds, no new errors.

- [ ] **Step 6: Manual/code-path verification**

Since this file has no dedicated test suite (per Plan 1's established scoping decision), trace the
new code by hand once: confirm `AnomalyJumpHandler` is rendered inside `<DrillDownProvider>` (not
outside it, which would throw `useDrillDown must be used inside a DrillDownProvider`), and confirm
`onJumpTo`'s `idField`/`dimension` mapping exactly matches `DrillCell`'s own (both must derive the
FK id the same way, or a jump-to-anomaly click would push a different filter shape than a direct
heatmap click).

- [ ] **Step 7: Commit**

```bash
git add src/components/reports/views/AonAnalyticsView.tsx
git commit -m "feat(analytics): anomaly banner, cost-impact tile, data-quality nudge on AON Overview

Anomaly banner surfaces (group, bucket) combinations running >=2x the
company-wide AON Attrition Rate for that bucket (min 3 exits, to avoid
flagging noise), each a direct link into the existing Employee List drill.
Cost-impact tile (exits x avg CTC x 0.75, labeled 'estimate') shown only
under the Attrition metric. Exit-reason gap note reframed to point at the
Deep Dive tab's own exact figure rather than duplicating the computation."
```

---

### Task 5: Frontend — Attrition Deep Dive: top-drivers reframe + manager accountability

**Files:**
- Modify: `src/components/reports/views/AonAnalyticsView.tsx` (`DeepDive`)

**Interfaces:**
- Consumes: `dimension_id` from Task 3 (on `q.data` rows when `dimension === "reporting_manager"`
  or any other id-backed dimension).

- [ ] **Step 1: Reframe the bar chart ranking**

`DeepDive`'s existing `values` memo sorts by `b.total - a.total` (raw exit count). Change the sort
to rank by deviation from the average `early` rate across all values in the current slice — this
alone answers "what's driving attrition" without a separate view:

```typescript
const values = useMemo(() => {
  const map = new Map<string, { total: number; early: number; buckets: Record<string, number>; dimensionId: string | null }>();
  for (const r of q.data ?? []) {
    const k = s(r.dimension_value) || "UNASSIGNED";
    const cur = map.get(k) ?? { total: 0, early: n(r.early_quit_rate), buckets: {}, dimensionId: s(r.dimension_id) || null };
    cur.total += n(r.exits);
    cur.buckets[s(r.aon_bucket)] = n(r.exits);
    map.set(k, cur);
  }
  const list = [...map.entries()].map(([value, v]) => ({ value, ...v }));
  const avgEarly = list.length
    ? list.reduce((a, v) => a + v.early, 0) / list.length
    : 0;
  return list
    .map(v => ({ ...v, deviationFromAvg: v.early - avgEarly }))
    .sort((a, b) => b.deviationFromAvg - a.deviationFromAvg)
    .slice(0, 20);
}, [q.data]);
```

Update the chart subtitle to reflect the new ranking:
```typescript
subtitle="Ranked by how far each slice's early-quit rate sits above the average across all slices shown — this IS the answer to what's driving attrition, not a separate view."
```

- [ ] **Step 2: Add "vs peer average" column + flag action for the Reporting Manager dimension**

When `dimension === "reporting_manager"`, the same table gains two things: a "vs Peer Avg" column
and a flag icon per row. Add this conditionally to the existing "Exits by AON bucket" table (the
second `ChartCard` in `DeepDive`'s JSX). First, compute the peer average once (reuse `values`'s
already-computed `avgEarly` — lift it out of the `useMemo` so both the chart and the table can use
it):

```typescript
const avgEarlyQuitRate = useMemo(
  () => (values.length ? values.reduce((a, v) => a + v.early, 0) / values.length : 0),
  [values],
);
```

In the table's header row, conditionally add one more `<th>`:
```typescript
{dimension === "reporting_manager" && (
  <th className="px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">vs Peer Avg</th>
)}
```

And in each row, conditionally add the corresponding `<td>`:
```typescript
{dimension === "reporting_manager" && (
  <td className={`px-2 py-1.5 text-right tabular-nums ${v.early > avgEarlyQuitRate ? "text-rose-700" : "text-emerald-700"}`}>
    {v.early > avgEarlyQuitRate ? "+" : ""}{(v.early - avgEarlyQuitRate).toFixed(1)}pp
  </td>
)}
```

- [ ] **Step 3: Wire drill-down for id-backed dimensions**

Wrap `DeepDive`'s return in `<DrillDownProvider>` (same pattern as `Overview`), and make each table
row clickable ONLY when `v.dimensionId` is non-null (per Task 3's design — proxy dimensions have no
stable id to filter by, so their rows correctly stay non-interactive rather than silently filtering
on a display-name string, which would repeat exactly the bug Plan 1's whole-branch review found and
fixed for the Overview heatmap):

```typescript
function DeepDiveRow({
  v, buckets, dimension,
}: { v: { value: string; total: number; early: number; buckets: Record<string, number>; dimensionId: string | null }; buckets: readonly Bucket[]; dimension: string }) {
  const { pushChip, openEmployeeList } = useDrillDown();
  const clickable = v.dimensionId != null && v.dimensionId !== "";

  const dimensionToFilterField: Record<string, string> = {
    branch: "branch", cost_centre: "costCentre", process: "process",
    department: "department", designation: "designation", reporting_manager: "managerId",
  };

  const handleClick = () => {
    if (!clickable) return;
    const field = dimensionToFilterField[dimension];
    if (!field) return;
    pushChip({ dimension: field, value: v.dimensionId!, label: v.value });
    openEmployeeList();
  };

  return (
    <tr
      className={`border-b border-slate-100 ${clickable ? "cursor-pointer hover:bg-slate-50" : ""}`}
      onClick={clickable ? handleClick : undefined}
    >
      {/* existing <td> cells unchanged */}
    </tr>
  );
}
```

**IMPORTANT — check before wiring this in**: `chipsToFilterParams` (in `SliceDetailPanel.tsx`,
reused by `EmployeeListPanel.tsx`) currently only maps `costCentre`/`process`/`branch`/`aonBucket`
dimensions to filter params. `department`, `designation`, and `managerId` are NOT in that mapping
today, and `aon-drilldown-employees`'s `appendFilterConditions` (from `types.ts`) already supports
`departmentId` and `managerId` as filter fields (check `ExecFilters`'s existing shape — it already
declares `departmentId?: string` and `managerId?: string`), but `designation` has no corresponding
filter field anywhere in the executor layer. Before wiring this task's drill-down:
1. Extend `chipsToFilterParams` in `SliceDetailPanel.tsx` to also map `department → departmentId`
   and `reporting_manager → managerId` (dimension names here should match whatever
   `dimensionToFilterField` above produces — align the two).
2. For `designation`, either add a new `designationId` filter field to `ExecFilters`/
   `appendFilterConditions`/`aon-drilldown-employees` (a small addition, following the exact same
   pattern as the existing `costCentreId`/`processId` fields), or — simpler for this pass — leave
   `designation` OUT of `dimensionToFilterField` (so designation rows stay non-clickable this
   round, same treatment as the proxy dimensions) and note it as a fast follow-up. Your call; if
   you add `designationId`, remember Task 2's Global Constraint: any new filter field MUST also be
   added to `report-suite.routes.ts`'s `default:` branch `execFilters` object in the same commit.

Replace the existing inline `<tr>` in the "Exits by AON bucket" table's `.map()` with
`<DeepDiveRow v={v} buckets={BUCKETS} dimension={dimension} key={v.value} />`, and add
`<EmployeeListPanel open metric="exits" from={from} to={to} />` and `<EmployeeDetailDrawer />` once
at the bottom of `DeepDive`'s JSX (same pattern as `Overview`), all inside the wrapping
`<DrillDownProvider>`.

- [ ] **Step 4: Frontend build check**

Run: `npx vite build --mode development 2>&1 | tail -40`
Expected: build succeeds, no new errors.

- [ ] **Step 5: Manual code-path verification**

Trace by hand: for `dimension: "reporting_manager"`, confirm a row's `dimensionId` (from the
backend's `mgr.id`) flows correctly into the pushed chip's `value`, and that
`chipsToFilterParams`'s `managerId` mapping (added in Step 3) produces exactly the query param
`aon-drilldown-employees`'s `appendFilterConditions` already reads as `filters.managerId`.

- [ ] **Step 6: Commit**

```bash
git add src/components/reports/views/AonAnalyticsView.tsx src/components/analytics/drilldown/SliceDetailPanel.tsx
git commit -m "feat(analytics): top-drivers reframe + manager accountability + drill wiring on Deep Dive

Bar chart and table now rank by deviation from the average early-quit rate
across the current slice, not raw exit count -- this alone answers what is
driving attrition. Reporting Manager dimension gains a 'vs Peer Avg' column.
Rows for id-backed dimensions (branch/cost_centre/process/department/
reporting_manager) are now clickable into the existing Employee List drill;
proxy dimensions with no stable id (source/gender/age_band/ctc_band/
exit_type_proxy) and designation (no filter field added this round) stay
non-interactive rather than filtering on a display-name string."
```

---

### Task 6: Frontend — wire drill-down into Cohort Survival

**Files:**
- Modify: `src/components/reports/views/AonAnalyticsView.tsx` (`CohortSurvival`)

**Interfaces:**
- Consumes: `branch_id`/`cost_centre_id`/`process_id` from Task 2's `aon-cohort-survival` fix;
  `cohortMonth` filter from Task 2's `aon-drilldown-employees` extension.

- [ ] **Step 1: Wrap `CohortSurvival` in `DrillDownProvider`, make cohort rows clickable**

`CohortSurvival`'s cohort-detail table (the "Cohort detail" `ChartCard`) is rolled up across
branch/cost-centre/process by `cohort_month` alone (see the existing `cohorts` memo, which discards
the per-branch/cost-centre/process id columns entirely when aggregating). Since the table's rows
are already a whole-company rollup per month, drilling a row means "show me everyone who joined in
this month" — a `cohortMonth`-only filter, with no branch/cost-centre/process narrowing (that
granularity was already thrown away by the existing rollup, and re-deriving it would need a second,
un-rolled-up data structure this task does not need to build).

Make each cohort-detail row clickable:

```typescript
function CohortRow({ c }: { c: { cohort: string; joined: number; left30: number } & Record<string, number | null> }) {
  const { pushChip, openEmployeeList } = useDrillDown();
  return (
    <tr
      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
      onClick={() => {
        pushChip({ dimension: "cohortMonth", value: c.cohort, label: `Joined ${c.cohort}` });
        openEmployeeList();
      }}
    >
      {/* existing <td> cells, unchanged */}
    </tr>
  );
}
```

Replace the existing inline `<tr>` in the cohort-detail table's `.map()` with `<CohortRow c={c}
key={c.cohort} />`.

Extend `chipsToFilterParams` in `SliceDetailPanel.tsx` (already touched in Task 5) to also map
`cohortMonth → cohortMonth` (identity mapping — the chip's dimension name and the filter param name
are the same here, unlike `costCentre → costCentreId`):

```typescript
else if (chip.dimension === "cohortMonth") params.cohortMonth = chip.value;
```

- [ ] **Step 2: Wrap the whole component and mount the panels**

```typescript
function CohortSurvival({ from, to, branchId }: { from: string; to: string; branchId: string }) {
  // ... existing hooks/memos unchanged ...

  if (q.error) {
    return ( /* unchanged error block */ );
  }

  return (
    <DrillDownProvider>
    <div className="space-y-4">
      {/* ... all existing JSX unchanged, with CohortRow swapped in ... */}
      <EmployeeListPanel open metric="headcount" from={from} to={to} />
      <EmployeeDetailDrawer />
    </div>
    </DrillDownProvider>
  );
}
```

Note: pass `metric="headcount"` here (not `"exits"`) — a cohort-month drill shows everyone who
JOINED in that month (an active-employee-shaped question, matching `aonDrilldownEmployees`'s
headcount-context branch, which is the one Task 2 added the `cohortMonth` filter to). This is a
deliberate, documented choice: showing "who joined" is a headcount-context question even though
some of those joiners have since left — a caller wanting only the leavers from that cohort would
need a different, not-yet-built filter combination; note this as a known scope limit in the commit
message, not a bug to chase in this task.

- [ ] **Step 3: Frontend build check**

Run: `npx vite build --mode development 2>&1 | tail -40`
Expected: build succeeds, no new errors.

- [ ] **Step 4: Manual code-path verification**

Trace by hand: `CohortRow`'s pushed chip has `dimension: "cohortMonth"`, `value: c.cohort` (a
`YYYY-MM` string, e.g. `"2026-03"` — confirm this matches the exact format Task 2's backend
`cohortMonth` filter expects, `^\d{4}-\d{2}$`). Confirm `EmployeeListPanel`'s existing chip-bar
rendering (added in Plan 1's whole-branch review fix) displays this chip sensibly (label "Joined
2026-03" reads correctly, not as a raw dimension key).

- [ ] **Step 5: Commit**

```bash
git add src/components/reports/views/AonAnalyticsView.tsx src/components/analytics/drilldown/SliceDetailPanel.tsx
git commit -m "feat(analytics): wire drill-down into Cohort Survival tab

Cohort-detail rows are clickable, drilling into everyone who joined that
month (headcount context, since the cohort-detail table is already rolled
up across branch/cost-centre/process and a per-dimension re-derivation is
out of scope for this pass). Reuses the existing Employee List panel and
detail drawer unchanged."
```

---

### Task 7: Whole-plan verification

**Files:** none (verification only)

- [ ] **Step 1: Full backend reporting suite**

Run: `cd backend && npx vitest run src/modules/reporting/`
Expected: all passing (baseline before this plan: 49 files, 297 passed + 1 skipped — expect this
count plus every new test added in Tasks 1-3).

- [ ] **Step 2: Full frontend drilldown suite**

Run: `npx vitest run src/components/analytics/drilldown/`
Expected: 18/18 passing, unchanged from Plan 1's final state (this plan adds no new drilldown
component tests — all new interaction wiring lives in the untested `AonAnalyticsView.tsx`, per the
same scoping decision Plan 1 made for that file).

- [ ] **Step 3: Frontend build**

Run: `npx vite build --mode development 2>&1 | tail -40`
Expected: succeeds, no new errors.

- [ ] **Step 4: Scoped backend typecheck**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon\.executor|aon-drilldown|report-suite"`
Expected: no output.

- [ ] **Step 5: End-to-end trace of one realistic interaction per tab**

Given `AonAnalyticsView.tsx` has no dedicated test file (an established, deliberate scoping
decision carried over from Plan 1), this manual trace is the equivalent gate Plan 1's own whole-
branch review identified as the one step that would have caught its two Critical defects. Do not
skip it:

1. **Overview**: an anomaly banner entry clicked → chip pushed with the real FK id (not a display
   name) → Employee List panel query params match what `aon-drilldown-employees` expects → a real
   row (or correct empty state) renders.
2. **Deep Dive**: dimension set to "Reporting Manager" → a row clicked → chip pushed with
   `managerId` → Employee List panel's query includes `managerId=<uuid>` → `aon-drilldown-employees`
   filters via `appendFilterConditions`'s existing `managerId` clause → a real row (or correct
   empty state) renders.
3. **Cohort Survival**: a cohort-detail row clicked → chip pushed with `cohortMonth=<YYYY-MM>` →
   Employee List panel's query includes `cohortMonth=<value>` → `aon-drilldown-employees`'s new
   `cohortMonth` clause (Task 2) filters correctly → a real row (or correct empty state) renders.

For each, confirm by reading the actual current code end to end (component → chip → filter-param
mapping → HTTP query string → `report-suite.routes.ts`'s `default:` branch `execFilters` → executor
clause) that every field name and every id type lines up, exactly as Plan 1's whole-branch review
did for the Overview heatmap. If you find a gap analogous to Plan 1's Critical A/B (a filter field
declared in `ExecFilters`'s type but never added to `execFilters` in `report-suite.routes.ts`, or a
report code that exists in one catalog but not the other — though this plan adds no new codes, so
that specific failure mode should not recur, but verify rather than assume), fix it before
considering this plan complete.

- [ ] **Step 6: Update the progress ledger**

Append a final summary entry to `.superpowers/sdd/progress.md` documenting Plan 2's completion,
following the same format as Plan 1's final entries (task-by-task commit SHAs, what each fixed,
what's still deferred).

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-08-25-aon-attrition-drilldown-design.md`):
- §4 Anomaly banner + extended data-quality nudge: Task 4. ✓
- §5 Cost impact estimate: Task 1 (backend column) + Task 4 (frontend tile). ✓
- §7 Manager accountability, folded into Deep Dive's existing selector, no new tab: Task 5. ✓
- §8 Top attrition drivers reframe: Task 5. ✓
- Cohort Survival / Attrition Deep Dive drill wiring (deferred from Plan 1): Tasks 2, 3, 5, 6. ✓
- §3's two-panel model, reused not rebuilt: every frontend task reuses `DrillDownProvider`/
  `SliceDetailPanel`/`EmployeeListPanel`/`EmployeeDetailDrawer` from Plan 1 unchanged in structure.

**Placeholder scan**: no `TBD`/`TODO`. Two explicit, bounded scope-limit notes exist (designation
dimension left non-clickable pending a small follow-up filter field; cohort-month drill is
headcount-context only, not exits-context) — both are stated design decisions with reasoning, not
unfinished placeholders.

**Type consistency**: `dimensionId`/`dimension_id` naming is consistent between Task 3's backend
column and Task 5's frontend consumption. `cohortMonth` is spelled identically across Task 2's
backend filter, Task 6's frontend chip dimension, and the `chipsToFilterParams` mapping added in
Task 6. `GROUP_BY_ID_FIELD`/`dimensionToFilterField` naming follows Plan 1's established
`DrillCell`/chip-mapping conventions exactly.

## Verification Summary (run at the end of Task 7, not before)

- Backend reporting suite: full pass, count to be confirmed against Plan 1's 297+1 baseline plus
  this plan's new tests.
- Frontend drilldown suite: 18/18, unchanged (no new component tests added by this plan).
- Frontend build: clean.
- Manual end-to-end trace for Overview/Deep Dive/Cohort Survival: performed and passing before this
  plan is considered complete — this is the step whose absence caused Plan 1's two Critical defects
  to ship past every individual task review, so it is not optional here either.
