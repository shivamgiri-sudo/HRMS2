# Task 7 Report — EmployeeDetailDrawer (3rd drill level)

## Status: DONE

Commit: `3ddb0f02` — confirmed an ancestor of `origin/main` (verified with
`git merge-base --is-ancestor 3ddb0f02 origin/main`).

## Files

- Created `src/components/analytics/drilldown/EmployeeDetailDrawer.tsx`
- Created `src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx`

## What the real `GET /api/employees/:id` response actually contains (vs the brief's assumption)

The brief's Step 1 test/Step 3 implementation assumed the response carries
`branch_name`, `cost_centre_name`, `process_name`, `date_of_joining`, `date_of_exit`.
I read the route and its controller/service before implementing:

- `backend/src/modules/employees/employee.routes.ts:1442` — `router.get("/:id", ...)`
  does a scope check, then calls `c.getEmployee(req, res)`.
- `backend/src/modules/employees/employee.controller.ts:getEmployee` calls
  `employeeService.getEmployee(id)`, then `redactEmployeeIdentifiers(data, roles)`,
  and returns `{ data }`.
- `backend/src/modules/employees/employee.service.ts:271` — the query is:
  ```sql
  SELECT *, COALESCE(NULLIF(TRIM(official_email),''), email) AS email
  FROM employees WHERE id = ? LIMIT 1
  ```
  **This is a flat `SELECT *` on `employees` with no joins whatsoever.**
- `redactEmployeeIdentifiers` (backend/src/shared/employeeIdentifierRedaction.ts)
  only (a) strips crypto-plumbing columns and (b) masks
  `aadhaar_number`/`pan_number`/`bank_account_number`/`uan_number`/`ifsc_code`
  for roles outside `RAW_IDENTIFIER_ROLES` — it does not add or rename any field.

Net result: **there is no `branch_name`, `cost_centre_name`, or `process_name`
anywhere in this response** — only the raw FK ids: `branch_id`, `department_id`,
`process_id`, and `cost_centre_id` (present on the table per
`backend/sql/schema-snapshot.json` even though it isn't declared in the
`Employee` TS interface in `employee.types.ts`, which is stale relative to the
actual table). `date_of_joining` and `date_of_exit` *are* real fields, confirmed
in `employee.types.ts`, along with `salary_start_date`.

I built the drawer around the real fields: Employment (status/type), Assignment
(branch_id/department_id/process_id/cost_centre_id shown as raw ids, with an
inline comment explaining why — no invented display names), and Tenure
(date_of_joining/salary_start_date/date_of_exit via `formatDate`). Sections
follow the CLAUDE.md Drill-Down Mandate visual pattern (`text-xs font-bold
uppercase tracking-wide text-slate-400` section labels, right-side `Sheet`
`sm:max-w-2xl` full height scrollable). Per the brief, the workflow-timeline/
documents/audit-trail sections are explicitly deferred to Plan 2.

## Test approach deviation from the brief

The brief's Step 1 test imports `@testing-library/react` and calls
`render()`/`.click()`. Running it verbatim failed immediately:

```
Error: Cannot find package '@testing-library/react' imported from
.../EmployeeDetailDrawer.test.tsx
```

This repo has no `@testing-library/react`/`jsdom` installed (confirmed), and
`DrillDownProvider.test.tsx` / `EmployeeListPanel.test.tsx` (Tasks 6) already
documented and worked around the same gap. I followed the established
in-repo pattern instead of the brief's snippet:

- Section A: `renderToStaticMarkup` mounts the real `DrillDownProvider` +
  `EmployeeDetailDrawer`, proving `useDrillDown()` wiring is correct and that
  nothing renders (no "Assignment" text) when `selectedEmployeeId` is null;
  plus the standard "throws outside a DrillDownProvider" guard test.
- Section B: exercises the exported pure helpers the component's `useQuery`
  actually calls — `fetchEmployeeDetail` (asserts it hits exactly
  `/api/employees/emp-1` and never any `/api/reports` path) and `formatDate`
  (DD/MM/YYYY on a valid ISO string, `"—"` on null, undefined, and an invalid
  date string, without throwing).

## Step 2: confirm failing test (module doesn't exist yet)

```
$ npx vitest run src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx
 FAIL  .../EmployeeDetailDrawer.test.tsx
Error: Cannot find module '/src/components/analytics/drilldown/EmployeeDetailDrawer'
 Test Files  1 failed (1)
      Tests  no tests
```

## Step 4: test passes after implementation

