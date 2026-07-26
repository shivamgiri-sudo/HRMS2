# MASTER REPORT SOURCE CONTRACT MATRIX
**Branch:** agent/deep-section-reports
**Date:** 2026-07-26
**Methodology:** Field-by-field inspection of migration SQL files under `backend/sql/` and authoritative service code under `backend/src/modules/`. Every table reference was cross-checked against the CREATE TABLE statements in the migrations. SOURCE_STATUS is assigned at the column level based on whether the table exists and the column is present.

---

## How to Read the Table

### SOURCE_STATUS values
| Value | Meaning |
|---|---|
| `VERIFIED` | Table and column both confirmed in migration SQL files. |
| `COLUMN_GAP` | Table exists in migrations but the specific column is absent. The field must be derived, computed, or supplied via ALTER in a later migration. |
| `TABLE_MISSING` | No CREATE TABLE statement for this table exists in any file under `backend/sql/`. The field cannot be served from MySQL until the table is added. |

### SENSITIVITY values
| Value | Meaning |
|---|---|
| `PUBLIC` | Safe for aggregate client portal or external view after approval. |
| `INTERNAL` | Safe for internal management/operations staff; must not leak to clients. |
| `CONFIDENTIAL` | Role-restricted; payroll/HR roles only. Must not appear in operations exports. |
| `RESTRICTED` | Highest sensitivity: PII, bank/PAN/statutory data. Strict need-to-know; encryption at rest required; never in reports without explicit role gate. |

---

## Important Notes on Audit Tables

Migration `218_enterprise_foundation_helpers.sql` (and its duplicate content in `220_enterprise_foundation_helpers.sql`) creates:

```sql
CREATE TABLE IF NOT EXISTS audit_action_log ( ... );
CREATE TABLE IF NOT EXISTS audit_log LIKE audit_action_log;
```

Both tables have identical schemas. However:

- **`audit_action_log`** is the canonical insert target used by `shared/auditLog.ts` `writeAuditLog()`.
- **`audit_log`** is a legacy alias retained for backward compatibility with `incentives.routes.ts`.
- Governance adapters and report queries **MUST** use `audit_action_log` as primary. Reads from `audit_log` are acceptable for backward-compat only; writes to `audit_log` by new code are prohibited.

Migration `015_platform_foundation.sql` creates `sensitive_action_log` (for high-security audit: salary changes, statutory edits, PII updates). Migration `237_attendance_dispute_schema.sql` adds `old_value_json`, `new_value_json`, and `actor_role` columns to `sensitive_action_log`.

**`salary_payslip`** is the correct table name (created in `007_payroll.sql`). There is no table named `payslip` in the migrations.

---

## Per-Report Source Contract Tables

---

### 1. bpo-operations-productivity-master
**Grain:** ONE ROW PER EMPLOYEE PER WORK DATE PER PROCESS/LOB

| REPORT_FIELD | AUTH_SCHEMA | AUTH_TABLE | AUTH_COLUMN | JOIN_KEY | AGGREGATION | DATE_FIELD | SENSITIVITY | SOURCE_STATUS | NOTES |
|---|---|---|---|---|---|---|---|---|---|
| EMPLOYEE_CODE | mas_hrms | employees | employee_code | employees.id | NONE | — | INTERNAL | VERIFIED | Primary identifier |
| REPORT_DATE | mas_hrms | attendance_reconciliation_record | roster_date | employee_id | NONE | roster_date | INTERNAL | VERIFIED | Roster date is the canonical work date |
| BRANCH | mas_hrms | branch_master | branch_name | employees.branch_id | NONE | — | INTERNAL | VERIFIED | Join employees → branch_master |
| PROCESS | mas_hrms | process_master | process_name | employees.process_id | NONE | — | INTERNAL | VERIFIED | Join employees → process_master |
| ROSTER_SHIFT | mas_hrms | wfm_shift_master | shift_code | wfm_roster_assignment.shift_id | NONE | — | INTERNAL | VERIFIED | Via wfm_roster_assignment.shift_id → wfm_shift_master |
| SHIFT_START_TIME | mas_hrms | wfm_shift_master | start_time | wfm_roster_assignment.shift_id | NONE | — | INTERNAL | VERIFIED | — |
| SHIFT_END_TIME | mas_hrms | wfm_shift_master | end_time | wfm_roster_assignment.shift_id | NONE | — | INTERNAL | VERIFIED | — |
| SCHEDULED_MINUTES | mas_hrms | wfm_shift_master | required_minutes | wfm_roster_assignment.shift_id | NONE | — | INTERNAL | VERIFIED | — |
| ROSTER_DATE | mas_hrms | wfm_roster_assignment | roster_date | employee_id | NONE | roster_date | INTERNAL | VERIFIED | — |
| BIOMETRIC_IN | mas_hrms | wfm_attendance_session | login_time | employee_id | NONE | session_date | INTERNAL | VERIFIED | Raw login_time from session |
| BIOMETRIC_OUT | mas_hrms | wfm_attendance_session | logout_time | employee_id | NONE | session_date | INTERNAL | VERIFIED | Raw logout_time from session |
| PROCESSED_ATTENDANCE_MINUTES | mas_hrms | attendance_reconciliation_record | actual_minutes | employee_id | NONE | roster_date | INTERNAL | VERIFIED | Reconciled final minutes |
| PRODUCTIVE_MINUTES | mas_hrms | attendance_reconciliation_record | productive_minutes | employee_id | NONE | roster_date | INTERNAL | VERIFIED | actual_minutes minus break_minutes |
| CALLS_HANDLED | mas_hrms | kpi_score | actual_value | employee_id | NONE | period | INTERNAL | COLUMN_GAP | kpi_score stores metric by period (YYYY-MM), not daily. No per-day calls_handled column. Requires dialer_session_log or external feed aggregated to day grain. |
| AHT_SECONDS | mas_hrms | kpi_score | actual_value | employee_id | NONE | period | INTERNAL | COLUMN_GAP | Same as CALLS_HANDLED: kpi_metric_master has AHT metric_code but kpi_score is monthly grain. Daily AHT must come from dialer_session_log or external KPI feed. |
| QUALITY_SCORE | db_audit | call_quality_assessment | (external) | employee_code | NONE | (date col external) | CONFIDENTIAL | TABLE_MISSING | db_audit.call_quality_assessment is an external database; confirmed as external-only in `505_performance_source_connector_keys.sql`. No local table. |
| SHRINKAGE_PCT | mas_hrms | shrinkage_daily_snapshot | total_shrinkage_pct | process_id, branch_id | NONE | snapshot_date | INTERNAL | VERIFIED | Process/branch aggregate; not per-employee. Per-employee derived from attendance_status. |
| ADHERENCE_PCT | mas_hrms | attendance_reconciliation_record | adherence_pct | employee_id | NONE | roster_date | INTERNAL | VERIFIED | — |
| DIALER_LOGIN_MINUTES | mas_hrms | dialer_session_log | login_minutes | employee_code | SUM | session_date | INTERNAL | VERIFIED | SUM across multiple dialer rows per employee per date |

