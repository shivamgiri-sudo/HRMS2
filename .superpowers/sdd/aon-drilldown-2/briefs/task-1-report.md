# Task 1 Report — cost impact column on `aonBucketAttrition`

Status: DONE
Commit: `61aabc3e` (pushed to origin/main; confirmed via `git merge-base --is-ancestor 61aabc3e origin/main`)

## Step 1 — Live-verify the CTC data source

Throwaway script `backend/scripts/tmp-verify-ctc.ts` (deleted after use), using the existing
`.env`-based `db` pool from `src/db/mysql.ts`. Query and live result:

```sql
SELECT AVG(ctc_annual) avg_ctc, COUNT(*) c FROM employee_salary_assignment WHERE active_status = 1;
```

Result: `{"avg_ctc":142351.135899,"c":30219}` — matches the brief's expected
`avg_ctc = 142351.14`, `c = 30219` exactly (measured live 2026-08-25).

Also confirmed via `information_schema.columns` that `employee_salary_assignment`'s column
list is exactly `id, employee_id, structure_id, salary_slab_id, salary_proposal_id,
governance_mode, assigned_by, assignment_reason, ctc_annual, effective_from, effective_to,
active_status, created_at, updated_at` — `employee_id` is the join key to `employees.id`, as
the brief stated.

## Final SQL added

Two additions to `aonBucketAttrition` in `backend/src/modules/reporting/executors/aon.executor.ts`:

1. A sibling CTE to the existing `at_risk` CTE, added to the same `WITH` clause:

```sql
ctc_by_employee AS (
  SELECT esa.employee_id, esa.ctc_annual
    FROM employee_salary_assignment esa
   WHERE esa.active_status = 1
)
```

2. Inside `exit_groups`' own FROM/JOIN (same join level as `branch_master` /
   `cost_centre_master` / `process_master`):

```sql
LEFT JOIN ctc_by_employee ctc ON ctc.employee_id = e.id
```

   and one new aggregate column in `exit_groups`' SELECT list:

```sql
ROUND(AVG(ctc.ctc_annual), 0) AS avg_ctc_annual
```

3. Passed through unchanged in the final outer `SELECT` (`g.avg_ctc_annual`), alongside the
   existing `g.process_coverage_pct`.

No correlated subquery was introduced — `ctc_by_employee` is scanned once and LEFT-JOINed
into `exit_groups`'s existing single-pass aggregation. `active_status = 1` on
`employee_salary_assignment` means at most one row per `employee_id` matches, so the join
cannot fan out `exits`, `avg_tenure_days`, or any other existing column in `exit_groups`.

## Performance — live-timed, no regression

Ran the real `aonBucketAttrition` function directly via `tsx` (throwaway script
`backend/scripts/tmp-verify-aon-ctc.ts`, deleted after use), unscoped super_admin scope,
default 12-month window, `limit: 2000`:

```
elapsed: 8.495s, rowCount: 545, rows returned: 545
rows with avg_ctc_annual populated: 545 / 545
min avg_ctc_annual: 87000
max avg_ctc_annual: 1500000
any NaN: false
```

- 8.5s, well under the 120s API gateway limit and consistent with Plan 1's post-fix
  performance for this same function.
- 545 rows — matches the exact row count already documented live in this file's own
  comments for the unscoped 12-month default ("545 rows measured live"), confirming no
  change in `exit_groups`' cardinality (i.e. the new LEFT JOIN did not fan out rows).
- `avg_ctc_annual` populated on all 545 rows (LEFT JOIN, no employee dropped), sane range
  (₹87,000–₹15,00,000; a small handful of low-`exits` groups sit at the high end, e.g. a
  single high-earner exit — expected for an unweighted per-group average, not a bug).
- No NaN values.
- Existing columns (`exits`, `aon_attrition_rate_pct`, `at_risk_population_avg`,
  `process_coverage_pct`, etc.) present and populated as before; sample row keys confirm all
  prior columns are intact plus the one new column.

## Test output

Failing-first (Step 3), confirmed:
```
✗ aonBucketAttrition's SQL selects avg_ctc_annual
  expect(sql).toContain("avg_ctc_annual")  — FAILED (not yet in SQL)
Test Files  1 failed (1)
Tests  1 failed | 2 passed (3)
```

After implementation (Step 5):
```
Test Files  1 passed (1)
Tests  3 passed (3)
```

Full reporting suite (Step 7):
```
Test Files  49 passed (49)
Tests  298 passed | 1 skipped (299)
```
298 passed + 1 skipped = Plan 1's final 297 passed + 1 skipped, plus this task's 1 new test.

Scoped typecheck (Step 8):
```
cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon\.executor"
```
No output — no errors in the touched file.

## Commit

```
commit 61aabc3e
feat(reporting): add avg_ctc_annual column to aon-bucket-attrition for cost impact
 2 files changed, 35 insertions(+), 1 deletion(-)
```
`git show --stat HEAD` confirmed only the two intended files
(`aon.executor.ts`, `aon-attrition-rate.test.ts`) landed in the commit — `git status
--porcelain` was checked immediately before staging and several unrelated dirty/untracked
files belonging to other concurrent sessions were left untouched (staged by explicit path
only, never `git add -A`/`git add .`).

Pushed to `origin/main` (`14890d03..61aabc3e`); pre-push structural guards passed; confirmed
ancestor of `origin/main` via `git merge-base --is-ancestor 61aabc3e origin/main`.

## Concerns

None. This task only added a column to an existing, already-catalogued report code
(`aon-bucket-attrition`) — no new report code, no new filter field, so neither of Plan 1's
two whole-branch-review defect classes (uncatalogued report code / dropped HTTP filter
field) applies here. The column is consumed only by Task 3 (cost-impact tile), not yet
wired into any frontend code as part of this task.
