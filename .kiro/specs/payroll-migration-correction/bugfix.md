# Bugfix Requirements Document

## Introduction

The migration target `mas_hrms` (MySQL 8 @ 122.184.128.90) does not reproduce the payroll that the live legacy system `db_bill` (MySQL 5.5.44 @ 14.97.30.236) actually paid. `db_bill` remains the source of truth for what was disbursed and is READ-ONLY; `mas_hrms` is not yet live for disbursal.

A single root cause produces roughly 95% of the money defects. `db_bill.salary_data` carries two parallel earning column sets: the unsuffixed columns hold the full-month **entitlement**, while the `1`-suffixed columns hold the **earned** amount (entitlement x EarnedDays / WorkingDays). Every importer written before 2026-08-29 read the entitlement set. This is confirmed rather than suspected: `salary_prep_line.gross_salary` equals db_bill `Gross` (entitlement) on 129,696 of 129,696 rows. Commit fa951ee9e (2026-08-29) corrected the scripts, but the data was never re-imported, so the defect is still fully present in the stored payroll.

Measured impact across full history (129,696 lines, 100% matched to db_bill, 0 unmatched): earning drift of Rs.17,90,43,881 spread over seven earning heads, and net salary overstated on 351 lines in run_month 2026-07 by Rs.14,13,319 with no line understated. All deduction and employer-contribution heads are already exact. Attendance proration is impossible today because `EarnedDays` was never imported, leaving `final_payable_days` at zero on every line in history.

Beyond the money, the surrounding payroll controls do not hold. Role guards reference a role no user holds, the Payroll Head cannot generate the payment file, the approval and disbursal chain has never been exercised on a real run, the readiness score can be passed while skipping attendance entirely, and bank verification stands at 0.84% of active employees. There is no employee-level parity gate, so nothing prevents an incorrect payment file from being produced.

IDC employees (`EmpCode LIKE 'IDC%'`, approximately 131-155 employees, roughly Rs.23.5L per month) are deliberately excluded from `mas_hrms` and remain on `db_bill`. Their absence is accepted scope, not a defect.

The correction must cover past months, not August forward only, and must verify every salary component and every salary package per employee. August 2026 is to be run in both systems in parallel; `mas_hrms` takes over payroll only after it reproduces `db_bill` at zero variance for three consecutive months (Aug, Sep, Oct).

## Bug Analysis

### Current Behavior (Defect)

**Root cause group: entitlement imported instead of earned (D1, D2, D3)**

1.1 WHEN a salary line is read for any month in history THEN the system holds full-month entitlement values in the earning components BASIC, HRA, PORTFOLIO, SPECIAL, CONV, BONUS and MA instead of the earned values, producing a total drift of Rs.17,90,43,881 (BASIC 34,976 rows differ / Rs.8,77,00,254; HRA 28,297 / Rs.3,18,31,191; PORTFOLIO 11,280 / Rs.1,87,34,173; SPECIAL 13,137 / Rs.1,82,29,496; CONV 28,297 / Rs.1,66,35,797; BONUS 28,297 / Rs.59,12,077; MA 1 / Rs.893)

1.2 WHEN `salary_prep_line.gross_salary` is compared to db_bill THEN the system matches db_bill `Gross` (entitlement) on 129,696 of 129,696 rows instead of matching db_bill `Gross1` (earned)

1.3 WHEN an employee earned zero for a component in a month THEN the system holds an extra component row with a non-zero entitlement amount (BASIC 11,879 extra rows, HRA 10,746, CONV 10,746, BONUS 10,746, SPECIAL 5,060, PORTFOLIO 3,709, MA 1)

1.4 WHEN net salary is read for run_month 2026-07 THEN the system overstates 351 lines by Rs.14,13,319 in total, every one overstated and none understated, with the worst case MAS61915 showing Rs.28,050 against db_bill earned Gross1 of 0 and an actual payment of Rs.2,550

1.5 WHEN any salary line in history is read THEN the system reports `final_payable_days` = 0, including on 100% of the 1,371 lines in 2026-07

1.6 WHEN any salary line in history is read THEN the system reports `lwp_days` = 0, `base_gross_pay` = 0, `earned_salary_till_date` = 0 and `gross_before_lwp` = NULL

1.7 WHEN attendance proration is attempted for any month THEN the system cannot compute it because db_bill `salary_data.EarnedDays` and `WorkingDays` were never imported

