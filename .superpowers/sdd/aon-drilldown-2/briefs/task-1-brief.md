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

