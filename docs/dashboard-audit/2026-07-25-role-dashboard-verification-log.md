# Role Dashboard Verification Log — 2026-07-25

## Task 3 — Employee Self and Manager

- Status: Verified in source and targeted automated checks; live authenticated browser/API verification was not available in this workspace.

### Findings and fixes

- Employee Self uses only employee-linked endpoints in `ReferenceRoleDashboard`: `/api/wfm/my-attendance` with `/api/dashboards/employee/summary` as its self-scoped attendance fallback. The fixed employee summary route requires `EMPLOYEE_SELF_DASHBOARD`, resolves the authenticated user's employee record, and returns `409 EMPLOYEE_MAPPING_UNAVAILABLE` when mapping is absent.
- `MyAttendanceWidget` now consumes the API's `halfDay` detail key and exposes fetch failures or missing attendance metrics instead of rendering fallback zeroes.
- Manager uses `MANAGEMENT_DASHBOARD` for its summary and now also consumes `/:dashboardCode/good-bad-insights` and `/:dashboardCode/owner-accountability`; those responses are rendered as manager work-queue and accountability panels.
- Dynamic dashboard endpoints are already protected by the router `dashboardCode` entitlement parameter, and dashboard metrics resolve `MANAGEMENT_DASHBOARD` with the authenticated manager's `TEAM_ONLY` scope. No backend route change was required.

### Verification

- `node backend/node_modules/vitest/vitest.mjs run src/pages/dashboards/__tests__/employee-manager-dashboard-contract.test.ts --config vite.config.ts --globals` — passed (2 tests).
- `npm run typecheck` — passed.
- `npm --prefix backend run typecheck` — passed.
- `npm --prefix backend test -- --run src/modules/dashboards/__tests__/dashboard-access-registry.test.ts src/modules/dashboards/__tests__/dashboard-error-semantics.test.ts` — passed (2 files, 10 tests).

## Task 4 — HR, WFM, and WFM Attendance

- Status: Verified in source and targeted automated checks; live authenticated browser/API verification was not available in this workspace.

### Findings and fixes

- `HrDashboard`, `WfmDashboard`, and `WfmAttendanceDashboard` route through `ReferenceRoleDashboard`, whose registry mapping uses `HR_DASHBOARD`, `WFM_DASHBOARD`, and `WFM_ATTENDANCE_DASHBOARD` respectively for summary requests.
- HR and WFM Attendance now receive the same scoped branch/process controls as WFM. The shared control loads `/api/dashboards/:dashboardCode/filters`, keeps the returned scope constrained by the authenticated backend request, and visibly reports filter-load failures instead of silently replacing them with unrestricted options.
- The drilldown drawer now unwraps the standard `{ success, data }` envelope, so successful drilldown records display instead of appearing as an empty result. Its existing visible error state remains active for failed requests.
- Backend trend and drilldown endpoints now reject a metric that is not configured for the requested dashboard. This prevents a caller from combining an entitled HR/WFM dashboard code with another dashboard's metric; entitlement and resolved scope checks remain in place.
- The metric bundles are role-specific: HR has onboarding/TAT/resignation/compliance metrics; WFM has headcount and attendance; WFM Attendance has attendance.

### Verification

- `node backend/node_modules/vitest/vitest.mjs run src/tests/role-dashboard-live-data.contract.test.ts --config vite.config.ts --globals --exclude .worktrees/** -t "uses dashboard-scoped filters|unwraps drilldown API envelopes"` — passed (2 tests; 26 skipped).
- `npm --prefix backend test -- --run src/modules/dashboards/__tests__/dashboard-metric-contract.test.ts` — passed (7 tests).
- `npm run typecheck` — passed.
- `npm --prefix backend run typecheck` — passed.
- `git diff --check` — passed (exit 0; CRLF normalization warnings only).

### Concern

- The full frontend contract file with `.worktrees` excluded still has one unrelated pre-existing failure: the IT provisioning assertion rejects `?? 0` in `ItManagerReferenceLayout.tsx`, which is outside Task 4. Without the exclusion, two unrelated worktree suites also run and fail because their isolated branches are incomplete.