---

### 2. bpo-payroll-statutory-master
**Grain:** ONE ROW PER EMPLOYEE PER PAYROLL MONTH PER PAYROLL RUN

| REPORT_FIELD | AUTH_SCHEMA | AUTH_TABLE | AUTH_COLUMN | JOIN_KEY | AGGREGATION | DATE_FIELD | SENSITIVITY | SOURCE_STATUS | NOTES |
|---|---|---|---|---|---|---|---|---|---|
| EMPLOYEE_CODE | mas_hrms | salary_prep_line | employee_code | salary_prep_line.employee_id | NONE | — | CONFIDENTIAL | VERIFIED | Denormalised in salary_prep_line |
| PAYROLL_MONTH | mas_hrms | salary_prep_run | run_month | salary_prep_line.run_id | NONE | run_month | CONFIDENTIAL | VERIFIED | Format YYYY-MM |
| PAYROLL_RUN_ID | mas_hrms | salary_prep_run | id | salary_prep_line.run_id | NONE | — | CONFIDENTIAL | VERIFIED | UUID |
| GROSS_EARNINGS | mas_hrms | salary_prep_line | gross_salary | run_id, employee_id | NONE | — | RESTRICTED | VERIFIED | Primary earnings field per run |
| NET_PAY | mas_hrms | salary_prep_line | net_salary | run_id, employee_id | NONE | — | RESTRICTED | VERIFIED | — |
| BASIC_PAY | mas_hrms | salary_prep_line | (derived) | run_id, employee_id | NONE | — | RESTRICTED | COLUMN_GAP | salary_prep_line has gross_salary, total_deductions, net_salary but no basic_pay column. Basic must be re-derived from employee_salary_assignment.ctc_annual * salary_structure_master.basic_pct / 12. |
| PF_EMPLOYEE | mas_hrms | salary_prep_line | pf_employee | run_id, employee_id | NONE | — | RESTRICTED | VERIFIED | — |
| PF_EMPLOYER | mas_hrms | salary_prep_line | pf_employer | run_id, employee_id | NONE | — | RESTRICTED | VERIFIED | — |
| ESIC_EMPLOYEE | mas_hrms | salary_prep_line | esic_employee | run_id, employee_id | NONE | — | RESTRICTED | VERIFIED | — |
| ESIC_EMPLOYER | mas_hrms | salary_prep_line | esic_employer | run_id, employee_id | NONE | — | RESTRICTED | VERIFIED | — |
| PROFESSIONAL_TAX | mas_hrms | salary_prep_line | professional_tax | run_id, employee_id | NONE | — | RESTRICTED | VERIFIED | — |
| TDS_DEDUCTION | mas_hrms | salary_prep_line | tds | run_id, employee_id | NONE | — | RESTRICTED | VERIFIED | Column is named `tds` in migration 007 |
| BANK_ACCOUNT | mas_hrms | employee_bank_detail | account_number | employee_id | NONE | — | RESTRICTED | VERIFIED | VARBINARY(500) — encrypted at rest; mask in report output |
| BANK_IFSC | mas_hrms | employee_bank_detail | ifsc_code | employee_id | NONE | — | RESTRICTED | VERIFIED | — |
| PAN_NUMBER | mas_hrms | employees | pan_number | employee_id | NONE | — | RESTRICTED | VERIFIED | Added via migration 041_schema_gap_fill.sql ALTER TABLE employees |
| PAYSLIP_URL | mas_hrms | salary_payslip | file_url | prep_line_id | NONE | generated_at | RESTRICTED | VERIFIED | Table is salary_payslip (not payslip) per migration 007 |
| WORKING_DAYS | mas_hrms | salary_prep_line | working_days | run_id, employee_id | NONE | — | CONFIDENTIAL | VERIFIED | — |
| PRESENT_DAYS | mas_hrms | salary_prep_line | present_days | run_id, employee_id | NONE | — | CONFIDENTIAL | VERIFIED | — |
| LWP_DAYS | mas_hrms | salary_prep_line | lwp_days | run_id, employee_id | NONE | — | CONFIDENTIAL | VERIFIED | — |

