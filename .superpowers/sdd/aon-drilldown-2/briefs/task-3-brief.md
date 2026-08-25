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

