# HRMS2 Payroll Effective Date Rules

## Dates

- `joining_date`: physical date of joining.
- `salary_start_date`: salary effective date.
- `attendance_effective_from`: attendance/payroll attendance effective date.
- `statutory_effective_from`: EPF/ESI/statutory effective date.
- `payroll_month_effective`: payroll month in `YYYY-MM` format.

## Validations

- DOJ is mandatory.
- Salary effective date defaults to DOJ when blank.
- Salary effective date cannot be before DOJ.
- If salary effective date differs from DOJ, `salary_effective_date_reason` is mandatory.
- Salary register cannot be locked until Payroll HR validation is complete and salary proposal, if any, is approved.

## Storage

Rules are stored on `ats_payroll_hr_validation` and locked into `salary_register`.
