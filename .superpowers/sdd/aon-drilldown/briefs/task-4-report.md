# Task 4 report — Flag for Retention Review endpoint

**Status:** DONE
**Commit:** `fdf4c0d0` (pushed to `origin/main`, ancestor-verified)

## What was built

`POST /api/reports/aon-analytics/flag-retention` — body `{ employeeId, riskBand? }`, response
`{ success: true, outcome: "created" | "refreshed" }`. Reuses `upsertOpenWorkItem()` from
`backend/src/shared/workItem.ts` unchanged (no signature change, no new Work Inbox plumbing).

Files:
- Created `backend/src/modules/reporting/aon-retention-flag.routes.ts`
- Created `backend/src/modules/reporting/__tests__/aon-retention-flag.routes.test.ts`
- Modified `backend/src/app.ts` (import + mount, 2 lines only)

## Live verification of the manager-role resolution chain (before trusting the brief's SQL)

Ran read-only queries against `mas_hrms` on `122.184.128.90` via a throwaway `mysql2` script run
from `backend/` (no `mysql` CLI available on this box; deleted after use). Two real defects found
in the brief's sketch, both fixed:

**Defect 1 — email is the wrong join key.**
The brief joined `employees` → `auth_user` by matching `COALESCE(official_email, email)` against
`auth_user.email`. Checked live:
- `employees.official_email` is a placeholder value (`'na'`, `'n/a'`, etc.) on **17,854** rows;
  `employees.email` is a placeholder on **22,171** rows. Many real employees also carry a personal
  Gmail address in `email` with `official_email` NULL.
- `employees.user_id CHAR(36)` is the actual FK to `auth_user.id` (confirmed via `SHOW COLUMNS`
  and sampled rows).
- Resolution-rate comparison over the 161 distinct `reporting_manager_id` values currently in use:
  - email-join (brief's approach, `_ci` collation so case wasn't the issue): **66/161** resolved.
  - `employees.user_id` → `auth_user.id`: **77/161** resolved.
- Fixed by joining `employees mgr JOIN user_roles ur ON ur.user_id = mgr.user_id WHERE mgr.id = ?`
  instead of the email subquery.
- Collation note: `auth_user.email` and `employees.email`/`official_email` are all
  `utf8mb4_unicode_ci`, so MySQL `=` comparisons on these columns are already case-insensitive at
  the DB level — case sensitivity was checked and is **not** actually a defect here, contrary to
  what the task brief flagged as a possibility.

**Defect 2 — unordered `LIMIT 1` over `user_roles` picks an arbitrary role.**
Checked a real manager (`naresh.chauhan@teammas.in`, employee `MAS00175`) who has 6 rows in
`user_roles`, 3 of them `active_status = 1` simultaneously: `employee`, `payroll_admin`,
`payroll_hr`. The brief's `SELECT role_key ... AND active_status = 1 LIMIT 1` with no `ORDER BY`
returns whichever the engine hands back first — in a live check it returned `employee`, useless as
a review-routing target. Fixed by fetching **all** active `role_key` rows for the manager and
passing them through the existing, already-tested `resolvePrimaryRole()` from
`backend/src/shared/roleResolver.ts` (the same priority ranking used for `req.authUser.role` and
`GET /api/access/me`). `resolvePrimaryRole` also canonicalizes aliases via `normalizeDashboardRole`
(e.g. `payroll_admin` → `payroll`), so the test asserts the canonicalized value.

If the manager has no resolvable role better than `"employee"` (including the case of zero active
`user_roles` rows, which `resolvePrimaryRole` also reports as `"employee"`), the endpoint falls
back to `"branch_head"` — the same fallback used when the employee has no `reporting_manager_id`
at all.

## Final SQL / code

`backend/src/modules/reporting/aon-retention-flag.routes.ts`:

```ts
async function resolveAssignedRole(employeeId: string): Promise<string> {
  const [rows] = await db.execute<EmployeeForFlag[]>(
    `SELECT id, reporting_manager_id, branch_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  const emp = rows[0];
  if (!emp?.reporting_manager_id) return FALLBACK_ROLE;

  const [roleRows] = await db.execute<ManagerRoleRow[]>(
    `SELECT ur.role_key
       FROM employees mgr
       JOIN user_roles ur ON ur.user_id = mgr.user_id
      WHERE mgr.id = ? AND ur.active_status = 1`,
    [emp.reporting_manager_id],
  );

  const roleKeys = roleRows.map((row) => row.role_key);
  const primaryRole = resolvePrimaryRole(roleKeys);
  return primaryRole === "employee" ? FALLBACK_ROLE : primaryRole;
}
```

`employeeId` is validated/used as `employees.id` (the real UUID, `WHERE id = ?`), matching what
Task 3's `aon-drilldown-employees` selects as `employee_id` — never `employee_code`.

Auth: `requireAuth` from `backend/src/middleware/authMiddleware.js` (confirmed the exact import
path against `deep-report.routes.ts`'s existing usage before trusting the brief — file exists,
export exists, and the route is registered under it: `aonRetentionFlagRouter.post("/flag-retention", requireAuth, ...)`).

## Test-driven development

Wrote the failing test first (adapted from the brief's sketch to encode the *fixed* behavior, not
the brief's flawed design — a naive test copy would have "passed" the defective code):

1. Confirmed failing — module didn't exist:
   ```
   FAIL  src/modules/reporting/__tests__/aon-retention-flag.routes.test.ts
   Error: Cannot find module '/src/modules/reporting/aon-retention-flag.routes.js'
   ```
2. Implemented.
3. Confirmed passing:
   ```
   Test Files  1 passed (1)
        Tests  4 passed (4)
   ```

Four cases:
- Manager with multiple active roles (`employee` + `payroll_admin`) → resolves to `payroll`
  (highest-priority, canonicalized), proving the `LIMIT 1` defect is fixed.
- Manager resolves to no role beyond `employee` (empty role rows) → falls back to `branch_head`.
- Employee has no `reporting_manager_id` → falls back to `branch_head`, and asserts only **one**
  `db.execute` call is made (no wasted role query).
- Missing `employeeId` → 400, no DB calls at all.
- Also asserts the employee lookup query text matches `WHERE id = ?` (not `employee_code`), and
  that the exact `employeeId` value is passed as the bind param — locking in the UUID contract
  from the brief's context note.

`supertest`/`@types/supertest` were already present in `backend/package.json` — no dependency
change needed.

## Typecheck

```
cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "aon-retention-flag|app\.ts"
```
No output — clean. (Full backend `tsc` was not run, per the `hrms2-backend-typecheck-orphans`
discipline.)

## Commit / push notes (shared-tree discipline)

- `git status --porcelain` before staging showed `backend/src/app.ts` and
  `backend/src/modules/exit/exit.routes.ts` already modified/dirty by a concurrent session, plus
  several untracked files from other sessions (`manpower-risk.routes.ts`,
  `src/components/exit/`, other `.superpowers` briefs). None of these were touched, staged, or
  committed.
- `app.ts` had a *concurrent* uncommitted edit interleaved with mine (another session's
  `manpowerRiskRouter` import + mount). To avoid sweeping that into my commit, I temporarily
  removed those two lines, committed only my two lines, then restored the other session's lines
  in the working tree exactly as found (still uncommitted, untouched, left for that session).
  Verified with `git diff backend/src/app.ts` before and after, and `git show --stat HEAD` after
  committing — only my 3 files landed.
- Staged by explicit path only (never `git add -A`/`.`):
  `backend/src/app.ts backend/src/modules/reporting/aon-retention-flag.routes.ts backend/src/modules/reporting/__tests__/aon-retention-flag.routes.test.ts`.
- `git fetch origin main` before committing showed my parent commit (`a584d04a`, Task 3) was
  already `origin/main` HEAD — committed directly on top, no rebase needed.
- Pre-push hook (`schema-column-refs` structural guard) blocked the push, but the reported
  violations were entirely in `modules/exit/exit.routes.ts` and
  `modules/workforce-mandate/manpower-risk.routes.ts` — both untouched, uncommitted files from a
  different concurrent session, not part of this commit. Recorded that in the commit message per
  the repo's stated convention ("if you are certain this is not your change, say so in the commit
  message") and pushed with `--no-verify`.
- Post-push: `git fetch` + `git merge-base --is-ancestor fdf4c0d origin/main` confirmed the commit
  is really on `origin/main`, not just reported as pushed.

## Concerns

1. **Pre-push guard bypass.** I used `--no-verify` because the guard's failures were verifiably
   another session's files, not mine — but I did not fix or silence those failures, so the next
   session to push (including possibly this repo's CI, if billing is ever restored) will hit the
   same guard again until `exit.routes.ts` / `manpower-risk.routes.ts` are fixed or committed
   properly. Flagging so it isn't mistaken for something this task introduced.
2. **`resolvePrimaryRole` fallback semantics.** Treating a resolved `"employee"` role the same as
   "no manager found" (both → `branch_head`) is a judgment call, not something the brief specified.
   It seemed right because routing a retention-review Work Inbox item to the literal `employee`
   role would (per this router's own code comment on role-based routing) surface it far too
   broadly, but if there's a case where routing "employee" is actually desired, this would need to
   change.
3. **Manager resolution coverage is still partial.** Even with the `user_id` fix, only 77/161
   distinct reporting managers currently resolve to an `auth_user` account live — the rest (and
   any employee with no `reporting_manager_id` at all) fall back to `branch_head`. That's expected
   behavior per the brief, not a bug, but worth knowing before assuming most flags reach an actual
   named manager's inbox.
4. Did not verify the frontend button/call site for this endpoint — Task 4's brief only covers the
   backend endpoint; wiring it to a UI action (if not already part of a separate frontend task) is
   out of scope here.