1.8 WHEN the import scripts corrected by commit fa951ee9e (2026-08-29) are compared against stored data THEN the system still holds pre-fix values because no re-import was ever executed

**Component completeness (D4)**

1.9 WHEN a payslip itemises the SHSH deduction THEN the system cannot display it on 1,968 of 54,953 expected component rows because those rows are missing

1.10 WHEN a payslip itemises the SHORT_COLL deduction THEN the system cannot display it on 47 of 462 expected component rows because those rows are missing

**Duplicate TDS column (D5)**

1.11 WHEN a payslip PDF is generated THEN the system prints TDS as Rs.0 because `payslip.service.ts:173-174` selects `spl.tds` (0) while the real value sits in `spl.tds_amount` (Rs.94,160 for 2026-07), affecting Form-16 correctness, even though `payroll.routes.ts:1805` and `ff-compute.service.ts:367` read it correctly via `COALESCE(NULLIF(spl.tds_amount,0), spl.tds)`

**Run header totals (D6)**

1.12 WHEN a run header total is compared to the sum of its lines THEN the system disagrees for every month from 2026-04 to 2026-07 (2026-07 header Rs.1,86,68,410 vs lines Rs.2,00,81,729; 2026-06 header Rs.1,76,99,305 vs lines Rs.1,91,25,665; 2026-05 header Rs.10,50,813 vs lines Rs.1,87,10,762; 2026-04 header Rs.0 vs lines Rs.1,92,54,184)

1.13 WHEN a run header employee count is compared to its line count THEN the system disagrees (2026-05 header 11 employees vs 1,415 lines; 2026-04 header 0 employees vs 1,466 lines)

1.14 WHEN a run header is checked for internal arithmetic consistency THEN the system fails it, since 2,58,65,345 - 10,50,533 does not equal the recorded net of 1,86,68,410 for 2026-07

**Salary package assignments (D8)**

1.15 WHEN a salary package is read from `salary_component_assignments` THEN the system reports `bonus` = 0.00 on 2,619 of 4,291 rows (61%) while `gross` still includes the bonus, so the parts do not sum to the gross (MAS63418: basic 8000 + hra 4793 + conv 1600 = 14,393 against gross 15,059, missing 666; MAS63424: parts 15,783 against gross 16,633, missing 850)

1.16 WHEN a query selects the current salary package using `status='active'` THEN the system returns an arbitrary historical revision, because old revisions were never closed: 838 employees have 4 active rows, 212 have 3, 59 have 2 and only 184 have 1, and no column marks which row is current

1.17 WHEN payroll is computed for the 43 active employees that have no row in `salary_component_assignments` THEN the system has no component structure to compute from

**Role and route access (D9, D10)**

1.18 WHEN Branch Payroll HR staff use the payroll pages THEN the system denies them, because 62 code guards check the role `payroll_branch` which zero users hold, while the 4 active real users hold `payroll_hr`

1.19 WHEN a `payroll_hr` user calls the branch readiness routes THEN the system rejects the request, because `payroll_hr` is absent from the guards at `payroll-branch-readiness.routes.ts` lines 250, 289, 377, 471, 511, 555, 607 and 658, and `role_page_access` grants 15 pages to the phantom `payroll_branch` (also defined at `rbacPageMatrix.ts:838`) against 66 for the real `payroll_hr`

1.20 WHEN a branch signatory is required on a payroll document THEN the system has none, because `branch_payroll_hr_signatory` holds 0 rows

1.21 WHEN a `payroll_head` user requests the NEFT payment file THEN the system denies it, because `payroll.routes.ts:2351` (GET /runs/:id/neft-export) and `:2218` (neft-summary) require `admin, super_admin, finance, payroll` and omit `payroll_head`, which is the role the 2 responsible users hold

1.22 WHEN the NEFT export route is maintained THEN the system carries a duplicate definition at `payroll-extended.routes.ts:166` that can never execute, because `payrollRouter` is mounted at `app.ts:402` ahead of `payrollExtendedRouter` at `:403`

**Approval, disbursal and review gates (D11, D12)**

1.23 WHEN an approval trail is read for the 2026-04 to 2026-07 runs THEN the system shows status `finalized` with `validation_status` = pending and `validated_by`, `finance_approved_by`, `ceo_acknowledged_by`, `approved_by` and `disbursed_by` all NULL, plus `attendance_snapshot_locked` = 0 and `compliance_checked` = 0

