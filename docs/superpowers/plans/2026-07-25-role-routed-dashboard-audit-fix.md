# Role-Routed Dashboard Audit and Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit and fix the routed role dashboards so each one renders real, role-scoped, database-backed data through the correct frontend and backend paths.

**Architecture:** The work proceeds dashboard-by-dashboard, starting from route definitions and page components, then tracing each widget to dashboard API endpoints, metric execution, scope filtering, and database queries. Shared dashboard components are fixed only where they currently misroute requests or leak one dashboard’s data into another.

**Tech Stack:** React, React Router, TypeScript, TanStack Query, Express, MySQL, role entitlement middleware, dashboard metric services.

## Global Constraints

- Only the routed role dashboards are in scope for this phase.
- Every dashboard must use its own dashboard code and must not silently reuse HR summary data.
- Real API failures must remain visible; do not convert upstream failures into fake zeros or fake empty success states.
- Scope and entitlement must remain enforced through `ProtectedRoute`, `WorkforcePageGate`, and backend dashboard entitlement checks.
- Prefer fixes that follow existing dashboard architecture over introducing a new dashboard framework.

---

## File Structure

### Route and access contract

- Modify: `src/config/routes/dashboards.routes.tsx`
- Inspect/possibly modify: `src/components/auth/ProtectedRoute.tsx`
- Inspect/possibly modify: `backend/src/shared/dashboardAccessRegistry.js`
- Inspect/possibly modify: `backend/src/shared/dashboardScope.js`

### Frontend dashboard pages

- Modify as needed:
  - `src/pages/dashboards/CeoDashboard.tsx`
  - `src/pages/dashboards/PayrollHrDashboard.tsx`
  - `src/pages/dashboards/WfmDashboard.tsx`
  - `src/pages/dashboards/HrDashboard.tsx`
  - `src/pages/dashboards/EmployeeSelfDashboard.tsx`
  - `src/pages/dashboards/ManagerDashboard.tsx`
  - `src/pages/dashboards/QualityDashboardRole.tsx`
  - `src/pages/dashboards/OperationsDashboardRole.tsx`
  - `src/pages/dashboards/RecruiterDashboard.tsx`
  - `src/pages/dashboards/WfmAttendanceDashboard.tsx`
  - `src/pages/dashboards/ItManagerDashboard.tsx`

### Shared frontend dashboard plumbing

- Likely modify:
  - `src/pages/dashboards/ReferenceRoleDashboard.tsx`
  - `src/pages/dashboards/ReferenceDashboardUI.tsx`
  - `src/pages/dashboards/dashboard-data-contracts.ts`
  - `src/pages/dashboards/reference-dashboard-model.ts`
  - `src/components/dashboard/DashboardDrilldownDrawer.tsx`
  - `src/components/dashboard/widgets/AiBriefingPanel.tsx`
  - `src/components/dashboard/widgets/PendingActionsWidget.tsx`
  - `src/components/dashboard/widgets/MyAttendanceWidget.tsx`
  - any `src/components/dashboard/layouts/*.tsx` file still hardcoding `/api/dashboards/hr/summary`

### Backend dashboard APIs

- Likely modify:
  - `backend/src/modules/dashboards/dashboard.routes.ts`
  - `backend/src/modules/dashboards/dashboard-definition.service.ts`
  - `backend/src/modules/dashboards/dashboard-drilldown.service.ts`
  - `backend/src/shared/dashboardMetricContract.js`
  - relevant tests in `backend/src/modules/dashboards/__tests__/`

### Audit artifacts

- Create:
  - `docs/dashboard-audit/2026-07-25-role-dashboard-widget-matrix.md`
  - `docs/dashboard-audit/2026-07-25-role-dashboard-verification-log.md`

## Task List

### Task 1: Build the routed dashboard audit matrix

**Files:**
- Create: `docs/dashboard-audit/2026-07-25-role-dashboard-widget-matrix.md`
- Modify: `src/config/routes/dashboards.routes.tsx`
- Modify: `src/pages/dashboards/ReferenceRoleDashboard.tsx`

**Interfaces:**
- Consumes: route-to-dashboard-code mapping from `dashboardRouteElements`
- Produces: dashboard inventory listing route, dashboard code, page component, summary endpoint, widget endpoint, and verification owner

- [ ] Read `src/config/routes/dashboards.routes.tsx` and record all 11 routed role dashboards.
- [ ] Read `src/pages/dashboards/ReferenceRoleDashboard.tsx` and capture every API path it can call.
- [ ] Create `docs/dashboard-audit/2026-07-25-role-dashboard-widget-matrix.md` with one section per dashboard including:
  - route path
  - dashboard code
  - page component
  - summary endpoint
  - secondary endpoints (`metric-values`, `metrics`, `good-bad-insights`, `filters`, `drilldown`, `trend`, `root-causes`, `owner-accountability`)
  - visible widgets to verify
