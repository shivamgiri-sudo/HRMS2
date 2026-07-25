# Role Dashboard Widget Audit Matrix — 2026-07-25

## Audit boundary and conventions

This is the canonical inventory for the role dashboards registered in `src/config/routes/dashboards.routes.tsx`. Each routed page delegates to `ReferenceRoleDashboard` and then renders the named reference layout. “Summary” below means the live client request `GET /api/dashboards/:dashboardCode/summary` unless the employee exception is called out.

The dashboard router also exposes `metric-values`, `metrics`, `good-bad-insights`, metric `drilldown`, metric `trend`, `filters`, `root-causes`, and `owner-accountability` for every entitled `:dashboardCode`. None of the routed role pages or the reference shared UI inspected here currently calls those endpoints. They remain audit candidates for future interactive metrics, not current widget data sources.

`ScopedFilterBar` is a shared control but presently loads its choices from `GET /api/org/branches` and `GET /api/org/processes[?branch_id=…]`, **not** `GET /api/dashboards/:dashboardCode/filters`. It is rendered only for WFM, CEO, Quality, Operations, and Manager; its date changes are intentionally ignored by `ReferenceRoleDashboard`.

## `/ceo/dashboard` — `CEO_DASHBOARD`

- **Page / layout:** `src/pages/dashboards/CeoDashboard.tsx` → `ReferenceRoleDashboard` (`ceo`) → `reference/CeoReferenceLayout.tsx`.
- **Summary:** `GET /api/dashboards/CEO_DASHBOARD/summary?branchId=&processId=`.
- **Secondary live sources:** `GET /api/ats/stats`; `GET /api/management/workforce-dashboard`; `GET /api/finance/pnl/summary`; `GET /api/bi/daily-operations-pulse`; `GET /api/executive/quality-summary?daysBack=30`; `GET /api/kpi/org-summary?period=YYYY-MM`; `GET /api/bi/quality-intervention` (all carry branch/process where coded); shared Work Inbox: `GET /api/work-inbox/my`.
- **Visible checks:** four executive metric cards; workforce/attendance strip; Work Inbox; automated executive brief; Good / Bad Insights; quality overview; KPI performance and trend.
- **Risk notes:** Broad organisation/branch/process sources are combined in one view; verify every source actually honors the selected scope. The generic dashboard insight, root-cause, accountability, metric, and drilldown endpoints are not wired to the visible panels.

## `/payroll-hr/dashboard` — `PAYROLL_HR_DASHBOARD`

- **Page / layout:** `src/pages/dashboards/PayrollHrDashboard.tsx` → `ReferenceRoleDashboard` (`payroll`) → `reference/PayrollReferenceLayout.tsx`.
- **Summary:** `GET /api/dashboards/PAYROLL_HR_DASHBOARD/summary`.
- **Secondary live sources:** `GET /api/finance/pnl/summary`; `GET /api/payroll/runs?limit=50`; after a run is selected, `GET /api/dashboards/PAYROLL_HR_DASHBOARD/operational-summary?runId=…`.
- **Visible checks:** run selector and required-selection state; run-linked source-availability disclosure; payroll metric grid; payroll/payment/upcoming-payroll panels; statutory, PF/ESI/TDS, alerts, loans, reimbursements, due dates, and payslip-status panels.
- **Risk notes:** Operational summary is deliberately run-linked and requires `runId`; many displayed domains are explicitly marked unavailable by its response. Do not replace that state with the shared `PayrollSummaryWidget`, `PayrollSummaryDonut`, `RevenueAtRiskWidget`, or `StatutorySummaryTable`: those widgets fetch `/api/management/ceo-metrics` (HR/CEO-shaped data) and are not rendered by this routed layout.

## `/wfm/dashboard` — `WFM_DASHBOARD`

- **Page / layout:** `src/pages/dashboards/WfmDashboard.tsx` → `ReferenceRoleDashboard` (`wfm`) → `reference/WfmReferenceLayout.tsx`.
- **Summary:** `GET /api/dashboards/WFM_DASHBOARD/summary?branchId=&processId=`.
- **Secondary live sources:** `GET /api/wfm/biometric-summary/adherence-summary`; `GET /api/integrations/cosec/sync-status`; `GET /api/bi/daily-operations-pulse`; shared Work Inbox: `GET /api/work-inbox/my`; `ScopedFilterBar` sources noted above.
- **Visible checks:** WFM metric grid, attendance/operations trend, biometric/Cosec status, AI brief, attendance-variance buckets, Work Inbox.
- **Risk notes:** `?view=attendance` changes this page’s variant to `wfm_attendance` and therefore its summary code/layout, while the route gate remains `WFM_DASHBOARD`; audit this entitlement/code mismatch separately. Filter options are not sourced from the dashboard’s scoped filters endpoint.

## `/hr/dashboard` — `HR_DASHBOARD`