1.24 WHEN disbursal records are read THEN the system returns 12 seeded demo rows in `payroll_disbursement` (all written 2026-06-11 18:22:05 by user 000...001, each with exactly 263 employees) and 0 rows in `salary_run_disbursal`

1.25 WHEN a payroll window passes its close date THEN the system never transitions `finalized` to `locked`, because the auto-lock cron in `payroll-window.cron.ts` treats `finalized` as already closed via `CLOSED_RUN_STATUSES` in `run-status.ts` and skips it, leaving 2026-07 with `window_close_date` 2026-08-29 elapsed and `auto_closed_at` still NULL

1.26 WHEN employees sit in `employee_payroll_head_review` THEN the system passes all 26 pending rows through unreviewed, because `payroll_config_flags.payroll_head_review_gate_enabled` is 'false'

1.27 WHEN a payroll config flag is resolved THEN the system may read either of two duplicate rows at the same NULL/NULL scope, affecting `payroll_head_review_gate_enabled` (ids ca98b872..., fc85c2a1..., both false, updated 2026-08-23), `weekoff_earning_required`, `working_days_required_for_one_weekoff`, `new_joiner_holiday_cutoff_enabled`, `new_joiner_cutoff_day`, `holiday_payout_basis`, `holiday_double_pay_requires_superadmin` and `payroll_recalc_auto_on_regularization`

**Readiness scoring (D13)**

1.28 WHEN a branch skips `attendance_data_ready` (15 points) and `attendance_frozen` (10 points) THEN the system still scores 85 and passes the default `min_readiness_score` of 80, because the weights at `payroll-branch-readiness.service.ts:566-587` sum to 110 and are clamped with `Math.min(100)`, and `computeStatus` (line ~595) omits the frozen requirement from 'ready'

1.29 WHEN readiness is scored for a branch that has done nothing THEN the system awards 10 unearned points, because `noc_resolved` and `holiday_work_approved` DEFAULT to 1 in the DDL

1.30 WHEN readiness is scored THEN the system awards 10 points for `overtime_entered` even though `overtime_allowed` is false company-wide

**Bank payment readiness (D14)**

1.31 WHEN the NEFT export is requested THEN the system refuses because the payable set will not reconcile: only 9 of 1,073 active employees holding a primary bank record are verified (0.84%), 50 active employees have no bank record at all, and `bank-payment-readiness.service.ts` classes unverified employees as not READY, while the penny-drop infrastructure (`bank_penny_drop_log`, `candidate_bank_verification`) sits unused

**Data hygiene (D15)**

1.32 WHEN active employees are counted THEN the system includes 30 employees that are `active_status` = 1 while `employment_status` is resigned (24) or terminated (6)

1.33 WHEN pending payroll work is drained THEN the system leaves 30,628 rows in `payroll_recalculation_queue` and 268 rows in `payroll_attendance_conflict_review` unprocessed

1.34 WHEN `payroll_branch_readiness` is read for 2026-08 THEN the system mixes grains, holding 7 branch-level rows plus 24 process-level rows across 7 branches when only 4 branches have active employees, alongside a phantom `2099-01` month with 6 rows marked ready

1.35 WHEN the 2026-08 payroll cycle is opened THEN the system has no `2026-08` row in `payroll_calendar` (only 2026-07 exists) and no `2026-08` run in `salary_prep_run`

**Absent parity and cutover controls**

1.36 WHEN payroll figures are reconciled between the two systems THEN the system compares totals only, so opposing per-employee errors net out and a month can appear reconciled while individual employees are wrong

1.37 WHEN the NEFT export is generated THEN the system does not require per-employee agreement with db_bill, so a payment file can be produced while variance exists

1.38 WHEN a bulk correction rewrites salary data THEN the system does not require a fresh backup or an approved `--dry-run` diff beforehand, and the only existing backups (`salary_prep_line_bk_20260829`, `salary_prep_line_component_bk_20260829`, `salary_prep_run_bk_20260829`) predate the correction

1.39 WHEN a bulk correction completes THEN the system does not re-run the parity audit or assert zero variance afterwards

1.40 WHEN cutover to `mas_hrms` is considered THEN the system imposes no requirement for consecutive clean parallel-run months, so cutover could occur while variance remains

### Expected Behavior (Correct)

**Root cause group: earned values imported (D1, D2, D3)**

