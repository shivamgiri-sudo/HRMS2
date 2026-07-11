# HRMS2 Approval Matrix

## Joining Flow

| Step | Owner | HRMS2 Source | Rule |
| --- | --- | --- | --- |
| Payroll HR Validation | Payroll HR | `ats_payroll_hr_validation` | Payroll HR prepares DOJ, profile, department, designation, cost centre, band, package, salary effective dates, and reporting details. |
| BM / Branch Head JCLR Approval | BM / Branch Head | `ats_branch_head_approval` | This is the JCLR approval step. Do not show it as a separate Branch Head approval plus JCLR approval unless old HRS confirms two different approvers. |
| Payroll HR JCLR Entry | Payroll HR | `jclr_detail` | Payroll HR can complete JCLR Entry only after BM / Branch Head JCLR Approval is approved. |
| EPF / Statutory Completion | Payroll HR / Statutory owner | `statutory_declaration` | Must be verified before employee code generation. |
| Final Readiness Checklist | System | `joining_control_room_snapshot` | Blocks until salary, BGV, name-match, DPDP, JCLR approval, JCLR entry, statutory, and readiness checks are complete. |
| Employee Code Generation | System / HRMS2 conversion path | `ats_onboarding_bridge`, `employees` | Uses existing approved-offer conversion path. |

## Salary Exception Flow

| Step | Owner |
| --- | --- |
| Salary proposal creation | Payroll HR |
| Salary approval stage 1 | BM / Branch Head |
| Salary approval stage 2 | Operations Head |
| Salary approval stage 3 | Payroll Head |
| Salary approval stage 4 | Finance Head |
| Salary Register Lock | Payroll HR / Payroll Head, after approvals |
| JCLR Approval, if pending | BM / Branch Head |
| JCLR Entry | Payroll HR |
| Employee Code Gate | System |

## Labels

Use these labels in HRMS2:

- `BM / Branch Head JCLR Approval`
- `Payroll HR JCLR Entry`
- `BM / Branch Head Salary Approval`
- `Operations Head Salary Approval`
- `Payroll Head Salary Approval`
- `Finance Head Salary Approval`

Do not label Payroll HR as the JCLR approval owner.
