# HRMS1 Role and Page Access Audit

## Purpose

This audit identifies frontend routes and backend APIs that must be checked for all roles. It is intended for Codex/local validation while continuing page-by-page fixes.

## Access model found

Frontend uses two layers:

1. `ProtectedRoute`
   - Validates login.
   - Enforces password change.
   - Blocks non-employees except dashboard unless user is Admin/HR.
   - Can enforce explicit `roles` array.

2. `WorkforcePageGate`
   - Uses page code based access.
   - Shows access-denied UI.
   - Allows access request creation via `/api/access/access-requests`.

This is a good model, but it is inconsistently applied across high-risk pages.

## Routes that already use page-code gate

Examples:

```text
/employees -> EMPLOYEE_MANAGEMENT
/payroll -> PAYROLL
/attendance-regularization -> ATTENDANCE_REGULARIZATION
/departments -> ORG_MASTERS
/ats/dashboard -> ATS_DASHBOARD
/wfm/roster -> WFM_ROSTER
/wfm/live-tracker -> WFM_LIVE_TRACKER
/settings/access-control -> ACCESS_CONTROL
/org-masters -> ORG_MASTERS
/payroll/payslips -> PAYROLL_PAYSLIPS
/payroll/tax-declaration -> TAX_DECLARATION
/payroll/masters -> PAYROLL_MASTERS
/integration-hub -> INTEGRATION_HUB
/compliance/statutory -> STATUTORY_COMPLIANCE
```

## High-impact routes that need Gate review

These currently use only `ProtectedRoute` or broad roles and should be reviewed.

| Route | Risk | Recommended treatment |
|---|---|---|
| `/reports` | High | Add `Gate pageCode="ADVANCED_REPORTS"` or `REPORTS` page code |
| `/attendance` | High | Add page gate or split self attendance vs team/WFM attendance |
| `/leaves` | Medium | Self leave can stay open, approvals/admin tabs must be role/page gated |
| `/assets` | Medium | Employee self assets can stay, asset admin needs gate |
| `/settings` | High | Restrict with `roles={['admin']}` or page gate `SETTINGS` |
| `/performance` | Medium | Self performance vs manager/HR performance sections must be scoped |
| `/employee-stat-card` | High | Public employee stat-card route must enforce self/team/admin scope |
| `/calendar` | Low/Medium | Company calendar okay, event management must be HR/admin gated |
| `/notifications` | Low | Self-service okay |
| `/engagement/*` | Medium | Self engagement okay, command center already gated |
| `/performance-feedback/*` | Medium/High | Team reports and assignments should be scoped/gated |
| `/my-roster` | Low | Self-service okay |
| `/changelog` | Low | Auth-only okay |

## Recommended route-code mapping

```text
/reports                         -> ADVANCED_REPORTS
/attendance                      -> ATTENDANCE_DAILY or WFM_LIVE_TRACKER depending UI purpose
/leaves                          -> LEAVE_SELF for self, LEAVE_ADMIN for admin tabs
/assets                          -> ASSETS_SELF for self, ASSETS_MANAGER for admin tabs
/settings                        -> SETTINGS or ADMIN_SETTINGS
/performance                     -> PERFORMANCE_SELF / PERFORMANCE_ADMIN split
/employee-stat-card/:id          -> EMPLOYEE_MANAGEMENT or self/team scope
/performance-feedback/team-reports -> PERFORMANCE_FEEDBACK_TEAM
/performance-feedback/assignments  -> PERFORMANCE_FEEDBACK_ASSIGNMENTS
```

## Backend API role/scope checks to verify

For every module, confirm backend also enforces role/scope. Frontend gates are not enough.

### Employees

- Admin/HR can view all.
- Manager can view own reporting hierarchy only.
- Employee can view self only.
- Sensitive fields masked unless authorized.

### Attendance

Existing route treats `admin`, `hr`, `wfm`, and `manager` as privileged. Manager scope must be restricted to own team/hierarchy.

Do not change attendance calculation logic.

### Payroll

- Employee can view own payslip/tax declaration only.
- HR/Finance/Payroll can view scoped payroll.
- Bank exports must be Finance/Payroll/Admin only.
- Payroll run calculate/freeze must be Finance/Payroll/Admin only.
- Salary assignment/increment implementation must be audited.

### Reports

- Every report must apply branch/process/manager scope.
- Export actions must be audited.
- Sensitive reports such as payroll/statutory/bank must not be visible to normal employees.

### Org masters

- List endpoints are okay for dropdowns but must return active-only for filters.
- Create/update/delete Admin/HR only.

### Integration Hub

- Admin/IT/HR only.
- Secrets must never be returned to frontend.
- Integration run logs can show status, not passwords/API keys.

## Role test matrix

Run manual UI tests for these roles:

```text
super_admin
admin
hr
finance
payroll
wfm
manager
tl
employee
candidate
client
```

For each role check:

```text
Can login
Sidebar only shows allowed modules
Direct URL blocked if no permission
Backend API returns 403 if no permission
Self-service pages only show own data
Manager pages only show own team
Branch/process scope applied
Exports blocked unless authorized
Sensitive fields masked
Access request flow works
```

## Page-by-page audit checklist

For every page:

```text
Page loads
No console error
No white dropdown text
Filters use active-only values
Search works
Pagination works
Clear filters works
Exports work
Totals match API
Role/page gate applied
Backend API scope applied
Sensitive actions logged
Inactive records hidden unless Include inactive is explicit
```

## Immediate priority fixes

1. Add page gate to `/reports`.
2. Add page gate or split self/team mode for `/attendance`.
3. Restrict `/settings` to admin or page code.
4. Enforce manager team scope in attendance daily API.
5. Ensure report suite uses scope before production.
6. Validate `/employee-stat-card/:id` cannot expose any employee to normal users.
7. Standardize all filters to `/api/org/filter-options`.
