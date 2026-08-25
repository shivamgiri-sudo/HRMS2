# Backlog fixes — Employee Performance Scorecard backend (2026-08-25)

## Fix 1 — real branch/process scoping in performance-scorecard.routes.ts

`backend/src/modules/performance-scorecard/performance-scorecard.routes.ts`

Removed the locally-duplicated `resolveTeamScope` (direct-reports-only or fully
org-wide, no branch/process tier). Replaced with the shared pattern already used
by `performance-scorecard-drilldown.ts`:

```ts
const context = await getUserRoleContext(req.authUser!.id);
const scope = await resolveDashboardScope(req.authUser!.id, context.primaryRole);
const { sql: scopeSql, params: scopeParams } = buildScopeWhereEmployees(scope, "e");
```

- `scopeSql` is folded directly into the existing WHERE clause (alias `e` on
  `employees`, matching the drilldown file's alias).
- `scopeSql === "1=0"` (empty resolvable scope, e.g. a manager with 0 reports, or
  BRANCH_ALL/PROCESS_ALL with no branches/processes) is treated as "no data",
  same 200/`{success:true,data:[]}` as before.
- `resolveDashboardScope` throwing `DashboardScopeConfigurationError` (its 409
  fail-closed signal for "no employee mapping / no branch / no process / no
  reporting hierarchy for this role") is caught and mapped to the same 403 the
  route returned before, preserving the prior fail-closed fix — it is NOT let
  through as 409.
- `requireRole(...)`'s 16-role list is untouched.
- Removed the 500(→50000)-row cap's only real limiter tied to
  direct-reports-only sizing, and removed the `reporting_manager_id OR
  manager_id` dual-column ambiguity as a side effect (see honesty note below).

### Does resolveDashboardScope actually fix reporting_manager_id / manager_id and single- vs multi-level? (verified, not assumed)

Read `resolveTeamEmployeeIds` in `backend/src/shared/dashboardScope.ts`
(used for `TEAM_ROLES` = manager/assistant_manager/team_leader/team_lead/tl):

- It still reads **both** `reporting_manager_id` and `manager_id` columns
  (`SELECT id, reporting_manager_id, manager_id FROM employees ...`) and treats
  either as a parent edge. So the plan's Global Constraint ("use
  `reporting_manager_id` only") is **not** actually satisfied by
  `resolveDashboardScope` — it still unions both columns, same ambiguity, just
  in the shared resolver instead of a local one. This is a pre-existing property
  of the shared resolver, not something this fix introduced or was asked to
  change; flagging it honestly rather than claiming the ambiguity is gone.
- It **is** genuinely multi-level: it builds an in-memory child-adjacency map
  from every active employee's row and does an iterative BFS/DFS walk
  (`queue.pop()` + visited set) from the manager down through all descendants,
  not just direct reports — so a manager now sees their whole reporting chain,
  not one level. It also correctly excludes self-referencing rows (5 known bad
  rows in the data) so those can't create infinite loops, and drops the manager
  themselves from their own team.
- Net effect versus the removed local `resolveTeamScope`: the single-level cap
  is gone (now full multi-level descent) and branch/process scoping tiers now
  exist (BRANCH_ALL/PROCESS_ALL for branch_head/branch_hr/process_manager/etc.)
  — genuinely new capability. The `reporting_manager_id`/`manager_id` dual-read
  itself persists unchanged inside the shared resolver.

### One-line asymmetry comment (Fix 4)

Added directly above the `requireRole(...)` call: notes that `"management"`'s
alias expansion also admits `operations_manager`, which is not in this
registry's `allowedRoleKeys` or migration 1607's seeded grants — not a security
leak (scoped/blocked by `resolveDashboardScope` and the frontend Gate), just a
reminder the three gates are not alias-for-alias identical.

## Fix 2 — historical PIP status correctness

`backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts`

`computeEmployeeSnapshot(employeeId, date)`'s PIP query changed from
`pr.status = 'active'` (today's live status, wrong for a historical backfill) to
a date-bounded check against the given `date`:

```sql
WHERE pr.employee_id = ? AND pr.start_date <= ? AND (pr.end_date IS NULL OR pr.end_date >= ?)
```

bound with `date` twice. Verified via `backend/sql/023_career_pip.sql`:
`pip_record.start_date`/`end_date` are both `DATE NOT NULL` — `end_date IS NULL`
never actually fires today (no NULL end dates exist by schema), but the clause
is kept for defensiveness/future-proofing per the task instruction; it is
harmless.

Also bounded the checkpoint join the same way so a checkpoint recorded after the
snapshot date can't leak into a historical row:
`LEFT JOIN pip_checkpoint pc ON pc.pip_id = pr.id AND pc.checkpoint_date <= ?`.

`designationId` (`employees.designation_id`) is left as a documented, known
"as-of-now" limitation — a one-line comment was added directly above that query
explaining there is no designation-history table in this schema to fix it
against.

## Fix 3 — dead registry route + missing nav-mapping entry

- `backend/src/shared/dashboardAccessRegistry.ts`: `PERFORMANCE_SCORECARD.route`
  changed from `"/performance-scorecard/dashboard"` (doesn't exist) to
  `"/performance-command-center"` (the real page).
- `src/lib/pageRoutePageCodes.ts`: added
  `"/performance-command-center": "PERFORMANCE_SCORECARD_COMMAND_CENTER"`,
  matching the existing pattern (e.g. `"/pip-management": "PIP_MANAGEMENT"`).

## Fix 4 — role-alias documentation

Covered above (inline comment on the `requireRole(...)` call in
`performance-scorecard.routes.ts`), no functional change.

## Tests

Rewrote `backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts`
to mock `getUserRoleContext` + `resolveDashboardScope` (real
`buildScopeWhereEmployees` is used unmocked) instead of the deleted local
resolver's dependencies. New/updated cases:
- TEAM_ONLY scope → `e.id IN (...)` with the team's employee ids.
- **branch_head caller gets BRANCH_ALL scoping** (`e.branch_id IN (...)`), proving
  real branch scoping — not just direct reports (this is the case the task asked
  to specifically prove).
- ORG_ALL scope (ceo/coo/management/super_admin) → `1=1`, no employee filter.
- Missing dateFrom/dateTo → 400 (unchanged).
- Role with no grant at all → 403 from `requireRole`, `resolveDashboardScope`
  never called.
- `resolveDashboardScope` throwing `DashboardScopeConfigurationError` → 403
  (fail-closed preserved, not 409).
- Resolvable scope with zero employees → 200 `{success:true,data:[]}`, no DB
  query issued.

Added a case to `performance-scorecard-snapshot.service.test.ts` proving the PIP
query binds the snapshot `date` (not the literal string `'active'`) and no
longer contains `pr.status = 'active'`.

## Verification (real output)

```
cd backend && npx tsc --noEmit -p tsconfig.json
# exit 0, no errors

cd backend && npx vitest run src/modules/performance-scorecard src/modules/dashboards
# Test Files  24 passed (24)
# Tests  149 passed (149)
```

(The ERROR-level log lines in the vitest output are from pre-existing
error-path tests in `dashboard-metric-error-states.test.ts` intentionally
exercising `logSourceFailure` — not failures.)

## Commit

Staged explicit paths only (concurrent sessions had unrelated dirty files —
`backend/src/modules/reporting/executors/aon.executor.ts`,
`.superpowers/sdd/aon-drilldown-2/briefs/task-3-review-package.diff`,
`backend/scripts/verify-partition-fix-tmp.mjs` — left untouched):

- `backend/src/modules/performance-scorecard/performance-scorecard.routes.ts`
- `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts`
- `backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts`
- `backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts`
- `backend/src/shared/dashboardAccessRegistry.ts`
- `src/lib/pageRoutePageCodes.ts`
