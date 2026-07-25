# Task 4 Brief: Fix and verify HR, WFM, and WFM Attendance dashboards

## Goal

Verify and fix the routed HR, WFM, and WFM Attendance dashboards so each page uses the correct dashboard code, role-scoped summary/filter/drilldown/trend behavior, and live backend contracts.

## Scope

Primary files in scope:

- `src/pages/dashboards/HrDashboard.tsx`
- `src/pages/dashboards/WfmDashboard.tsx`
- `src/pages/dashboards/WfmAttendanceDashboard.tsx`
- `src/pages/dashboards/ReferenceRoleDashboard.tsx`
- `backend/src/modules/dashboards/dashboard.routes.ts`
- `backend/src/modules/dashboards/dashboard-definition.service.ts`
- `backend/src/modules/dashboards/dashboard-drilldown.service.ts`

You may also edit directly connected shared role-dashboard layouts, data-contract helpers, and targeted frontend/backend tests if needed.

## Required outcome

- Each of the three routed dashboards must pass the correct dashboard code through summary, drilldown, trend, and filter requests.
- Any backend metric bundle mismatch for `HR_DASHBOARD`, `WFM_DASHBOARD`, or `WFM_ATTENDANCE_DASHBOARD` must be fixed.
- Filter dropdowns must stay correctly scoped by branch/process and must not overexpose data outside role scope.
- Drilldown drawers must load the requested dashboard/metric pair and must not fail silently.
- Real API failures must remain visible; do not introduce fake zero/fake success fallbacks.

## Verification expectations

- Verify the actual routed pages plus the shared `ReferenceRoleDashboard` flow for `variant="hr"`, `variant="wfm"`, and `variant="wfm_attendance"`.
- Inspect `/summary`, `/filters`, `/metric/:metricCode/drilldown`, and `/metric/:metricCode/trend` usage for these dashboard codes.
- Add or update targeted tests if you find a bug in route dispatch, metric wiring, filter scope, or drilldown behavior.
- Record findings and results in `docs/dashboard-audit/2026-07-25-role-dashboard-verification-log.md`.
- Run the relevant repo verification commands for touched code and report exact results.

## Constraints

- Keep changes scoped to HR/WFM/WFM-Attendance routed dashboards plus directly connected shared/backend plumbing.
- Preserve existing access gating through route protection, role dashboard access checks, and backend dashboard entitlement/scope checks.
- Prefer existing dashboard architecture over introducing a new pattern.
