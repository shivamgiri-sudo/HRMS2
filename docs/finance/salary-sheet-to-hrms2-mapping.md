# SALARY SHEET → HRMS2 mapping matrix

Source: `SALARY SHEET.xls`, sheet `Salary - 2026-08-07T161629.466`, **90 columns × 1,566 rows**,
`SalDate = 30-Jun-2026`.

The supplied workbook has every monetary column redacted — `Basic`, `HRA`, `Gross`, `NetSalary`,
`ESIC`, `EPF` and all `Tax*` columns are blank or zero on all 1,566 rows. That is intentional.
**The headers are the contract**; the amounts are not needed to establish the mapping, and this
document maps all 90.

## The naming convention

The sheet uses a consistent pair: `X` is the **offered / master** value from the salary
structure, `X1` is the **earned** value after attendance. `Gross` vs `Gross1` is the clearest
case, and the same holds for `Basic/Basic1`, `HRA/HRA1`, `Bonus/Bonus1`, `Conv/Conv1`,
`Portfolio/Portfolio1`, `SpecialAllowance/SpecialAllowance1`, `OtherAllowance/OtherAllowance1`,
`MedicalAllowance/MedicalAllowance1`.

This matters for the voucher: **`Gross Salary` in the Tally voucher must come from the EARNED
figure (`Gross1`), not the offered one.** Posting offered gross would overstate the journal by
every unpaid day in the month.

## Availability legend

- **YES** — a canonical HRMS2 column holds it today
- **DERIVED** — computable from canonical data, no new storage needed
- **GAP** — no canonical source; needs a decision before the voucher can be produced

## Identity and dimensions

| Legacy column | HRMS2 table | HRMS2 column | Available | Note |
|---|---|---|---|---|
| EmpCode | `employees` | `employee_code` | YES | |
| EmpName | `employees` | `full_name` | YES | |
| CostCenter | `employees` | `cost_centre_id` → `cost_centre_master.cost_centre_code` | YES | Sheet carries the code (`BSS/BO/AHMH-JD/560`) |
| Department | `employees` | `department_id` → `department_master.dept_name` | YES | |
| Designation | `employees` | `designation_id` → `designation_master.designation_name` | YES | |
| Profile | `employee_salary_snapshot` sibling | — | **GAP** | Legacy `salary_profile` (35 rows) maps designation → profile. No HRMS2 equivalent |
| Employee For | legacy migration table | `emp_for` | PARTIAL | Exists on the legacy snapshot only, not on `employees` |
| Billable | `employees` | — | **GAP** | Billability lives in the P&L billability module, not per employee-month |
| Branch | `employees` | `branch_id` → `branch_master.branch_name` | YES | |

## Offered salary components

All present on `employee_salary_snapshot` (created by `052_legacy_migration_tables.sql`).

| Legacy | HRMS2 column | Available |
|---|---|---|
| Basic | `basic` | YES |
| HRA | `hra` | YES |
| Bonus | `bonus` | YES |
| Conv | `conveyance` | YES |
| Portfolio | `portfolio_allowance` | YES |
| MedicalAllowance | `medical_allowance` | YES |
| LTA | `lta` | YES |
| SpecialAllowance | `special_allowance` | YES |
| OtherAllowance | `other_allowance` | YES |
| PLI1 | `pli` | YES |
| Gross | `gross` | YES |
| CTCOffered | `ctc_offered` | YES |
| CurrentCTC | `package` | YES |
| CTC | `package` | YES |

`da` and `mobile_allowance` exist in HRMS2 but have no column in the sheet — harmless.

## Attendance-driven values

| Legacy | HRMS2 source | Available | Note |
|---|---|---|---|
| WorkingDays | payroll run | `working_days` | YES |
| ActualDays | payroll run | `payable_days` | YES | See the payable-days memo — this figure has a known history |
| EarnedDays | payroll run | `earned_days` | YES |
| ExtraDay | — | | **GAP** |
| Leave | leave module | | DERIVED |
| Basic1 … Gross1 | `payroll_employee_component_snapshot` | `amount` where `component_type='earning'` | DERIVED | Per-run, per-component; the earned counterpart of the offered columns |

## Statutory and deductions