- **Page / layout:** `src/pages/dashboards/HrDashboard.tsx` → `ReferenceRoleDashboard` (`hr`) → `reference/HrReferenceLayout.tsx`.
- **Summary:** `GET /api/dashboards/HR_DASHBOARD/summary`.
- **Secondary live sources:** `GET /api/ats/stats`; shared Work Inbox: `GET /api/work-inbox/my`.
- **Visible checks:** five primary HR metric cards; two ATS metric cards; HR AI brief; Work Inbox.
- **Risk notes:** The access registry permits filters, but this variant does not render `ScopedFilterBar`, so the displayed summary is unfiltered. `PendingActionsWidget` is not rendered here but hard-codes `/api/dashboards/hr/summary` (lowercase/non-registry code): avoid introducing it without correcting the path and contract.

## `/manager/dashboard` — `MANAGEMENT_DASHBOARD`

- **Page / layout:** `src/pages/dashboards/ManagerDashboard.tsx` → `ReferenceRoleDashboard` (`manager`) → `reference/ManagerReferenceLayout.tsx`.
- **Summary:** `GET /api/dashboards/MANAGEMENT_DASHBOARD/summary?branchId=&processId=`.
- **Secondary live sources:** `GET /api/ats/stats`; `GET /api/management/workforce-dashboard`; `GET /api/wfm/biometric-summary/adherence-summary`; `GET /api/bi/daily-operations-pulse`; `GET /api/leave/requests?limit=100`; `GET /api/kpi/org-summary?period=YYYY-MM`; `GET /api/bi/quality-intervention`; `ScopedFilterBar` sources.
- **Visible checks:** manager metric grid; team attendance, leave-request, and team-status panels; performance trend; tasks/quick links; pending approvals; productivity; shift adherence; coaching follow-ups; escalation alerts.
- **Risk notes:** A manager/team dashboard combines organisation-oriented workforce/KPI/ATS and QA intervention sources; validate role and scope enforcement on every source, especially leaves. The date filter does not alter requests.

## `/my-dashboard` — `EMPLOYEE_SELF_DASHBOARD`

- **Page / layout:** `src/pages/dashboards/EmployeeSelfDashboard.tsx` (also `CompanyFeedLoginPopup`) → `ReferenceRoleDashboard` (`employee`) → `reference/EmployeeReferenceLayout.tsx`.
- **Summary:** no generic code summary query. Client calls `GET /api/dashboards/employee/summary` as an attendance fallback; the dashboard router’s fixed route is `GET /employee/summary` below its `/api/dashboards` mount.
- **Secondary live sources:** `GET /api/wfm/my-attendance`; `GET /api/leave/balance`; `GET /api/ats/my-onboarding-status`; `GET /api/lms/learner-progress/:employeeId`; `GET /api/engagement/me`; shared Work Inbox: `GET /api/work-inbox/my`; Company Feed side panel/login popup: `GET /api/engagement/company-posts/feed?page=&limit=`.
- **Visible checks:** attendance grid and attendance/leave AI brief; onboarding; learning progress; leave balance; Work Inbox; source freshness; quick links; company feed.
- **Risk notes:** This is the only routed dashboard not driven by `/:dashboardCode/summary`; every source must remain employee-linked. `MyAttendanceWidget` has the same lower-case fallback path but is not rendered by this layout.

## `/quality-dashboard` — `QUALITY_DASHBOARD`

- **Page / layout:** `src/pages/dashboards/QualityDashboardRole.tsx` → `ReferenceRoleDashboard` (`quality`) → `reference/QualityReferenceLayout.tsx`.
- **Summary:** `GET /api/dashboards/QUALITY_DASHBOARD/summary?branchId=&processId=`.
- **Secondary live sources:** `GET /api/management/workforce-dashboard`; `GET /api/bi/daily-operations-pulse`; `GET /api/quality-dashboard/summary`; `GET /api/quality-dashboard/trend?granularity=day`; `GET /api/quality-dashboard/agents?limit=100`; `ScopedFilterBar` sources.
- **Visible checks:** quality metric grid; score trend; pass/fail split; top/bottom agent panels; quality action cards.
- **Risk notes:** The dedicated quality summary/trend/agents endpoints are the primary layout inputs; generic dashboard summary is fetched concurrently but may not supply the visible detail. Confirm branch/process semantics across both quality API families.

## `/operations-dashboard` — `OPERATIONS_DASHBOARD`

- **Page / layout:** `src/pages/dashboards/OperationsDashboardRole.tsx` → `ReferenceRoleDashboard` (`operations`) → `reference/OperationsReferenceLayout.tsx`.
- **Summary:** `GET /api/dashboards/OPERATIONS_DASHBOARD/summary?branchId=&processId=`.
- **Secondary live sources:** `GET /api/management/workforce-dashboard`; `GET /api/wfm/biometric-summary/adherence-summary`; `GET /api/bi/daily-operations-pulse`; `GET /api/bi/quality-intervention`; `ScopedFilterBar` sources.
- **Visible checks:** operations metric grid, volume/shrinkage trend, live performance/quality panels, action cards.
- **Risk notes:** Operations relies on workforce, biometric, pulse, and intervention blends; validate every metric against operations scope and avoid reusing HR/CEO summary widgets.

## `/recruiter-dashboard` — `RECRUITER_DASHBOARD`