2.1 WHEN a salary line is read for any month in history THEN the system SHALL hold the earned values from the `1`-suffixed db_bill columns for BASIC, HRA, PORTFOLIO, SPECIAL, CONV, BONUS and MA, per the mapping in `backend/scripts/lib/dbbill-salary-mapping.mjs`, such that a full-history parity audit reports 0 differing rows and Rs.0 drift on every earning head

2.2 WHEN `salary_prep_line.gross_salary` is compared to db_bill THEN the system SHALL equal db_bill `Gross1` (earned) on 129,696 of 129,696 rows, and `Gross1` SHALL equal the sum of the eight `1`-suffixed earning columns identified as earnings in `dbbill-salary-mapping.mjs`

2.3 WHEN an employee earned zero for a component in a month THEN the system SHALL hold no component row for that component, eliminating all 42,887 extra rows

2.4 WHEN net salary is read for any line THEN the system SHALL satisfy the legacy net identity `NetSalary = Gross1 + Incentive + ExtraDayIncentive + Arrear + PLI - ESIC - EPF - IncomeTax - AdvPaid - LoanDed - TotalDeduction`, where `TotalDeduction` is db_bill's roll-up of the non-statutory buckets only (ProTaxDeduction, LeaveDeduction, OtherDeduction, MobileDedcution, ShortCollection, AssetRecovery, Insurance, SHSH) and those buckets SHALL NOT be added again individually, so that all 351 overstated lines in 2026-07 reconcile to db_bill and the identity holds with zero failures across all lines as it does on 1,371 of 1,371 db_bill rows

2.5 WHEN any salary line is read THEN the system SHALL report `final_payable_days` equal to db_bill `salary_data.EarnedDays` for that employee-month, non-zero wherever db_bill records attendance

2.6 WHEN any salary line is read THEN the system SHALL populate `lwp_days`, `base_gross_pay`, `earned_salary_till_date` and `gross_before_lwp` from db_bill rather than leaving them at 0 or NULL

2.7 WHEN attendance proration is computed THEN the system SHALL satisfy `earned_component = entitlement_component x EarnedDays / WorkingDays` for every earning component, using `EarnedDays` and `WorkingDays` imported from `db_bill.salary_data`

2.8 WHEN the corrected import scripts are compared against stored data THEN the system SHALL show a completed re-import for every month in history, executed with the existing scripts `resync-diff-months-salary.mjs`, `sync-salary-gap-from-dbbill.mjs` and `fix-present-days-from-dbbill.mjs` rather than newly written ones

**Component completeness (D4)**

2.9 WHEN a payslip itemises the SHSH deduction THEN the system SHALL hold all 54,953 expected component rows, with the 1,968 missing rows created

2.10 WHEN a payslip itemises the SHORT_COLL deduction THEN the system SHALL hold all 462 expected component rows, with the 47 missing rows created

**Duplicate TDS column (D5)**

2.11 WHEN a payslip PDF is generated THEN the system SHALL print the actual TDS by resolving it through `COALESCE(NULLIF(spl.tds_amount,0), spl.tds)` at `payslip.service.ts:173-174`, matching the value already returned by `payroll.routes.ts:1805` and `ff-compute.service.ts:367`, so that 2026-07 shows Rs.94,160 rather than Rs.0

**Run header totals (D6)**

2.12 WHEN a run header total is compared to the sum of its lines THEN the system SHALL agree exactly for every month, and both SHALL agree with db_bill (2026-07 Rs.1,86,68,410; 2026-06 Rs.1,76,99,305)

2.13 WHEN a run header employee count is compared to its line count THEN the system SHALL report the same count

2.14 WHEN a run header is checked for internal arithmetic consistency THEN the system SHALL satisfy `total_earnings - total_deductions = total_net` on every run

**Salary package assignments (D8)**

2.15 WHEN a salary package is read THEN the system SHALL populate `bonus` such that the sum of the component columns equals `gross` on all 4,291 rows (MAS63418 bonus 666 giving 15,059; MAS63424 bonus 850 giving 16,633)

2.16 WHEN a query selects the current salary package THEN the system SHALL return exactly one row per employee, with superseded revisions closed so that at most one row per employee is `status='active'` and the current row is unambiguously identifiable without relying on query ordering

2.17 WHEN payroll is computed THEN the system SHALL find a component assignment for every active employee, resolving all 43 employees that have none

**Role and route access (D9, D10)**