```
$ npx vitest run src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  1.74s
```

Tests:
1. `EmployeeDetailDrawer — mount > renders inside a DrillDownProvider without crashing while no employee is selected` — PASS
2. `EmployeeDetailDrawer — mount > throws outside a DrillDownProvider` — PASS
3. `EmployeeDetailDrawer — data fetch > fetchEmployeeDetail hits GET /api/employees/:id and unwraps res.data, never a list report path` — PASS
4. `EmployeeDetailDrawer — formatDate > formats an ISO date string as DD/MM/YYYY` — PASS
5. `EmployeeDetailDrawer — formatDate > returns a placeholder for null/undefined without crashing` — PASS
6. `EmployeeDetailDrawer — formatDate > returns a placeholder for an invalid date string without crashing` — PASS

## Step 5: frontend build check

```
$ npx vite build --mode development
✓ built in 9.78s
```
No new errors; only the pre-existing "chunks larger than 500kB" advisory warning (unrelated, pre-existing across the whole app).

## Step 6: commit and push

Committed by explicit path only (`git add <path1> <path2>`, never `-A`/`.`):
```
[main 3ddb0f02] feat(analytics): per-employee detail drawer (3rd drill level)
 2 files changed, 234 insertions(+)
 create mode 100644 src/components/analytics/drilldown/EmployeeDetailDrawer.tsx
 create mode 100644 src/components/analytics/drilldown/__tests__/EmployeeDetailDrawer.test.tsx
```
`git show --stat HEAD` confirmed exactly those 2 files landed — nothing from
the many unrelated dirty/untracked files in this shared tree (`.superpowers/sdd/...`
briefs and reports from Tasks 2-6, plus an entirely separate in-flight
`employee-performance-scorecard` plan) was swept in.

### Push — one concurrent-tree wrinkle, no git surgery needed

First `git push origin HEAD:refs/heads/main` was BLOCKED by the pre-push
structural guard (`migration-manifest-guard`), reporting that
`migrations/1607_performance_scorecard_page_catalog.sql` didn't exist —
this is a different, concurrent session's in-flight migration (their own
`employee-performance-scorecard` plan, unrelated to Task 7's frontend-only
change). Re-running that one guard test directly in `backend/`
(`npx vitest run src/db/__tests__/migration-manifest-guard.test.ts`)
immediately after showed **9 passed** — the earlier failure was a
transient read of a file mid-write by that concurrent session in the shared
tree, not a real defect and not something my change touched.

Retried the push: guards passed, but the ref-lock was rejected
(`cannot lock ref 'refs/heads/main': is at f993fa58... but expected adec39f3...`)
— another concurrent commit landed on `main` between my fetch and push.
Per instructions, did **not** attempt any git surgery. Instead: `git fetch
origin main` again and checked whether my commit was already incorporated.
It was — `origin/main` is now `f993fa58` (a concurrent session's own guard fix
for the same 1607 migration, one commit ahead of mine), and

```
$ git merge-base --is-ancestor 3ddb0f02 origin/main && echo CONFIRMED
CONFIRMED: my commit is an ancestor of origin/main
```

confirms `3ddb0f02` (this task's commit, content verified via `git show --stat`
above) is already on `main`. No force-push, no rebase, no `--no-verify` was
needed in the end.

## Concerns / follow-ups

1. **Assignment section shows raw ids, not names.** Branch/department/process/
   cost-centre are shown as bare UUIDs (`branch_id`, etc.) because the endpoint
   does no joins. This is honest but not very useful for an end user reading the
   drawer — a real fix needs either a join added to `employee.service.ts`'s
   `getEmployee` query or a client-side lookup against the branch/process/cost-
   centre master lists already loaded elsewhere in the app. Flagging as a
   near-term follow-up rather than doing it here, since "no changes to existing
   queries beyond what the brief scoped" and the brief explicitly deferred the
   fuller record view to Plan 2.
2. **`Employee` TS interface is stale** (`employee.types.ts` doesn't declare
   `cost_centre_id`, `reporting_manager_id` is there but several other real
   columns aren't) — not fixed here since it's out of this task's scope, but
   worth a note for whoever does the join/lookup follow-up above.
3. Confirmed via direct reads (not assumed) that `useDrillDown()`'s
   `selectedEmployeeId: string | null`, `selectEmployee: (id: string) => void`,
   `deselectEmployee: () => void` match exactly what Task 6 shipped in
   `DrillDownProvider.tsx` — no interface drift found.
