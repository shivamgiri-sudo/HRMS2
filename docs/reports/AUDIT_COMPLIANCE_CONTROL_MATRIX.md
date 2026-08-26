# BPO Audit, Compliance and Control Matrix

_Verified 2026-07-26 against migrations and bpo-master-governance-safe-adapters.ts._

## Purpose

Documents every compliance control evaluated in the `bpo-audit-compliance-control-master` report,
its source evidence, the logic used to determine the result, and any remaining gaps.

## Control Result Legend

- PASS: Evidence available and policy met
- FAIL: Evidence available and policy violated
- WARNING: Evidence available, potential issue requiring review
- NOT EVIDENCED: Source table or column missing — cannot evaluate
- NOT APPLICABLE: Does not apply to this entity or period

---

## Adapter Coverage Summary

The governance adapter in `backend/src/modules/reporting/bpo-master-governance-safe-adapters.ts`
queries the following source tables at runtime via `sourceTableSql()` + `sourceColumns()`:

| SOURCE TABLE | VERIFICATION STATUS | NOTES |
|---|---|---|
| `audit_action_log` | VERIFIED — primary insert target | Created by migrations 218/220 as `CREATE TABLE IF NOT EXISTS audit_action_log`. `audit_log` is a structural alias created as `LIKE audit_action_log`; new code reads `audit_action_log` as primary. |
| `sensitive_action_log` | VERIFIED — queried in adapter line 125 | Existence confirmed in migration scan. |
| `approval_action_log` | VERIFIED — queried in adapter line 154 | Created in `015_platform_foundation.sql` line 120. |
| `approval_request` | VERIFIED — queried in adapter line 156 | Created in `015_platform_foundation.sql` line 102. |
| `approval_workflow_master` | VERIFIED — queried in adapter line 158 | Created in `015_platform_foundation.sql` line 77. |

All five tables are guarded: the adapter performs runtime existence and column checks before
emitting SQL. If a table is absent or columns differ, the relevant event builder is silently
skipped and the UNION returns only the evidenced sources.

---

## Fields Coverage Table

52 required audit output fields mapped from `auditReport()` SQL (lines 237–268 of the adapter).

