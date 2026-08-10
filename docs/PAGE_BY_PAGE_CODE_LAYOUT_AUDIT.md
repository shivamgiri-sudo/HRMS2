# HRMS1 Page-by-Page Code and Layout Audit

## Purpose

This document tracks detailed page-level findings while Codex stabilizes the branch. It focuses on code quality, layout, role visibility, data correctness, search, pagination, filters, exports, and premium UI opportunities.

## Design direction from supplied references

The supplied dashboard references show a premium HR SaaS pattern:

- Rounded left sidebar with grouped navigation.
- Top search and quick actions.
- Hero/banner card for page context.
- KPI cards with big numbers and small trend/status pills.
- White card surfaces with soft borders and subtle shadows.
- Operational right-side panels for approvals, requests, exceptions, and employee status.
- Calendar/timeline visuals for attendance, roster, leave, interviews, payroll close, and onboarding.
- Line charts for trends, bar charts for monthly comparisons, donut charts for distributions, gauges for readiness/performance/adherence.
- Visual priority: data first, decoration second.

Do not copy the images exactly. Build HRMS1's own enterprise design language.

Recommended shared UI primitives:

```text
PremiumDashboardShell
PremiumHeroBanner
PremiumMetricCard
PremiumInsightCard
PremiumReportCard
PremiumCalendarTimeline
PremiumApprovalPanel
PremiumFilterBar
PremiumDataTableShell
PremiumEmptyState
PremiumStatusPill
```

## Route and role gate summary

Pages already using page-code gate include `/employees`, `/payroll`, `/ats/dashboard`, `/wfm/live-tracker`, `/org-masters`, `/payroll/payslips`, `/integration-hub`, and compliance pages.

Pages requiring gate/scope review:

```text
/reports
/attendance
/leaves
/assets
/settings
/profile
/performance
/employee-stat-card/:id
/performance-feedback/*
```

Highest priority:

```text
/reports -> ADVANCED_REPORTS or REPORTS page code
/attendance -> split self vs WFM/team mode
/settings -> admin/page-code access
/employee-stat-card/:id -> self/team/admin scope
```

## Page audit: /reports

### Current code observations

File:

```text
src/pages/Reports.tsx
```

Current strengths:

- Uses live hooks from `useReportsData`.
- Has year filter.
- Has overview and employee report tabs.
- Has headcount summary cards.
- Has employee growth, department distribution, leave statistics, and payroll trend charts.
- Blocks non-admin/HR inside the page.

Current issues:

1. Route is only `ProtectedRoute` in `App.tsx`, not page-code gated.
2. Access denial is inside page instead of route-level gate.
3. Report cards are limited to Attendance, Leave, Payroll, Asset.
4. New report-suite catalog is not mounted in the UI yet.
5. Filters are minimal; no Branch, Process, Department, Cost Centre, Manager filter across all reports.
6. No report catalog search.
7. No pinned/recent reports.
8. No data source/last refresh/data health badge.
9. Exports are scattered inside individual components.
10. Premium visual design is partial, not yet at command-center level.

### Required improvements

- Gate `/reports` using `ADVANCED_REPORTS` or `REPORTS` page code.
- Mount/use `/api/reports/suite/catalog`.
- Add report catalog grid with category tabs:

```text
HR
Attendance
Leave
Payroll
Compliance
WFM
ATS
Exit
Governance
```

- Add global report filters:

```text
Year
Month
Date range
Branch
Department
Process
Cost Centre
Manager
Status
```

- Use `/api/org/filter-options` for active-only filters.
- Add report cards with:

```text
Report name
Description
Module
Last refreshed
Access level
Source table
Run button
Export button
Schedule button
```

- Add Data Health panel:

```text
Employee source: employees
Attendance source: attendance_daily_record
Payroll source: salary_prep_line
Leave source: leave_balance_ledger
Biometric source: integration_biometric_daily
```

### Premium layout proposal

```text
Hero: Reports & Analytics Command Center
KPI row: Available reports, Scheduled reports, Failed exports, Data health score
Left/main: report catalog cards
Right panel: recent exports, saved reports, data alerts
Bottom: key charts and exceptions
```

## Page audit: /attendance

### Current code observations

File:

```text
src/pages/Attendance.tsx
```

Current strengths:

- Good premium hero header already exists.
- Has month/year selector.
- Has today's attendance cards.
- Has schedule panel.
- Has attendance calendar.
- Has monthly summary cards.
- Has pagination for history.
- Uses dark/blue enterprise styling closer to the references.

Current issues:

1. Route is only `ProtectedRoute`, not page-code gated.
2. Page is mainly employee self-service, but page name is generic `/attendance`.
3. Admin/WFM/team attendance should be separate or tabbed with clear access controls.
4. Admin/HR late count is calculated on frontend from `clock_in`, while backend attendance engine already has `late_mark` and `late_by_minutes`; this can create mismatch.
5. Calendar uses `employeeId={user.id}`; confirm whether `AttendanceCalendar` expects auth user id or employee id. If it expects employee id, this is a bug.
6. Month/year dropdowns sit on dark hero; global select readability patch helps, but trigger text in hero still uses white styling intentionally.
7. Team/WFM filters are absent here.
8. No operational exception panel for unreconciled, absent, biometric mismatch, missing roster, missing shift.

### Required improvements

- Split route modes:

```text
/attendance/my -> employee self-service
/attendance/team -> manager/TL team attendance
/wfm/live-tracker -> WFM/HR/admin command center
```

or add role-based tabs inside `/attendance`:

```text
My Attendance
Team Attendance
Exceptions
Regularization
```

- Add page gate for team/WFM tabs.
- Use backend fields:

```text
attendance_status
lwp_value
late_mark
late_by_minutes
attendance_source
raw_minutes
dialler_minutes
biometric_minutes
is_locked
```

- Add premium timeline from supplied time-attendance reference:

```text
Rows = employees
Columns = dates
Colors = present / late / half day / leave / week off / holiday / absent / unreconciled
```

- Add exception cards:

```text
Unreconciled
No biometric for present
Punched but absent
Missing roster
Missing shift
Manual overrides
Attendance not locked
```

- Do not change attendance calculation logic.

## Page audit: /payroll

### Current code observations

File:

```text
src/pages/Payroll.tsx
```

Current strengths:

- Has premium metric cards.
- Has search query.
- Has payroll history filters: month/year/status/search.
- Has CSV and PDF export.
- Has pagination for history.
- Has payroll table and salary structure manager.
- Has role-based internal access check using `useIsAdminOrHR`.

Current issues:

1. Main route is page-code gated in App, which is good.
2. Search/history filters are client-side over `allRecords`. This will not scale.
3. Current payroll only filters by current month in hook; run-level controls are not prominent enough.
4. Payroll readiness/freeze/variance/hold salary tabs are not yet surfaced.
5. Exports are generated client-side; sensitive payroll export should be audited server-side.
6. Bulk mark paid/processed actions need governance confirmation and audit trail.
7. Payroll records should be filtered server-side by branch/process/cost centre/status/search.
8. Payroll page should not just be payroll list; it should become Payroll Control Center.

### Required improvements

Add tabs:

```text
Dashboard
Readiness
Attendance Freeze
Current Payroll
Variance Review
Employee Lines
Arrears
Hold Salary
Bank File
Payslip Release
Audit Trail
```

Add premium KPI cards:

```text
Payroll Readiness %
Attendance Frozen
Gross Pay
Net Pay
Deductions
High Variance Employees
Missing Bank
Payslip Acknowledgement
```

Move to server-side pagination/search:

```text
GET /api/payroll/records?page=&limit=&search=&runMonth=&status=&branchId=&processId=&costCentreId=
```

Exports:

- Payroll register export must be generated by backend.
- NEFT/bank export must be Finance/Payroll/Admin only.
- Export must create audit log.

## Page audit: /employees

### Current code observations

File:

```text
src/pages/Employees.tsx
```

Current strengths:

- Already page-code gated in App as `EMPLOYEE_MANAGEMENT`.
- Uses server-side employee directory query with page, limit, search, department, process, branch, status.
- Has premium hero header.
- Has metric cards.
- Has search.
- Has department/process/branch/status filters.
- Has clear filters.
- Has bulk actions and export.
- Has pagination based on backend total.

Current issues:

1. Filters currently use `useDepartments` and `useEmployeeDirectoryMasters`; confirm these return active-only. Preferred source is `/api/org/filter-options`.
2. Cost centre filter is missing.
3. Reporting manager filter is missing.
4. Export uses currently loaded/sorted employees only, not full server-side result set for all pages.
5. Bulk actions must be strictly role scoped.
6. Non-admin/HR view says Team Members, but backend must enforce manager/TL team scope.
7. Employee list could become more premium with optional card/list switch.
8. Inactive status is available; this is okay only because status filter explicitly includes Active & Inactive.

### Required improvements

- Replace master filter sources with `/api/org/filter-options`.
- Add filters:

```text
Cost Centre
Reporting Manager
Employment Type
Work Location
```

- Server-side export endpoint:

```text
GET /api/employees/export?same-filters
```

- Add role-specific view:

```text
Admin/HR: all permitted employees
Manager/TL: own team only
Employee: no directory access unless allowed
```

- Add premium employee directory mode:

```text
Table view
Card view
Org chart view
Manager hierarchy view
```

## Shared layout issues found across pages

1. Metric card component is duplicated in Reports, Attendance, Payroll, Employees. Create one shared `PremiumMetricCard`.
2. Hero header patterns are duplicated. Create one shared `PremiumHeroBanner`.
3. Filter bars are duplicated. Create one shared `PremiumFilterBar`.
4. Pagination is implemented differently across pages. Create one shared `ServerPaginationBar`.
5. Search debounce is inconsistent. Standardize using deferred value + server-side search.
6. Export logic is often client-side. Sensitive exports should move to backend with audit log.
7. Status colors need central mapping.
8. Empty states are duplicated. Create one shared `PremiumEmptyState`.

## Shared status color system

Recommended:

```text
Success: emerald
Info: sky/blue
Warning: amber
Danger: rose/red
Neutral: slate
Payroll/finance: indigo
WFM/attendance: blue + emerald
Leave: violet
Compliance: rose + amber
```

## Premium UI priority by page

### Phase 1

```text
/dashboard
/reports
/attendance
/wfm/live-tracker
/payroll
/employees/:id
```

### Phase 2

```text
/employees
/leaves
/org-masters
/ats/dashboard
/payroll/payslips
/integration-hub
```

### Phase 3

```text
/performance
/engagement/command-center
/exit/command-center
/assets-manager
/helpdesk
/compliance/statutory
```

## Next code actions after Codex stabilizes typecheck

1. Restore payroll routes from main and reapply only payroll governance additions.
2. Mount report suite.
3. Add route gates for `/reports`, `/attendance`, `/settings`, `/employee-stat-card/:id`.
4. Add manager/TL hierarchy scope helper.
5. Apply helper to attendance and employee detail APIs.
6. Migrate `/employees` filters to `/api/org/filter-options`.
7. Add cost centre and manager filters to `/employees`.
8. Add `/reports` premium catalog layout.
9. Add `/payroll` readiness/freeze/variance tabs.
10. Add `/attendance` team timeline and exceptions layout.
