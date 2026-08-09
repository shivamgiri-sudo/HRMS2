# Payslip Center Audit

## Page checked

```text
/payroll/payslips
```

File:

```text
src/pages/NativePayslipCenter.tsx
```

## Current strengths

- Premium modal layout exists.
- MAS Callnet payslip PDF generator is integrated.
- Employee detail alignment in generated PDF was already corrected.
- Form 16 data modal exists.
- NEFT summary support exists.
- Payslip acknowledgement action exists.
- Payslip status colors exist.
- PDF generator reads component rows for many earnings/deductions.

## Issues found

1. Payroll lines are loaded all-at-once from `/api/payroll/runs/:runId/lines`.
2. No server-side search, page, limit, status, branch, process, cost centre, or manager filters in payslip center.
3. Payslip modal earnings still shows hardcoded Basic / HRA / Other Allowances even though component arrays are available.
4. Deductions modal uses hardcoded common deductions and may hide other configured salary components.
5. Bulk generation/release/acknowledgement governance is not visible enough.
6. Export/download actions should create audit logs, especially for payroll data.
7. Employee self-view must only show own payslips.
8. HR/payroll/finance views must be scoped by branch/process where applicable.
9. Payslip release should be blocked until payroll is approved/disbursed according to policy.
10. Payslip resend/reminder feature is missing.
11. Missing acknowledgement reminders are not automated.
12. No payslip versioning display when regenerated.

## Required fixes

### Server-side payslip list

Add endpoint or reuse records endpoint:

```text
GET /api/payroll/payslips?runId=&page=&limit=&search=&status=&branchId=&processId=&costCentreId=&managerId=
```

Response:

```json
{
  "success": true,
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 50
}
```

### Modal component rendering

Replace hardcoded earnings/deductions in modal with component arrays:

```text
earnings[]
deductions[]
employer_costs[]
```

Fallback only if components are missing.

### Governance controls

Actions must be role-guarded:

```text
Generate payslip: payroll/finance/admin
Release payslip: payroll/finance/admin
Download own payslip: employee self
Download any payslip: payroll/finance/hr/admin, scoped
Download bank/NEFT: finance/payroll/admin only
Acknowledge: employee self only
Regenerate: payroll/finance/admin, reason required
```

### Audit events

Create audit events for:

```text
PAYSLIP_GENERATED
PAYSLIP_RELEASED
PAYSLIP_DOWNLOADED
PAYSLIP_REGENERATED
PAYSLIP_ACKNOWLEDGED
PAYSLIP_REMINDER_SENT
FORM16_VIEWED
FORM16_DOWNLOADED
NEFT_EXPORT_DOWNLOADED
```

### Premium UI additions

Add top KPI cards:

```text
Generated
Released
Acknowledged
Pending acknowledgement
Missing payslips
Failed generation
```

Add filter bar:

```text
Payroll month
Status
Branch
Process
Cost centre
Manager
Search employee
```

Add right-side insight panel:

```text
Payslips pending acknowledgement
Employees missing bank details
Employees with zero net pay
Employees with negative variance
Download/export audit summary
```

## Email template integration

Use premium templates:

```text
payslip_released
payslip_acknowledgement_reminder
payroll_readiness_blocker
```

Reminder logic:

```text
If payslip released and acknowledged_at is null after N days, send reminder to employee and summary to HR/payroll.
```

## Test checklist

```text
Employee can view only own payslips.
Admin/payroll can view permitted payslips.
Manager cannot view salary/payslips unless explicitly granted.
Generate button hidden for employee.
Acknowledge button visible only to employee self.
Download PDF layout is aligned.
Form 16 PAN comes from employees.pan_number.
NEFT export is finance/payroll/admin only.
All downloads are audited.
```

## Priority

P0:

```text
Server-side pagination/search/filter.
Render component arrays in modal.
Audit payslip downloads/generation.
Enforce self/scoped access.
```

P1:

```text
Bulk release governance.
Reminder automation.
Payslip versioning.
Insight cards.
```
