# Salary Increment Workflow Blueprint

## Objective

Salary increment must be controlled, auditable, approval-based, and reflected consistently in:

- employee salary assignment
- employee CTC
- payroll calculation
- payslip
- employee journey
- increment letter
- communication history
- audit logs

## Tables added

Migration:

```text
backend/sql/197_salary_increment_governance.sql
```

Tables:

```text
salary_increment_request
salary_increment_audit_log
salary_increment_letter
```

## Increment request flow

```text
Requester creates increment request
→ HR validates employee/salary/master data
→ Finance validates budget/statutory/payroll impact
→ Approver approves/rejects
→ Payroll/HR implements salary assignment
→ Increment letter is generated
→ Communication is sent
→ Employee acknowledges letter
→ Audit and employee journey are updated
```

## Who can raise request

Recommended requester matrix:

| Requester | Scope | Use case |
|---|---|---|
| Reporting Manager | Own team | Performance increment recommendation |
| HR | Any permitted branch/process | Correction, promotion, policy increment |
| Department Head | Own department | Department-level revision |
| Admin/Leadership | All | Special approval |

## Request fields

Required:

```text
employee_id
current_ctc
proposed_ctc
increment_percentage
effective_from
reason_code
business_justification
requested_by
```

Formula:

```text
increment_percentage = ((proposed_ctc - current_ctc) / current_ctc) * 100
```

## HR validation

HR validates:

```text
Employee active
Department/branch/process correct
Designation/band correct
Reporting manager correct
No pending increment request
Effective date valid
Promotion/role change mapped if applicable
Letter template available
```

HR action:

```text
status: submitted → hr_validated
```

## Finance validation

Finance validates:

```text
Budget available
CTC range within band
PF/ESIC/PT/TDS impact
Payroll month cut-off
No conflict with current payroll lock
Arrear impact if backdated
```

Finance action:

```text
status: hr_validated → finance_validated
```

## Approval

Approver validates:

```text
Justification
Percentage reasonability
Manager/HR/Finance validation
Effective date
Business approval
```

Approval action:

```text
status: finance_validated → approved
```

Rejection action:

```text
status: submitted/hr_validated/finance_validated → rejected
```

## Implementation in system

When implemented:

1. Close current active salary assignment:

```sql
UPDATE employee_salary_assignment
SET active_status = 0,
    effective_to = DATE_SUB(:effective_from, INTERVAL 1 DAY)
WHERE employee_id = :employee_id
  AND active_status = 1;
```

2. Insert new salary assignment:

```sql
INSERT INTO employee_salary_assignment
(employee_id, structure_id, ctc_annual, effective_from, active_status)
VALUES
(:employee_id, :structure_id, :proposed_ctc, :effective_from, 1);
```

3. Update employee current CTC:

```sql
UPDATE employees
SET ctc = :proposed_ctc,
    updated_at = NOW()
WHERE id = :employee_id;
```

4. Mark increment request:

```text
status = implemented
new_assignment_id = new assignment id
implemented_by = actor
implemented_at = now
```

## Logs created

Every step creates:

```text
salary_increment_audit_log
```

Events:

```text
INCREMENT_REQUESTED
HR_VALIDATED
FINANCE_VALIDATED
APPROVED
REJECTED
IMPLEMENTED
LETTER_GENERATED
LETTER_RELEASED
EMPLOYEE_ACKNOWLEDGED
```

Also create employee journey event:

```text
event_type = increment
old_value = old CTC
new_value = new CTC
```

## Communication to build

Recommended communication triggers:

| Trigger | Recipient | Channel |
|---|---|---|
| Request submitted | HR/Finance queue | Work inbox + email |
| HR validated | Finance | Work inbox + email |
| Finance validated | Approver | Work inbox + email |
| Approved | Payroll/HR | Work inbox + email |
| Implemented | Employee + Manager | Email/portal notification |
| Letter released | Employee | Portal + email |
| Acknowledged | HR/Manager | Work inbox |

## Letter auto-trigger

After implementation:

```text
Generate increment letter draft
Populate employee name, code, designation, department, old CTC, new CTC, increment %, effective date
Store salary_increment_letter row
Release after HR confirmation
Employee acknowledges in portal
```

## Payroll impact

Payroll calculation should pick the new assignment from `employee_salary_assignment` based on effective date.

If increment is backdated after payroll is locked:

```text
Do not change closed payroll
Create arrear adjustment for next open payroll
```

## UI modules to add

```text
/payroll/increments
```

Tabs:

```text
1. Increment Dashboard
2. Create Request
3. Pending HR Validation
4. Pending Finance Validation
5. Pending Approval
6. Approved / Ready to Implement
7. Implemented
8. Letters
9. Audit Trail
```

Dashboard KPIs:

```text
Pending HR
Pending Finance
Pending Approval
Approved not implemented
Average increment %
Total monthly CTC impact
Backdated arrear impact
Letters pending release
Letters pending acknowledgement
```

## Guardrails

```text
No duplicate pending request for same employee
No implementation without approval
No implementation into locked payroll month
No direct CTC edit without audit
No letter release before implementation
No backdated increment without arrear impact review
```
