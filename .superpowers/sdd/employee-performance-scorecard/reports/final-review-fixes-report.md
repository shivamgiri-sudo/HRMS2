# Final review fixes — Employee Performance Scorecard

Date: 2026-08-25

## Scope

Fixed the 3 findings from the final whole-branch code review of the Employee
Performance Scorecard feature (13-task plan, already merged to main):

1. CRITICAL — drilldown handlers didn't enforce per-employee authorization
2. CRITICAL — `LIMIT 5000` silently truncated org-wide scorecard results
3. IMPORTANT — missing `PERFORMANCE_SCORECARD_COMMAND_CENTER` entry in `rbacPageMatrix.ts`

## Fix 1 — Per-employee drilldown authorization

File: `backend/src/modules/dashboards/performance-scorecard-drilldown.ts`

All 8 handlers (`drillAttendanceStatus`, `drillLatecoming`, `drillUnplannedLeave`,
`drillPipStatus`, `drillQualityBaseline`, `drillAttrition`, `drillShrinkage`,
`drillRevenue`) took `_scope: unknown` and queried solely on the caller-supplied
`filters.employeeId`, never checking whether that employee fell inside the caller's
actual scope. Confirmed the dispatch site
(`backend/src/modules/dashboards/dashboard-drilldown.service.ts`, the `getDrilldown`
switch) already passed the real `scope` through to every one of these 8 cases — so
this was purely a handler-side gap, no call-site change needed.

Fix, matching the exact pattern every sibling handler in
`dashboard-drilldown.service.ts` uses (`buildScopeWhereEmployees(scope, "e")` folded
into the SQL alongside the existing filter):

- Changed all 8 handler signatures from `_scope: unknown` to `scope: DashboardScope`
  (imported from `../../shared/dashboardScope.js`, matching the sibling file's import).
- `fetchSnapshotRows` (shared by 6 of the 8 handlers) now takes `scope` and adds
  `buildScopeWhereEmployees(scope, "e")` to its `WHERE` clause alongside
  `s.employee_id = ?`.
- `drillPipStatus` queried `pip_record`/`pip_checkpoint` with no join to `employees`
  at all, so it had no column to scope by. Added `JOIN employees e ON e.id =
  pr.employee_id` and applied the same `buildScopeWhereEmployees(scope, "e")` clause.

Net effect: a TEAM_ONLY-scoped caller (e.g. a manager) can no longer pull another
team's employee performance/PIP history by passing an arbitrary `employeeId` — the
query itself now returns zero rows for an out-of-scope id, the same fail-closed
behavior every other drilldown in the file already has.

### Test added

`backend/src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts` —
new `describe("performance-scorecard-drilldown authorization")` block:

- `drillAttendanceStatus` returns the row for an employee inside a TEAM_ONLY caller's
  team.
- `drillAttendanceStatus` returns **zero** rows for an employeeId outside that team,
  and asserts the SQL sent to the DB actually carries the `e.id IN (...)` scope
  predicate with the caller's own team id in the params (proving the fix wires scope
  into the query, not just that the mock happens to return nothing).
- `drillPipStatus` (the handler with no prior `employees` join) enforces the same
  block/allow behavior.
- An `ORG_ALL` scope (hr/ceo/etc.) can still reach any employeeId, confirming the fix
  doesn't over-narrow legitimately org-wide roles.

The mock `db.execute` implementation used for these tests actually applies the scope
predicate embedded in the generated SQL/params (checks for `1=0`, `e.id IN`, and
membership), rather than unconditionally returning canned rows — so the test proves
enforcement, not just that a query happened.

## Fix 2 — Row limit truncation

File: `backend/src/modules/performance-scorecard/performance-scorecard.routes.ts`

Verified this route hits `mas_hrms` (MySQL 8, not the `db_bill` MySQL 5.5 database),
but per the dispatch's explicit instruction implemented the pragmatic "raise the
limit + warn" fix rather than a full aggregation/pagination redesign, to avoid
touching the Compare panel's existing per-day-row contract:

- Raised `LIMIT 5000` → `LIMIT 50000` (comfortably covers ~1,110 active employees ×
  a 45-day range, which needs ≈50k rows; a 30-day default range needs ≈33k).
- Added a server-side `console.warn` when the result set hits the limit (row count
  `>= ROW_LIMIT`), logging the date range, caller userId, and whether the scope was
  org-wide — so a truncation is now diagnosable server-side instead of silent.