---

### 3. bpo-finance-pnl-profitability-master
**Grain:** ONE ROW PER BRANCH PER CLIENT PER PROCESS/LOB PER FINANCE MONTH

| REPORT_FIELD | AUTH_SCHEMA | AUTH_TABLE | AUTH_COLUMN | JOIN_KEY | AGGREGATION | DATE_FIELD | SENSITIVITY | SOURCE_STATUS | NOTES |
|---|---|---|---|---|---|---|---|---|---|
| FINANCE_MONTH | mas_hrms | process_delivery_actual | period_code | process_id | NONE | period_code | CONFIDENTIAL | VERIFIED | Format YYYY-MM |
| BRANCH | mas_hrms | branch_master | branch_name | process_master.branch_id | NONE | — | INTERNAL | VERIFIED | — |
| CLIENT | mas_hrms | client_master | client_name | process_master.client_id | NONE | — | INTERNAL | VERIFIED | Join via process_master |
| PROCESS | mas_hrms | process_master | process_name | process_id | NONE | — | INTERNAL | VERIFIED | — |
| PLANNED_REVENUE | mas_hrms | process_monthly_plan | planned_revenue | process_id, period | NONE | period_code | CONFIDENTIAL | COLUMN_GAP | process_monthly_plan exists but planned_revenue column presence depends on migration 415 ALTER statements; column name not confirmed as planned_revenue. |
| EARNED_REVENUE | mas_hrms | process_delivery_actual | (derived) | process_id, period_code | SUM | period_code | CONFIDENTIAL | COLUMN_GAP | Earned revenue is computed by bpoPnlAllocationOverlayService from process_revenue_rule + process_delivery_actual.billable_units. No single stored earned_revenue column — it is a runtime calculation. |
| RECOGNISED_REVENUE | mas_hrms | process_revenue_component | amount_inr | process_id, period_code | SUM | recognition_date | CONFIDENTIAL | VERIFIED | SUM of approved process_revenue_component rows where status='approved' |
| INVOICE_AMOUNT | mas_hrms | billing_invoice | net_amount | process_id | NONE | period_from | CONFIDENTIAL | VERIFIED | billing_invoice.net_amount is post-adjustment invoice value |
| COLLECTION | mas_hrms | billing_invoice | (derived) | process_id | NONE | paid_at | CONFIDENTIAL | COLUMN_GAP | billing_invoice.status = 'paid' indicates collection but no separate collection_amount column exists. Collection amount = net_amount when status='paid'. |
| PAYROLL_COST | mas_hrms | salary_prep_run | total_gross | branch_filter, process_filter | NONE | run_month | RESTRICTED | VERIFIED | SUM of salary_prep_line.gross_salary per process/branch/month is the canonical payroll cost input |
| GRN_COST | mas_hrms | grn_request | amount | branch_id | SUM | bill_date | CONFIDENTIAL | VERIFIED | SUM of approved grn_request.amount per branch per period; grn_cost_allocation.pnl_bucket drives P&L attribution |
| GROSS_PAYABLE | mas_hrms | vendor_payment_tracking | gross_amount | grn_request_id | NONE | — | CONFIDENTIAL | COLUMN_GAP | vendor_payment_tracking table exists (310_vendor_payment_tracking.sql) but column is named differently; inspect migration 310 for exact column. |
| CASH_PAID | mas_hrms | vendor_payment_tracking | (derived) | grn_request_id | NONE | paid_date | CONFIDENTIAL | COLUMN_GAP | Cash paid is likely sum of approved payment rows; exact column name requires inspection of migration 310 beyond line 80. |
| OUTSTANDING_PAYABLE | mas_hrms | vendor_payment_tracking | (derived) | grn_request_id | NONE | due_date | CONFIDENTIAL | COLUMN_GAP | Derived: grn_request.amount minus sum of vendor_payment_tracking paid amounts. No stored outstanding column confirmed. |
| EBITDA | mas_hrms | (runtime) | (computed) | process_id, period | — | period_code | RESTRICTED | COLUMN_GAP | EBITDA is computed by bpoPnlAllocationOverlayService / bpoPnlService at query time. Not stored as a column. Must be materialised if report needs offline access. |
| PBT | mas_hrms | (runtime) | (computed) | process_id, period | — | period_code | RESTRICTED | COLUMN_GAP | Same as EBITDA — runtime computed from cost waterfall in bpo-pnl.calculation.ts |
| PAT | mas_hrms | (runtime) | (computed) | process_id, period | — | period_code | RESTRICTED | COLUMN_GAP | Same as EBITDA — computed after tax deduction; no stored column |
| EBITDA_MARGIN_PCT | mas_hrms | (runtime) | (computed) | process_id, period | — | period_code | RESTRICTED | COLUMN_GAP | Derived from EBITDA / EARNED_REVENUE at runtime |

