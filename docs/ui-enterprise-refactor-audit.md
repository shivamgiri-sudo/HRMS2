# Enterprise UI Refactor Audit

## Existing Strengths

- CompactDashboardLayout already provides a strong MAS-branded app shell with sidebar, sticky topbar, mobile drawer, and mobile bottom navigation.
- `hrms-design-system.css` already defines brand, surface, text, status, radius, spacing, shadow, and module tint tokens.
- Payroll, Attendance, Employees, and Reports already use existing hooks and actions cleanly, so the UI can be improved without touching business logic.
- Key routes are protected through existing layout, role, and page access behavior; no route path changes are needed.

## UI Inconsistencies Found

- Several pages define local KPI card variants with raw color classes and different spacing.
- Empty, loading, error, and access-denied states vary by page.
- Payroll and employee tables were desktop-first and depended on horizontal scrolling on small screens.
- Status badges use mixed color styles and raw hex/Tailwind semantic colors.
- Topbar breadcrumbs were generated from URL segments instead of the navigation labels already maintained in `navConfig`.
- Reports felt chart-first rather than a report library with a clear header, filters, and reusable metric cards.

## Components Created

- `EnterprisePageShell`
- `EnterprisePageHeader`
- `KpiCard`
- `KpiCardGrid`
- `FilterBar`
- `ActionToolbar`
- `ResponsiveDataView`
- `MobileRecordCard`
- `RightDetailDrawer`
- `ExceptionPanel`
- `ApprovalTimeline`
- `StepProgress`
- `ExportButtonGroup`
- `EmptyState`
- `ErrorState`
- `LoadingState`
- `AmountCell`
- `EmployeeCell`
- `StatusBadgeV2`

## Pages Migrated

- Payroll: enterprise header, KPI cards, exception panel, shared empty/loading states, and responsive payroll row cards.
- Reports: enterprise shell/header, report library cards, shared KPI cards, and consistent year filter/action surface.
- Employees: responsive employee card view added through the existing table component.
- Topbar: friendly breadcrumbs now prefer labels from `navConfig`.

## Remaining Pages To Migrate Later

- Attendance full shell cleanup beyond existing mobile-first cards.
- WFM control tower pages.
- COSEC monitoring.
- Payroll readiness.
- ATS command center, candidate master, onboarding bridge, and BGV verification.
- LMS, Quality, Performance, Compliance, Communication, Admin, Expense, and Portal pages.