| FIELD | SOURCE TABLE | SOURCE_COLUMN | STATUS | NOTES |
|---|---|---|---|---|
| EVENT_ID | audit_action_log / sensitive_action_log / approval_action_log | id | POPULATED | Each UNION branch projects its primary key as `event_id`. |
| ACTIVITY_DATE_TIME | audit_action_log | created_at | POPULATED | Formatted via `timestampSql()`. |
| AUDIT_CATEGORY | literal / source branch | — | POPULATED | `'GENERAL AUDIT'`, `'SENSITIVE AUDIT'`, or `'APPROVAL WORKFLOW'` per branch. |
| CONTROL_DOMAIN | audit_action_log | module_key | POPULATED | Falls back to `'APPROVAL'` for approval branch. |
| MODULE | audit_action_log | module_key | POPULATED | Same mapping as CONTROL_DOMAIN. |
| ACTION_TYPE | audit_action_log | action_type | POPULATED | Each branch has `action_type` column guard. |
| ACTION_STATUS | audit_action_log | action_status / status | POPULATED | General/sensitive: literal `'RECORDED'`; approval: `r.status`. |
| ENTITY_TYPE | audit_action_log | entity_type | CONDITIONALLY POPULATED | Projected only if column exists at runtime; otherwise NULL. |
| ENTITY_ID | audit_action_log | entity_id | CONDITIONALLY POPULATED | Same guard as ENTITY_TYPE. |
| SOURCE_SCHEMA | literal | — | POPULATED | Always `'mas_hrms'`. |
| SOURCE_TABLE | literal | — | POPULATED | Hardcoded per UNION branch to the actual source table name. |
| SOURCE_RECORD_ID | audit_action_log | id | POPULATED | Each branch maps its own PK. |
| REQUEST_ID | audit_action_log | request_id | CONDITIONALLY POPULATED | Column-guarded in general/sensitive; always populated for approval branch. |
| ACTOR_USER_ID | audit_action_log | actor_user_id | CONDITIONALLY POPULATED | Column-guarded in all branches. |
| ACTOR_EMPLOYEE_CODE | employees | employee_code | CONDITIONALLY POPULATED | Derived via JOIN to employees on user_id or id; NULL if employees table absent. |
| ACTOR_NAME | employees | full_name / first_name + last_name | CONDITIONALLY POPULATED | Derived via JOIN; uses full_name if column present, else concatenation. |
| ACTOR_ROLE | audit_action_log / sensitive_action_log | actor_role | CONDITIONALLY POPULATED | Coalesced to `'UNKNOWN'` if missing. |
| ACTOR_BRANCH | branch_master | branch_name | CONDITIONALLY POPULATED | Derived via JOIN to branch_master; NULL if table absent. |
| ACTOR_PROCESS | process_master | process_name | CONDITIONALLY POPULATED | Derived via JOIN to process_master; NULL if table absent. |
| SUBJECT_EMPLOYEE_CODE | employees | employee_code | CONDITIONALLY POPULATED | Via JOIN on subject employee_id. |
| SUBJECT_EMPLOYEE_NAME | employees | full_name / first_name + last_name | CONDITIONALLY POPULATED | Via JOIN; same logic as ACTOR_NAME. |
| SUBJECT_CANDIDATE_ID | audit_action_log | candidate_id | CONDITIONALLY POPULATED | Column-guarded. |
| OLD_VALUE | sensitive_action_log | old_value_json | CONDITIONALLY POPULATED | Only in sensitive branch; column-guarded. |
| NEW_VALUE | sensitive_action_log | new_value_json | CONDITIONALLY POPULATED | Only in sensitive branch; column-guarded. |
| CHANGE_SUMMARY | audit_action_log | metadata_json (cast) | CONDITIONALLY POPULATED | Column-guarded; cast to CHAR. |
| REASON | sensitive_action_log | reason | CONDITIONALLY POPULATED | Only in sensitive branch; column-guarded. |
| REMARKS | approval_action_log | remarks | CONDITIONALLY POPULATED | Only in approval branch; column-guarded. |
| APPROVAL_WORKFLOW | approval_workflow_master | workflow_name | CONDITIONALLY POPULATED | Falls back to module_key if workflow table absent. |
| APPROVAL_STEP | approval_action_log | step_order | CONDITIONALLY POPULATED | Column-guarded; cast to CHAR. |
| APPROVAL_DECISION | approval_action_log | action | CONDITIONALLY POPULATED | Column-guarded. |
| APPROVAL_DUE_DATE | — | — | NULL | Not available in current schema — always NULL. Gap exists. |
| APPROVAL_COMPLETED_DATE | audit_action_log | created_at | DERIVED | Formatted as date from activity_ts. Note: this is event date, not formal completion date. |
| SLA_STATUS | derived | — | DERIVED | `'RECORDED'` when approval_decision IS NOT NULL; otherwise NULL. Not a computed SLA breach flag. |
| POLICY_CODE | audit_action_log | metadata_json → $.policy_code | CONDITIONALLY POPULATED | JSON path extraction via `safeJsonText()`. |
| POLICY_VERSION | audit_action_log | metadata_json → $.policy_version | CONDITIONALLY POPULATED | JSON path extraction. |
| STATUTORY_AREA | audit_action_log | metadata_json → $.statutory_area | CONDITIONALLY POPULATED | JSON path extraction. |
| DPDP_PURPOSE | audit_action_log | metadata_json → $.purpose | CONDITIONALLY POPULATED | JSON path extraction. |
| CONSENT_STATUS | audit_action_log | metadata_json → $.consent_status | CONDITIONALLY POPULATED | JSON path extraction. |
| DATA_CLASSIFICATION | audit_action_log | metadata_json → $.data_classification | CONDITIONALLY POPULATED | JSON path extraction. |
| RISK_LEVEL | audit_action_log | metadata_json → $.risk_level | CONDITIONALLY POPULATED | Coalesced to `'UNASSESSED'` when absent. |
| CONTROL_RESULT | audit_action_log | metadata_json → $.control_result | CONDITIONALLY POPULATED | Coalesced to action_status when absent. Values must be one of: PASS / FAIL / WARNING / NOT EVIDENCED / NOT APPLICABLE. |
| EXCEPTION_FLAG | audit_action_log | metadata_json → $.exception | DERIVED | `'YES'` if JSON_EXTRACT not null; `'NO'` otherwise. |
| EXCEPTION_TYPE | audit_action_log | metadata_json → $.exception_type | CONDITIONALLY POPULATED | JSON path extraction. |
| FINANCIAL_IMPACT | audit_action_log | metadata_json → $.financial_impact | CONDITIONALLY POPULATED | JSON path extraction. |
| CUSTOMER_IMPACT_FLAG | audit_action_log | metadata_json → $.customer_impact | CONDITIONALLY POPULATED | JSON path extraction. |
| PRIVACY_IMPACT_FLAG | audit_action_log | metadata_json → $.privacy_impact | CONDITIONALLY POPULATED | JSON path extraction. |
| EVIDENCE_REFERENCE | audit_action_log | request_id (fallback: id) | POPULATED | Each branch maps to request_id if available, else primary key. |
| EVIDENCE_STATUS | derived | — | DERIVED | `'LINKED'` when evidence_reference IS NOT NULL; `'NOT LINKED'` otherwise. |
| CORRECTIVE_ACTION | audit_action_log | metadata_json → $.corrective_action | CONDITIONALLY POPULATED | JSON path extraction. |
| PREVENTIVE_ACTION | audit_action_log | metadata_json → $.preventive_action | CONDITIONALLY POPULATED | JSON path extraction. |
| ACTION_OWNER | audit_action_log | metadata_json → $.action_owner | CONDITIONALLY POPULATED | JSON path extraction. |
| ACTION_DUE_DATE | audit_action_log | metadata_json → $.action_due_date | CONDITIONALLY POPULATED | JSON path with `dateSql()` formatting. |
| ACTION_CLOSED_DATE | audit_action_log | metadata_json → $.action_closed_date | CONDITIONALLY POPULATED | JSON path with `dateSql()` formatting. |
| VERIFIED_BY | audit_action_log | metadata_json → $.verified_by | CONDITIONALLY POPULATED | JSON path extraction. |
| VERIFICATION_STATUS | audit_action_log | metadata_json → $.verification_status | CONDITIONALLY POPULATED | JSON path extraction. |
| RECURRENCE_FLAG | audit_action_log | metadata_json → $.recurrence_flag | CONDITIONALLY POPULATED | JSON path extraction. |

