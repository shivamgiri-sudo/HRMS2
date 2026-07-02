# Profile and Employee Stat Card Audit

## Pages checked

```text
/profile
/employee-stat-card/:id
```

## /profile findings

File:

```text
src/pages/Profile.tsx
```

### Strengths

- Strong premium hero card already exists.
- Employee photo upload is integrated.
- Tabs exist for profile, statutory, emergency, journey, leaves, attendance, assets, reviews, payslips, and documents.
- RM change request dialog is integrated.
- Change password is integrated.
- Employee journey endpoint is used.
- Sensitive details are separated into Bank/Statutory and Emergency/Nominee sections.
- Self-service update goes through `/api/employees/me`.

### Issues / enhancements

1. `/profile` is self-service and can stay `ProtectedRoute`, but sensitive tabs must still enforce backend checks.
2. Bank/statutory save should create verification workflow and HR/payroll notification.
3. Profile completion score is missing.
4. Missing document/letter/payslip acknowledgement alerts should show as insight cards.
5. RM change request shows pending state, but profile should also display request history and current approver/status.
6. The profile page should show a personal data health panel:

```text
Official email compliant
Bank verified
PAN present
UAN present
Emergency contact present
Nominee present
Documents verified
Photo present
```

7. Employee should not be able to edit official HR fields directly. Editable fields should stay contact/address/personal preference only.
8. Changes to sensitive fields should be audited.
9. Profile should show clear owner for corrections: Employee, HR, Payroll, WFM.

### Premium layout enhancement

Add a right-side insight rail:

```text
Profile completion %
Pending documents
Payslips to acknowledge
Letters to acknowledge
Open leave requests
Attendance exception
Bank/statutory verification status
```

## /employee-stat-card/:id findings

File:

```text
src/pages/NativeEmployeeStatCard.tsx
```

Backend endpoint:

```text
GET /api/employees/:id/stat-card
```

### Strengths

- Shows employee identity, designation, branch, process, department.
- Shows leave balance card.
- Shows attendance percentage.
- Shows latest performance.
- Shows active assets.
- Shows pending documents.
- Shows engagement tier.
- Shows journey timeline.
- Admin/HR search is available.

### Critical backend issue found

The existing stat-card route uses outdated leave ledger columns:

```text
lbl.leave_code
lbl.opening_balance
lbl.accrued_days
lbl.valid_for
```

But HRMS1 live schema uses:

```text
leave_type_id
balance_year
allocated_days
used_days
adjusted_days
```

Required SQL replacement:

```sql
SELECT lt.leave_code,
       lt.leave_name,
       (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) AS available_days,
       lbl.used_days
FROM leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
WHERE lbl.employee_id = ?
  AND lbl.balance_year = YEAR(CURDATE())
ORDER BY lt.leave_code;
```

### Access risk to validate

Frontend route can accept `/employee-stat-card/:id`. Backend currently blocks non-privileged users from viewing other employees, which is good. Confirm this remains true after refactors.

Recommended access model:

```text
Admin/HR/CEO: all employees
Finance/Payroll: all employees, salary visible
Manager/TL: own team only, salary hidden
Employee: self only, salary visible to self if policy allows
```

### Enhancement needed

1. Add manager/team scope to backend stat-card route.
2. Keep salary hidden from managers/TLs.
3. Fix leave ledger SQL.
4. Add cost centre and reporting manager in header badges.
5. Add risk indicators:

```text
Missing manager
Missing bank verification
Missing PAN/UAN
Pending documents
Low attendance
Open exit/F&F
```

6. Add audit when HR/Admin views sensitive stat card.
7. Add print/export stat card action for HR only.

## Implementation note

A compatibility override route can be mounted before `employeeRouter`, or the existing route in `employee.routes.ts` can be corrected directly.

Preferred correction:

```text
backend/src/modules/employees/employee.routes.ts
```

Fix only the stat-card leave-balance query and add manager-team scope. Do not rewrite the whole file.

## Validation

Run:

```bash
curl "http://localhost:5055/api/employees/EMPLOYEE_ID/stat-card" \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

For employee self-token:

```bash
curl "http://localhost:5055/api/employees/OTHER_EMPLOYEE_ID/stat-card" \
  -H "Authorization: Bearer EMPLOYEE_TOKEN"
```

Expected:

```text
403 Access denied
```

For manager token:

```text
own direct report = 200
unmapped employee = 403
```

## Priority

P0:

```text
Fix leave balance SQL in stat-card route.
Validate self/team/admin access.
Hide salary from managers.
```

P1:

```text
Add profile completion and insight rail.
Add statutory/bank verification workflow cards.
Add audit logs for sensitive views and edits.
```
