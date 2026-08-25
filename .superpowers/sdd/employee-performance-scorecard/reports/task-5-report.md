# Task 5 Report: Dashboard metric registry entries

## Summary

Registered the `PERFORMANCE_SCORECARD` dashboard and its 8 new metric keys
(`attendanceStatus`, `latecoming`, `unplannedLeave`, `pipStatus`,
`qualityBaseline`, `attrition`, `shrinkage`, `revenue`), wired to the 8
tile-summary stub functions Task 6 created in
`backend/src/modules/dashboards/performance-scorecard-drilldown.ts`.

Commit: `417be5416eeae187872723b8b7f2d78546a9d279` on `main`.

## Step 1 — current structure confirmed before editing

- `backend/src/shared/dashboardAccessRegistry.ts`: `DashboardCode` union's last
  member was still `"EMPLOYEE_SELF_DASHBOARD"` (12 members total, matching the
  brief's assumption — no drift from concurrent sessions).
- `backend/src/modules/dashboards/dashboard-definition.service.ts`:
  `MetricKey`'s last member was `"leaveApprovals"`, `METRICS`'s last entry was
  `leaveApprovals: {...}`, and `DASHBOARD_METRICS`'s last entry was
  `EMPLOYEE_SELF_DASHBOARD: ["att", "leaveApprovals"]` — also unchanged from
  the brief's assumption. `MetricDefinition` field shape matched the brief's
  illustrative snippet exactly (`code, label, unit, source, sourceTable,
  higherIsBetter, moduleCode, execute`, plus optional `numeratorKey`/
  `denominatorKey` not used by the new entries).

## Changes made

### `backend/src/shared/dashboardAccessRegistry.ts`
- Added `"PERFORMANCE_SCORECARD"` as the 13th `DashboardCode` union member.
- **Deviation from the brief's literal Step 2 text**: the brief only asked to
  add the union member, but `DASHBOARD_ACCESS_REGISTRY` is typed
  `Readonly<Record<DashboardCode, DashboardAccessDefinition>>` — adding a
  union member without a matching object entry fails TypeScript compilation
  (`TS2741: Property 'PERFORMANCE_SCORECARD' is missing`), verified by
  temporarily removing the entry and re-running `tsc`. Added a
  `DASHBOARD_ACCESS_REGISTRY.PERFORMANCE_SCORECARD` definition, following the
  existing pattern (route `/performance-scorecard/dashboard`, roles unioning
  employee-self + manager + HR + CEO/COO/management, scopes
  `SELF/TEAM/BRANCH/PROCESS`) since the brief did not specify one and this
  task's stated scope is data-only (routes/frontend are later tasks). See
  Concerns below — this is the one place I made a judgment call rather than
  following the brief verbatim.

### `backend/src/modules/dashboards/dashboard-definition.service.ts`
- Added the import block for the 8 tile-summary functions from
  `./performance-scorecard-drilldown.js`.
- Extended `MetricKey` with the 8 new members (exact list from the brief).
- Added the 8 `METRICS` entries exactly as specified in the brief (shape
  matched the real `MetricDefinition` type; no field-name differences found).
- Added `DASHBOARD_METRICS.PERFORMANCE_SCORECARD` with the 8 keys in the
  brief's order. This entry is also required by TypeScript since
  `DASHBOARD_METRICS` is `Record<DashboardCode, readonly MetricKey[]>`.

## Step 6 — TypeScript verification

`cd backend && npx tsc --noEmit -p tsconfig.json` (project config, not the
bare-file invocation which has known pre-existing unrelated errors per repo
convention — confirmed those same errors reproduce with a bare-file `tsc`
invocation on a clean baseline, e.g. `pino`/`tedious`/`dotenv` typing noise
unrelated to this change).

Result: **zero errors** referencing `dashboardAccessRegistry.ts`,
`dashboard-definition.service.ts`, or `performance-scorecard-drilldown.ts`
(grepped the full output for these three filenames — no matches).

## Step 7 — test suite

`cd backend && npx vitest run src/modules/dashboards/__tests__/`

Result: **21 files passed, 1 file failed (2 tests) — 133/135 tests passing**
(Task 6 baseline was 22 files / 135 tests all passing).

The 2 new failures are both in `dashboard-access-registry.test.ts`
(**not one of this task's 2 target files**), and both fail for the same root
cause: that test hardcodes the dashboard count/role-matrix fixture to the
prior 12 dashboards:
- `defines all twelve production dashboards...` — asserts
  `definitions.toHaveLength(12)`, now 13.
- `matches the complete production role-dashboard matrix` — asserts the exact
  list of dashboard codes each role can reach; `ceo` (and likely other roles
  in the fixture) now also resolves `PERFORMANCE_SCORECARD` since I gave it a
  `ceo` grant in the new definition.

These are stale-fixture failures, not regressions in behavior: they are the
direct, unavoidable consequence of `DashboardCode` gaining a 13th member,
which is this task's own stated deliverable
(`Produces: DashboardCode union member "PERFORMANCE_SCORECARD"`). Every
other test in the suite (133/135, including all attendance/access-check
logic tests) passes unchanged.

## Step 8 — commit

```
git add backend/src/shared/dashboardAccessRegistry.ts backend/src/modules/dashboards/dashboard-definition.service.ts
git commit -m "feat: register PERFORMANCE_SCORECARD dashboard metrics"
```
`git status --short` before staging showed several other dirty/untracked
files from concurrent sessions (`backend/src/app.ts`,
`backend/src/modules/exit/exit.routes.ts`, various `.superpowers/sdd/...`,
new reporting/workforce-mandate files, `src/components/exit/`) — none were
staged or touched. `git show --stat HEAD` after commit confirms exactly the
2 intended files landed (44 insertions, 2 deletions total). `git fetch
origin main` was run before committing; local `main` was based on the
current `origin/main` tip (`a584d04a`) with no divergence. Not pushed, per
instructions.

## Concerns

1. **`dashboard-access-registry.test.ts` now needs updating** (out of this
   task's file scope) to account for the 13th dashboard — either by a
   follow-on task or by whoever builds the `PERFORMANCE_SCORECARD` dashboard's
   routes/frontend. Flagging explicitly so this isn't mistaken for a
   regression.
2. **The `DASHBOARD_ACCESS_REGISTRY.PERFORMANCE_SCORECARD` definition's
   `allowedRoleKeys`/`route`/`scopeTypes` were my own judgment call**, not
   specified anywhere in the brief or plan (the brief only mentions the
   `DashboardCode` union member, not a full access definition). I chose
   values consistent with "every employee can see their own scorecard;
   managers/HR/CEO can see their team's" based on the feature name and the
   `EMPLOYEE_SELF_DASHBOARD`/`MANAGEMENT_DASHBOARD` patterns already in the
   file, but this may need revision once the actual route/RBAC task defines
   real requirements. `route: "/performance-scorecard/dashboard"` is a guess
   with no corresponding frontend route yet (expected — that's a later task).

---

# Task 5 Follow-up: Code Review Fixes (2026-08-25)

## Finding 1 — RBAC scoped too broadly (fixed)

Confirmed the Concerns section above: the original `PERFORMANCE_SCORECARD`
entry included `employee`/`agent`/`trainee` and `SELF` scope, incorrectly
matching the self-service `EMPLOYEE_SELF_DASHBOARD` pattern instead of the
manager/HR-Ops/CEO-only pattern this feature's route guard
(`requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager",
"team_leader", "assistant_manager", "wfm", "super_admin")`) and page-access
seed (`admin, hr, wfm, ceo, super_admin, branch_head, process_manager`)
actually use.

Changed in `backend/src/shared/dashboardAccessRegistry.ts`:

- `allowedRoleKeys`: dropped `"employee"`, `"agent"`, `"trainee"`. Kept the
  manager-family (`manager, process_manager, assistant_manager, branch_head,
  branch_manager, team_leader, tl`, matching `MANAGEMENT_DASHBOARD`'s
  convention), the HR-family (`hr, hr_admin, ho_hr, branch_hr, process_hr`,
  matching `HR_DASHBOARD`'s convention), and the org-wide roles (`ceo, coo,
  management, super_admin`, matching `CEO_DASHBOARD`'s convention).
- `scopeTypes`: dropped `"SELF"`. Added `"ORGANISATION"` (a real enum value
  already defined in `DashboardScopeType` and used by `CEO_DASHBOARD`/
  `HR_DASHBOARD` for the same org-wide-role pattern this entry now carries)
  alongside the existing `TEAM, BRANCH, PROCESS`.

Before:
```
allowedRoleKeys: ["employee", "agent", "trainee", "manager", "process_manager", "assistant_manager", "branch_head", "branch_manager", "team_leader", "tl", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "ceo", "coo", "management", "super_admin"]
scopeTypes: ["SELF", "TEAM", "BRANCH", "PROCESS"]
```
After:
```
allowedRoleKeys: ["manager", "process_manager", "assistant_manager", "branch_head", "branch_manager", "team_leader", "tl", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "ceo", "coo", "management", "super_admin"]
scopeTypes: ["ORGANISATION", "TEAM", "BRANCH", "PROCESS"]
```

`route`, `moduleCode`, `pageCode`, `sensitiveMetrics`, and `permissions` left
unchanged — no reason found to touch them for this finding.

## Finding 2 — stale pre-existing test (fixed)

`backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts`
(pre-existing file, not previously touched by this feature):

- `toHaveLength(12)` (dashboard count and both uniqueness checks) → `13`,
  matching the real 13-member `DashboardCode` union.
- Role-matrix fixture (`matches the complete production role-dashboard
  matrix`): added `"PERFORMANCE_SCORECARD"` to the expected dashboard-code
  arrays for `ceo`, `hr`, `branch_head`, `manager` (appended at the end,
  matching `PERFORMANCE_SCORECARD`'s position as the last-defined entry in
  the registry, which is also iteration order for `Object.keys`). Left
  `employee`'s expected array as `["EMPLOYEE_SELF_DASHBOARD"]` unchanged —
  it correctly no longer reaches `PERFORMANCE_SCORECARD` after Finding 1's
  fix. No other role's expected array needed a change (none of the other
  tested roles are in the corrected `allowedRoleKeys`).

## Verification

`cd backend && npx vitest run src/modules/dashboards/__tests__/`:
```
 Test Files  22 passed (22)
      Tests  135 passed (135)
```
(Back to full green from the 21/22 files, 133/135 tests partial state left
by the original Task 5 commit — the 2 failures were exactly the ones this
follow-up fixes.)

`cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "dashboardAccessRegistry\|dashboard-access-registry"`: no output (exit 1 / no matches) — zero new/existing errors referencing either changed file.

## Commit

```
git add backend/src/shared/dashboardAccessRegistry.ts backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts
git commit -m "fix: scope PERFORMANCE_SCORECARD dashboard access to manager/HR/CEO roles only"
```
Commit `b18cba8ec2d215d0e040c0b08a8749e621f034ef` (short `b18cba8e`) on `main`.
`git fetch origin` run first (`origin/main` tip `fdf4c0d0`, unrelated commits
from other sessions — no divergence affecting these two files). `git status
--short` before staging showed other dirty files from concurrent sessions
(`backend/src/app.ts`, `backend/src/modules/exit/exit.routes.ts`, various
`.superpowers/sdd/...` and untracked files) — none staged or touched.
`git show --stat HEAD` confirmed exactly the 2 intended files landed (10
insertions, 10 deletions total, 2 files changed). Not pushed, per
instructions.