- [ ] Verify the matrix is complete by checking that every page in `src/pages/dashboards/` is accounted for.
- [ ] Commit:
  - `git add docs/dashboard-audit/2026-07-25-role-dashboard-widget-matrix.md`
  - `git commit -m "docs: add role dashboard audit matrix"`

### Task 2: Remove hardcoded cross-dashboard frontend data calls

**Files:**
- Modify:
  - `src/components/dashboard/layouts/OpsLayout.tsx`
  - `src/components/dashboard/layouts/ManagerLayout.tsx`
  - `src/components/dashboard/layouts/HrAdminLayout.tsx`
  - `src/components/dashboard/layouts/FinanceLayout.tsx`
  - `src/components/dashboard/layouts/CeoLayout.tsx`
  - `src/components/dashboard/widgets/AiBriefingPanel.tsx`
  - `src/components/dashboard/widgets/PendingActionsWidget.tsx`

**Interfaces:**
- Consumes: dashboard code prop or route-specific page context
- Produces: dashboard-aware API usage instead of direct `/api/dashboards/hr/summary` assumptions

- [ ] Search for every occurrence of `/api/dashboards/hr/summary` and classify whether it belongs only to HR or is incorrectly shared.
- [ ] For each shared component that is reused outside HR, introduce an explicit `dashboardCode` or endpoint prop rather than relying on HR defaults.
- [ ] Ensure no CEO, Operations, Manager, Finance-like, or shared widget component silently pulls HR summary data by default unless the owning page explicitly passes `HR_DASHBOARD`.
- [ ] Run frontend typecheck/build command used by the repo and verify there are no prop/type regressions.
- [ ] Commit:
  - `git add src/components/dashboard src/pages/dashboards`
  - `git commit -m "fix: remove hardcoded hr summary usage from shared dashboards"`

### Task 3: Fix and verify Employee Self and Manager dashboards

**Files:**
- Modify:
  - `src/pages/dashboards/EmployeeSelfDashboard.tsx`
  - `src/pages/dashboards/ManagerDashboard.tsx`
  - `src/components/dashboard/widgets/MyAttendanceWidget.tsx`
  - `backend/src/modules/dashboards/dashboard.routes.ts`
  - `backend/src/modules/dashboards/dashboard-definition.service.ts`

**Interfaces:**
- Consumes: `/api/dashboards/employee/summary`, `/:dashboardCode/summary`, `/:dashboardCode/good-bad-insights`, `/:dashboardCode/owner-accountability`
- Produces: correct self-scoped and team-scoped data rendering for self/manager dashboards

- [ ] Verify Employee Self uses `/api/dashboards/employee/summary` only for self-specific attendance and not generic HR summary.
- [ ] Verify Manager dashboard uses `MANAGEMENT_DASHBOARD` summary and related role-scoped endpoints.
- [ ] Fix any contract mismatch between returned metric keys and rendered cards/widgets.
- [ ] Verify backend scope logic keeps self data limited to the current employee and manager data limited to allowed team scope.
- [ ] Add or update targeted backend tests if a bug is found in summary or scope semantics.
- [ ] Record results in `docs/dashboard-audit/2026-07-25-role-dashboard-verification-log.md`.
- [ ] Commit:
  - `git add src/pages/dashboards src/components/dashboard backend/src/modules/dashboards docs/dashboard-audit/2026-07-25-role-dashboard-verification-log.md`
  - `git commit -m "fix: verify self and manager role dashboards"`

### Task 4: Fix and verify HR, WFM, and WFM Attendance dashboards

**Files:**
- Modify:
  - `src/pages/dashboards/HrDashboard.tsx`
  - `src/pages/dashboards/WfmDashboard.tsx`
  - `src/pages/dashboards/WfmAttendanceDashboard.tsx`
  - `backend/src/modules/dashboards/dashboard.routes.ts`
  - `backend/src/modules/dashboards/dashboard-definition.service.ts`
  - `backend/src/modules/dashboards/dashboard-drilldown.service.ts`

**Interfaces:**
- Consumes: dashboard summary, metric values, filters, drilldown, trend
- Produces: role-correct HR and WFM metrics, filter behavior, and drilldowns

- [ ] Verify each of the three pages passes the correct dashboard code through summary, trend, drilldown, and filter requests.
- [ ] Fix any backend metric bundles that are missing or mismatched for `HR_DASHBOARD`, `WFM_DASHBOARD`, or `WFM_ATTENDANCE_DASHBOARD`.
- [ ] Verify filter dropdowns are scoped correctly by branch/process and do not overexpose organization-wide data where they should not.
- [ ] Verify drilldown drawers load data for the requested dashboard/metric pair and do not fail silently.
- [ ] Record verification evidence in `docs/dashboard-audit/2026-07-25-role-dashboard-verification-log.md`.
- [ ] Commit:
  - `git add src/pages/dashboards backend/src/modules/dashboards docs/dashboard-audit/2026-07-25-role-dashboard-verification-log.md`
  - `git commit -m "fix: verify hr and wfm role dashboards"`

### Task 5: Fix and verify Recruiter, Operations, and Quality dashboards