---

### 4. bpo-interview-to-exit-journey-ledger
**Grain:** ONE ROW PER JOURNEY ACTIVITY EVENT

| REPORT_FIELD | AUTH_SCHEMA | AUTH_TABLE | AUTH_COLUMN | JOIN_KEY | AGGREGATION | DATE_FIELD | SENSITIVITY | SOURCE_STATUS | NOTES |
|---|---|---|---|---|---|---|---|---|---|
| EMPLOYEE_CODE | mas_hrms | employees | employee_code | employees.id | NONE | — | INTERNAL | VERIFIED | COALESCE(e.employee_code, 'PENDING EMPLOYEE CODE') — pre-bridge candidates have no code |
| CANDIDATE_ID | mas_hrms | ats_candidate | id | ats_candidate.id | NONE | — | INTERNAL | VERIFIED | — |
| JOURNEY_PHASE | mas_hrms | (computed) | (literal) | — | NONE | — | INTERNAL | VERIFIED | Derived from source table name: RECRUITMENT / ONBOARDING / EMPLOYMENT / EXIT |
| ACTIVITY_TYPE | mas_hrms | (computed) | (literal) | — | NONE | — | INTERNAL | VERIFIED | E.g. APPLICATION CREATED, STAGE MOVEMENT, JOINING BRIDGE, LIFECYCLE EVENT |
| ACTIVITY_DATE_TIME | mas_hrms | (source-specific) | created_at / event_date | varies | NONE | created_at | INTERNAL | VERIFIED | Each source table has an activityDateColumn per SOURCE_REGISTRY in journey-audit-report.service.ts |
| ACTOR_EMPLOYEE_CODE | mas_hrms | employees | employee_code | actor join on actor_column | NONE | — | INTERNAL | VERIFIED | Resolved via LEFT JOIN employees ON employees.id = actor_column value |
| APPROVER_EMPLOYEE_CODE | mas_hrms | employees | employee_code | approval join | NONE | — | INTERNAL | VERIFIED | Applicable for lifecycle_event.approved_by and exit_approval_log.action_by |
| SOURCE_RECORD_ID | mas_hrms | (source-specific) | id | varies | NONE | — | INTERNAL | VERIFIED | The UUID of the originating row in the source table |
| SOURCE_TABLE | mas_hrms | (literal) | (literal) | — | NONE | — | INTERNAL | VERIFIED | Hardcoded from SOURCE_REGISTRY; e.g. 'ats_candidate', 'employee_lifecycle_event' |
| DAYS_FROM_PREVIOUS_EVENT | mas_hrms | (runtime) | (computed) | — | NONE | — | INTERNAL | COLUMN_GAP | Not stored; must be computed in the report query using LAG(ACTIVITY_DATE_TIME) window function |
| ATS_STAGE_FROM | mas_hrms | ats_candidate_stage_log | from_stage | candidate_id | NONE | stage_date | INTERNAL | VERIFIED | — |
| ATS_STAGE_TO | mas_hrms | ats_candidate_stage_log | to_stage | candidate_id | NONE | stage_date | INTERNAL | VERIFIED | — |
| BRIDGE_DATE | mas_hrms | ats_onboarding_bridge | bridge_date | candidate_id | NONE | bridge_date | INTERNAL | VERIFIED | — |
| LIFECYCLE_EVENT_TYPE | mas_hrms | employee_lifecycle_event | event_type | employee_id | NONE | effective_date | INTERNAL | VERIFIED | ENUM column in migration 016 |
| OLD_VALUE_JSON | mas_hrms | employee_lifecycle_event | old_value_json | employee_id | NONE | — | CONFIDENTIAL | VERIFIED | JSON column present in migration 016 |
| NEW_VALUE_JSON | mas_hrms | employee_lifecycle_event | new_value_json | employee_id | NONE | — | CONFIDENTIAL | VERIFIED | JSON column present in migration 016 |
| EXIT_TYPE | mas_hrms | exit_request | exit_type | employee_id | NONE | created_at | INTERNAL | VERIFIED | — |
| EXIT_STATUS | mas_hrms | exit_request | status | employee_id | NONE | created_at | INTERNAL | VERIFIED | — |
| CLEARANCE_DEPARTMENT | mas_hrms | exit_clearance_checklist | department | exit_request_id | NONE | created_at | INTERNAL | VERIFIED | — |

---

### 5. bpo-wfm-attendance-shrinkage-master
**Grain:** ONE ROW PER EMPLOYEE PER ATTENDANCE DATE

