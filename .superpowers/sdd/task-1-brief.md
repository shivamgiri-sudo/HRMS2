# Task 1 Brief: Build the routed dashboard audit matrix

## Goal

Create the canonical inventory for the routed role dashboards so later implementation tasks audit the real widgets and API paths instead of guessing.

## Scope

Only the routed role dashboards defined in `src/config/routes/dashboards.routes.tsx`.

## Required outputs

Create:

- `docs/dashboard-audit/2026-07-25-role-dashboard-widget-matrix.md`

That document must include one section per routed role dashboard with:

- route path
- dashboard code
- page component
- summary endpoint
- secondary endpoints used by the page/shared UI if applicable:
  - `/:dashboardCode/summary`
  - `/:dashboardCode/metric-values`
  - `/:dashboardCode/metrics`
  - `/:dashboardCode/good-bad-insights`
  - `/:dashboardCode/metric/:metricCode/drilldown`
  - `/:dashboardCode/metric/:metricCode/trend`
  - `/:dashboardCode/filters`
  - `/:dashboardCode/root-causes`
  - `/:dashboardCode/owner-accountability`
  - `/employee/summary`
  - `/PAYROLL_HR_DASHBOARD/operational-summary`
- visible widgets/components to verify
- any immediately visible risk notes, especially shared widgets that may point at HR summary data

## Files to inspect

- `src/config/routes/dashboards.routes.tsx`
- `src/pages/dashboards/*.tsx`
- `src/pages/dashboards/ReferenceRoleDashboard.tsx`
- `src/pages/dashboards/ReferenceDashboardUI.tsx`
- `src/pages/dashboards/dashboard-data-contracts.ts`
- `src/pages/dashboards/reference-dashboard-model.ts`
- `src/components/dashboard/**/*`
- `backend/src/modules/dashboards/dashboard.routes.ts`

## Constraints

- Do not modify application code in this task unless absolutely necessary to complete the inventory.
- Focus on accuracy over brevity.
- Use real paths and dashboard codes exactly as found.

## Deliverable standard

The output should be good enough that another implementer can audit each dashboard without rediscovering routes, API calls, or shared-widget risks.
