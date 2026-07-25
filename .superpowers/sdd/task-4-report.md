# Task 4 Report

## Status

DONE_WITH_CONCERNS

## Files changed

- `src/components/dashboard/ScopedFilterBar.tsx`
- `src/components/dashboard/DashboardDrilldownDrawer.tsx`
- `src/pages/dashboards/ReferenceRoleDashboard.tsx`
- `src/pages/dashboards/reference/HrReferenceLayout.tsx`
- `src/pages/dashboards/reference/WfmAttendanceReferenceLayout.tsx`
- `src/tests/role-dashboard-live-data.contract.test.ts`
- `backend/src/modules/dashboards/dashboard-definition.service.ts`
- `backend/src/modules/dashboards/dashboard.routes.ts`
- `backend/src/modules/dashboards/__tests__/dashboard-metric-contract.test.ts`
- `docs/dashboard-audit/2026-07-25-role-dashboard-verification-log.md`

## Findings

- Routed HR, WFM, and WFM Attendance variants resolve to their registry dashboard codes for summary calls.
- HR and WFM Attendance lacked the shared scoped filter controls. They now use the dashboard-scoped `/filters` contract through `ScopedFilterBar`; errors are rendered rather than silently falling back to empty/unscoped options.
- The drilldown drawer received `{ success, data }` responses but rendered the outer object, causing a false empty state. It now renders `data` and retains the existing visible error state on failure.
- Backend drilldown and trend routes previously accepted any metric alongside an entitled dashboard code. They now reject a metric that is not configured for the requested dashboard before querying, while preserving existing entitlement and scope enforcement.
- Metric bundles remain correct: HR = onboarding/TAT/resignation/compliance, WFM = headcount/attendance, WFM Attendance = attendance.

## Verification commands and exact results

- `node backend/node_modules/vitest/vitest.mjs run src/tests/role-dashboard-live-data.contract.test.ts --config vite.config.ts --globals --exclude .worktrees/** -t "uses dashboard-scoped filters|unwraps drilldown API envelopes"`
  - Passed: 1 file; 2 tests passed; 26 skipped.
- `npm --prefix backend test -- --run src/modules/dashboards/__tests__/dashboard-metric-contract.test.ts`
  - Passed: 1 file; 7 tests passed.
- `npm run typecheck`
  - Passed: exit 0.
- `npm --prefix backend run typecheck`
  - Passed: exit 0.
- `git diff --check`
  - Passed: exit 0; only CRLF-to-LF normalization warnings were printed.

## Concerns

- No authenticated live browser/API environment was available, so verification is source and targeted-test based.
- The full frontend contract test with `.worktrees` excluded still fails one unrelated IT provisioning assertion (`ItManagerReferenceLayout.tsx` contains `?? 0`), outside Task 4. Without excluding `.worktrees`, two unrelated incomplete worktree test suites also fail.
