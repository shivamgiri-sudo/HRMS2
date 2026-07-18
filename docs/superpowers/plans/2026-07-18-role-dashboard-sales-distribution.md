# Phase 2F: Role Dashboard Sales Distribution

## Current behaviour

- Performance Hub exposes verified sales/performance facts through a role-scoped backend API.
- Employee, Manager, HR, Payroll, CEO and Super Admin dashboards did not yet surface those facts directly.

## Implementation scope

- Add a reusable role-aware sales performance panel.
- Source the panel from `/api/performance-hub/scorecard` only; no duplicated dashboard formulas.
- Render current-month sales metrics:
  - `SALES_COUNT`
  - `REVENUE`
  - `AOV`
  - `CONVERSION_RATE`
  - `COD_SHARE`
  - `RTO_RATE`
- Embed the panel in:
  - Employee self dashboard
  - Manager dashboard
  - HR dashboard
  - Payroll HR dashboard
  - CEO dashboard
  - Super Admin dashboard

## Files changed

- `src/components/performance-hub/RoleSalesPerformancePanel.tsx`
- `src/tests/role-sales-performance-panel.test.tsx`
- `src/pages/dashboards/ReferenceRoleDashboard.tsx`
- `src/pages/dashboards/RoleDashboardV3.tsx`

## Safety

- No new API endpoint was added.
- No mock metrics were introduced.
- Role and row scope remain enforced by the Performance Hub backend.
- If no mapped sales facts exist, the panel shows a source-sync empty state.
