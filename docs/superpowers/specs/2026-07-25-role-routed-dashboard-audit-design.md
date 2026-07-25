# Role-Routed Dashboard Audit and Fix Design

Date: 2026-07-25

## Goal

Make the 10 role-routed dashboards fully functional against real database-backed APIs, with verified route access, live data rendering, role scope enforcement, and resilient loading/error/empty states.

## In Scope

Only the role-routed dashboards defined in `src/config/routes/dashboards.routes.tsx`:

- `CEO_DASHBOARD` → `/ceo/dashboard`
- `PAYROLL_HR_DASHBOARD` → `/payroll-hr/dashboard`
- `WFM_DASHBOARD` → `/wfm/dashboard`
- `HR_DASHBOARD` → `/hr/dashboard`
- `MANAGEMENT_DASHBOARD` → `/manager/dashboard`
- `EMPLOYEE_SELF_DASHBOARD` → `/my-dashboard`
- `QUALITY_DASHBOARD` → `/quality-dashboard`
- `OPERATIONS_DASHBOARD` → `/operations-dashboard`
- `RECRUITER_DASHBOARD` → `/recruiter-dashboard`
- `IT_MANAGER_DASHBOARD` → `/it/dashboard`
- `WFM_ATTENDANCE_DASHBOARD` → `/wfm-attendance`

## Out of Scope

- Non-routed reporting pages outside the role dashboard route file
- New dashboard features unrelated to broken or missing live-data behavior
- Production deployment steps beyond readiness validation

## Current Architecture Observed

The routed dashboard pages live in `src/pages/dashboards/` and appear to share common rendering patterns through:

- `src/pages/dashboards/ReferenceRoleDashboard.tsx`
- `src/pages/dashboards/ReferenceDashboardUI.tsx`
- `src/pages/dashboards/dashboard-data-contracts.ts`
- `src/pages/dashboards/reference-dashboard-model.ts`

Backend dashboard APIs are centralized in:

- `backend/src/modules/dashboards/dashboard.routes.ts`
- `backend/src/modules/dashboards/dashboard-definition.service.js/ts`
- `backend/src/modules/dashboards/dashboard-drilldown.service.ts`
- `backend/src/shared/dashboardScope.js`
- `backend/src/shared/dashboardAccessRegistry.js`

The current frontend also contains some suspicious hardcoded HR summary usage in shared dashboard layout components, which is a strong signal that some role dashboards may still be rendering the wrong dataset or generic fallback data.

## Problem Statement

The dashboards must not merely load; they must be trustworthy. That means each dashboard widget must:

1. resolve the correct route and entitlement gate
2. call the correct backend endpoint for its own dashboard code
3. receive real scoped data from live DB queries
4. render that data without fallback placeholders pretending to be live values
5. fail loudly and intelligibly when upstream data is unavailable

## Recommended Approach

Use an endpoint-first dashboard audit.

For each routed dashboard:

1. inventory every visible widget and the API call behind it
2. trace the API to backend route, metric service, drilldown service, and SQL source
3. verify role access and scope narrowing
4. fix any mismatch in:
   - dashboard code
   - endpoint path
   - role gate
   - metric mapping
   - backend query
   - frontend data contract
   - loading/error/empty UI handling
5. validate the dashboard in browser with live authenticated data

## Execution Order

The pass should proceed from the simplest, most user-scoped dashboards toward the broadest cross-functional dashboards:

1. Employee Self
2. Manager
3. HR
4. WFM
5. WFM Attendance
6. Recruiter
7. Operations
8. Quality
9. Payroll HR
10. IT Manager
11. CEO

This order reduces ambiguity early because self/team dashboards have narrower scope and simpler expected datasets.

## Verification Model

Each dashboard is only considered fixed when all of the following are true:

- route opens for an entitled user
- route is blocked for a non-entitled user
- summary endpoint returns live values for the correct dashboard code
- widget-level calls use the correct endpoint paths
- no widget silently falls back to another dashboard’s data
- drilldown and filter calls use the correct dashboard code and scope
- visible cards, charts, tables, and action panels render actual values or explicit empty states
- loading and API failure states are understandable and not disguised as zero

## Expected Output of Phase 1

- all 11 routed role dashboards audited
- broken data paths fixed
- role access and scope issues corrected
- dashboard endpoint mismatches corrected
- shared component misuse corrected
- per-dashboard verification notes captured

## Risks

### 1. Shared frontend layout contamination

Some shared components currently call `/api/dashboards/hr/summary` directly. This risks leaking HR data into other dashboards or making multiple dashboards appear functional while actually showing the same dataset.

Mitigation:

- explicitly map each dashboard page to its own dashboard code and endpoint usage
- remove or isolate shared components that are not dashboard-code-aware

### 2. Backend metric under-definition

Some dashboard codes may not have sufficient metric configuration or may rely on empty catalog definitions.

Mitigation:

- verify dashboard metric definitions per code
- fill backend metric execution gaps only for the audited role dashboards

### 3. Production/live-data ambiguity

Some dashboards may render, but use low-quality or stale data because source tables are incomplete.

Mitigation:

- distinguish code defects from source-data gaps
- surface source-data blockers explicitly instead of masking them

## Acceptance Criteria

This design is complete when the implementation phase can produce, for each routed role dashboard:

- correct route protection
- correct dashboard code usage
- real DB-backed summary metrics
- correct drilldown/filter wiring
- no fake placeholder success state
- explicit evidence of verification
