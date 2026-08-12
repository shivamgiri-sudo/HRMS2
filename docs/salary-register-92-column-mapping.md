# Salary Register — 92-column format, verified source mapping

Correction 9. The shared `Salary Register.xlsx` is **92 columns**, not a variant of the current
report. This maps every one of them to a source column that was confirmed to exist in
`mas_hrms` on 2026-08-12, so the build is implementation rather than discovery.

The format's design is a **master / earned pair**: `Basic` is the contracted structure, `Basic1`
is what was earned after days. Any implementation that populates one and not the other has
missed the point of the sheet.

## Confirmed available (build these first)

| Column(s) | Source |
|---|---|
| EmpCode, EmpName | `employees.employee_code`, `full_name` |
| CostCenter | `cost_centre_master.cost_centre_code` via `e.cost_centre_id` |
| Process Name, Department, Designation, Branch | `process_master`, `department_master`, `designation_master`, `branch_master` |
| Profile | `employees.profile_type` |
| Billable | `employees.billable_status` / `is_billable` |
| Basic, HRA, SpecialAllowance | `salary_prep_line.basic`, `.hra`, `.special_allowance` |
| Gross (master) | `salary_prep_line.gross_before_lwp` |
| Gross1 (earned) | `salary_prep_line.gross_salary` |
| WorkingDays, ActualDays, EarnedDays, Leave | `.working_days`, `.paid_working_days`, `.final_payable_days`, `.leave_days` |
| CTCOffered, CurrentCTC, CTC | `employees.ctc` |
| ESIC, EPF, IncomeTax | `.esic_employee`, `.pf_employee`, `.tds` |
| ESICCompany, EPFCompany | `.esic_employer`, `.pf_employer` |
| ProTaxDeduction | `.professional_tax` |
| OtherDeduction, TotalDeduction | `.other_deductions`, `.total_deductions` |
| LoanDed | `.loan_emi` |
| AdvPaid | `.advance_recovery` |
| Incentive | `.incentive_total` |
| NetSalary | `.net_salary` |
| UAN, EPFNo, ESICNo | `employees.uan_number`, `.epf_number`, `.esic_number` — now fillable via the bulk upload |
| LeftStatus | `employees.employment_status` / `date_of_leaving` |
| AcNo, IFSCCode, AcBank, AcBranch | `employees.bank_account_number`, `.ifsc_code`, `.bank_name`, `.bank_branch` |
| Tax* block (74–86) | The computation added for correction 11 already produces projected income, exemptions, taxable income, annual liability and cess — `TaxTotalGross`, `TotalIncome`, `TaxOnTotalIncome`, `EduCess`, `TaxPayEduCess` map onto it directly |

## No confirmed source — decide before building

Neither `salary_prep_line` (59 columns) nor `employees` (114) carries these. Most look like
salary components, so `salary_component_assignments` is the place to check first — note its
amount column is NOT called `amount`, which is worth confirming before designing around it.

    Bonus, Conv, Portfolio, MedicalAllowance, LTA, OtherAllowance, PLI1, PLI
    ExtraDay, ExtraDayIncentive, Arrear
    SHSH, MobileDedcution, ShortCollection, AssetRecovery, Insurance, AdminChrg
    ChequeNumber, ChequeDate, PrintDate, SalDate, SalaryPaymentMode
    Employee For, OtherDeductionRemarks, LeaveDeduction
    TaxSection10, TaxBalance, TaxUnderHd, DeductionUnder24, TaxAggofChapter6,
    TaxDeductedTillPreviousMonth, BalanceTax

`TaxDeductedTillPreviousMonth` and `BalanceTax` in particular need a year-to-date TDS store; the
correction-11 computation is per-month and does not accumulate.

## Build notes

1. **Both catalogues.** `backend/src/modules/reporting/report-catalog.ts` AND
   `src/lib/report-catalog.ts`. A column declared in only the backend is returned by the API and
   silently discarded by the grid and the export — this cost a full cycle on the cost-centre
   change.
2. **Check which implementation serves it.** Several payroll reports have an inline block or a
   high-risk router entry that wins over the executor; editing the executor alone changes
   nothing observable. `payroll-variance` has three implementations.
3. **Do not emit a column with no source.** A blank column reads as missing data; a zero reads as
   a fact. Anything from the second list should be omitted until its source is agreed, not
   defaulted to 0.
4. **On-roll scoping** matches the ESIC/PF/PT registers if this is a statutory-facing register:
   `employment_type = 'ONROLL'` (917 of 1,327 active).