2.18 WHEN Branch Payroll HR staff use the payroll pages THEN the system SHALL authorise them on the strength of the role they actually hold, with the phantom `payroll_branch` role either mapped to `payroll_hr` or removed from all 62 guards and from `rbacPageMatrix.ts:838`

2.19 WHEN a `payroll_hr` user calls the branch readiness routes THEN the system SHALL permit the request at all eight guard sites in `payroll-branch-readiness.routes.ts`, and `role_page_access` SHALL grant no pages to a role that no user holds

2.20 WHEN a branch signatory is required THEN the system SHALL resolve a named signatory from `branch_payroll_hr_signatory` for every branch that has active employees

2.21 WHEN a `payroll_head` user requests the NEFT payment file or summary THEN the system SHALL authorise the request at `payroll.routes.ts:2351` and `:2218`

2.22 WHEN the NEFT export route is maintained THEN the system SHALL define it exactly once, with the unreachable duplicate at `payroll-extended.routes.ts:166` removed

**Approval, disbursal and review gates (D11, D12)**

2.23 WHEN a run reaches disbursal THEN the system SHALL require the approval chain to be recorded, with `validation_status` advanced beyond pending and `validated_by`, `finance_approved_by`, `ceo_acknowledged_by`, `approved_by` and `disbursed_by` populated, and `attendance_snapshot_locked` and `compliance_checked` set

2.24 WHEN disbursal records are read THEN the system SHALL hold only real disbursals, with the 12 seeded demo rows in `payroll_disbursement` removed and `salary_run_disbursal` written by the actual disbursal path

2.25 WHEN a payroll window passes its close date THEN the system SHALL transition `finalized` to `locked` and set `auto_closed_at`, which requires `finalized` to be excluded from `CLOSED_RUN_STATUSES` in `run-status.ts` for the purposes of the `payroll-window.cron.ts` auto-lock

2.26 WHEN employees sit in `employee_payroll_head_review` THEN the system SHALL block them from payroll until reviewed, with `payroll_head_review_gate_enabled` set to 'true' and all 26 pending rows resolved

2.27 WHEN a payroll config flag is resolved THEN the system SHALL find exactly one row per key at a given scope, with the duplicates for all eight affected keys collapsed and a uniqueness constraint preventing recurrence

**Readiness scoring (D13)**

2.28 WHEN a branch has not completed attendance THEN the system SHALL score it below the `min_readiness_score` threshold and SHALL NOT report it ready, with the weights at `payroll-branch-readiness.service.ts:566-587` summing to exactly 100 without clamping, and `attendance_data_ready` and `attendance_frozen` treated as mandatory in `computeStatus`

2.29 WHEN readiness is scored for a branch that has done nothing THEN the system SHALL award zero points, with `noc_resolved` and `holiday_work_approved` defaulting to 0 rather than 1

2.30 WHEN readiness is scored while `overtime_allowed` is false THEN the system SHALL neither require nor award points for `overtime_entered`

**Bank payment readiness (D14)**

2.31 WHEN the NEFT export is requested THEN the system SHALL find every employee in the payable set carrying a verified primary bank record, with the 50 employees lacking a bank record supplied and verification driven through the existing penny-drop infrastructure

**Data hygiene (D15)**

2.32 WHEN active employees are counted THEN the system SHALL exclude employees whose `employment_status` is resigned or terminated, reconciling `active_status` for all 30 conflicting rows

2.33 WHEN pending payroll work is drained THEN the system SHALL process or explicitly dispose of all 30,628 `payroll_recalculation_queue` rows and all 268 `payroll_attendance_conflict_review` rows

2.34 WHEN `payroll_branch_readiness` is read for a month THEN the system SHALL hold one consistent grain, covering only the branches that have active employees, with the phantom `2099-01` rows removed

2.35 WHEN the 2026-08 payroll cycle is opened THEN the system SHALL hold a `2026-08` row in `payroll_calendar` and a `2026-08` run in `salary_prep_run`

**Parity and cutover controls**

2.36 WHEN payroll figures are reconciled between the two systems THEN the system SHALL compare per employee, not on totals, so that opposing errors cannot net out

2.37 WHEN the NEFT export is generated THEN the system SHALL hard-block it unless every employee in the payable set agrees with db_bill within Rs.1, refusing the export while any variance exists

2.38 WHEN a bulk correction rewrites salary data THEN the system SHALL require a fresh backup taken on the day of the write, an approved `--dry-run` diff, and per-month batching, and SHALL NOT write to db_bill under any circumstance