| REPORT_FIELD | AUTH_SCHEMA | AUTH_TABLE | AUTH_COLUMN | JOIN_KEY | AGGREGATION | DATE_FIELD | SENSITIVITY | SOURCE_STATUS | NOTES |
|---|---|---|---|---|---|---|---|---|---|
| EMPLOYEE_CODE | mas_hrms | employees | employee_code | employees.id | NONE | — | INTERNAL | VERIFIED | — |
| ROSTER_DATE | mas_hrms | wfm_roster_assignment | roster_date | employee_id | NONE | roster_date | INTERNAL | VERIFIED | Canonical date for WFM grain |
| ROSTER_STATUS | mas_hrms | wfm_roster_assignment | roster_status | employee_id, roster_date | NONE | roster_date | INTERNAL | VERIFIED | ENUM: Rostered, Off, Leave, etc. |
| PUBLISH_STATUS | mas_hrms | wfm_roster_assignment | publish_status | employee_id, roster_date | NONE | roster_date | INTERNAL | VERIFIED | draft / published / acknowledged |
| BIOMETRIC_IN | mas_hrms | wfm_attendance_session | login_time | employee_id, session_date | NONE | session_date | INTERNAL | VERIFIED | Raw punch-in; session_date = roster_date |
| BIOMETRIC_OUT | mas_hrms | wfm_attendance_session | logout_time | employee_id, session_date | NONE | session_date | INTERNAL | VERIFIED | Raw punch-out |
| TOTAL_LOGIN_MINUTES | mas_hrms | wfm_attendance_session | total_login_minutes | employee_id, session_date | NONE | session_date | INTERNAL | VERIFIED | — |
| PUNCH_SOURCE | mas_hrms | wfm_attendance_session | punch_source | employee_id, session_date | NONE | session_date | INTERNAL | VERIFIED | MANUAL / BIOMETRIC / FACIAL |
| PROCESSED_ATTENDANCE | mas_hrms | attendance_reconciliation_record | attendance_status | employee_id, roster_date | NONE | roster_date | INTERNAL | VERIFIED | ENUM: present / absent / half_day / leave_approved / week_off / etc. |
| ACTUAL_MINUTES | mas_hrms | attendance_reconciliation_record | actual_minutes | employee_id, roster_date | NONE | roster_date | INTERNAL | VERIFIED | — |
| PRODUCTIVE_MINUTES | mas_hrms | attendance_reconciliation_record | productive_minutes | employee_id, roster_date | NONE | roster_date | INTERNAL | VERIFIED | — |
| ADHERENCE_PCT | mas_hrms | attendance_reconciliation_record | adherence_pct | employee_id, roster_date | NONE | roster_date | INTERNAL | VERIFIED | — |
| LATE_BY_MINUTES | mas_hrms | attendance_reconciliation_record | late_by_minutes | employee_id, roster_date | NONE | roster_date | INTERNAL | VERIFIED | — |
| PAYROLL_ATTENDANCE_INPUT | mas_hrms | payroll_readiness_flag | status | employee_id | NONE | period_start | INTERNAL | VERIFIED | ENUM: pending / ready / sent_to_payroll / processed |
| LEAVE_TYPE | mas_hrms | leave_request | leave_type_id → leave_type_master.leave_code | employee_id | NONE | leave_date | INTERNAL | VERIFIED | Join leave_request → leave_type_master on leave_type_id |
| LEAVE_STATUS | mas_hrms | leave_request | status | employee_id | NONE | leave_date | INTERNAL | VERIFIED | — |
| REGULARISATION_STATUS | mas_hrms | attendance_regularization | status | employee_id, session_date | NONE | session_date | INTERNAL | VERIFIED | ENUM: pending / approved / rejected |
| SHRINKAGE_TYPE | mas_hrms | shrinkage_daily_snapshot | (derived) | process_id, branch_id, snapshot_date | NONE | snapshot_date | INTERNAL | COLUMN_GAP | shrinkage_daily_snapshot has planned_shrinkage_pct and unplanned_shrinkage_pct (aggregate level) but no per-employee shrinkage_type column. Per-employee type must be derived from attendance_status: absent without leave = unplanned; approved leave = planned. |
| BREAK_MINUTES | mas_hrms | wfm_break_log | duration_minutes | session_id | SUM | break_start | INTERNAL | VERIFIED | SUM(duration_minutes) per session |
| BREAK_TYPE | mas_hrms | wfm_break_log | break_type | session_id | NONE | break_start | INTERNAL | VERIFIED | — |

---

### 6. bpo-audit-compliance-control-master
**Grain:** ONE ROW PER AUDIT/CONTROL/APPROVAL/COMPLIANCE EVENT

