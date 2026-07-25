# Task 1 Report — Routed Dashboard Audit Matrix

## Status

DONE_WITH_CONCERNS

## Created / modified

- Created `docs/dashboard-audit/2026-07-25-role-dashboard-widget-matrix.md`.
- Created this task report. No application code was modified.

## Exact files inspected

- `src/config/routes/dashboards.routes.tsx`
- `src/pages/dashboards/CeoDashboard.tsx`
- `src/pages/dashboards/PayrollHrDashboard.tsx`
- `src/pages/dashboards/WfmDashboard.tsx`
- `src/pages/dashboards/HrDashboard.tsx`
- `src/pages/dashboards/ManagerDashboard.tsx`
- `src/pages/dashboards/EmployeeSelfDashboard.tsx`
- `src/pages/dashboards/QualityDashboardRole.tsx`
- `src/pages/dashboards/OperationsDashboardRole.tsx`
- `src/pages/dashboards/RecruiterDashboard.tsx`
- `src/pages/dashboards/WfmAttendanceDashboard.tsx`
- `src/pages/dashboards/ItManagerDashboard.tsx`
- `src/pages/dashboards/ReferenceRoleDashboard.tsx`
- `src/pages/dashboards/ReferenceDashboardUI.tsx`
- `src/pages/dashboards/dashboard-data-contracts.ts`
- `src/pages/dashboards/reference-dashboard-model.ts`
- `src/pages/dashboards/reference/*ReferenceLayout.tsx`
- `src/pages/dashboards/reference/ReferenceOperationalPanels.tsx`
- `src/components/dashboard/**/*` (focused API/shared-widget review)
- `src/hooks/useExecutiveQuality.ts`
- `src/hooks/useOrgKpiSummary.ts`
- `backend/src/modules/dashboards/dashboard.routes.ts`
- `backend/src/shared/dashboardAccessRegistry.ts`

## Concerns / shared-widget risks

- WFM route query `?view=attendance` changes the rendered dashboard code and layout while its route gate remains `WFM_DASHBOARD`.
- Scoped filters use organisation endpoints rather than dashboard-scoped filters, and their date range is ignored by the routed dashboard data loader.
- Several standalone payroll/revenue widgets fetch `/api/management/ceo-metrics`; they are not currently routed-layout widgets and must not be reused without a role/data-contract audit.
- `PendingActionsWidget` points to unregistered lower-case `/api/dashboards/hr/summary`; it is not currently rendered.

## Verification performed

- Compared all eleven routed role-dashboard paths with their route-gate codes, wrapper components, `ReferenceRoleDashboard` variants, and reference layouts.
- Checked client API calls and variant enablement against dashboard router endpoint definitions, including employee and payroll fixed routes.
- Self-reviewed the matrix for a section for every routed role dashboard and for all required endpoint families/risk notes.

## Reviewer fix completion â€” 2026-07-25

DONE

- Added the Employee Self Company Feed request, including its `page` / `limit` parameters.
- Added the IT Manager bulk-upload mutation endpoint: `POST /api/it-provisioning/bulk-sync`.
- Limited this follow-up to the two reviewer-requested matrix fixes and this report update.
