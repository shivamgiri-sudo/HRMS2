# HRMS1 Governance and Payroll Control Blueprint

## Purpose

This blueprint defines the enterprise governance layer that should sit above HRMS1 modules without breaking existing domain logic. The first implementation focus is payroll because payroll depends on employee master, attendance, leave, statutory, bank, incentives, arrears, exits, access control, and audit.

## Rule for attendance logic

Do not change the current attendance classification logic without explicit business approval.

Current rule summary:

- Operations + Executive employees use APR / dialler net login.
- Operations Executive thresholds: 480 minutes = present, >240 minutes = half day, <=240 minutes = absent.
- Other employees use COSEC / biometric minutes.
- COSEC thresholds: 540 minutes = present, >240 minutes = half day, <=240 minutes = absent.
- Approved leave, branch holiday, and roster week-off override both branches.
- WFM manual correction wins and locks the row.

Governance should wrap this logic, not replace it.

## Payroll governance sequence

Final target flow:

```text
Employee master verification
→ Salary master verification
→ Bank/statutory verification
→ COSEC/APR/attendance processing
→ Leave/LWP validation
→ Attendance freeze
→ Payroll readiness check
→ Payroll calculation
→ Variance review
→ Approval workflow
→ Bank file generation
→ Payment reconciliation
→ Payslip release
→ Statutory registers
→ Month close
```

## Implemented in Phase 1

### Payroll readiness API

```http
GET /api/payroll/runs/:id/readiness
```

Checks:

- Missing active salary assignment.
- Missing verified primary bank account.
- Missing attendance records for payroll month.
- Unreconciled attendance.
- Attendance rows not locked.
- Missing PAN.
- Missing active UAN/PF record.

### Attendance freeze API

```http
POST /api/payroll/runs/:id/freeze-attendance
```

What it does:

- Locks attendance_daily_record rows for the payroll run scope/month.
- Sets salary_prep_run.attendance_snapshot_locked = 1.
- Sets salary_prep_run.compliance_checked = 1.
- Writes payroll_calculation_audit event ATTENDANCE_FREEZE.
- Does not change attendance classification.

### Optional strict readiness

Set:

```env
PAYROLL_STRICT_READINESS=true
```

When enabled, payroll calculation is blocked unless:

- readiness has no blockers, and
- attendanceSnapshotLocked is true.

Default behavior is additive/non-breaking unless this flag is enabled.

## Payroll page enhancements needed

### 1. Readiness tab

Show blockers and warnings before calculation.

Recommended cards:

- Eligible employees.
- Missing salary assignment.
- Missing verified bank.
- Missing attendance.
- Unreconciled attendance.
- Attendance not locked.
- Missing PAN.
- Missing UAN.

### 2. Attendance Freeze tab

Show payroll-month attendance rows by employee:

- Working days.
- Present days.
- Paid leave.
- LWP days.
- Half days.
- Late marks.
- Source: APR / dialler / COSEC / manual override.
- Locked status.

### 3. Variance Review tab

Compare current run to previous month:

- Gross salary variance.
- Net salary variance.
- LWP variance.
- TDS variance.
- PF/ESIC/PT variance.
- Incentive variance.
- Arrear variance.
- Zero net salary.
- Negative net salary.
- Missing employee from previous payroll.
- New employee in payroll.

### 4. Component Ledger tab

Every payslip line should show component-level rows from salary_prep_line_component:

- Basic.
- HRA.
- Special allowance.
- Incentive.
- Arrear.
- PF employee.
- ESIC employee.
- Professional tax.
- TDS.
- Advance recovery.
- LWP deduction.
- Employer PF.
- Employer ESIC.
- Gratuity provision.

### 5. Hold Salary tab

Reasons:

- Bank details missing.
- Exit/F&F pending.
- Absconding.
- Compliance document missing.
- Legal/management hold.
- Payroll dispute.

### 6. Bank File tab

Controls:

- Generate bank file only after approval.
- Mask account number in UI.
- Log export in payroll_register_export_log.
- Track paid / failed / returned / reprocessed.

### 7. Payslip Release tab

Controls:

- Preview before release.
- Release only after bank/payment approval.
- Version payslip regeneration.
- Track employee acknowledgement.

## Corrections/enhancements found outside payroll calculation

### Attendance governance corrections

These are not calculation changes:

1. Manager scope should be stricter. Current attendance daily routes treat `manager` as privileged. This means manager can query employeeId unless service scope is added. Add reporting-manager scope enforcement before rollout.
2. Clock-in creates a present record immediately. This is okay for self-attendance but should be marked as app source and later reconciled by engine.
3. Clock-out updates clock_out_time but does not recalculate raw_minutes/lwp_value immediately. A daily sweep corrects final status, but UI should display interim status as provisional.
4. Attendance freeze should be used before payroll. Current attendance lock exists at row level; payroll now has a freeze API to use it.
5. Timezone should be standardized to Asia/Kolkata for clock-in/out and COSEC migration display.

### Reporting corrections already added

- Analytics overview now uses as-of-date headcount logic.
- Attendance report frontend pagination now respects backend max limit 200.
- Payroll summary now uses consolidated payroll records instead of the first run only.

## Whole-project governance model

### Governance surfaces

Every module should expose:

```text
Readiness
Exceptions
Approvals
Audit trail
Exports
Data health
Lock/freeze state
Owner/SLA
```

### Global exception center

Create a common exception object for:

- Missing master data.
- Data sync failure.
- Unmapped COSEC user.
- Attendance mismatch.
- Payroll variance.
- Missing statutory data.
- Unauthorized access attempt.
- Report mismatch.

### Role control matrix

For each module define:

```text
Role
View scope
Create scope
Edit scope
Approve scope
Export scope
Override permission
Delete permission
```

Minimum roles:

- Employee.
- TL.
- Manager.
- HR.
- WFM.
- Payroll.
- Finance.
- Compliance Auditor.
- IT Security.
- Data Security Officer.
- Admin.
- CEO / leadership.

### Module freeze model

Freeze states:

- Draft.
- Processed.
- Reconciled.
- Frozen.
- Approved.
- Published.
- Closed.

After a module is frozen, direct edits should be blocked. Corrections should create adjustment entries instead.

## Next implementation phases

### Phase 2

- Payroll variance API.
- Payroll hold salary register.
- Payroll arrear/adjustment register.
- Component ledger materialization for every calculation.
- Bank file export governance.

### Phase 3

- Global governance exception center.
- Module readiness cards.
- Role-wise data scope enforcement for manager/TL.
- Export audit and watermarking.

### Phase 4

- AI-assisted anomaly detection.
- Payroll root-cause assistant.
- Predictive payroll cost forecast.
- Statutory filing tracker.