**Files:**
- Modify:
  - `src/pages/dashboards/RecruiterDashboard.tsx`
  - `src/pages/dashboards/OperationsDashboardRole.tsx`
  - `src/pages/dashboards/QualityDashboardRole.tsx`
  - `backend/src/modules/dashboards/dashboard.routes.ts`
  - `backend/src/modules/dashboards/dashboard-definition.service.ts`
  - any ATS/quality adapter files discovered during audit

**Interfaces:**
- Consumes: dashboard summary plus any role-specific widgets using ATS or quality modules
- Produces: recruiter/operations/quality role pages with live DB-backed content and correct scope

- [ ] Verify Recruiter dashboard metrics are sourced from ATS/live recruiter activity data rather than empty generic metric bundles.
- [ ] Verify Operations and Quality dashboards do not render placeholder layouts disconnected from backend data.
- [ ] If these pages rely on alternate modules outside the generic dashboard router, document and fix those adapters explicitly.
- [ ] Add tests or route assertions where the issue is in backend API dispatch or role metric configuration.
- [ ] Record results in the verification log.
- [ ] Commit:
  - `git add src/pages/dashboards backend/src/modules docs/dashboard-audit/2026-07-25-role-dashboard-verification-log.md`
  - `git commit -m "fix: verify recruiter operations and quality dashboards"`

### Task 6: Fix and verify Payroll HR, IT Manager, and CEO dashboards

**Files:**
- Modify:
  - `src/pages/dashboards/PayrollHrDashboard.tsx`
  - `src/pages/dashboards/ItManagerDashboard.tsx`
  - `src/pages/dashboards/CeoDashboard.tsx`
  - `backend/src/modules/dashboards/dashboard.routes.ts`
  - `backend/src/modules/dashboards/dashboard-definition.service.ts`
  - relevant supporting services queried by these dashboards

**Interfaces:**
- Consumes: payroll operational summary, generic summary endpoints, executive/IT widgets
- Produces: production-grade rendering for the highest-level routed dashboards

- [ ] Verify Payroll HR uses `/api/dashboards/PAYROLL_HR_DASHBOARD/operational-summary` only when a payroll run is selected and handles missing run selection explicitly.
- [ ] Verify IT Manager dashboard uses its own dashboard code and does not inherit another dashboard’s data source.
- [ ] Verify CEO dashboard is dashboard-code-aware across all shared widgets, especially AI briefing and summary cards.
- [ ] Fix any high-level dashboards that currently render because of borrowed HR summary data instead of their own role data.
- [ ] Record results in the verification log.
- [ ] Commit:
  - `git add src/pages/dashboards backend/src/modules/dashboards docs/dashboard-audit/2026-07-25-role-dashboard-verification-log.md`
  - `git commit -m "fix: verify payroll it and ceo dashboards"`

### Task 7: Browser validation and completion gate

**Files:**
- Modify:
  - `docs/dashboard-audit/2026-07-25-role-dashboard-verification-log.md`
- Inspect:
  - all routed dashboard pages in browser

**Interfaces:**
- Consumes: all prior dashboard fixes
- Produces: final verified pass/fail matrix for the 11 routed dashboards

- [ ] Open each routed dashboard with an entitled account and validate:
  - route access works
  - data loads
  - charts/tables/cards are populated or explicitly empty
  - no widget shows obviously wrong cross-dashboard data
  - drilldowns and filters work where present
- [ ] Verify non-entitled behavior for at least one dashboard class through role gate or protected route behavior.
- [ ] Mark each dashboard as PASS, PASS WITH DATA GAP, or FAIL in the verification log.
- [ ] Produce a final summary of:
  - fixed dashboards
  - remaining code defects
  - remaining source-data or production-permission blockers
- [ ] Commit:
  - `git add docs/dashboard-audit/2026-07-25-role-dashboard-verification-log.md`
  - `git commit -m "docs: finalize role dashboard verification log"`

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Shared dashboard widgets default to HR endpoints | High | Make dashboard code explicit in shared widgets and layouts |
| Empty backend metric bundles for some dashboard codes | High | Audit `dashboard-definition.service.ts` and metric config per role |
| Role scope bugs leak or suppress data | High | Validate route + backend scope together for each dashboard |
| Browser-only failures missed by API review | Medium | Require browser pass at the end of each dashboard cluster |

## Open Questions

- Which authenticated accounts should be the primary verification accounts for each routed role in production-like testing?
- Are `QUALITY_DASHBOARD`, `OPERATIONS_DASHBOARD`, and `IT_MANAGER_DASHBOARD` expected to use the generic dashboard router only, or do they intentionally combine generic and module-specific APIs?

## Self-Review

- Spec coverage: all routed role dashboards, shared component contamination, route/access, summary wiring, drilldown/filter behavior, and browser verification are covered by Tasks 1-7.
- Placeholder scan: no TBD/TODO placeholders remain in the plan.
- Type consistency: the plan consistently refers to the routed dashboard codes defined in `src/config/routes/dashboards.routes.tsx`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-25-role-routed-dashboard-audit-fix.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