2.39 WHEN a bulk correction completes THEN the system SHALL re-run `audit-component-parity-vs-dbbill.mjs` and assert zero variance before the correction is accepted

2.40 WHEN cutover to `mas_hrms` is considered THEN the system SHALL require three consecutive parallel-run months (2026-08, 2026-09, 2026-10) at zero employee-level variance before payroll ownership transfers

2.41 WHEN the employee roster of `mas_hrms` is reconciled against db_bill THEN the system SHALL assert that the only permitted absentees are those matching `EmpCode LIKE 'IDC%'`, failing the reconciliation on any non-IDC absentee

### Unchanged Behavior (Regression Prevention)

3.1 WHEN any deduction or employer-contribution head is read THEN the system SHALL CONTINUE TO match db_bill exactly with 0 differing and 0 extra rows for PF_EMP, ESIC_EMP, PT, TDS, ADV, LOAN, LWP, MOBILE_DED, ASSET_REC, INS, OTHER_DED, PF_EMP_CO, ESIC_EMP_CO, ADMIN_CHG, INCENTIVE, EXTRA_DAY_INC, ARREAR, PLI and OA, and these heads SHALL NOT be rewritten by the correction

3.2 WHEN employees matching `EmpCode LIKE 'IDC%'` are processed THEN the system SHALL CONTINUE TO exclude them from `mas_hrms`, preserving every existing `NOT LIKE 'IDC%'` filter in the migration scripts, leaving approximately 131-155 employees and roughly Rs.23.5L per month on db_bill

3.3 WHEN `employee_salary_assignment` is queried THEN the system SHALL CONTINUE TO return exactly 1 active row for each of its 30,232 employees and SHALL CONTINUE TO retain all 102,341 rows as legitimate revision history, with only the single known duplicate addressed

3.4 WHEN `salary_component_assignments` revisions are closed THEN the system SHALL CONTINUE TO retain every historical row and its distinct `effective_date` spanning 2005-07-31 to 2026-08-20, changing only which row is marked current

3.5 WHEN any process reads db_bill THEN the system SHALL CONTINUE TO route through `billQuery()` in `backend/src/db/billDb.ts` and SHALL CONTINUE TO enforce its SELECT/SHOW/DESCRIBE/EXPLAIN allowlist, which together with database GRANTs is the only protection available given that MySQL 5.5 cannot enforce a session-level read-only mode

3.6 WHEN db_bill column semantics are resolved THEN the system SHALL CONTINUE TO treat `backend/scripts/lib/dbbill-salary-mapping.mjs` as the single authoritative mapping

3.7 WHEN NEFT summary or full-and-final amounts are computed THEN the system SHALL CONTINUE TO resolve TDS correctly at `payroll.routes.ts:1805` and `ff-compute.service.ts:367`

3.8 WHEN the correction is executed THEN the system SHALL CONTINUE TO use the existing scripts `resync-diff-months-salary.mjs`, `sync-salary-gap-from-dbbill.mjs`, `audit-component-parity-vs-dbbill.mjs` and `fix-present-days-from-dbbill.mjs` with their existing `--dry-run`, `--month=`, `--repair-components` and `--samples=` flags, and SHALL CONTINUE TO leave `audit-component-parity-vs-dbbill.mjs` read-only

3.9 WHEN 2026-08 salary data is found absent from both systems on 2026-08-30 THEN the system SHALL CONTINUE TO treat this as normal, since `ProcessAttendanceMaster` shows branch attendance finalising in the first two weeks of the following month (2026-06 finalised 3-13 Jul, 2026-07 finalised 5-12 Aug across 34 branches with 1 still open), placing 2026-08 due around 3-13 Sep

3.10 WHEN 2026-08 payroll is processed THEN the system SHALL CONTINUE TO run it in db_bill in parallel, and db_bill SHALL CONTINUE TO be the source of truth for what was actually paid until cutover completes

3.11 WHEN existing backup tables are present THEN the system SHALL CONTINUE TO retain `salary_prep_line_bk_20260829`, `salary_prep_line_component_bk_20260829` and `salary_prep_run_bk_20260829` alongside any fresh backup

3.12 WHEN an employee's line is already at zero variance against db_bill THEN the system SHALL CONTINUE TO produce the identical net salary after the correction, so that the fix changes only the lines that were wrong