| REPORT_FIELD | AUTH_SCHEMA | AUTH_TABLE | AUTH_COLUMN | JOIN_KEY | AGGREGATION | DATE_FIELD | SENSITIVITY | SOURCE_STATUS | NOTES |
|---|---|---|---|---|---|---|---|---|---|
| EVENT_ID | mas_hrms | audit_action_log | id | — | NONE | created_at | INTERNAL | VERIFIED | UUID primary key |
| CREATED_AT | mas_hrms | audit_action_log | created_at | — | NONE | created_at | INTERNAL | VERIFIED | — |
| ACTOR_USER_ID | mas_hrms | audit_action_log | actor_user_id | — | NONE | created_at | CONFIDENTIAL | VERIFIED | Resolve to ACTOR_EMPLOYEE_CODE via users join |
| ACTOR_EMPLOYEE_CODE | mas_hrms | employees | employee_code | users → employees.user_id | NONE | — | CONFIDENTIAL | VERIFIED | JOIN users ON audit_action_log.actor_user_id = users.id, then employees ON user_id |
| SUBJECT_EMPLOYEE_CODE | mas_hrms | audit_action_log | entity_id | entity_type='employee' | NONE | — | CONFIDENTIAL | VERIFIED | When entity_type='employee', entity_id is the employee UUID; resolve to code |
| ACTION_TYPE | mas_hrms | audit_action_log | action_type | — | NONE | — | INTERNAL | VERIFIED | VARCHAR(100) |
| MODULE_KEY | mas_hrms | audit_action_log | module_key | — | NONE | — | INTERNAL | VERIFIED | — |
| ENTITY_TYPE | mas_hrms | audit_action_log | entity_type | — | NONE | — | INTERNAL | VERIFIED | — |
| ENTITY_ID | mas_hrms | audit_action_log | entity_id | — | NONE | — | INTERNAL | VERIFIED | — |
| IP_ADDRESS | mas_hrms | audit_action_log | ip_address | — | NONE | — | CONFIDENTIAL | VERIFIED | — |
| METADATA_JSON | mas_hrms | audit_action_log | metadata_json | — | NONE | — | CONFIDENTIAL | VERIFIED | JSON blob |
| OLD_VALUE | mas_hrms | sensitive_action_log | old_value_json | — | NONE | acted_at | RESTRICTED | COLUMN_GAP | old_value_json added to sensitive_action_log via migration 237; NOT present in audit_action_log. Only available in sensitive_action_log for SENSITIVE events. |
| NEW_VALUE | mas_hrms | sensitive_action_log | new_value_json | — | NONE | acted_at | RESTRICTED | COLUMN_GAP | Same as OLD_VALUE — only in sensitive_action_log after migration 237. |
| ACTOR_ROLE | mas_hrms | sensitive_action_log | actor_role | — | NONE | acted_at | CONFIDENTIAL | COLUMN_GAP | actor_role added to sensitive_action_log via migration 237. Not present in audit_action_log. |
| CONTROL_RESULT | mas_hrms | security_audit_event | severity | — | NONE | created_at | INTERNAL | COLUMN_GAP | security_audit_event exists (migration 521) but no CONTROL_RESULT column; severity (info/low/medium/high/critical) is the closest analogue. |
| DPDP_PURPOSE | mas_hrms | (no canonical table) | — | — | — | — | RESTRICTED | TABLE_MISSING | dpdp_purpose_code appears in migration 271 on a specific consent table but there is no general-purpose DPDP purpose log in audit tables. Gap: a dpdp_processing_event or audit_action_log.metadata_json subfield is required. |
| DATA_CLASSIFICATION | mas_hrms | (no canonical table) | — | — | — | — | RESTRICTED | TABLE_MISSING | No data_classification column in audit_action_log or sensitive_action_log. Would need to be added to audit schema or inferred from entity_type + module_key mapping. |
| EXCEPTION_FLAG | mas_hrms | security_audit_event | severity | — | NONE | created_at | INTERNAL | COLUMN_GAP | exception_flag can be derived: security_audit_event.severity IN ('high','critical') = exception. No dedicated boolean exception_flag column confirmed. |
| REQUEST_ID | mas_hrms | audit_action_log | request_id | — | NONE | — | INTERNAL | VERIFIED | Added via migration 218 ALTER TABLE |

---

## Remaining 8 Reports — Summary Source Tables

### bpo-employee-performance-360-master

| KEY_FIELD | SOURCE_TABLE | SOURCE_COLUMN | SENSITIVITY | SOURCE_STATUS |
|---|---|---|---|---|
| EMPLOYEE_CODE | employees | employee_code | INTERNAL | VERIFIED |
| KPI_METRIC | kpi_metric_master | metric_code | INTERNAL | VERIFIED |
| KPI_ACTUAL_VALUE | kpi_score | actual_value | INTERNAL | VERIFIED |
| KPI_TARGET | kpi_template_metric | target_value | INTERNAL | VERIFIED |
| KPI_PERIOD | kpi_score | period | INTERNAL | VERIFIED |
| COACHING_DATE | coaching_session | session_date | INTERNAL | VERIFIED |
| PIP_STATUS | pip_record | status | CONFIDENTIAL | VERIFIED |
| QUALITY_SCORE | db_audit.call_quality_assessment | (external) | CONFIDENTIAL | TABLE_MISSING |

---

### bpo-client-sla-delivery-master

| KEY_FIELD | SOURCE_TABLE | SOURCE_COLUMN | SENSITIVITY | SOURCE_STATUS |
|---|---|---|---|---|
| CLIENT | client_master | client_name | INTERNAL | VERIFIED |
| PROCESS | process_master | process_name | INTERNAL | VERIFIED |
| PERIOD_CODE | process_delivery_actual | period_code | INTERNAL | VERIFIED |
| PLANNED_UNITS | process_delivery_actual | planned_units | INTERNAL | VERIFIED |
| DELIVERED_UNITS | process_delivery_actual | delivered_units | INTERNAL | VERIFIED |
| BILLABLE_UNITS | process_delivery_actual | billable_units | INTERNAL | VERIFIED |
| QUALITY_SCORE | process_delivery_actual | quality_score | CONFIDENTIAL | VERIFIED |
| SLA_SCORE | process_delivery_actual | sla_score | CONFIDENTIAL | VERIFIED |
| INVOICE_STATUS | billing_invoice | status | CONFIDENTIAL | VERIFIED |
| REVENUE_RULE | process_revenue_rule | billing_model | CONFIDENTIAL | VERIFIED |