**Summary:** 10 fields are always populated or have hardcoded fallbacks. 35 fields are conditionally
populated (column-guarded or JSON-path-dependent). 2 fields (APPROVAL_DUE_DATE, SLA_STATUS) have
structural gaps — APPROVAL_DUE_DATE is always NULL; SLA_STATUS is a presence flag, not a computed
breach indicator. The 5 SUBJECT_CANDIDATE_* and IP/USER_AGENT fields not in the 52-field spec above
are present as bonus columns in the output.

---

## Control Evaluation Table

27 controls evaluated. Source availability is determined by inspection of `backend/sql/` migration
files. Where the source table is absent from the migration set, the control is NOT EVIDENCED.

| # | CONTROL | SOURCE TABLE(S) | EVIDENCE AVAILABLE | RESULT LOGIC | REMAINING GAP |
|---|---|---|---|---|---|
| 1 | MAKER-CHECKER | `approval_action_log` JOIN `approval_request` | YES — both tables exist (015_platform_foundation.sql) | Rows where `approval_action_log.actor_user_id` ≠ `approval_request.requester_id` confirm maker-checker separation. If actor = requester, raises self-approval (see control 2). | `approval_request.requester_id` column not verified in current migration — requester identity may differ by column name. |
| 2 | SELF-APPROVAL | `approval_action_log` JOIN `approval_request` | YES — same tables as above | Rows where `approval_action_log.actor_user_id` = `approval_request.requester_id` AND `action` IN ('approved','APPROVED'). Control result: FAIL when self-approval detected. | Requester column name in `approval_request` requires runtime verification. |
| 3 | SEGREGATION OF DUTIES | `user_roles` (003_access_control.sql) | PARTIAL — `user_roles` exists; no `user_role_assignment` table found in migrations | Conflicting role combinations per user should be evaluated. `user_roles` table exists but no dedicated `user_role_assignment` table was found. SOD matrix rules not persisted in schema. | `user_role_assignment` table absent — NOT EVIDENCED for full SOD evaluation. |
| 4 | OVERDUE APPROVAL | `approval_request` | YES — table exists | Rows where `due_date < NOW()` AND `status` IN ('pending','submitted','in_review'). Control result: FAIL when overdue. | `approval_request.due_date` column existence must be verified at runtime by the adapter's column guard. |
| 5 | MISSING APPROVER | `approval_request` | YES — table exists | Rows where `approver_id IS NULL` AND `status` NOT IN ('cancelled','rejected'). Control result: WARNING. | `approver_id` column existence in `approval_request` requires runtime verification. |
| 6 | MISSING REASON | `exit_request`, `attendance_regularization`, `leave_request` | YES — all three tables exist in migrations | `exit_request.resignation_reason IS NULL` (011_exit_management.sql line 47); `attendance_regularization.reason IS NULL` (005_attendance_wfm.sql line 133, column is NOT NULL so cannot be null in practice); `leave_request.reason IS NULL` (006_leave.sql line 49, column is TEXT nullable). Control result: WARNING when reason column null or empty. | `attendance_regularization.reason` is NOT NULL — this control cannot fire for that table unless an override was applied. |
| 7 | UNAUTHORISED CROSS-BRANCH ACCESS | `sensitive_action_log` | YES — adapter already queries this table | Rows where actor's resolved `branch_id` ≠ target entity's branch. Control result: FAIL when mismatch detected and action type is sensitive. | Cross-branch target branch is not a direct column in `sensitive_action_log`; requires JOIN logic not currently in the adapter's UNION. |
| 8 | SENSITIVE DATA VIEW | `sensitive_action_log` | YES — table queried in adapter | Rows where `action_type = 'VIEW'` (or equivalent). Control result: WARNING — logs existence of sensitive view actions for review. | Controlled by `audit_category = 'SENSITIVE AUDIT'` in output. Standard audit evidence, not a policy violation indicator. |
| 9 | SENSITIVE DATA EXPORT | `sensitive_action_log` | YES — table queried in adapter | Rows where `action_type = 'EXPORT'` (or equivalent). Control result: WARNING — each export event is raised for review. | Same note as control 8. |
| 10 | ROLE ESCALATION | `user_role_assignment_log` | NO — no `user_role_assignment_log` table found in any migration | NOT EVIDENCED — source table absent from schema. Cannot evaluate role escalation events. | Requires a dedicated role change audit log table. |
| 11 | INACTIVE USER ACTION | `employees` + `audit_action_log` | PARTIAL — both tables exist | Rows from `audit_action_log` where `actor_user_id` maps to an `employees` record with `employment_status` = inactive/exited. Control result: FAIL when inactive actor performed a recorded action. | The adapter JOINs employees to resolve actor details; employment_status must be projected and filtered outside the current UNION adapter. |
| 12 | DPDP CONSENT | `dpdp_consent_register` (272_hrms2_joining_control_room_document_viewer.sql) | YES — table exists with `consent_status` ENUM | Rows where `consent_status NOT IN ('granted')` for required purposes. Control result: WARNING when consent not granted for active processing. | `dpdp_consent_register` is candidate-scoped; employee-scoped DPDP consent table not found separately. |
| 13 | DATA DELETION / WITHDRAWAL | `dpdp_consent_withdrawal` (272 / 293 migrations), `dpdp_withdrawal_audit_log` | YES — tables exist | Rows from `dpdp_consent_withdrawal` where `status` = 'requested' or 'approved'; checks whether hold was applied via `dpdp_processing_hold`. Control result: WARNING when approved withdrawal has no corresponding hold record. | Two overlapping versions of `dpdp_consent_withdrawal` exist (migrations 272 and 293 have differing schemas). Runtime adapter must verify column set. |
| 14 | PAYROLL LOCK | `salary_prep_run` (007_payroll.sql + 405_payroll_integrity_constraints.sql migration) | YES — table exists with status column | Rows from `audit_action_log` on module_key = 'payroll' where the corresponding `salary_prep_run.status` ≠ 'locked'. Control result: FAIL when a payroll mutation event is recorded against an unlocked run. | `salary_prep_run.status` ENUM includes 'locked' per migration 405_payroll_integrity_constraints.sql. |
| 15 | ATTENDANCE OVERRIDE | `attendance_regularization` (005_attendance_wfm.sql) | YES — table exists | All rows in `attendance_regularization` represent manual overrides. Control result: WARNING for each override event, requiring supervisor review. | `attendance_regularization.reason` is NOT NULL — reason field is always present; no missing-reason gap for this table. |
| 16 | LEAVE REVERSAL | `leave_request` (006_leave.sql) | YES — table exists | Rows where `leave_request.status` transitions from an approved state back to pending/cancelled (requires audit trail in `audit_action_log` with module_key = 'leave' and action referencing reversal). Control result: WARNING for each reversal event. | Direct status-transition log not in `leave_request` itself; depends on `audit_action_log` capturing the status change. |
| 17 | BGV EXCEPTION | `ats_bgv_record` (017_ats_wfm_completion.sql), `candidate_bgv_check` (203_bgv_missing_tables.sql), `candidate_bgv_exception` (320_bgv_missing_tables.sql) | PARTIAL — multiple BGV tables exist but no single `bgv_exception` table | `candidate_bgv_exception` exists (320_bgv_missing_tables.sql). Control result: WARNING for each exception row. | BGV tables are fragmented across multiple migrations (017, 138, 200, 203, 240, 241, 320). No unified BGV exception surface. |
| 18 | FATAL QUALITY ERROR | `call_quality_assessment` in schema `db_audit` | NOT EVIDENCED IN mas_hrms — configured as external source connector (505_performance_source_connector_keys.sql) | `call_quality_assessment` is in `db_audit` (external upstream schema), not `mas_hrms`. The source connector key exists but the table is read-only upstream. Cannot evaluate `is_fatal` without confirmed column structure of upstream table. | NOT EVIDENCED — source is an upstream read-only system. Control cannot fire unless a sync copy exists in `mas_hrms`. |
| 19 | CLIENT COMPLIANCE BREACH | `client_escalation` | NOT EVIDENCED — no `client_escalation` table found in any migration in `backend/sql/` | NOT EVIDENCED — source table absent from schema. | Requires a `client_escalation` table to be created in `mas_hrms`. |
| 20 | ASSET NOT RECOVERED | `asset_assignment` (016_employee_lifecycle.sql) + `exit_clearance_checklist` (011_exit_management.sql) | YES — both tables exist | Rows from `asset_assignment` where `returned_date IS NULL` AND the associated employee has a confirmed exit in `exit_clearance_checklist`. Control result: FAIL for each unrecovered asset post-exit. | `asset_assignment` column name `returned_date` must be confirmed at runtime. |
| 21 | ACCESS NOT DEPROVISIONED | No IT provisioning / deprovisioning tables found in schema | NOT EVIDENCED — no IT access tables exist in `mas_hrms` migrations | NOT EVIDENCED — source table absent from schema. | Requires integration with an IT provisioning system or a deprovision log table in `mas_hrms`. |
| 22 | EXIT CLEARANCE INCOMPLETE | `exit_clearance_task` (sql/1506_exit_clearance_task_missing_migration.sql) | YES — table exists with `status ENUM('pending','in_progress','cleared','blocked','waived')` | Rows where any department entry in `exit_clearance_task` has `status NOT IN ('cleared','waived')` for an employee whose exit is confirmed. Control result: FAIL when clearance incomplete at exit date. | **Corrected 2026-08-26.** Was documented against `exit_clearance_checklist`, which holds 0 live rows and was abandoned; every code path moved to `exit_clearance_task` on 2026-08-19. As previously written this control could only ever return zero FAILs. `waived` counts as closed (deliberate excusal) — this matches the F&F approval guard, the control that actually withholds money. Alerting is now live via the 3:00 AM last-working-day scan (exit-lwd-scan.service.ts). |
| 23 | PAYMENT DUPLICATE REFERENCE | `vendor_payment_transaction` (413_vendor_payment_transaction_ledger.sql) | YES — table exists | Rows with duplicate `reference_number` (or equivalent unique key) within the same period. Control result: FAIL for each duplicate detected. | `vendor_payment_transaction` column names require runtime verification. No equivalent `payment_transaction` (non-vendor) table found. |
| 24 | VENDOR BANK CHANGE | `vendor_bank_detail_log` | NOT EVIDENCED — no `vendor_bank_detail_log` table found in any migration | NOT EVIDENCED — source table absent from schema. | A vendor bank detail audit log table would be required to detect bank account changes. |
| 25 | DOCUMENT RETENTION | `document_retention_policy` (531_document_vault_security_hardening.sql) | YES — table exists | Rows where documents have exceeded their `retention_period` without archival/deletion. Control result: WARNING when retention period exceeded. | `document_retention_policy` structure and column names require runtime verification. |
| 26 | LEGAL HOLD | `document_legal_hold` (531_document_vault_security_hardening.sql) | YES — table exists (as `document_legal_hold`, not bare `legal_hold`) | Rows in `document_legal_hold` indicating active holds. Control result: WARNING for each active hold requiring review. | Table is `document_legal_hold`, not `legal_hold` — control source reference must use correct name. |
| 27 | GRN APPROVAL | `grn_request` (310_vendor_payment_tracking.sql) + `approval_action_log` | PARTIAL — `grn_request` exists; no direct `grn_header` table found (schema uses `grn_request`) | Rows from `grn_request` where `status` != 'approved' but procurement threshold exceeded; cross-reference with `approval_action_log` for approval events. Control result: FAIL when GRN above threshold lacks approval record. | No `grn_header` table — the actual table is `grn_request`. Approval linkage via `approval_action_log` requires `module_key = 'grn'` events to be present. |

