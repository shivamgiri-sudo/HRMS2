# HRMS2 Salary Proposal Approval Flow

## Trigger

A proposal is required when proposed gross salary differs from the selected salary slab gross.

## Source Table

Existing table `salary_exception_proposal` is used. No duplicate salary proposal table is created.

## Stages

1. BM approval
2. Operations approval
3. Payroll approval
4. Finance approval

Each approval is logged in `salary_proposal_approval_step`.

## Lock Rule

Salary register lock is allowed only when:

- Payroll HR validation exists.
- Salary proposal is absent or approved.
- Salary effective date is valid.

Locked records are written to `salary_register` and audited in `salary_register_audit_log`.
