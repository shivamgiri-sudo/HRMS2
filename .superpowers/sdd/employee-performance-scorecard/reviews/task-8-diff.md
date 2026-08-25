STAT:
commit 8a418a5d8263d8bb6a9ffe969284e2b8ddf26f83
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 08:08:45 2026 +0530

    feat: seed page_catalog/role_page_access for Performance Scorecard Command Center

 .../1607_performance_scorecard_page_catalog.sql    | 44 ++++++++++++++++++++++
 backend/src/db/runPendingMigrations.ts             |  1 +
 2 files changed, 45 insertions(+)

FULL DIFF:
commit 8a418a5d8263d8bb6a9ffe969284e2b8ddf26f83
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 08:08:45 2026 +0530

    feat: seed page_catalog/role_page_access for Performance Scorecard Command Center

diff --git a/backend/sql/migrations/1607_performance_scorecard_page_catalog.sql b/backend/sql/migrations/1607_performance_scorecard_page_catalog.sql
new file mode 100644
index 00000000..c4bfc78f
--- /dev/null
+++ b/backend/sql/migrations/1607_performance_scorecard_page_catalog.sql
@@ -0,0 +1,44 @@
+-- Task 8 of employee-performance-scorecard plan: page_catalog + role_page_access seed
+-- for PERFORMANCE_SCORECARD_COMMAND_CENTER, consumed by WorkforcePageGate in a later
+-- frontend task.
+--
+-- Schema verified live 2026-08-25 against page_catalog/role_page_access via
+-- `SELECT * FROM page_catalog WHERE page_code = 'PIP_MANAGEMENT'` and the equivalent
+-- role_page_access query:
+--   page_catalog: id CHAR(36) PK DEFAULT (uuid()), page_code VARCHAR(100) UNIQUE NOT NULL,
+--     page_name VARCHAR(255) NOT NULL, page_path VARCHAR(255) NULL, module VARCHAR(100) NULL,
+--     description TEXT NULL, active_status TINYINT(1) NOT NULL DEFAULT 1,
+--     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP (no updated_at column).
+--   role_page_access: id CHAR(36) PK DEFAULT (uuid()), role_key VARCHAR(100) NOT NULL,
+--     page_code VARCHAR(100) NOT NULL, can_view/can_create/can_edit/can_delete/can_export
+--     TINYINT(1) NOT NULL DEFAULT 0, active_status TINYINT(1) NOT NULL DEFAULT 1,
+--     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP (no updated_at column).
+--
+-- Role list is the CURRENT, live PERFORMANCE_SCORECARD.allowedRoleKeys from
+-- backend/src/shared/dashboardAccessRegistry.ts (read fresh 2026-08-25, matches the
+-- brief's corrected list exactly — admin and wfm are deliberately excluded per the
+-- 2026-08-22 incident documented in
+-- backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts).
+--
+-- can_view only (matches the read-only "command center" surface this page gates);
+-- can_create/can_edit/can_delete/can_export left at their table default of 0.
+-- Purely additive, idempotent (WHERE NOT EXISTS guards), no existing table touched.
+
+INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status, created_at)
+SELECT UUID(), 'PERFORMANCE_SCORECARD_COMMAND_CENTER', 'Performance Scorecard Command Center', '/performance-scorecard/command-center', 'performance', 'Employee performance scorecard command center dashboard', 1, NOW()
+WHERE NOT EXISTS (
+  SELECT 1 FROM page_catalog WHERE page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'
+);
+
+INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
+SELECT UUID(), roles.role_key, 'PERFORMANCE_SCORECARD_COMMAND_CENTER', 1, 0, 0, 0, 0, 1, NOW()
+FROM (
+  SELECT 'manager' AS role_key UNION ALL SELECT 'process_manager' UNION ALL SELECT 'assistant_manager'
+  UNION ALL SELECT 'branch_head' UNION ALL SELECT 'branch_manager' UNION ALL SELECT 'team_leader' UNION ALL SELECT 'tl'
+  UNION ALL SELECT 'hr' UNION ALL SELECT 'hr_admin' UNION ALL SELECT 'ho_hr' UNION ALL SELECT 'branch_hr' UNION ALL SELECT 'process_hr'
+  UNION ALL SELECT 'ceo' UNION ALL SELECT 'coo' UNION ALL SELECT 'management' UNION ALL SELECT 'super_admin'
+) roles
+WHERE NOT EXISTS (
+  SELECT 1 FROM role_page_access
+  WHERE role_key = roles.role_key AND page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'
+);
diff --git a/backend/src/db/runPendingMigrations.ts b/backend/src/db/runPendingMigrations.ts
index 197be5da..9f3c2f0c 100644
--- a/backend/src/db/runPendingMigrations.ts
+++ b/backend/src/db/runPendingMigrations.ts
@@ -780,30 +780,31 @@ const MIGRATION_MANIFEST: string[] = [
   "1549_manager_wfm_quality_dashboard_access.sql", // Grants manager role view access to WFM_DASHBOARD and QUALITY_DASHBOARD in role_page_access. Matches dashboardAccessRegistry.ts allowedRoleKeys — both gates must agree. Reactivates an existing QUALITY_DASHBOARD row (active_status=0 from 2026-07-25 RBAC cleanup) and adds the missing WFM_DASHBOARD grant. Purely additive (INSERT ... ON DUPLICATE KEY UPDATE, no schema changes).
   "1550_budget_topup_cost_centre_split.sql", // Group D: extends budget Top-up (1061/1524) with cost-centre splits and brand-new budget-line requests. Makes finance_budget_topup_request.budget_line_id NULLable (a new-line request has no existing line to point at) and adds is_new_line/head/sub_head/unit/unit_rate (all NULL-default; every existing row gets is_new_line=0 and stays exactly as it reads today). New table finance_budget_topup_request_split (topup_request_id, cost_centre_id, amount, quantity) mirrors finance_budget_line_allocation's own convention (no FK to cost_centre_master). Purely additive/nullability-relaxing, information_schema-guarded ALTERs + CREATE TABLE IF NOT EXISTS, matching 1524's pattern exactly.
   "1551_payroll_branch_readiness_leave_regularization.sql", // Adds leave_finalized/leave_finalized_at/leave_finalized_by and regularization_complete/regularization_complete_at/regularization_complete_by to payroll_branch_readiness. payroll-branch-readiness.service.ts has referenced these in its scoring and UPSERT since the columns were added to its CREATE TABLE DDL, but the table pre-existed (migration 400) so they were never created. Without them every UPSERT silently drops these two readiness signals and the scoring logic evaluating them always reads 0. information_schema-guarded, purely additive.
   "1552_employee_salary_assignment_updated_at.sql", // Adds employee_salary_assignment.updated_at DATETIME NULL. payroll-head-review.service.ts sets updated_at = NOW() on every salary-package confirmation but the column was never created; the UPDATE caught the ER_BAD_FIELD_ERROR and logged a warning on every call. information_schema-guarded, nullable (existing rows read NULL), purely additive.
   "1553_salary_prep_line_component_notes.sql", // Adds salary_prep_line_component.notes TEXT NULL. salary-dispute.service.ts inserts a notes value when creating arrear adjustment lines for resolved disputes; the INSERT has always failed with ER_BAD_FIELD_ERROR, meaning no dispute arrear has ever been written to salary_prep_line_component. information_schema-guarded, TEXT NULL, no existing row touched, purely additive.
   "1554_workforce_mandate_alert_threshold.sql", // Adds alert_threshold_pct DECIMAL(5,2) DEFAULT 80.00 to workforce_mandate. Required by hc-gap-alert.cron.ts daily job — fires when coverage_pct drops below this threshold. ADD COLUMN IF NOT EXISTS, backward-compatible; existing rows default to 80%.
   "1555_attrition_record_inference_columns.sql", // Adds inferred_reason VARCHAR(50), inference_confidence ENUM('HIGH','MEDIUM','LOW'), inference_signals JSON to attrition_record. Required by attrition-reason-inference.service.ts to persist inference results. All columns NULL-default, ADD COLUMN IF NOT EXISTS, purely additive.
   "1556_employee_retention_recommendation.sql", // Creates employee_retention_recommendation: stores rule-based retention action recommendations generated by intervention-recommendation.service.ts per employee. Tracks risk_tier, prediction_score, recommendations JSON, action_taken, outcome. CREATE TABLE IF NOT EXISTS, InnoDB utf8mb4, purely additive.
   "migrations/1558_helpdesk_ticket_raised_by.sql", // Adds helpdesk_ticket.raised_by_user_id + resolved_by_user_id (both CHAR(36) NULL, no FK, matching assigned_to on the same table) and idx_helpdesk_ticket_raised_by. The maker/checker pair for the separation-of-duties guard added to POST /tickets/:id/resolve in the same commit: helpdesk had no occurrence of "maker" or "checker" anywhere, so one holder of one HELPDESK_ADMIN_ROLES role could raise a ticket on behalf of an employee, self-assign it via /take and resolve it, with the acting user surviving only in sensitive_action_log's change_summary JSON — telemetry that writeSensitiveActionLog is explicitly allowed to drop. No backfill: helpdesk_ticket holds 4 rows, all INSERTed in the same second on 2026-06-01 (seed data), and module_key='HELPDESK' in sensitive_action_log has only TICKET_ASSIGNED (3) and TICKET_ESCALATED (1) — TICKET_CREATED/TICKET_RESOLVED/TICKET_TAKEN have never been written, so no ticket has ever gone through this API. Those 4 rows keep raised_by_user_id NULL and the guard treats NULL as "raiser unknown" and lets the resolve through rather than inventing a failure on rows that predate the column. information_schema-guarded PREPARE/EXECUTE, not ADD COLUMN IF NOT EXISTS (unsupported on MySQL 8; this repo has recorded migrations applied while their DDL did nothing — see 1304/1305). Collation stated explicitly: helpdesk_ticket and auth_user are both utf8mb4_unicode_ci, verified live 2026-08-24. Additive and idempotent; registered but NOT applied by hand — applies at the next backend restart like every other manifest entry.
   "1557_branch_sal_code_from_db_bill.sql", // Adds sal_branch_code VARCHAR(30) NULL to branch_master (salary/establishment code from db_bill Sal_Branch_Code). Backfills sal_branch_code, address, and company_name for all 24 db_bill branches, matched by branch_code. All UPDATEs idempotent (only sets where NULL). Source: db_bill.branch_master verified 2026-08-24.
   "migrations/1601_bank_penny_drop_verification_token.sql", // Adds verification_token (UNIQUE VARCHAR 64), verification_token_expires_at, employee_name_at_request, name_match_tier, name_match_score to bank_penny_drop_log. Supports the employee bank-change penny drop email flow: a secure one-time token is emailed to Payroll Branch on submission; clicking the link triggers a live Luckpay penny drop and classifyNameMatch() comparison; results stored here and surfaced in the Payroll HO approval queue. Extends penny_drop_status ENUM with 'name_mismatch'. All column additions are information_schema-guarded. Additive only — no existing rows or values changed.
   "migrations/1602_payroll_loans_rbac_restore.sql", // Reactivates role_page_access rows for page_code='PAYROLL_LOANS': payroll_head and hr were active_status=0 (revoked), admin and finance_head had no row at all — leaving Loan Management's approval queue reachable only by super_admin in practice, out of sync with the frontend's own canApproveLoans gate. UPDATE + INSERT...WHERE NOT EXISTS, idempotent. Applied against production 2026-08-25 with explicit user approval as part of the payroll audit fix plan (Batch 3 Phase 1, Track 2); registered here so it also applies cleanly on any other environment.
   "migrations/1603_loan_negative_pending_cleanup.sql", // Clamps employee_loans.pending_amount to 0 for the 11 rows that were negative — legacy-import artifacts the app's own record-payment handler could never produce (it already clamps at Math.max(0, pending - paid)). Idempotent (WHERE pending_amount < 0 matches nothing once applied). Run via scripts/loan-negative-pending-cleanup.ts --apply, not this raw UPDATE directly, so a logSensitiveAction row is written per loan first — 11 rows confirmed in sensitive_action_log (action_type 'loan_negative_pending_cleanup'). Applied against production 2026-08-25 with explicit user approval, same fix plan as 1602.
   "migrations/1604_employee_performance_daily_snapshot.sql", // Foundation table for the Employee Performance Scorecard feature (Task 1 of that plan) — creates employee_performance_daily_snapshot (employee_id/snapshot_date grain, attendance/late/leave/PIP/quality/template_metrics/team attrition-shrinkage-revenue columns). Nothing in the codebase reads or writes this table yet; later tasks in the same plan populate and consume it. employee_id VARCHAR(36) COLLATE utf8mb4_unicode_ci matches employees.id (char(36) COLLATE utf8mb4_unicode_ci, verified live via SHOW CREATE TABLE employees 2026-08-25) with an FK to employees(id). Task brief specified migration number 1558 assuming 1557 was the highest existing entry; live manifest already had 1558-1603 registered by other concurrent sessions, so this was numbered 1604 (next free number) instead, and filed under sql/migrations/ (the subfolder every entry from 1558 onward actually uses) rather than the brief's literal sql/ root path. Purely additive, CREATE TABLE IF NOT EXISTS, no existing table touched.
   "migrations/1605_deactivate_dangling_payroll_disbursal_grant.sql", // Deactivates the 2 remaining active role_page_access rows for page_code='PAYROLL_DISBURSAL' (finance_head, super_admin — finance and payroll_head were already inactive). The page this code once gated, src/pages/payroll/DisbursalManagement.tsx, was deleted as confirmed dead code in the same change: unrouted since PaymentDisbursalCenter.tsx absorbed its functionality on 2026-08-23, and /payroll/disbursal has redirected to /payroll/payment-center?tab=disbursal (gated on PAYROLL_BANK_READINESS instead) ever since. Soft-deactivate, not delete, matching this table's existing convention. Idempotent. Batch 3 Phase 4 of the payroll audit fix plan; applied against production 2026-08-25 with explicit user approval. Numbered 1605 (not 1604 — a concurrent session took that number between this file being written and the manifest being regenerated).
+  "migrations/1607_performance_scorecard_page_catalog.sql", // Task 8 of the employee-performance-scorecard plan: registers PERFORMANCE_SCORECARD_COMMAND_CENTER in page_catalog and seeds its role_page_access grants (can_view only) for the 16 roles in PERFORMANCE_SCORECARD.allowedRoleKeys (backend/src/shared/dashboardAccessRegistry.ts, read live 2026-08-25) — manager, process_manager, assistant_manager, branch_head, branch_manager, team_leader, tl, hr, hr_admin, ho_hr, branch_hr, process_hr, ceo, coo, management, super_admin. admin and wfm deliberately excluded per the 2026-08-22 incident in backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts. Consumed by WorkforcePageGate in a later frontend task in the same plan. Numbered 1607 (1606 was already taken on disk by a concurrent session's normalize_component_names migration, not yet registered in this manifest at the time of writing). Purely additive, WHERE NOT EXISTS idempotent, no existing table touched.
   ];
 
 export type MigrationHealth = {
   status: "not_started" | "running" | "ok" | "failed";
   applied: string[];
   skipped: string[];
   failed: Array<{ filename: string; error: string }>;
   startedAt: string | null;
   completedAt: string | null;
 };
 
 let migrationHealth: MigrationHealth = {
   status: "not_started",
   applied: [],
   skipped: [],
