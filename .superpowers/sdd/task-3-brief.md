# Task 3 Brief: Fix and verify Employee Self and Manager dashboards

## Goal

Verify and fix the routed Employee Self and Manager dashboards so they render correct role-scoped live data through the intended frontend and backend contracts.

## Scope

Primary files in scope:

- `src/pages/dashboards/EmployeeSelfDashboard.tsx`
- `src/pages/dashboards/ManagerDashboard.tsx`
- `src/components/dashboard/widgets/MyAttendanceWidget.tsx`
- `src/pages/dashboards/ReferenceRoleDashboard.tsx`
- `backend/src/modules/dashboards/dashboard.routes.ts`
- `backend/src/modules/dashboards/dashboard-definition.service.ts`

You may also edit directly connected role-dashboard layouts, shared data-contract helpers, or targeted backend tests if needed to make these two dashboards correct.

## Required outcome

- Employee Self must use self-scoped data and must not silently depend on generic HR summary behavior.
- Manager must use `MANAGEMENT_DASHBOARD` summary and related role-scoped endpoints.
- Any contract mismatch between backend metric keys and rendered widgets/cards must be fixed.
- Backend scope semantics must continue to limit:
  - Employee Self data to the authenticated employee
  - Manager data to the authenticated manager's allowed team scope
- Real API failures must remain visible; do not replace failures with fake zeros or fake success states.

## Verification expectations

- Inspect the actual routed pages plus the shared `ReferenceRoleDashboard` flow used by `variant="employee"` and `variant="manager"`.
- Verify `/api/dashboards/employee/summary` behavior and shape against consumer expectations.
- Verify `/:dashboardCode/summary`, `/:dashboardCode/good-bad-insights`, and `/:dashboardCode/owner-accountability` usage for the manager path.
- Add or update targeted backend tests if you find a bug in route behavior, summary semantics, or scope handling.
- Record findings and results in `docs/dashboard-audit/2026-07-25-role-dashboard-verification-log.md`.
- Run the relevant repo verification commands for touched frontend/backend code and report exact results.

## Constraints

- Keep changes scoped to Employee Self and Manager routed dashboards plus directly connected shared/backend plumbing.
- Preserve existing access gating through `ProtectedRoute`, role dashboard access checks, and backend entitlement checks.
- Prefer existing dashboard architecture over introducing a new pattern.
