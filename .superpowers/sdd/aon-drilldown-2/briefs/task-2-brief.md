## Global Constraints (from the plan)


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

