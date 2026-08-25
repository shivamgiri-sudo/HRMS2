# Task 7 Report: RBAC-scoped GET /api/performance-scorecard route

## Summary

Added a new backend route `GET /api/performance-scorecard` returning rows from
`employee_performance_daily_snapshot` (Task 1's table), scoped by the caller's
role/team via the same pattern used by `management.routes.ts`'s
`agent-performance` route.

## Step 1: reference route confirmed real values

Read `backend/src/modules/management/management.routes.ts` in full for the
`agent-performance` route and its imports. Confirmed:

- `db` import: `import { db } from "../../db/mysql.js";`
- Async handler wrapper `h`: **not imported from anywhere** — it's a small
  local arrow function defined at the top of `management.routes.ts`
  (`const h = (fn) => (req, res, next) => fn(req, res).catch(next);`). I
  replicated the same local definition in the new route file rather than
  importing a nonexistent shared util.
- `requireRole` import: `import { requireRole } from "../../middleware/requireRole.js";`
- `AuthenticatedRequest` type import: `import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";`
- `resolveTeamScope`: **not exported** from `management.service.ts` or
  `management.routes.ts` — it's a local (unexported) async function in
  `management.routes.ts` built from `hasRole`/`getEmployeeForUser`
  (`../../shared/accessGuard.js`) and `managementService.getDirectReportIds`
  (`../management/management.service.js`). Per the brief's own fallback
  instruction ("If `resolveTeamScope` turns out not to exist ... adapt — do
  not invent a function that doesn't exist"), I replicated the identical
  logic as a local function in the new route file, importing only the real
  exported building blocks it's built from.

## Role list verification

Read `backend/src/shared/dashboardAccessRegistry.ts`'s `PERFORMANCE_SCORECARD`
entry (lines 203-213). `allowedRoleKeys` is exactly:

```
manager, process_manager, assistant_manager, branch_head, branch_manager,
team_leader, tl, hr, hr_admin, ho_hr, branch_hr, process_hr, ceo, coo,
management, super_admin
```

This matches the brief's corrected list verbatim — used it unchanged in
`requireRole(...)`. Also read `requireRole.ts` in full: it normalizes role
strings via `normalizeRoleInputs`/`expandRoles` from
`platform/policy/index.js`, a separate alias layer from
`dashboardAccessRegistry.ts`'s `normalizeDashboardRole`, but both operate on
the same underlying role-key spellings (confirmed by the existing
`my-team-role-gate.test.ts` regression test, which documents `team_leader`
and `tl` as bidirectionally aliased inside `requireRole`'s
`platform/policy/roles.ts`). No spelling mismatch found between the registry
and `requireRole`.

Confirmed `admin` and `wfm` are deliberately absent from both the registry
entry and my route — left unchanged as instructed.

## Files

- Created: `backend/src/modules/performance-scorecard/performance-scorecard.routes.ts`
- Created: `backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts`
- Modified: `backend/src/app.ts` (added the import + `app.use("/api/performance-scorecard", performanceScorecardRoutes);`, mounted alongside the existing `/api/management` mounts, same pattern)

Note: `backend/src/modules/performance-scorecard/` already contained
`performance-scorecard-snapshot.service.ts`, `.cron.ts` and `.types.ts` from
earlier tasks (Task 1/2) when I started — untouched by this task. The
response column list in my route's `SELECT` matches
`EmployeePerformanceSnapshotRow` in `performance-scorecard.types.ts` and the
`employee_performance_daily_snapshot` schema in
`backend/sql/migrations/1604_employee_performance_daily_snapshot.sql`
exactly.

## TDD

1. Wrote `performance-scorecard.routes.test.ts` first, adapted from the real
   auth-mocking convention found in
   `backend/src/modules/management/__tests__/my-team-role-gate.test.ts`
   (mocks `db/mysql.js`, `shared/accessGuard.js`,
   `management/management.service.js`, and `middleware/authMiddleware.js`'s
   `requireAuth` to inject `req.authUser`). Added 3 cases: scoped rows for a
   manager, 400 on missing dateFrom/dateTo, and 403 for a role with no grant.
2. Ran it — failed as expected: `Cannot find module '.../performance-scorecard.routes.js'`.
3. Implemented the route.
4. Reran — all 3 tests pass:
   ```
   Test Files  1 passed (1)
        Tests  3 passed (3)
   ```
5. `npx tsc --noEmit -p .` on the backend showed zero errors attributable to
   `performance-scorecard.routes.ts`, its test, or `app.ts` (grepped tsc
   output for those filenames — no matches; did not chase pre-existing
   unrelated errors per project memory on backend tsc orphans).

## Mounting

`backend/src/app.ts` already had another concurrent session's in-flight
uncommitted edit (a `manpowerRiskRouter` mount) sitting in the working tree
when I started. To avoid sweeping that unrelated change into this commit, I
built a minimal patch containing only my two hunks (the
`performanceScorecardRoutes` import and its `app.use` line) and applied it
with `git apply --cached` against the index only — leaving the working tree
untouched (both edits still present on disk) and the other session's edit
still unstaged for them to commit themselves. `git show --stat HEAD` after
commit confirms exactly 3 files landed: `app.ts` (+2 lines only), the new
route, and the new test.

## Git safety

- `git fetch origin main` before committing; `origin/main` was at `9cf9a0bd`,
  same as local — no divergence.
- `git status --porcelain` reviewed before staging; left `exit.routes.ts` and
  all other dirty/untracked files untouched.
- Staged only the 3 explicit files/hunks.
- `git show --stat HEAD` confirmed only those 3 files are in the commit.
- Did not push (local commit only, per instructions).

## Concerns

- **None regarding the role list** — verified against the live registry
  entry and the Task 5 security-review commit history
  (`b18cba8e fix: scope PERFORMANCE_SCORECARD dashboard access to
  manager/HR/CEO roles only`); did not add `admin` or `wfm` or any other
  role.
- `resolveTeamScope` is now duplicated in two files (`management.routes.ts`
  and this new route). This mirrors the brief's own fallback instruction
  (adapt, don't invent), but a future cleanup task could extract it to a
  shared module (e.g. `shared/teamScope.ts`) so both routes and any future
  consumer share one implementation instead of two copies that could drift.
  Flagging rather than doing it unilaterally, since it touches
  `management.routes.ts`, which is outside this task's file list.
- `backend/src/app.ts` is confirmed to be a hot, frequently-touched file
  (another session had an uncommitted mount edit in it at the same moment).
  My commit only carries my 2-line hunk; the other session's
  `manpowerRiskRouter` mount remains in the working tree, uncommitted, for
  them to commit on their own.

---

## Follow-up session (2026-08-25): finishing the stalled fail-closed fix + tests

Picked this up where the previous agent stalled. State found on arrival:

- `performance-scorecard.routes.ts` already had the 403 fail-closed fix applied
  correctly: when `resolveTeamScope` returns `{ employeeIds: null, isWide: false }`
  (no employee record, not an org-wide role) the route now returns
  `403 { success: false, message: "Unable to resolve your team scope — no
  employee record or organization-wide role found" }` **before** falling
  through to the empty-team case. The empty-team case
  (`{ employeeIds: [], isWide: false }`) correctly short-circuits to
  `200 { success: true, data: [] }` without querying the DB. Read the file in
  full — no changes needed here.
- The test file already had two new imports added by the previous agent
  (`getEmployeeForUser` from `../../../shared/accessGuard.js` and
  `managementService` from `../../management/management.service.js`) but no
  test bodies — these are the same names already used inside the file's
  `vi.mock(...)` factories, just not yet referenced by any `it(...)` block.

### Tests added

Two new cases appended to the existing `describe("GET /api/performance-scorecard")`
block, following the file's existing mocking convention (module-level
`vi.mock` on `db/mysql.js`, `shared/accessGuard.js`,
`management/management.service.js`, `middleware/authMiddleware.js`):

1. **403 fail-closed**: `vi.mocked(getEmployeeForUser).mockResolvedValueOnce(null)`
   for one request — with `hasRole` still resolving `false` for the
   admin/hr/ceo/qa check (the file's default mock), `resolveTeamScope` hits
   `if (!emp) return { employeeIds: null, isWide: false }`, and the route
   returns 403 with `success: false`.
2. **200 empty data**: `vi.mocked(managementService.getDirectReportIds).mockResolvedValueOnce([])`
   plus the default empty `execute` mock, asserting `{ success: true, data: [] }`.

Both previously-unused imports are now referenced by these tests via
`vi.mocked(...)`, so no imports needed to be removed.

**Honesty note on test 2**: `resolveTeamScope`'s own logic
(`if (!ids.includes(emp.id)) ids.push(emp.id);`) unconditionally adds the
caller's own employee id to the reports list when it's absent — so starting
from `getDirectReportIds` returning `[]`, the array `resolveTeamScope`
actually returns is `[emp.id]` (length 1), never a literal `[]`. This means
route.ts's own early-return branch for `employeeIds.length === 0` (lines
72-74) is **currently unreachable via `resolveTeamScope` as written** — a
manager with a real employee record always resolves to at least
`[selfId]`, never to a true empty array. Test 2 as written exercises the
*externally observable* contract the task asked for (200, `data: []`) by
having the DB layer return zero rows for that manager's `[selfId]` query
(the file's default `execute` mock already resolves to `[[], []]`), not by
hitting route.ts's dedicated empty-array early-return branch directly. That
branch remains defensive/dead code under the current `resolveTeamScope`
implementation. Flagging this as a finding rather than modifying
`resolveTeamScope`'s self-inclusion behavior, which is out of this task's
scope and could change intended semantics (a manager always seeing their
own row) without explicit approval.

### Verification

```
cd backend && npx vitest run src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### Git safety

- `git fetch` then reviewed `git log origin/main -3`: `9cf9a0bd` at HEAD,
  local was up to date (no divergence).
- `git status --short` showed a large number of unrelated dirty/untracked
  files from other concurrent sessions (analytics drilldown components,
  `app.ts`, `exit.routes.ts`, SDD briefs for a different feature, etc.).
  Left all of them untouched.
- `git add` used two explicit paths only. After staging, `git diff --cached
  --stat` unexpectedly showed 3 unrelated `src/components/analytics/drilldown/*`
  files already staged in the shared index from another session —
  `git restore --staged` was used to unstage exactly those 3 files before
  committing, leaving only my 2 files staged.
- Committed as `0b677867562eacb5fcb784e7755a56899282c16f`. `git show --stat HEAD`
  confirmed exactly 2 files, `+31/-0` lines, matching this task's scope.
- Not pushed (local commit only, per instructions).