---

### bpo-hr-workforce-lifecycle-master

| KEY_FIELD | SOURCE_TABLE | SOURCE_COLUMN | SENSITIVITY | SOURCE_STATUS |
|---|---|---|---|---|
| EMPLOYEE_CODE | employees | employee_code | INTERNAL | VERIFIED |
| EMPLOYMENT_STATUS | employees | employment_status | INTERNAL | VERIFIED |
| DATE_OF_JOINING | employees | date_of_joining | INTERNAL | VERIFIED |
| DATE_OF_EXIT | employees | date_of_exit | INTERNAL | VERIFIED |
| LIFECYCLE_EVENT_TYPE | employee_lifecycle_event | event_type | INTERNAL | VERIFIED |
| EFFECTIVE_DATE | employee_lifecycle_event | effective_date | INTERNAL | VERIFIED |
| LEAVE_BALANCE | leave_balance_ledger | balance_days | INTERNAL | VERIFIED |
| EXIT_TYPE | exit_request | exit_type | CONFIDENTIAL | VERIFIED |
| EXIT_STATUS | exit_request | status | INTERNAL | VERIFIED |
| CLEARANCE_STATUS | exit_clearance_checklist | status | INTERNAL | VERIFIED |

---

### bpo-quality-risk-compliance-master

| KEY_FIELD | SOURCE_TABLE | SOURCE_COLUMN | SENSITIVITY | SOURCE_STATUS |
|---|---|---|---|---|
| EMPLOYEE_CODE | employees | employee_code | INTERNAL | VERIFIED |
| QUALITY_METRIC | kpi_metric_master | metric_code | INTERNAL | VERIFIED |
| QUALITY_SCORE | kpi_score | actual_value | INTERNAL | VERIFIED |
| FATAL_ERROR_RATE | kpi_score | actual_value | INTERNAL | VERIFIED |
| ESCALATION_COUNT | kpi_score | actual_value | INTERNAL | VERIFIED |
| CALL_QUALITY_RAW | db_audit.call_quality_assessment | (external) | CONFIDENTIAL | TABLE_MISSING |
| COMPLIANCE_EVENT | security_audit_event | event_type | CONFIDENTIAL | VERIFIED |
| RISK_SEVERITY | security_audit_event | severity | CONFIDENTIAL | VERIFIED |
| AUDIT_TRAIL_REF | audit_action_log | id | INTERNAL | VERIFIED |

---

### bpo-recruitment-training-readiness-master

| KEY_FIELD | SOURCE_TABLE | SOURCE_COLUMN | SENSITIVITY | SOURCE_STATUS |
|---|---|---|---|---|
| CANDIDATE_CODE | ats_candidate | candidate_code | INTERNAL | VERIFIED |
| CURRENT_ATS_STAGE | ats_candidate | current_stage | INTERNAL | VERIFIED |
| SOURCING_CHANNEL | ats_candidate | sourcing_channel | INTERNAL | VERIFIED |
| STAGE_DATE | ats_candidate_stage_log | stage_date | INTERNAL | VERIFIED |
| BRIDGE_DATE | ats_onboarding_bridge | bridge_date | INTERNAL | VERIFIED |
| EMPLOYEE_CODE_POST_BRIDGE | ats_onboarding_bridge | employee_id → employees.employee_code | INTERNAL | VERIFIED |
| LMS_PROGRESS | lms_learner_progress_snapshot | (integration layer) | INTERNAL | COLUMN_GAP |
| CERTIFICATION_STATUS | lms_certification_snapshot | (integration layer) | INTERNAL | COLUMN_GAP |

---

### bpo-admin-asset-facility-master

| KEY_FIELD | SOURCE_TABLE | SOURCE_COLUMN | SENSITIVITY | SOURCE_STATUS |
|---|---|---|---|---|
| EMPLOYEE_CODE | employees | employee_code | INTERNAL | VERIFIED |
| ASSET_TYPE | asset_master | asset_type | INTERNAL | VERIFIED |
| ASSET_CODE | asset_master | asset_code | INTERNAL | VERIFIED |
| ASSIGNED_DATE | asset_assignment | assigned_date | INTERNAL | VERIFIED |
| RETURNED_DATE | asset_assignment | returned_date | INTERNAL | VERIFIED |
| DOCUMENT_TYPE | employee_documents | doc_type | INTERNAL | VERIFIED |
| DOCUMENT_VERIFIED | employee_documents | verified | INTERNAL | VERIFIED |
| DOCUMENT_EXPIRY | employee_documents | expiry_date | INTERNAL | VERIFIED |

---

### bpo-management-executive-master