- **Page / layout:** `src/pages/dashboards/RecruiterDashboard.tsx` → `ReferenceRoleDashboard` (`recruiter`) → `reference/RecruiterReferenceLayout.tsx`.
- **Summary:** `GET /api/dashboards/RECRUITER_DASHBOARD/summary`.
- **Secondary live sources:** `GET /api/ats/stats`; `GET /api/ats/recruiter/hiring-dashboard?fromDate=IST-today&toDate=IST-today`.
- **Visible checks:** recruiter metric grid; hiring funnel; application/requisition activity panels; recruiter action cards.
- **Risk notes:** Data is merged from generic ATS stats and a day-bounded recruiter endpoint; no branch/process filter is rendered despite registry support. Verify that the merged data does not imply wider HR visibility.

## `/wfm-attendance` — `WFM_ATTENDANCE_DASHBOARD`

- **Page / layout:** `src/pages/dashboards/WfmAttendanceDashboard.tsx` → `ReferenceRoleDashboard` (`wfm_attendance`) → `reference/WfmAttendanceReferenceLayout.tsx`.
- **Summary:** `GET /api/dashboards/WFM_ATTENDANCE_DASHBOARD/summary`.
- **Secondary live sources:** `GET /api/wfm/biometric-summary/adherence-summary`; `GET /api/integrations/cosec/sync-status`; `GET /api/bi/daily-operations-pulse`.
- **Visible checks:** attendance metric grid; processed-status, late-trend, regularization, biometric-device, shift, roster-coverage, manual-punch, overtime, compliance, alerts, and quick-action panels.
- **Risk notes:** Registry allows filters but this layout has no `ScopedFilterBar`; it may show organisation scope irrespective of desired branch/process. Device data is currently an empty array paired with Cosec sync status, so validate the device-status panel’s empty state.

## `/it/dashboard` — `IT_MANAGER_DASHBOARD`

- **Page / layout:** `src/pages/dashboards/ItManagerDashboard.tsx` → `ReferenceRoleDashboard` (`it_manager`) → `reference/ItManagerReferenceLayout.tsx`.
- **Summary:** `GET /api/dashboards/IT_MANAGER_DASHBOARD/summary`.
- **Secondary live sources:** `GET /api/it-provisioning/stats?assigned_role=it[&branch_id=&process_id=]`; `GET /api/it-provisioning/it-dashboard-summary[?branch_id=&process_id=]`; bulk upload: `POST /api/it-provisioning/bulk-sync`.
- **Visible checks:** IT metric grid/action strip; provisioning task breakdown and pending joiners; helpdesk ticket metrics/history; employee directory; bulk upload workflow.
- **Risk notes:** This page does not render filter controls, so branch/process query parameters are normally absent despite being supported by its direct endpoints. The visible bulk-upload workflow is a mutation surface and should be audited separately from dashboard data reads.

## Shared-widget and endpoint risk register

- `src/components/dashboard/widgets/PayrollSummaryWidget.tsx`, `PayrollSummaryDonut.tsx`, `RevenueAtRiskWidget.tsx`, and `StatutorySummaryTable.tsx` query `/api/management/ceo-metrics`; they are HR/CEO-summary-shaped and are **not currently rendered** by routed role-dashboard layouts. Treat future reuse as a cross-role data-contract risk.
- `PendingActionsWidget.tsx` queries `/api/dashboards/hr/summary`, not the registered `HR_DASHBOARD` code. It is also not currently rendered by the routed layouts.
- `ScopedFilterBar.tsx` uses organisation endpoints rather than `/:dashboardCode/filters`; its date range has no effect in `ReferenceRoleDashboard`.
- `ReferenceWorkInbox` is independently queried by CEO, HR, WFM, and employee layouts; it is not part of the dashboard summary response and needs its own entitlement/error-state verification.

## Files inspected

- `src/config/routes/dashboards.routes.tsx`
- `src/pages/dashboards/*.tsx` for the eleven routed wrapper pages
- `src/pages/dashboards/ReferenceRoleDashboard.tsx`
- `src/pages/dashboards/ReferenceDashboardUI.tsx`
- `src/pages/dashboards/dashboard-data-contracts.ts`
- `src/pages/dashboards/reference-dashboard-model.ts`
- `src/pages/dashboards/reference/*ReferenceLayout.tsx` and `ReferenceOperationalPanels.tsx`
- `src/components/dashboard/**/*` (with focused inspection of `ScopedFilterBar.tsx`, shared operational UI, and dashboard widgets)
- `src/hooks/useExecutiveQuality.ts`, `src/hooks/useOrgKpiSummary.ts`
- `backend/src/modules/dashboards/dashboard.routes.ts`
- `backend/src/shared/dashboardAccessRegistry.ts`

## Verification

- Cross-checked all eleven routes in `dashboardRouteElements` against a matrix section, the route-gate dashboard code, wrapper page, `ReferenceRoleDashboard` variant, and rendered reference layout.
- Cross-checked each named dashboard summary against the client query and router implementation; recorded direct/shared API calls from enabled variant queries and shared UI.