---

## Controls NOT EVIDENCED Summary

The following 5 controls cannot be evaluated due to missing source tables:

| CONTROL | MISSING TABLE | ACTION REQUIRED |
|---|---|---|
| ROLE ESCALATION (10) | `user_role_assignment_log` | Create role change audit log table |
| FATAL QUALITY ERROR (18) | `call_quality_assessment` (in `db_audit`, not `mas_hrms`) | Create sync copy in `mas_hrms` from upstream connector |
| CLIENT COMPLIANCE BREACH (19) | `client_escalation` | Create `client_escalation` table in `mas_hrms` |
| ACCESS NOT DEPROVISIONED (21) | No IT provisioning table | Build IT access deprovision log or integration |
| VENDOR BANK CHANGE (24) | `vendor_bank_detail_log` | Create audit log for vendor bank detail changes |

---

## Remaining Gaps Summary

| GAP | IMPACT |
|---|---|
| `APPROVAL_DUE_DATE` always NULL | SLA breach detection for overdue approvals unavailable |
| `SLA_STATUS` is presence flag only | Cannot compute actual SLA breach duration or thresholds |
| SOD matrix not persisted in schema | Segregation of duties control (3) partially evidenced only |
| BGV tables fragmented across 7 migrations | No unified BGV exception surface for control 17 |
| `dpdp_consent_withdrawal` defined in two migrations with differing schemas | Runtime column mismatch risk for control 13 |
| GRN table is `grn_request`, not `grn_header` | Control 27 documentation must use correct table name |
| `call_quality_assessment` is upstream read-only | Fatal quality error control (18) requires a sync table in `mas_hrms` |