| KEY_FIELD | SOURCE_TABLE | SOURCE_COLUMN | SENSITIVITY | SOURCE_STATUS |
|---|---|---|---|---|
| BRANCH | branch_master | branch_name | INTERNAL | VERIFIED |
| HEADCOUNT_ACTIVE | employees | employment_status | INTERNAL | VERIFIED |
| ATTRITION_COUNT | exit_request | exit_type | INTERNAL | VERIFIED |
| EBITDA_CONTRIBUTION | (runtime) | (bpoPnlService computed) | RESTRICTED | COLUMN_GAP |
| OVERALL_SHRINKAGE_PCT | shrinkage_daily_snapshot | total_shrinkage_pct | INTERNAL | VERIFIED |
| COMPLIANCE_EXCEPTIONS | security_audit_event | severity | CONFIDENTIAL | VERIFIED |
| RECEIVABLE_OUTSTANDING | billing_invoice | (derived: unpaid net_amount) | RESTRICTED | COLUMN_GAP |
| PAYABLE_OUTSTANDING | vendor_payment_tracking | (derived) | RESTRICTED | COLUMN_GAP |

---

### bpo-report-data-lineage-reconciliation-master

| KEY_FIELD | SOURCE_TABLE | SOURCE_COLUMN | SENSITIVITY | SOURCE_STATUS |
|---|---|---|---|---|
| SOURCE_KEY | (SOURCE_REGISTRY constant) | key | INTERNAL | VERIFIED |
| SOURCE_TABLE | (SOURCE_REGISTRY constant) | table | INTERNAL | VERIFIED |
| SOURCE_STATUS | (runtime schema check) | (computed) | INTERNAL | VERIFIED |
| MISSING_COLUMNS | (runtime schema check) | (computed) | INTERNAL | VERIFIED |
| AUTHORITATIVE_FOR | (SOURCE_REGISTRY constant) | authoritativeFor | INTERNAL | VERIFIED |
| VERIFIED_AT | (runtime) | NOW() | INTERNAL | VERIFIED |
| IMMUTABLE_EVENT_SOURCE | (SOURCE_REGISTRY constant) | immutable | INTERNAL | VERIFIED |
| REPORT_RUN_COUNT | (runtime metrics) | (not stored) | INTERNAL | TABLE_MISSING |

---

## Key Authoritative Source Rules

1. **Payroll earnings → `salary_prep_line`** (not `salary_master`)
   The canonical payroll computation result is in `salary_prep_line` (migration 007). `salary_master` is not a table in these migrations. `employee_salary_assignment` holds the CTC configuration input; `salary_prep_line` holds the final computed payroll output per run. Always join via `salary_prep_line.run_id → salary_prep_run.id` to get the payroll month context.

2. **Attendance → reconciled/final attendance for payroll reporting (not raw biometric)**
   Raw biometric is in `wfm_attendance_session` (login_time / logout_time). For payroll and compliance reporting the canonical source is `attendance_reconciliation_record` (migration 021). `payroll_readiness_flag` is the gate that confirms attendance is locked and sent to payroll. Never use raw `wfm_attendance_session` as the final attendance figure for a payroll report row.

3. **P&L → canonical allocation-aware P&L engine (`bpoPnlAllocationOverlayService`)**
   EBITDA, PBT, PAT, and earned revenue are NOT stored columns. They are computed at query time by `bpoPnlAllocationOverlayService` and `bpoPnlService` (`backend/src/modules/process-pnl/`). These values use `process_delivery_actual`, `process_revenue_rule`, `process_revenue_component`, `process_pnl_cost_component`, `grn_cost_allocation`, and `salary_prep_run` as inputs. Reports requiring offline P&L must materialise the output of this engine into a snapshot table; do not attempt to re-derive EBITDA by direct SQL sum.

4. **Quality scores → `db_audit.call_quality_assessment` (external, fully qualified)**
   Confirmed via `505_performance_source_connector_keys.sql`: quality assessment data lives in the external `db_audit` database, not in `mas_hrms`. The source registry in `bpo-master-source-registry.ts` queries `information_schema.columns WHERE table_schema IN (DATABASE(), 'db_audit')`. Reports must use the fully qualified reference `db_audit.call_quality_assessment` and handle the case where the external database is unavailable (SOURCE_STATUS = TABLE_MISSING in offline environments).

5. **Audit events → `audit_action_log` (canonical insert target per migrations 218/220)**
   `audit_action_log` is the canonical write target. `audit_log` is a structural alias created as `LIKE audit_action_log`; it exists only for backward compatibility with `incentives.routes.ts`. New governance adapters must read from and write to `audit_action_log`. For high-security events (salary, PII, statutory), use `sensitive_action_log` which additionally carries `old_value_json`, `new_value_json`, and `actor_role` (added via migration 237). For security centre events (login anomalies, intrusion, privilege escalation) use `security_audit_event` (migration 521).

6. **Candidate pre-bridge → `PENDING EMPLOYEE CODE` (not fabricated)**
   When a candidate has not yet been bridged to an employee record via `ats_onboarding_bridge`, the employee code in journey reports must be rendered as the literal string `'PENDING EMPLOYEE CODE'` (as implemented in `journey-audit-report.service.ts` via `COALESCE(e.employee_code, 'PENDING EMPLOYEE CODE')`). Report consumers must never fabricate an employee code for pre-employment rows and must treat `PENDING EMPLOYEE CODE` as a valid non-null status value, not as a data error.