- Left the query shape (one row per employee per day) unchanged, so the Compare
  panel's existing client-side `groupByEmployee`/per-employee-history filtering keeps
  working against the same response shape.
- A full aggregate-to-one-row-per-employee + separate Compare-panel data source is
  explicitly out of scope for this fix (per the dispatch), flagged as a follow-up.

## Fix 3 — Missing rbacPageMatrix entry

File: `backend/src/shared/rbacPageMatrix.ts`

This file's actual shape is per-role arrays (`ROLE_SPECIFIC_PAGE_CODES` and
`LIVE_IMPORTED_PAGE_CODES`), not a per-page-with-role-list shape — `PIP_MANAGEMENT`
appears as one string inside several different roles' arrays, not as a single
combined entry. Followed that exact shape: added `"PERFORMANCE_SCORECARD_COMMAND_CENTER"`
into the array for each of the 16 roles the feature grants:

- Already had an array in `ROLE_SPECIFIC_PAGE_CODES` or `LIVE_IMPORTED_PAGE_CODES`
  (appended to the existing array, each with a `// Employee Performance Scorecard
  (migration 1607).` comment): `manager`, `process_manager`, `assistant_manager`,
  `branch_head` (both its curated and live-imported blocks), `branch_hr`,
  `team_leader`, `tl`, `hr`, `hr_admin`, `ceo`, `coo`.
- Had **no** entry anywhere in the file (would otherwise fall through to
  `COMMON_USER_PAGE_CODES` only, i.e. lose this grant the moment
  `apply-rbac-page-matrix.mjs --apply` runs): added new single-page array entries
  for `management`, `ho_hr`, `process_hr`, `branch_manager`, each with a comment
  explaining they're named in `dashboardAccessRegistry`'s
  `PERFORMANCE_SCORECARD.allowedRoleKeys` but were otherwise absent from this file.
- `super_admin` needs no entry: `getRolePageCodes()` gives `super_admin` every
  currently-active `page_catalog` code unconditionally (line ~939), bypassing this
  matrix entirely — confirmed by reading that function before assuming an entry was
  needed.

## Verification

```
cd backend && npx tsc --noEmit -p tsconfig.json
# exit 0, zero errors (confirmed clean, not just grepped for the touched files)

cd backend && npx vitest run \
  src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts \
  src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts \
  src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
# Test Files  3 passed (3) | Tests  13 passed (13)

cd backend && npx vitest run src/modules/dashboards
# Test Files  22 passed (22) | Tests  139 passed (139)
```

## Commit

**Concurrency note:** this repo has multiple concurrent Claude sessions sharing one
working tree (per `CLAUDE.md`'s Concurrent Agent Rule). By the time these fixes were
ready to stage, `git status --short` showed the 4 touched files as already clean —
another session had run a broad commit (`cfcfa0e1d43315ecc677c12385095e799df3072f`,
message: "feat: add simple test endpoint for daily report email") that swept up these
in-flight edits alongside unrelated files from other sessions
(`aon.executor.ts`, `FraudComparisonPanel.tsx`, `health.routes.ts`, sdd briefs). This
was not an action taken by this session — no `git add`/`commit` was run here for
these files. Per the Concurrent Agent Rule ("never revert, overwrite or discard
another session's work"), that commit was left alone rather than amended or reset.

Verified by diffing that commit directly (`git show cfcfa0e1 -- <each touched file>`)
that its content for all 4 files matches exactly what this session wrote — nothing
was lost or altered. That commit is already an ancestor of `origin/main`, i.e. it was
already pushed by whichever session created it; this session did not push anything.

Touched files (content confirmed present and correct in commit `cfcfa0e1`):
- `backend/src/modules/dashboards/performance-scorecard-drilldown.ts`
- `backend/src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts`
- `backend/src/modules/performance-scorecard/performance-scorecard.routes.ts`
- `backend/src/shared/rbacPageMatrix.ts`

## Concerns

- The fix commit's message and diff also include unrelated changes from other
  concurrent sessions (aon executor, health routes, a frontend fraud-comparison
  panel, sdd progress notes). None of that content was authored or reviewed by this
  session — flagging per the "small-titled commits carry whole-tree snapshots"
  pattern already known in this repo (see `hrms2-broad-commits-revert-work` memory).
- Fix 2 is deliberately the minimal "raise limit + warn" version per the dispatch's
  explicit instruction, not a real pagination/aggregation fix. At true full-org scale
  (1,110 employees × 45 days ≈ 50k rows) the new 50000 cap is close to the ceiling —
  worth re-visiting if the org grows meaningfully past that.
