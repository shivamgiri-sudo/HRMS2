# Report Validation Matrix — PR #59

Branch: `agent/deep-section-reports`
Last updated: 2026-07-27

## Wave 1 — Highest-priority codes (one per category)

| Code | Category | Sensitivity | containsPII | containsFinancialData | Table dependencies | availabilityStatus | Schema issues |
|------|----------|-------------|-------------|----------------------|-------------------|-------------------|---------------|
| `headcount` | HR & Workforce | internal | false | false | employees, branch_master, department_master, process_master | under_validation | None — all tables exist |
| `employee-master` | HR & Workforce | confidential | true | false | employees, branch_master, process_master, department_master | under_validation | None |
| `attendance-daily` | Attendance | confidential | true | false | attendance_daily_record, employees, branch_master | under_validation | None |
| `leave-balance` | Leave | confidential | true | false | leave_balance_ledger (balance_year, allocated_days, used_days, adjusted_days), leave_type_master | under_validation | Fixed: wrong column names corrected in Step B |
| `payroll-register` | Payroll | highly_restricted | true | true | salary_prep_line, salary_prep_run, employees | under_validation | Tables exist (007_payroll.sql) |
| `payroll-variance` | Payroll | highly_restricted | false | true | salary_prep_line, salary_prep_run | under_validation | None |
| `pf-contribution-register` | Statutory | restricted | true | true | salary_prep_line (pf_employee, pf_employer, uan_number), salary_prep_run | under_validation | No dedicated pf_contribution table — derived from payslip |
| `gratuity-liability-register` | Statutory | restricted | true | true | employees | under_validation | Formula based on employee tenure + salary; salary_prep_line for wages |
| `resignation-register` | Exit & Separation | confidential | true | false | exit_request (was employee_exit_request — fixed), employees | under_validation | Table corrected from employee_exit_request → exit_request |
| `fnf-settlement-register` | Exit & Separation | restricted | true | true | employees, employee_fnf_settlement (LEFT JOIN — table not yet created) | under_validation | employee_fnf_settlement missing — returns NULL settlement columns until table created |
| `monthly-attrition-summary` | Attrition | internal | false | false | employees | under_validation | None |
| `recruitment-pipeline` | Recruitment | internal | false | false | job_description (ats_job_description?), ats_candidate | under_validation | Need to verify job_description table name |
| `agent-performance-summary` | Operations/KPI | confidential | true | false | Shivamgiri.v_call_master_unified_kpi (cross-DB) | under_validation | Cross-DB via sourceDb; cols User/CallDate/quality_score; scope via mas_hrms.employees |
| `roster-published` | WFM/Roster | confidential | true | false | wfm_roster_assignment, wfm_shift_master, employees | under_validation | None |
| `asset-inventory` | Assets | internal | false | false | asset_master, asset_category, branch_master | under_validation | None |
| `training-completion-status` | Training/LMS | confidential | true | false | lms integration tables | **blocked** | Depends on LMS integration sync tables not yet populated; LMS is external system |
| `document-expiry-tracker` | Documents | confidential | true | false | employee_document_expiry or similar | **blocked** | No document_expiry table found in schema; needs dedicated table |
| `identity-source-snapshot` | Identity | confidential | true | false | report_identity_source_snapshot (507_identity_source_snapshot.sql) | under_validation | Table exists; sync logic in identity-source-snapshot.ts |
| `daily-shrinkage-report` | Attendance/BPO | internal | false | false | attendance_daily_record, employees | under_validation | None — aggregate from attendance |
| `uan-status-report` | Identity | restricted | true | false | employees (uan_number, esic_number, pan_number) | under_validation | UAN/ESIC/PAN masked when !canViewSensitiveFields |

## Cross-DB sources (other databases on same server)

| Database | Table/View | Used by |
|----------|-----------|---------|
| `db_audit` | `call_quality_assessment` | quality-audit-log, fatal-error-register |
| `Shivamgiri` | `v_call_master_unified_kpi` | KPI live data (used by performance-feedback module) |

Access via `sourceDb.ts` (`querySource()`) using DB_HOST with SOURCE_DB_USER credentials. Queries use fully-qualified `db_audit.call_quality_assessment` refs. Employee scope enforced via sub-query on `mas_hrms.employees`.

## All Wave 1 codes now under_validation — no blocked codes remain

| Code | Source | Notes |
|------|--------|-------|
| `agent-performance-summary` | `Shivamgiri.v_call_master_unified_kpi` (cross-DB via sourceDb) | Cols: User, CallDate, quality_score. Scope via mas_hrms.employees sub-query |
| `team-performance-summary` | Same — application-side aggregation by team lead | Avoids cross-DB GROUP BY; groups per-employee scores in application layer |
| `training-completion-status` | `lms_learner_progress` (250_lms_integration_schema.sql) | Synced from external LMS; joins on employee_code |
| `document-expiry-tracker` | `employee_documents` + migration 415 adds `expiry_date` | Graceful ER_BAD_FIELD_ERROR fallback if migration not yet applied |

## Unblocked by cross-DB discovery

| Code | Was | Now | Source |
|------|-----|-----|--------|
| `quality-audit-log` | blocked (quality_audit_record missing) | under_validation | `db_audit.call_quality_assessment` via sourceDb |
| `fatal-error-register` | blocked (quality_audit_record missing) | under_validation | `db_audit.call_quality_assessment` via sourceDb |
| `fnf-settlement-register` | blocked (employee_fnf_settlement missing) | under_validation | `full_final_calculation` (011_exit_management.sql) |
| `clearance-status-register` | blocked (employee_clearance missing) | under_validation | `exit_clearance_checklist` (011_exit_management.sql) |

## Known schema corrections applied

| Issue | Executor | Fix |
|-------|----------|-----|
| `leave_balance_ledger` wrong column names | leave.executor.ts (Step B) | Corrected: allocated_days, used_days, adjusted_days, balance_year |
| `kpi_score_record` → `kpi_score` | operations.executor.ts | Table name and column names corrected to match schema |
| `employee_exit_request` → `exit_request` | exit.executor.ts | Table name corrected to match 011_exit_management.sql |
| `wfm_shift_swap_request` missing | wfm.executor.ts | Added try/catch for ER_NO_SUCH_TABLE; returns empty result gracefully |

## Validation procedure (per code)

For each code in Wave 1 with status `under_validation`:
1. Run `GET /api/reports/suite/{code}?...filters` — verify rows returned match DB count
2. Check columns: labels correct, no raw IDs, no placeholder rows
3. Test branch scope: branch-scoped user sees only their branch
4. Test empty result: correct empty-state, no crash
5. For sensitive codes: verify PAN/UAN/bank masked when accessed by non-payroll user
6. Export: `GET /api/reports/suite/{code}/export` — compare row count vs preview
7. Update `availabilityStatus` to `validated` or `validated_with_limitations`

## Wave 2 onward

Covers remaining ~117 codes. Begin after Wave 1 validation passes for each category.
Category may be merged into hub only after all its codes have a non-TBD decision.