| Legacy | HRMS2 | Available |
|---|---|---|
| ESIElig / PFELig | `employees` eligibility flags | PARTIAL |
| ESIC | `employee_salary_snapshot.esic_employee` | YES |
| EPF | `employee_salary_snapshot.epf_employee` | YES |
| ESICCompany | `esic_employer` | YES |
| EPFCompany | `epf_employer` | YES |
| AdminChrg | `admin_charges` | YES |
| ProTaxDeduction | `professional_tax` | YES |
| IncomeTax | payroll TDS | PARTIAL — TDS is gated on `statutory_config`; see the payroll safety rules |
| AdvTaken / AdvPaid | salary advance module | PARTIAL |
| LoanTaken / LoanDed | loan module | PARTIAL |
| Insurance / SHSH | — | **GAP** — `STAY HEALTHY STAY HAPPY INSURANCE` is a voucher ledger line with no HRMS2 source |
| MobileDedcution *(sic)* | — | **GAP** — spelling preserved; legacy typo |
| ShortCollection / AssetRecovery | — | **GAP** |
| LeaveDeduction | DERIVED from LWP | DERIVED |
| OtherDeduction / OtherDeductionRemarks | — | **GAP** |
| TotalDeduction | DERIVED | DERIVED |
| NetSalary | payroll run `net_salary` | YES |

## Tax computation block

`TaxTotalGross`, `TaxSection10`, `TaxBalance`, `TaxUnderHd`, `DeductionUnder24`,
`TaxGrossTotal`, `TaxAggofChapter6`, `TotalIncome`, `TaxOnTotalIncome`, `EduCess`,
`TaxPayEduCess`, `TaxDeductedTillPreviousMonth`, `BalanceTax`.

**All GAP.** HRMS2's TDS projection is explicitly blocked without approved effective-dated slab
configuration in `statutory_config`, and the project rules forbid hardcoded fallback slabs. These
thirteen columns cannot be produced until that configuration exists. They do **not** block the
Tally voucher, which needs only the single `TDS SALARY 2026-27` posting.

## Identifiers and payment

| Legacy | HRMS2 | Available |
|---|---|---|
| SalDate | payroll run period end | DERIVED |
| UAN / EPFNo / ESICNo | `employees` statutory identifiers | YES |
| ChequeNumber / ChequeDate | `payroll_disbursement` | PARTIAL |
| PrintDate | — | **GAP** — a report artefact, not payroll data |
| LeftStatus | `employees.active_status` + exit module | DERIVED |
| SalaryPaymentMode | `employee_salary_snapshot.salary_payment_mode` | YES |
| AcNo / IFSCCode / AcBank / AcBranch | employee bank details | YES — note the account-number corruption memo |

## What this means for the Tally voucher

The voucher needs far less than the full sheet. Its ledger lines map to:

| Voucher ledger line | Source |
|---|---|
| Gross Salary | SUM earned gross (`Gross1`) per branch |
| Employer's Contribution to Esic | SUM `esic_employer` |
| Employer's Contribution to Epf | SUM `epf_employer` |
| EPF Admin Charges | SUM `admin_charges` |
| Salary Payable A/C | SUM `net_salary` |
| ESIC Payable | SUM `esic_employee` + `esic_employer` |
| EPF Payable | SUM `epf_employee` + `epf_employer` |
| Professional Tax 2026-27 | SUM `professional_tax` |
| TDS SALARY 2026-27 | SUM TDS |
| Advance Against Salary (BRANCH) | advance recovery, branch-qualified by pattern |
| STAY HEALTHY STAY HAPPY INSURANCE | **GAP** |
| GROSS SALARY *(distinct from `Gross Salary`)* | confirmed deliberate — a second, separate ledger |

So **nine of the twelve ledger lines are already sourceable**. The blockers are not the salary
components.

## The two real blockers

1. **No legal entity on payroll.** Nothing in `backend/src/modules/payroll/` references
   `company_id`, `legal_entity` or `company_code`. MAS and IDC cannot be separated, and faking it
   through Branch is explicitly ruled out. The nearest path is
   employee → cost centre → `cost_centre_master.company_name` → `finance_company`, which must be
   proven against real data first.
2. **The two unnamed MAS voucher columns.** Established: not proportional (the share varies
   0–100% within one voucher), non-zero only at AHMEDABAD-JALDARSHAN and HEAD OFFICE, zero on
   every NOIDA and NOIDA-2 line, absent from IDC entirely. The EPF family shares one ratio per
   branch (7.85% AHM, 28.46% HO), so it is a fixed group of employees — roughly 5 at AHM and 9–10
   at HO by EPF arithmetic, holding 100% of AHM's TDS and exactly one employee's ₹200 PT.
   The redacted amounts mean it cannot be resolved from the workbook.

## Reported, not changed

Per the "do not improve an approved format" rule:

- `MobileDedcution` is misspelled in the source. Preserved.
- `Gross Salary` and `GROSS SALARY` are two separate ledger lines — confirmed deliberate.
- Voucher serial `614` appears on both `HEAD OFFICE/MAS/06/26/614` and
  `HEAD OFFICE/IDC/06/26/614`. Confirmed: replicate the legacy sequence behaviour as-is.
