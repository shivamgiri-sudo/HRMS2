=== COMMIT LIST (plan-relevant files, d886f228..HEAD) ===
d85fd936 fix(payroll): resolve 3 dead-end approval/coverage gaps
a732b921 fix(performance-scorecard): correct dashboardAccessRegistry pageCode mismatch
e160679a feat: add multi-metric compare panel to performance scorecard
60a01cec fix: revert migration 1607 to real page_code/page_name columns (concurrent commit 989a1334 introduced non-existent page_key/page_label)
23bb784e feat: add Performance Command Center page for HR/Ops/CEO
079648ae chore: remove dead code orphaned by PerformanceScorecardTable wiring (riskLabel, ScoreBar, unused icons)
b620e924 feat: wire PerformanceScorecardTable into TeamPerformanceTab
22b92a90 feat: add shared PerformanceScorecardTable component
989a1334 fix(migration): create 1607_performance_scorecard_page_catalog.sql
8a418a5d feat: seed page_catalog/role_page_access for Performance Scorecard Command Center
0fc58a08 test: clarify empty-scorecard test doesn't exercise the (unreachable) employeeIds=[] branch
0b677867 fix: fail closed (403) when team scope cannot be resolved in performance scorecard route
ae7341bb feat: add RBAC-scoped GET /api/performance-scorecard route
b18cba8e fix: scope PERFORMANCE_SCORECARD dashboard access to manager/HR/CEO roles only
417be541 feat: register PERFORMANCE_SCORECARD dashboard metrics
118957e8 feat: add performance scorecard drilldown handlers
20420325 feat: add performance scorecard snapshot backfill script
5d6d1a42 feat: register nightly employee performance snapshot scheduler
07797463 fix: isolate per-employee failures in performance snapshot batch write
26fbc5fb feat: add employee performance snapshot aggregation service
2749825a fix(payroll): disbursal completion path, false-green signals, dead-page cleanup
65675a84 feat: add employee_performance_daily_snapshot table (migration 1604)

=== STAT ===
 .../backfill-performance-scorecard-snapshot.ts     |  32 +++
 .../1604_employee_performance_daily_snapshot.sql   |  24 +++
 .../1607_performance_scorecard_page_catalog.sql    |  50 +++++
 backend/src/db/runPendingMigrations.ts             |   4 +
 .../__tests__/dashboard-access-registry.test.ts    |  16 +-
 .../performance-scorecard-drilldown.test.ts        |  47 +++++
 .../dashboards/dashboard-definition.service.ts     |  32 ++-
 .../dashboards/dashboard-drilldown.service.ts      |  20 ++
 .../dashboards/performance-scorecard-drilldown.ts  | 226 +++++++++++++++++++++
 .../performance-scorecard-snapshot.service.test.ts |  53 +++++
 .../__tests__/performance-scorecard.routes.test.ts | 131 ++++++++++++
 .../performance-scorecard-snapshot.cron.ts         |  58 ++++++
 .../performance-scorecard-snapshot.service.ts      | 133 ++++++++++++
 .../performance-scorecard.routes.ts                | 103 ++++++++++
 .../performance-scorecard.types.ts                 |  14 ++
 backend/src/server.ts                              |   2 +
 backend/src/shared/dashboardAccessRegistry.ts      |  14 +-
 backend/src/workers/all-workers.ts                 |   9 +
 src/components/layout/navConfig.tsx                |   3 +-
 src/components/my-team/TeamPerformanceTab.tsx      |  96 ++-------
 .../PerformanceCompareModal.tsx                    |  74 +++++++
 .../PerformanceScorecardTable.tsx                  | 135 ++++++++++++
 .../performanceScorecardColumns.ts                 |  37 ++++
 src/config/routes/performance.routes.tsx           |   4 +
 src/pages/PerformanceCommandCenter.tsx             |  29 +++
 25 files changed, 1257 insertions(+), 89 deletions(-)

=== FULL DIFF ===
diff --git a/backend/scripts/backfill-performance-scorecard-snapshot.ts b/backend/scripts/backfill-performance-scorecard-snapshot.ts
new file mode 100644
index 00000000..4c9ab544
--- /dev/null
+++ b/backend/scripts/backfill-performance-scorecard-snapshot.ts
@@ -0,0 +1,32 @@
+// backend/scripts/backfill-performance-scorecard-snapshot.ts
+// Usage: npx tsx backend/scripts/backfill-performance-scorecard-snapshot.ts 2026-07-01 2026-08-24
+import { writeEmployeePerformanceSnapshots } from "../src/modules/performance-scorecard/performance-scorecard-snapshot.service.js";
+
+async function main() {
+  const [fromArg, toArg] = process.argv.slice(2);
+  if (!fromArg || !toArg) {
+    console.error("Usage: backfill-performance-scorecard-snapshot.ts <fromDate YYYY-MM-DD> <toDate YYYY-MM-DD>");
+    process.exit(1);
+  }
+  const from = new Date(fromArg);
+  const to = new Date(toArg);
+  let totalWritten = 0;
+  let totalErrors = 0;
+  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
+    const dateStr = d.toISOString().slice(0, 10);
+    const { written, errors } = await writeEmployeePerformanceSnapshots(dateStr);
+    totalWritten += written;
+    totalErrors += errors.length;
+    console.log(`${dateStr}: wrote ${written} rows${errors.length > 0 ? `, ${errors.length} errors` : ""}`);
+    if (errors.length > 0) {
+      console.error(`${dateStr} errors:`, errors.slice(0, 5));
+    }
+  }
+  console.log(`Done. Total written: ${totalWritten}, total errors: ${totalErrors}`);
+  process.exit(totalErrors > 0 ? 1 : 0);
+}
+
+main().catch((err) => {
+  console.error(err);
+  process.exit(1);
+});
diff --git a/backend/sql/migrations/1604_employee_performance_daily_snapshot.sql b/backend/sql/migrations/1604_employee_performance_daily_snapshot.sql
new file mode 100644
index 00000000..46dfdb9d
--- /dev/null
+++ b/backend/sql/migrations/1604_employee_performance_daily_snapshot.sql
@@ -0,0 +1,24 @@
+-- backend/sql/migrations/1604_employee_performance_daily_snapshot.sql
+-- Foundation table for the Employee Performance Scorecard feature (Task 1).
+-- employee_id collation verified live against `employees`.`id`
+-- (char(36) COLLATE utf8mb4_unicode_ci) 2026-08-25 via SHOW CREATE TABLE employees.
+CREATE TABLE IF NOT EXISTS employee_performance_daily_snapshot (
+  id VARCHAR(36) NOT NULL PRIMARY KEY,
+  employee_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci,
+  snapshot_date DATE NOT NULL,
+  attendance_status VARCHAR(20) NULL,
+  late_by_minutes INT NOT NULL DEFAULT 0,
+  unplanned_leave_flag TINYINT(1) NOT NULL DEFAULT 0,
+  pip_status VARCHAR(20) NULL,
+  designation_id VARCHAR(36) NULL,
+  quality_score DECIMAL(6,2) NULL,
+  template_metrics JSON NULL,
+  team_attrition_pct DECIMAL(6,2) NULL,
+  team_shrinkage_pct DECIMAL(6,2) NULL,
+  team_revenue DECIMAL(18,2) NULL,
+  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
+  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
+  UNIQUE KEY uq_emp_perf_snapshot (employee_id, snapshot_date),
+  KEY idx_perf_snapshot_date (snapshot_date),
+  CONSTRAINT fk_emp_perf_snapshot_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
+) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
diff --git a/backend/sql/migrations/1607_performance_scorecard_page_catalog.sql b/backend/sql/migrations/1607_performance_scorecard_page_catalog.sql
new file mode 100644
index 00000000..f5b21d86
--- /dev/null
+++ b/backend/sql/migrations/1607_performance_scorecard_page_catalog.sql
@@ -0,0 +1,50 @@
+-- Migration 1607: Register PERFORMANCE_SCORECARD_COMMAND_CENTER in page_catalog
+-- and seed role_page_access grants (can_view only) for 16 roles.
+-- admin and wfm deliberately excluded (see 2026-08-22 incident).
+-- Purely additive; WHERE NOT EXISTS makes it idempotent.
+--
+-- Column names verified against the LIVE schema and the real application code
+-- (backend/src/modules/access/*.ts consistently reads/writes page_code/page_name,
+-- never page_key/page_label — confirmed 2026-08-25 via SHOW CREATE TABLE on both
+-- page_catalog and role_page_access, and a grep of every access-module query).
+-- A concurrent-session edit (commit 989a1334) had briefly changed this migration
+-- to the non-existent page_key/page_label columns; reverted here after
+-- independent re-verification, since running it as committed would have thrown
+-- ER_BAD_FIELD_ERROR and silently gated this page shut for every role.
+
+INSERT INTO page_catalog (page_code, page_name, module, description, created_at)
+SELECT
+  'PERFORMANCE_SCORECARD_COMMAND_CENTER',
+  'Performance Scorecard',
+  'performance',
+  'Employee performance scorecard command center — daily snapshot, KPI, and drill-down',
+  NOW()
+WHERE NOT EXISTS (
+  SELECT 1 FROM page_catalog WHERE page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'
+);
+
+INSERT INTO role_page_access (role_key, page_code, can_view, can_edit, can_delete, can_export, created_at)
+SELECT r.role_key, 'PERFORMANCE_SCORECARD_COMMAND_CENTER', 1, 0, 0, 0, NOW()
+FROM (
+  SELECT 'manager'           AS role_key UNION ALL
+  SELECT 'process_manager'               UNION ALL
+  SELECT 'assistant_manager'             UNION ALL
+  SELECT 'branch_head'                   UNION ALL
+  SELECT 'branch_manager'                UNION ALL
+  SELECT 'team_leader'                   UNION ALL
+  SELECT 'tl'                            UNION ALL
+  SELECT 'hr'                            UNION ALL
+  SELECT 'hr_admin'                      UNION ALL
+  SELECT 'ho_hr'                         UNION ALL
+  SELECT 'branch_hr'                     UNION ALL
+  SELECT 'process_hr'                    UNION ALL
+  SELECT 'ceo'                           UNION ALL
+  SELECT 'coo'                           UNION ALL
+  SELECT 'management'                    UNION ALL
+  SELECT 'super_admin'
+) r
+WHERE NOT EXISTS (
+  SELECT 1 FROM role_page_access
+   WHERE role_key = r.role_key
+     AND page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'
+);
diff --git a/backend/src/db/runPendingMigrations.ts b/backend/src/db/runPendingMigrations.ts
index 2e214942..088bed5d 100644
--- a/backend/src/db/runPendingMigrations.ts
+++ b/backend/src/db/runPendingMigrations.ts
@@ -785,16 +785,20 @@ const MIGRATION_MANIFEST: string[] = [
   "1554_workforce_mandate_alert_threshold.sql", // Adds alert_threshold_pct DECIMAL(5,2) DEFAULT 80.00 to workforce_mandate. Required by hc-gap-alert.cron.ts daily job — fires when coverage_pct drops below this threshold. ADD COLUMN IF NOT EXISTS, backward-compatible; existing rows default to 80%.
   "1555_attrition_record_inference_columns.sql", // Adds inferred_reason VARCHAR(50), inference_confidence ENUM('HIGH','MEDIUM','LOW'), inference_signals JSON to attrition_record. Required by attrition-reason-inference.service.ts to persist inference results. All columns NULL-default, ADD COLUMN IF NOT EXISTS, purely additive.
   "1556_employee_retention_recommendation.sql", // Creates employee_retention_recommendation: stores rule-based retention action recommendations generated by intervention-recommendation.service.ts per employee. Tracks risk_tier, prediction_score, recommendations JSON, action_taken, outcome. CREATE TABLE IF NOT EXISTS, InnoDB utf8mb4, purely additive.
   "migrations/1558_helpdesk_ticket_raised_by.sql", // Adds helpdesk_ticket.raised_by_user_id + resolved_by_user_id (both CHAR(36) NULL, no FK, matching assigned_to on the same table) and idx_helpdesk_ticket_raised_by. The maker/checker pair for the separation-of-duties guard added to POST /tickets/:id/resolve in the same commit: helpdesk had no occurrence of "maker" or "checker" anywhere, so one holder of one HELPDESK_ADMIN_ROLES role could raise a ticket on behalf of an employee, self-assign it via /take and resolve it, with the acting user surviving only in sensitive_action_log's change_summary JSON — telemetry that writeSensitiveActionLog is explicitly allowed to drop. No backfill: helpdesk_ticket holds 4 rows, all INSERTed in the same second on 2026-06-01 (seed data), and module_key='HELPDESK' in sensitive_action_log has only TICKET_ASSIGNED (3) and TICKET_ESCALATED (1) — TICKET_CREATED/TICKET_RESOLVED/TICKET_TAKEN have never been written, so no ticket has ever gone through this API. Those 4 rows keep raised_by_user_id NULL and the guard treats NULL as "raiser unknown" and lets the resolve through rather than inventing a failure on rows that predate the column. information_schema-guarded PREPARE/EXECUTE, not ADD COLUMN IF NOT EXISTS (unsupported on MySQL 8; this repo has recorded migrations applied while their DDL did nothing — see 1304/1305). Collation stated explicitly: helpdesk_ticket and auth_user are both utf8mb4_unicode_ci, verified live 2026-08-24. Additive and idempotent; registered but NOT applied by hand — applies at the next backend restart like every other manifest entry.
   "1557_branch_sal_code_from_db_bill.sql", // Adds sal_branch_code VARCHAR(30) NULL to branch_master (salary/establishment code from db_bill Sal_Branch_Code). Backfills sal_branch_code, address, and company_name for all 24 db_bill branches, matched by branch_code. All UPDATEs idempotent (only sets where NULL). Source: db_bill.branch_master verified 2026-08-24.
   "migrations/1601_bank_penny_drop_verification_token.sql", // Adds verification_token (UNIQUE VARCHAR 64), verification_token_expires_at, employee_name_at_request, name_match_tier, name_match_score to bank_penny_drop_log. Supports the employee bank-change penny drop email flow: a secure one-time token is emailed to Payroll Branch on submission; clicking the link triggers a live Luckpay penny drop and classifyNameMatch() comparison; results stored here and surfaced in the Payroll HO approval queue. Extends penny_drop_status ENUM with 'name_mismatch'. All column additions are information_schema-guarded. Additive only — no existing rows or values changed.
   "migrations/1602_payroll_loans_rbac_restore.sql", // Reactivates role_page_access rows for page_code='PAYROLL_LOANS': payroll_head and hr were active_status=0 (revoked), admin and finance_head had no row at all — leaving Loan Management's approval queue reachable only by super_admin in practice, out of sync with the frontend's own canApproveLoans gate. UPDATE + INSERT...WHERE NOT EXISTS, idempotent. Applied against production 2026-08-25 with explicit user approval as part of the payroll audit fix plan (Batch 3 Phase 1, Track 2); registered here so it also applies cleanly on any other environment.
   "migrations/1603_loan_negative_pending_cleanup.sql", // Clamps employee_loans.pending_amount to 0 for the 11 rows that were negative — legacy-import artifacts the app's own record-payment handler could never produce (it already clamps at Math.max(0, pending - paid)). Idempotent (WHERE pending_amount < 0 matches nothing once applied). Run via scripts/loan-negative-pending-cleanup.ts --apply, not this raw UPDATE directly, so a logSensitiveAction row is written per loan first — 11 rows confirmed in sensitive_action_log (action_type 'loan_negative_pending_cleanup'). Applied against production 2026-08-25 with explicit user approval, same fix plan as 1602.
+  "migrations/1604_employee_performance_daily_snapshot.sql", // Foundation table for the Employee Performance Scorecard feature (Task 1 of that plan) — creates employee_performance_daily_snapshot (employee_id/snapshot_date grain, attendance/late/leave/PIP/quality/template_metrics/team attrition-shrinkage-revenue columns). Nothing in the codebase reads or writes this table yet; later tasks in the same plan populate and consume it. employee_id VARCHAR(36) COLLATE utf8mb4_unicode_ci matches employees.id (char(36) COLLATE utf8mb4_unicode_ci, verified live via SHOW CREATE TABLE employees 2026-08-25) with an FK to employees(id). Task brief specified migration number 1558 assuming 1557 was the highest existing entry; live manifest already had 1558-1603 registered by other concurrent sessions, so this was numbered 1604 (next free number) instead, and filed under sql/migrations/ (the subfolder every entry from 1558 onward actually uses) rather than the brief's literal sql/ root path. Purely additive, CREATE TABLE IF NOT EXISTS, no existing table touched.
+  "migrations/1605_deactivate_dangling_payroll_disbursal_grant.sql", // Deactivates the 2 remaining active role_page_access rows for page_code='PAYROLL_DISBURSAL' (finance_head, super_admin — finance and payroll_head were already inactive). The page this code once gated, src/pages/payroll/DisbursalManagement.tsx, was deleted as confirmed dead code in the same change: unrouted since PaymentDisbursalCenter.tsx absorbed its functionality on 2026-08-23, and /payroll/disbursal has redirected to /payroll/payment-center?tab=disbursal (gated on PAYROLL_BANK_READINESS instead) ever since. Soft-deactivate, not delete, matching this table's existing convention. Idempotent. Batch 3 Phase 4 of the payroll audit fix plan; applied against production 2026-08-25 with explicit user approval. Numbered 1605 (not 1604 — a concurrent session took that number between this file being written and the manifest being regenerated).
+  "migrations/1607_performance_scorecard_page_catalog.sql", // Task 8 of the employee-performance-scorecard plan: registers PERFORMANCE_SCORECARD_COMMAND_CENTER in page_catalog and seeds its role_page_access grants (can_view only) for the 16 roles in PERFORMANCE_SCORECARD.allowedRoleKeys (backend/src/shared/dashboardAccessRegistry.ts, read live 2026-08-25) — manager, process_manager, assistant_manager, branch_head, branch_manager, team_leader, tl, hr, hr_admin, ho_hr, branch_hr, process_hr, ceo, coo, management, super_admin. admin and wfm deliberately excluded per the 2026-08-22 incident in backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts. Consumed by WorkforcePageGate in a later frontend task in the same plan. Numbered 1607 (1606 was already taken on disk by a concurrent session's normalize_component_names migration, not yet registered in this manifest at the time of writing). Purely additive, WHERE NOT EXISTS idempotent, no existing table touched.
+  "migrations/1608_salary_dispute_arrear_pending_status.sql", // Adds 'arrear_pending' to salary_dispute.status (MySQL ENUM). applyArrear() (salary-dispute.service.ts) previously wrote 'closed' unconditionally once a dispute was approved, even when no open payroll run existed yet to attach the arrear to — payroll runs in arrears, so this was the common case. An approved dispute always looked fully resolved regardless of whether the differential had actually been paid. Same commit's service fix now writes 'arrear_pending' instead when no line was found to attach to. Additive ALTER TABLE, existing rows/values untouched. Batch 3 Phase 4 of the payroll audit fix plan; applied against production only with explicit user approval, before/after shown, same as 1602/1603/1605.
   ];
 
 export type MigrationHealth = {
   status: "not_started" | "running" | "ok" | "failed";
   applied: string[];
   skipped: string[];
   failed: Array<{ filename: string; error: string }>;
   startedAt: string | null;
diff --git a/backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts b/backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts
index 2e6219c8..b0741452 100644
--- a/backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts
+++ b/backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts
@@ -5,22 +5,22 @@ import { resolve } from "node:path";
 import {
   DASHBOARD_ACCESS_REGISTRY,
   canAccessDashboard,
   getDashboardDefinition,
   normalizeDashboardRole,
 } from "../../../shared/dashboardAccessRegistry.js";
 
 describe("dashboard access registry", () => {
-  it("defines all twelve production dashboards with unique routes and page codes", () => {
+  it("defines all thirteen production dashboards with unique routes and page codes", () => {
     const definitions = Object.values(DASHBOARD_ACCESS_REGISTRY);
 
-    expect(definitions).toHaveLength(12);
-    expect(new Set(definitions.map((item) => item.route)).size).toBe(12);
-    expect(new Set(definitions.map((item) => item.pageCode)).size).toBe(12);
+    expect(definitions).toHaveLength(13);
+    expect(new Set(definitions.map((item) => item.route)).size).toBe(13);
+    expect(new Set(definitions.map((item) => item.pageCode)).size).toBe(13);
   });
 
   it("normalizes supported aliases before checking entitlement", () => {
     expect(normalizeDashboardRole(" TL ")).toBe("team_leader");
     expect(normalizeDashboardRole("ops_manager")).toBe("operations_manager");
     expect(normalizeDashboardRole("payroll_hr")).toBe("payroll");
   });
 
@@ -43,33 +43,33 @@ describe("dashboard access registry", () => {
     // role_page_access granted them the self dashboard. Administrative roles now reach
     // the self dashboard and nothing privileged.
     const expected: Record<string, string[]> = {
       admin: ["EMPLOYEE_SELF_DASHBOARD"],
       trainer: ["EMPLOYEE_SELF_DASHBOARD"],
       branch_admin: ["EMPLOYEE_SELF_DASHBOARD"],
       interviewer: ["EMPLOYEE_SELF_DASHBOARD"],
       super_admin: Object.keys(DASHBOARD_ACCESS_REGISTRY),
-      ceo: ["CEO_DASHBOARD", "QUALITY_DASHBOARD", "OPERATIONS_DASHBOARD", "MANAGEMENT_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
-      hr: ["HR_DASHBOARD", "WFM_ATTENDANCE_DASHBOARD", "RECRUITER_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
+      ceo: ["CEO_DASHBOARD", "QUALITY_DASHBOARD", "OPERATIONS_DASHBOARD", "MANAGEMENT_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD", "PERFORMANCE_SCORECARD"],
+      hr: ["HR_DASHBOARD", "WFM_ATTENDANCE_DASHBOARD", "RECRUITER_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD", "PERFORMANCE_SCORECARD"],
       wfm: ["WFM_DASHBOARD", "WFM_ATTENDANCE_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
       payroll: ["PAYROLL_HR_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
       qa: ["QUALITY_DASHBOARD", "OPERATIONS_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
       operations_manager: ["WFM_ATTENDANCE_DASHBOARD", "QUALITY_DASHBOARD", "OPERATIONS_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
       recruiter: ["RECRUITER_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
       it: ["IT_MANAGER_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
       it_head: ["IT_MANAGER_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
       tq_head: ["QUALITY_DASHBOARD", "OPERATIONS_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
       finance_head: ["PAYROLL_HR_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
       accounts_head: ["PAYROLL_HR_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
-      branch_head: ["QUALITY_DASHBOARD", "OPERATIONS_DASHBOARD", "MANAGEMENT_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
+      branch_head: ["QUALITY_DASHBOARD", "OPERATIONS_DASHBOARD", "MANAGEMENT_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD", "PERFORMANCE_SCORECARD"],
       // 2026-08-22: manager had no WFM_DASHBOARD grant at all and a deactivated
       // QUALITY_DASHBOARD grant (leftover from the 2026-07-25 RBAC cleanup) — neither was
       // deliberate, both fixed to match the parity manager already had on OPERATIONS_DASHBOARD.
-      manager: ["WFM_DASHBOARD", "QUALITY_DASHBOARD", "OPERATIONS_DASHBOARD", "MANAGEMENT_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
+      manager: ["WFM_DASHBOARD", "QUALITY_DASHBOARD", "OPERATIONS_DASHBOARD", "MANAGEMENT_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD", "PERFORMANCE_SCORECARD"],
       employee: ["EMPLOYEE_SELF_DASHBOARD"],
     };
 
     for (const [role, dashboardCodes] of Object.entries(expected)) {
       const actual = Object.keys(DASHBOARD_ACCESS_REGISTRY)
         .filter((code) => canAccessDashboard(code, [role]));
       expect(actual, role).toEqual(dashboardCodes);
     }
diff --git a/backend/src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts b/backend/src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts
new file mode 100644
index 00000000..be8cd885
--- /dev/null
+++ b/backend/src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts
@@ -0,0 +1,47 @@
+import { describe, expect, it, vi } from "vitest";
+
+/**
+ * Drilldown handlers for the employee performance scorecard's per-metric tiles.
+ * These read from employee_performance_daily_snapshot (Task 1's new table) and require
+ * employeeId/dateFrom/dateTo filters — there is no branch/process rollup for these,
+ * only a single employee's own record range.
+ */
+
+const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
+vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
+
+import { drillAttendanceStatus } from "../performance-scorecard-drilldown.js";
+
+describe("drillAttendanceStatus", () => {
+  it("returns one record per snapshot day with attendanceStatus and lateByMinutes", async () => {
+    execute.mockReset();
+    execute.mockResolvedValue([
+      [
+        {
+          employeeCode: "E100",
+          employeeName: "Test User",
+          snapshotDate: "2026-08-24",
+          attendanceStatus: "present",
+          lateByMinutes: 5,
+        },
+      ],
+      [],
+    ]);
+
+    const result = await drillAttendanceStatus(
+      {} as any,
+      { employeeId: "emp-1", dateFrom: "2026-08-01", dateTo: "2026-08-24" },
+    );
+
+    expect(result.metricCode).toBe("ATTENDANCE_STATUS");
+    expect(result.records).toHaveLength(1);
+    expect((result.records[0] as any).attendanceStatus).toBe("present");
+  });
+
+  it("throws a 400-flagged error when employeeId, dateFrom, or dateTo is missing", async () => {
+    execute.mockReset();
+    await expect(
+      drillAttendanceStatus({} as any, { employeeId: "emp-1" }),
+    ).rejects.toThrow();
+  });
+});
diff --git a/backend/src/modules/dashboards/dashboard-definition.service.ts b/backend/src/modules/dashboards/dashboard-definition.service.ts
index cd5eab21..68b2ac80 100644
--- a/backend/src/modules/dashboards/dashboard-definition.service.ts
+++ b/backend/src/modules/dashboards/dashboard-definition.service.ts
@@ -18,16 +18,26 @@ import {
   getPayrollReadinessMetrics,
   getRecruiterActivityMetrics,
   getResignationMetrics,
   getSalaryComponentMetrics,
   getTatMetrics,
   getTrainingProgressMetrics,
   type MetricResult,
 } from "./dashboard-metric.service.js";
+import {
+  getAttendanceStatusMetric,
+  getLatecomingMetric,
+  getUnplannedLeaveMetric,
+  getPipStatusMetric,
+  getQualityBaselineMetric,
+  getAttritionMetric,
+  getShrinkageMetric,
+  getRevenueMetric,
+} from "./performance-scorecard-drilldown.js";
 
 type MetricKey =
   | "hc"
   | "onb"
   | "att"
   | "payroll"
   | "incentive"
   | "tat"
@@ -38,17 +48,25 @@ type MetricKey =
   | "nm"
   | "joiningDocEsign"
   | "attException"
   | "docCompliance"
   | "biometric"
   | "salaryComponents"
   | "recruiterActivity"
   | "training"
-  | "leaveApprovals";
+  | "leaveApprovals"
+  | "attendanceStatus"
+  | "latecoming"
+  | "unplannedLeave"
+  | "pipStatus"
+  | "qualityBaseline"
+  | "attrition"
+  | "shrinkage"
+  | "revenue";
 
 type MetricDefinition = {
   code: string;
   label: string;
   unit: string;
   source: string;
   sourceTable: string | null;
   numeratorKey?: string;
@@ -82,16 +100,24 @@ const METRICS: Readonly<Record<MetricKey, MetricDefinition>> = {
   joiningDocEsign: { code: "JOINING_DOC_ESIGN", label: "Joining document eSign pending", unit: "documents", source: "Joining documents", sourceTable: "employee_joining_document_checklist", higherIsBetter: false, moduleCode: "onboarding", execute: getJoiningDocEsignMetrics },
   attException: { code: "ATTENDANCE_EXCEPTIONS", label: "Open attendance exceptions", unit: "issues", source: "Attendance reconciliation", sourceTable: "attendance_reconciliation_issue", numeratorKey: "blockers", denominatorKey: "openTotal", higherIsBetter: false, moduleCode: "attendance", execute: getAttendanceExceptionMetrics },
   docCompliance: { code: "DOC_COMPLIANCE", label: "Employees with no documents", unit: "employees", source: "Employee documents", sourceTable: "employee_documents", numeratorKey: "employeesWithDocs", denominatorKey: "activeEmployees", higherIsBetter: false, moduleCode: "hrms", execute: getDocumentComplianceMetrics },
   biometric: { code: "BIOMETRIC_ACTIVITY", label: "Biometric punch coverage", unit: "employees", source: "Biometric daily activity", sourceTable: "integration_biometric_daily", numeratorKey: "completePunchPairs", denominatorKey: "employees", higherIsBetter: true, moduleCode: "attendance", execute: getBiometricActivityMetrics },
   salaryComponents: { code: "SALARY_COMPONENTS", label: "Payroll components in latest run", unit: "components", source: "Salary component lines", sourceTable: "salary_prep_line_component", higherIsBetter: true, moduleCode: "payroll", execute: getSalaryComponentMetrics },
   recruiterActivity: { code: "RECRUITER_ACTIVITY", label: "Recruiter pipeline (30d)", unit: "leads", source: "Recruiter hiring activity", sourceTable: "ats_recruiter_hiring_activity", numeratorKey: "selected", denominatorKey: "leads", higherIsBetter: true, moduleCode: "ats", execute: getRecruiterActivityMetrics },
   training: { code: "TRAINING_PROGRESS", label: "Training completion rate", unit: "percent", source: "LMS progress snapshot", sourceTable: "lms_learning_progress_snapshot", numeratorKey: "completed", denominatorKey: "assignments", higherIsBetter: true, moduleCode: "lms", execute: getTrainingProgressMetrics },
   leaveApprovals: { code: "LEAVE_APPROVALS", label: "Pending leave approvals", unit: "requests", source: "Leave requests", sourceTable: "leave_request", higherIsBetter: false, moduleCode: "leave", execute: getLeaveApprovalMetrics },
+  attendanceStatus: { code: "ATTENDANCE_STATUS", label: "Attendance", unit: "days", source: "Attendance snapshot", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: true, moduleCode: "performance-scorecard", execute: getAttendanceStatusMetric },
+  latecoming: { code: "LATECOMING", label: "Latecoming", unit: "minutes", source: "Attendance snapshot", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: false, moduleCode: "performance-scorecard", execute: getLatecomingMetric },
+  unplannedLeave: { code: "UNPLANNED_LEAVE", label: "Unplanned Leave", unit: "days", source: "Attendance snapshot", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: false, moduleCode: "performance-scorecard", execute: getUnplannedLeaveMetric },
+  pipStatus: { code: "PIP_STATUS", label: "PIP Status", unit: "status", source: "PIP records", sourceTable: "pip_record", higherIsBetter: true, moduleCode: "performance-scorecard", execute: getPipStatusMetric },
+  qualityBaseline: { code: "QUALITY_BASELINE", label: "Quality", unit: "score", source: "KPI daily actuals", sourceTable: "kpi_daily_actual", higherIsBetter: true, moduleCode: "performance-scorecard", execute: getQualityBaselineMetric },
+  attrition: { code: "ATTRITION", label: "Attrition", unit: "%", source: "Attrition analytics", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: false, moduleCode: "performance-scorecard", execute: getAttritionMetric },
+  shrinkage: { code: "SHRINKAGE", label: "Shrinkage", unit: "%", source: "Shrinkage analytics", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: false, moduleCode: "performance-scorecard", execute: getShrinkageMetric },
+  revenue: { code: "REVENUE", label: "Revenue", unit: "INR", source: "Finance/BI", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: true, moduleCode: "performance-scorecard", execute: getRevenueMetric },
 };
 
 /**
  * Which metrics each dashboard requests.
  *
  * SUPER_ADMIN, QUALITY and IT_MANAGER were empty arrays, so `/summary` returned
  * `metrics: {}` for them. That was not a cosmetic gap: SuperAdminReferenceLayout reads
  * `metricDetail(m, "att", …)` for Present / On Leave / Absent Today and the attendance
@@ -133,16 +159,20 @@ const DASHBOARD_METRICS: Readonly<Record<DashboardCode, readonly MetricKey[]>> =
   // Scoped headcount and attendance context for QA; audit scores stay on /api/quality-dashboard/*.
   QUALITY_DASHBOARD: ["hc", "att"],
   OPERATIONS_DASHBOARD: ["hc", "att"],
   RECRUITER_DASHBOARD: ["onb", "tat", "recruiterActivity"],
   // Incoming joiners are provisioning demand; exits are deprovisioning and asset recovery.
   IT_MANAGER_DASHBOARD: ["hc", "onb", "resign"],
   MANAGEMENT_DASHBOARD: ["hc", "att", "tat", "training", "leaveApprovals"],
   EMPLOYEE_SELF_DASHBOARD: ["att", "leaveApprovals"],
+  PERFORMANCE_SCORECARD: [
+    "attendanceStatus", "latecoming", "unplannedLeave", "pipStatus",
+    "qualityBaseline", "attrition", "shrinkage", "revenue",
+  ],
 };
 
 function numberFromDetail(result: MetricResult, key?: string): number | null {
   if (!key) return null;
   const value = result.detail[key];
   return typeof value === "number" && Number.isFinite(value) ? value : null;
 }
 
diff --git a/backend/src/modules/dashboards/dashboard-drilldown.service.ts b/backend/src/modules/dashboards/dashboard-drilldown.service.ts
index 6ab9aff7..38016089 100644
--- a/backend/src/modules/dashboards/dashboard-drilldown.service.ts
+++ b/backend/src/modules/dashboards/dashboard-drilldown.service.ts
@@ -1,12 +1,16 @@
 import { db } from "../../db/mysql.js";
 import type { RowDataPacket } from "mysql2";
 import { type DashboardScope, buildScopeWhere, buildScopeWhereEmployees } from "../../shared/dashboardScope.js";
 import { LATEST_COMPLETE_ATTENDANCE_DATE_SQL } from "../../shared/attendanceStatus.js";
+import {
+  drillAttendanceStatus, drillLatecoming, drillUnplannedLeave, drillPipStatus,
+  drillQualityBaseline, drillAttrition, drillShrinkage, drillRevenue,
+} from "./performance-scorecard-drilldown.js";
 
 export interface DrilldownResult {
   metricCode: string;
   records: unknown[];
   note?: string;
   /**
    * Rows returned, NOT the size of the underlying population.
    *
@@ -95,16 +99,32 @@ export async function getDrilldown(
     case "RECRUITER_ACTIVITY":
       return drillRecruiterActivity(scope);
     case "TRAINING_PROGRESS":
       return drillTrainingProgress(scope);
     case "LEAVE_APPROVALS":
       return drillLeaveApprovals(scope);
     case "RECRUITER_PIPELINE":
       return drillRecruiterPipeline(scope, filters);
+    case "ATTENDANCE_STATUS":
+      return drillAttendanceStatus(scope, filters);
+    case "LATECOMING":
+      return drillLatecoming(scope, filters);
+    case "UNPLANNED_LEAVE":
+      return drillUnplannedLeave(scope, filters);
+    case "PIP_STATUS":
+      return drillPipStatus(scope, filters);
+    case "QUALITY_BASELINE":
+      return drillQualityBaseline(scope, filters);
+    case "ATTRITION":
+      return drillAttrition(scope, filters);
+    case "SHRINKAGE":
+      return drillShrinkage(scope, filters);
+    case "REVENUE":
+      return drillRevenue(scope, filters);
     default:
       return {
         metricCode,
         records: [],
         note: `Drilldown not yet implemented for ${metricCode}`,
       };
   }
 }
diff --git a/backend/src/modules/dashboards/performance-scorecard-drilldown.ts b/backend/src/modules/dashboards/performance-scorecard-drilldown.ts
new file mode 100644
index 00000000..979b7a9e
--- /dev/null
+++ b/backend/src/modules/dashboards/performance-scorecard-drilldown.ts
@@ -0,0 +1,226 @@
+import { db } from "../../db/mysql.js";
+import type { DrilldownResult } from "./dashboard-drilldown.service.js";
+import type { DashboardScope } from "../../shared/dashboardScope.js";
+import type { MetricResult } from "./dashboard-metric.service.js";
+
+interface ScorecardFilters {
+  employeeId?: string;
+  dateFrom?: string;
+  dateTo?: string;
+}
+
+function requireRange(
+  filters: Record<string, unknown> | undefined,
+): { employeeId: string; dateFrom: string; dateTo: string } {
+  const f = (filters ?? {}) as ScorecardFilters;
+  if (!f.employeeId || !f.dateFrom || !f.dateTo) {
+    throw Object.assign(new Error("employeeId, dateFrom and dateTo are required"), { status: 400 });
+  }
+  return { employeeId: f.employeeId, dateFrom: f.dateFrom, dateTo: f.dateTo };
+}
+
+async function fetchSnapshotRows(employeeId: string, dateFrom: string, dateTo: string) {
+  const [rows] = (await db.execute(
+    `SELECT e.employee_code AS employeeCode, e.full_name AS employeeName,
+            s.snapshot_date AS snapshotDate, s.attendance_status AS attendanceStatus,
+            s.late_by_minutes AS lateByMinutes, s.unplanned_leave_flag AS unplannedLeaveFlag,
+            s.pip_status AS pipStatus, s.quality_score AS qualityScore,
+            s.team_attrition_pct AS teamAttritionPct, s.team_shrinkage_pct AS teamShrinkagePct,
+            s.team_revenue AS teamRevenue
+       FROM employee_performance_daily_snapshot s
+       JOIN employees e ON e.id = s.employee_id
+      WHERE s.employee_id = ? AND s.snapshot_date BETWEEN ? AND ?
+      ORDER BY s.snapshot_date ASC`,
+    [employeeId, dateFrom, dateTo],
+  )) as any;
+  return rows as Array<Record<string, unknown>>;
+}
+
+export async function drillAttendanceStatus(
+  _scope: unknown,
+  filters?: Record<string, unknown>,
+): Promise<DrilldownResult> {
+  const { employeeId, dateFrom, dateTo } = requireRange(filters);
+  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
+  return {
+    metricCode: "ATTENDANCE_STATUS",
+    records: rows.map((r) => ({
+      employeeCode: r.employeeCode,
+      employeeName: r.employeeName,
+      snapshotDate: r.snapshotDate,
+      attendanceStatus: r.attendanceStatus,
+    })),
+    totalCount: rows.length,
+  };
+}
+
+export async function drillLatecoming(
+  _scope: unknown,
+  filters?: Record<string, unknown>,
+): Promise<DrilldownResult> {
+  const { employeeId, dateFrom, dateTo } = requireRange(filters);
+  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
+  return {
+    metricCode: "LATECOMING",
+    records: rows.map((r) => ({
+      employeeCode: r.employeeCode,
+      employeeName: r.employeeName,
+      snapshotDate: r.snapshotDate,
+      lateByMinutes: Number(r.lateByMinutes ?? 0),
+    })),
+    totalCount: rows.length,
+  };
+}
+
+export async function drillUnplannedLeave(
+  _scope: unknown,
+  filters?: Record<string, unknown>,
+): Promise<DrilldownResult> {
+  const { employeeId, dateFrom, dateTo } = requireRange(filters);
+  const rows = (await fetchSnapshotRows(employeeId, dateFrom, dateTo)).filter((r) => Boolean(r.unplannedLeaveFlag));
+  return {
+    metricCode: "UNPLANNED_LEAVE",
+    records: rows.map((r) => ({
+      employeeCode: r.employeeCode,
+      employeeName: r.employeeName,
+      snapshotDate: r.snapshotDate,
+      attendanceStatus: r.attendanceStatus,
+    })),
+    totalCount: rows.length,
+  };
+}
+
+export async function drillPipStatus(
+  _scope: unknown,
+  filters?: Record<string, unknown>,
+): Promise<DrilldownResult> {
+  const { employeeId } = requireRange(filters);
+  const [rows] = (await db.execute(
+    `SELECT pr.status, pr.start_date, pr.end_date, pr.reason, pc.checkpoint_date, pc.rating, pc.notes
+       FROM pip_record pr LEFT JOIN pip_checkpoint pc ON pc.pip_id = pr.id
+      WHERE pr.employee_id = ? ORDER BY pr.start_date DESC, pc.checkpoint_date DESC LIMIT 100`,
+    [employeeId],
+  )) as any;
+  return { metricCode: "PIP_STATUS", records: rows, totalCount: rows.length };
+}
+
+export async function drillQualityBaseline(
+  _scope: unknown,
+  filters?: Record<string, unknown>,
+): Promise<DrilldownResult> {
+  const { employeeId, dateFrom, dateTo } = requireRange(filters);
+  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
+  return {
+    metricCode: "QUALITY_BASELINE",
+    records: rows.map((r) => ({
+      employeeCode: r.employeeCode,
+      employeeName: r.employeeName,
+      snapshotDate: r.snapshotDate,
+      qualityScore: r.qualityScore === null ? null : Number(r.qualityScore),
+    })),
+    totalCount: rows.length,
+  };
+}
+
+export async function drillAttrition(
+  _scope: unknown,
+  filters?: Record<string, unknown>,
+): Promise<DrilldownResult> {
+  const { employeeId, dateFrom, dateTo } = requireRange(filters);
+  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
+  return {
+    metricCode: "ATTRITION",
+    records: rows.map((r) => ({
+      employeeCode: r.employeeCode,
+      snapshotDate: r.snapshotDate,
+      teamAttritionPct: r.teamAttritionPct === null ? null : Number(r.teamAttritionPct),
+    })),
+    totalCount: rows.length,
+    note: "Team-level rollup for this employee's managed team",
+  };
+}
+
+export async function drillShrinkage(
+  _scope: unknown,
+  filters?: Record<string, unknown>,
+): Promise<DrilldownResult> {
+  const { employeeId, dateFrom, dateTo } = requireRange(filters);
+  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
+  return {
+    metricCode: "SHRINKAGE",
+    records: rows.map((r) => ({
+      employeeCode: r.employeeCode,
+      snapshotDate: r.snapshotDate,
+      teamShrinkagePct: r.teamShrinkagePct === null ? null : Number(r.teamShrinkagePct),
+    })),
+    totalCount: rows.length,
+    note: "Team-level rollup for this employee's managed team",
+  };
+}
+
+export async function drillRevenue(
+  _scope: unknown,
+  filters?: Record<string, unknown>,
+): Promise<DrilldownResult> {
+  const { employeeId, dateFrom, dateTo } = requireRange(filters);
+  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
+  return {
+    metricCode: "REVENUE",
+    records: rows.map((r) => ({
+      employeeCode: r.employeeCode,
+      snapshotDate: r.snapshotDate,
+      teamRevenue: r.teamRevenue === null ? null : Number(r.teamRevenue),
+    })),
+    totalCount: rows.length,
+    note: "Team-level rollup for this employee's managed team",
+  };
+}
+
+// ─── Tile-summary stubs ───────────────────────────────────────────────────────
+// Consumed by dashboard-definition.service.ts's METRICS entries (wired in a later task).
+// These match MetricDefinition["execute"]'s real signature/return shape (MetricResult from
+// dashboard-metric.service.ts) rather than a placeholder — no live computation yet, so every
+// stub reports status "unknown" with a null value, identical in shape to nullResult() there.
+function stubMetricResult(metricCode: string): MetricResult {
+  return {
+    value: null,
+    previousValue: null,
+    target: null,
+    variance: null,
+    variancePct: null,
+    changePct: null,
+    status: "unknown",
+    trend: null,
+    drilldownApi: `/api/dashboards/:dashboardCode/metric/${metricCode}/drilldown`,
+    actionUrl: null,
+    detail: {},
+    errorCode: null,
+    errorMessage: null,
+    sourceRowCount: null,
+  };
+}
+
+export async function getAttendanceStatusMetric(_scope: DashboardScope): Promise<MetricResult> {
+  return stubMetricResult("ATTENDANCE_STATUS");
+}
+export async function getLatecomingMetric(_scope: DashboardScope): Promise<MetricResult> {
+  return stubMetricResult("LATECOMING");
+}
+export async function getUnplannedLeaveMetric(_scope: DashboardScope): Promise<MetricResult> {
+  return stubMetricResult("UNPLANNED_LEAVE");
+}
+export async function getPipStatusMetric(_scope: DashboardScope): Promise<MetricResult> {
+  return stubMetricResult("PIP_STATUS");
+}
+export async function getQualityBaselineMetric(_scope: DashboardScope): Promise<MetricResult> {
+  return stubMetricResult("QUALITY_BASELINE");
+}
+export async function getAttritionMetric(_scope: DashboardScope): Promise<MetricResult> {
+  return stubMetricResult("ATTRITION");
+}
+export async function getShrinkageMetric(_scope: DashboardScope): Promise<MetricResult> {
+  return stubMetricResult("SHRINKAGE");
+}
+export async function getRevenueMetric(_scope: DashboardScope): Promise<MetricResult> {
+  return stubMetricResult("REVENUE");
+}
diff --git a/backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts b/backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
new file mode 100644
index 00000000..e52d4785
--- /dev/null
+++ b/backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
@@ -0,0 +1,53 @@
+import { beforeEach, describe, expect, it, vi } from "vitest";
+
+const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
+vi.mock("../../../db/mysql.js", () => ({ db: { execute: mocks.execute } }));
+
+import {
+  computeEmployeeSnapshot,
+  writeEmployeePerformanceSnapshots,
+} from "../performance-scorecard-snapshot.service.js";
+
+describe("computeEmployeeSnapshot", () => {
+  beforeEach(() => mocks.execute.mockReset());
+
+  it("marks unplanned_leave_flag true when attendance_status is missing_punch", async () => {
+    mocks.execute
+      .mockResolvedValueOnce([[{ attendance_status: "missing_punch", late_by_minutes: 0 }]]) // attendance
+      .mockResolvedValueOnce([[]]) // active pip
+      .mockResolvedValueOnce([[{ overall_score: 82.5 }]]) // quality
+      .mockResolvedValueOnce([[{ designation_id: "desig-1" }]]); // employee designation
+
+    const result = await computeEmployeeSnapshot("emp-1", "2026-08-24");
+
+    expect(result.unplannedLeaveFlag).toBe(true);
+    expect(result.pipStatus).toBe("none");
+    expect(result.qualityScore).toBe(82.5);
+  });
+});
+
+describe("writeEmployeePerformanceSnapshots", () => {
+  beforeEach(() => mocks.execute.mockReset());
+
+  it("continues past a failing employee and still writes the next one, reporting the error", async () => {
+    mocks.execute
+      // SELECT active employees
+      .mockResolvedValueOnce([[{ id: "emp-fail" }, { id: "emp-ok" }]])
+      // emp-fail: computeEmployeeSnapshot's first query throws
+      .mockRejectedValueOnce(new Error("connection reset"))
+      // emp-ok: computeEmployeeSnapshot's 4 queries succeed
+      .mockResolvedValueOnce([[{ attendance_status: "present", late_by_minutes: 0 }]]) // attendance
+      .mockResolvedValueOnce([[]]) // active pip
+      .mockResolvedValueOnce([[{ overall_score: 90 }]]) // quality
+      .mockResolvedValueOnce([[{ designation_id: "desig-2" }]]) // employee designation
+      // emp-ok: INSERT
+      .mockResolvedValueOnce([{}]);
+
+    const result = await writeEmployeePerformanceSnapshots("2026-08-24");
+
+    expect(result.written).toBe(1);
+    expect(result.errors).toHaveLength(1);
+    expect(result.errors[0].employeeId).toBe("emp-fail");
+    expect(result.errors[0].error).toContain("connection reset");
+  });
+});
diff --git a/backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts b/backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts
new file mode 100644
index 00000000..e202d0cc
--- /dev/null
+++ b/backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts
@@ -0,0 +1,131 @@
+import express from "express";
+import request from "supertest";
+import { beforeEach, describe, expect, it, vi } from "vitest";
+import { getEmployeeForUser } from "../../../shared/accessGuard.js";
+import { managementService } from "../../management/management.service.js";
+
+/**
+ * Task 7: GET /api/performance-scorecard — RBAC-scoped route over
+ * employee_performance_daily_snapshot (Task 1's table).
+ *
+ * Role list is security-sensitive: matches dashboardAccessRegistry.ts's
+ * PERFORMANCE_SCORECARD.allowedRoleKeys exactly. Deliberately excludes
+ * "admin" and "wfm" — see Task 5's 2026-08-22 production-incident fix
+ * (dashboard-access-registry.test.ts) restricting admin to
+ * EMPLOYEE_SELF_DASHBOARD only, and PERFORMANCE_SCORECARD's registry entry
+ * not including wfm.
+ */
+
+const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
+vi.mock("../../../db/mysql.js", () => ({
+  db: { execute, query: execute, getConnection: vi.fn() },
+}));
+
+vi.mock("../../../shared/accessGuard.js", () => ({
+  hasRole: vi.fn(async (_userId: string, ...roles: string[]) =>
+    roles.some((r) => ["manager"].includes(r))
+  ),
+  getEmployeeForUser: vi.fn(async () => ({ id: "emp-mgr-1" })),
+}));
+
+vi.mock("../../management/management.service.js", () => ({
+  managementService: {
+    getDirectReportIds: vi.fn(async () => ["emp-report-1"]),
+  },
+}));
+
+let actorRoles: string[] = ["manager"];
+vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
+  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
+  return {
+    ...original,
+    requireAuth: (req: any, _res: any, next: any) => {
+      req.authUser = { id: "u-mgr-1", role: actorRoles[0], roles: actorRoles };
+      next();
+    },
+  };
+});
+
+import performanceScorecardRoutes from "../performance-scorecard.routes.js";
+
+function app() {
+  const a = express();
+  a.use(express.json());
+  a.use("/api/performance-scorecard", performanceScorecardRoutes);
+  return a;
+}
+
+beforeEach(() => {
+  execute.mockReset().mockResolvedValue([[], []]);
+  actorRoles = ["manager"];
+});
+
+describe("GET /api/performance-scorecard", () => {
+  it("returns snapshot rows scoped to the caller's manager chain", async () => {
+    execute.mockResolvedValueOnce([
+      [
+        {
+          employeeId: "emp-1",
+          employeeName: "Test Employee",
+          employeeCode: "EMP-1",
+          snapshotDate: "2026-08-24",
+          attendanceStatus: "present",
+        },
+      ],
+      [],
+    ]);
+
+    const res = await request(app())
+      .get("/api/performance-scorecard")
+      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });
+
+    expect(res.status).toBe(200);
+    expect(res.body.success).toBe(true);
+    expect(res.body.data).toHaveLength(1);
+    expect(res.body.data[0].employeeId).toBe("emp-1");
+  });
+
+  it("returns 400 when dateFrom or dateTo is missing", async () => {
+    const res = await request(app()).get("/api/performance-scorecard");
+    expect(res.status).toBe(400);
+    expect(res.body.success).toBe(false);
+  });
+
+  it("a role with no grant at all gets 403", async () => {
+    actorRoles = ["employee"];
+    const res = await request(app())
+      .get("/api/performance-scorecard")
+      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });
+    expect(res.status).toBe(403);
+  });
+
+  it("fails closed with 403 when the caller has no employee record and no org-wide role", async () => {
+    vi.mocked(getEmployeeForUser).mockResolvedValueOnce(null as unknown as { id: string });
+
+    const res = await request(app())
+      .get("/api/performance-scorecard")
+      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });
+
+    expect(res.status).toBe(403);
+    expect(res.body.success).toBe(false);
+  });
+
+  it("returns 200 with an empty array when the scoped query has no matching snapshot rows", async () => {
+    // NOTE: resolveTeamScope always appends the caller's own employee id to the
+    // direct-report list (see management.routes.ts's resolveTeamScope), so
+    // employeeIds can never actually be [] for a resolved (non-null) scope in
+    // practice — the route's `employeeIds.length === 0` branch is effectively
+    // unreachable given that behavior. This test instead covers the ordinary
+    // scoped-query path (employeeIds = [self]) returning zero DB rows, which is
+    // the realistic way a caller sees an empty scorecard today.
+    vi.mocked(managementService.getDirectReportIds).mockResolvedValueOnce([]);
+    execute.mockResolvedValueOnce([[], []]);
+
+    const res = await request(app())
+      .get("/api/performance-scorecard")
+      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });
+
+    expect(res.status).toBe(200);
+    expect(res.body).toEqual({ success: true, data: [] });
+  });
+});
diff --git a/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.cron.ts b/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.cron.ts
new file mode 100644
index 00000000..83cc4e56
--- /dev/null
+++ b/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.cron.ts
@@ -0,0 +1,58 @@
+import { writeEmployeePerformanceSnapshots } from "./performance-scorecard-snapshot.service.js";
+import { getIstDateString } from "../../utils/dateUtils.js";
+
+let _timer: ReturnType<typeof setInterval> | null = null;
+let _lastRunDate: string | null = null;
+let _running = false;
+
+const RUN_AT_HOUR_IST = 3; // 03:00 IST, after the dashboard snapshot (02:00) and attendance reconciliation.
+const CHECK_INTERVAL_MS = 30 * 60 * 1000;
+
+function istHour(): number {
+  return Number(
+    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()),
+  );
+}
+
+async function runPerformanceScorecardSnapshot(): Promise<void> {
+  if (_running) return;
+  _running = true;
+  try {
+    const date = getIstDateString();
+    const yesterday = new Date(date);
+    yesterday.setDate(yesterday.getDate() - 1);
+    const targetDate = yesterday.toISOString().slice(0, 10);
+    const { written, errors } = await writeEmployeePerformanceSnapshots(targetDate);
+    console.log(`[performance-scorecard-cron] wrote ${written} snapshot rows for ${targetDate}`);
+    if (errors.length > 0) {
+      console.error(
+        `[performance-scorecard-cron] ${errors.length} employee(s) failed for ${targetDate}:`,
+        errors.slice(0, 10),
+      );
+    }
+  } catch (err) {
+    console.error("[performance-scorecard-cron] snapshot run failed", err);
+  } finally {
+    _running = false;
+  }
+}
+
+export function startPerformanceScorecardSnapshotScheduler(): void {
+  if (_timer) return;
+  const tick = () => {
+    const today = getIstDateString();
+    if (_lastRunDate === today) return;
+    if (istHour() !== RUN_AT_HOUR_IST) return;
+    _lastRunDate = today;
+    void runPerformanceScorecardSnapshot();
+  };
+  _timer = setInterval(tick, CHECK_INTERVAL_MS);
+  console.log(`[performance-scorecard-cron] scheduler started (daily at ${RUN_AT_HOUR_IST}:00 IST)`);
+}
+
+export function stopPerformanceScorecardSnapshotScheduler(): void {
+  if (_timer) {
+    clearInterval(_timer);
+    _timer = null;
+  }
+}
diff --git a/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts b/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts
new file mode 100644
index 00000000..f6424a08
--- /dev/null
+++ b/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts
@@ -0,0 +1,133 @@
+import { randomUUID } from "node:crypto";
+import { db } from "../../db/mysql.js";
+import type { EmployeePerformanceSnapshotRow } from "./performance-scorecard.types.js";
+
+const UNPLANNED_STATUSES = new Set(["absent", "missing_punch"]);
+
+export async function computeEmployeeSnapshot(
+  employeeId: string,
+  date: string,
+): Promise<EmployeePerformanceSnapshotRow> {
+  const [[attendance]] = (await db.execute(
+    `SELECT attendance_status, late_by_minutes FROM attendance_daily_record
+      WHERE employee_id = ? AND record_date = ? LIMIT 1`,
+    [employeeId, date],
+  )) as any;
+
+  const [pipRows] = (await db.execute(
+    `SELECT pr.status, pc.rating
+       FROM pip_record pr
+       LEFT JOIN pip_checkpoint pc ON pc.pip_id = pr.id
+      WHERE pr.employee_id = ? AND pr.status = 'active'
+      ORDER BY pc.checkpoint_date DESC LIMIT 1`,
+    [employeeId],
+  )) as any;
+
+  const [[quality]] = (await db.execute(
+    `SELECT AVG(kda.actual_value) AS overall_score
+       FROM kpi_daily_actual kda
+      WHERE kda.employee_id = ? AND kda.score_date = ?`,
+    [employeeId, date],
+  )) as any;
+
+  const [[emp]] = (await db.execute(
+    `SELECT designation_id FROM employees WHERE id = ? LIMIT 1`,
+    [employeeId],
+  )) as any;
+
+  const attendanceStatus: string | null = attendance?.attendance_status ?? null;
+  const pipRow = pipRows?.[0];
+  const pipStatus: EmployeePerformanceSnapshotRow["pipStatus"] = pipRow
+    ? pipRow.rating === "off_track"
+      ? "off_track"
+      : pipRow.rating === "at_risk"
+        ? "at_risk"
+        : "active"
+    : "none";
+
+  return {
+    employeeId,
+    snapshotDate: date,
+    attendanceStatus,
+    lateByMinutes: Number(attendance?.late_by_minutes ?? 0),
+    unplannedLeaveFlag: attendanceStatus !== null && UNPLANNED_STATUSES.has(attendanceStatus),
+    pipStatus,
+    designationId: emp?.designation_id ?? null,
+    qualityScore:
+      quality?.overall_score === null || quality?.overall_score === undefined
+        ? null
+        : Number(quality.overall_score),
+    templateMetrics: null,
+    teamAttritionPct: null,
+    teamShrinkagePct: null,
+    teamRevenue: null,
+  };
+}
+
+/**
+ * Writes daily performance snapshots for all active employees.
+ *
+ * Each employee is processed independently: a failure computing or writing
+ * one employee's snapshot (bad data, FK issue, transient connection error)
+ * is caught, logged and recorded in `errors`, and processing continues with
+ * the remaining employees rather than aborting the whole batch.
+ */
+export async function writeEmployeePerformanceSnapshots(
+  date: string,
+): Promise<{ written: number; errors: Array<{ employeeId: string; error: string }> }> {
+  const [rows] = (await db.execute(
+    `SELECT id FROM employees WHERE active_status = 1`,
+  )) as any;
+
+  let written = 0;
+  const errors: Array<{ employeeId: string; error: string }> = [];
+
+  for (const { id: employeeId } of rows as Array<{ id: string }>) {
+    try {
+      const snapshot = await computeEmployeeSnapshot(employeeId, date);
+      await db.execute(
+        `INSERT INTO employee_performance_daily_snapshot
+           (id, employee_id, snapshot_date, attendance_status, late_by_minutes, unplanned_leave_flag,
+            pip_status, designation_id, quality_score, template_metrics,
+            team_attrition_pct, team_shrinkage_pct, team_revenue)
+         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
+         ON DUPLICATE KEY UPDATE
+           attendance_status = VALUES(attendance_status),
+           late_by_minutes = VALUES(late_by_minutes),
+           unplanned_leave_flag = VALUES(unplanned_leave_flag),
+           pip_status = VALUES(pip_status),
+           designation_id = VALUES(designation_id),
+           quality_score = VALUES(quality_score),
+           template_metrics = VALUES(template_metrics),
+           team_attrition_pct = VALUES(team_attrition_pct),
+           team_shrinkage_pct = VALUES(team_shrinkage_pct),
+           team_revenue = VALUES(team_revenue),
+           updated_at = CURRENT_TIMESTAMP`,
+        [
+          randomUUID(),
+          snapshot.employeeId,
+          snapshot.snapshotDate,
+          snapshot.attendanceStatus,
+          snapshot.lateByMinutes,
+          snapshot.unplannedLeaveFlag ? 1 : 0,
+          snapshot.pipStatus,
+          snapshot.designationId,
+          snapshot.qualityScore,
+          snapshot.templateMetrics ? JSON.stringify(snapshot.templateMetrics) : null,
+          snapshot.teamAttritionPct,
+          snapshot.teamShrinkagePct,
+          snapshot.teamRevenue,
+        ],
+      );
+      written += 1;
+    } catch (err) {
+      const message = err instanceof Error ? err.message : String(err);
+      console.error(
+        `[performance-scorecard-snapshot] failed to write snapshot for employeeId=${employeeId}:`,
+        err,
+      );
+      errors.push({ employeeId, error: message });
+    }
+  }
+  return { written, errors };
+}
diff --git a/backend/src/modules/performance-scorecard/performance-scorecard.routes.ts b/backend/src/modules/performance-scorecard/performance-scorecard.routes.ts
new file mode 100644
index 00000000..ad3edf7c
--- /dev/null
+++ b/backend/src/modules/performance-scorecard/performance-scorecard.routes.ts
@@ -0,0 +1,103 @@
+import { Router } from "express";
+import type { Response } from "express";
+import { requireAuth } from "../../middleware/authMiddleware.js";
+import { requireRole } from "../../middleware/requireRole.js";
+import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
+import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
+import { managementService } from "../management/management.service.js";
+import { db } from "../../db/mysql.js";
+
+const router = Router();
+// eslint-disable-next-line @typescript-eslint/no-explicit-any
+const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
+router.use(requireAuth);
+
+/**
+ * Resolve scoped employee ID list for non-admin/hr/ceo/qa roles.
+ * Mirrors management.routes.ts's resolveTeamScope (not exported from there,
+ * so replicated here rather than imported — see task-7-report.md).
+ * Admins, HR, CEO, QA see everyone. Managers/TLs see only their direct reports.
+ * Returns null if the caller has no employee record (block the request).
+ * Returns [] if the manager has no reports yet (no data returned).
+ */
+async function resolveTeamScope(userId: string): Promise<{ employeeIds: string[] | null; isWide: boolean }> {
+  if (await hasRole(userId, "admin", "hr", "ceo", "qa")) {
+    return { employeeIds: null, isWide: true };
+  }
+  const emp = await getEmployeeForUser(userId);
+  if (!emp) return { employeeIds: null, isWide: false };
+  const ids = await managementService.getDirectReportIds(emp.id);
+  if (!ids.includes(emp.id)) ids.push(emp.id);
+  return { employeeIds: ids, isWide: false };
+}
+
+/**
+ * Role list is SECURITY-SENSITIVE. Matches dashboardAccessRegistry.ts's
+ * PERFORMANCE_SCORECARD.allowedRoleKeys exactly (confirmed 2026-08-25).
+ * Deliberately excludes "admin" and "wfm" per Task 5's 2026-08-22
+ * production-incident fix — do not add them back without a security review.
+ */
+router.get(
+  "/",
+  requireRole(
+    "manager",
+    "process_manager",
+    "assistant_manager",
+    "branch_head",
+    "branch_manager",
+    "team_leader",
+    "tl",
+    "hr",
+    "hr_admin",
+    "ho_hr",
+    "branch_hr",
+    "process_hr",
+    "ceo",
+    "coo",
+    "management",
+    "super_admin",
+  ),
+  h(async (req: AuthenticatedRequest, res: Response) => {
+    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
+    if (!dateFrom || !dateTo) {
+      return res.status(400).json({ success: false, message: "dateFrom and dateTo are required" });
+    }
+    const { employeeIds, isWide } = await resolveTeamScope(req.authUser!.id);
+    if (!isWide && employeeIds === null) {
+      return res.status(403).json({
+        success: false,
+        message: "Unable to resolve your team scope — no employee record or organization-wide role found",
+      });
+    }
+    if (!isWide && employeeIds !== null && employeeIds.length === 0) {
+      return res.json({ success: true, data: [] });
+    }
+
+    const conds = ["s.snapshot_date BETWEEN ? AND ?"];
+    const params: unknown[] = [dateFrom, dateTo];
+    if (!isWide && employeeIds && employeeIds.length > 0) {
+      conds.push(`s.employee_id IN (${employeeIds.map(() => "?").join(",")})`);
+      params.push(...employeeIds);
+    }
+
+    const [rows] = (await db.execute(
+      `SELECT e.id AS employeeId, e.full_name AS employeeName, e.employee_code AS employeeCode,
+              s.snapshot_date AS snapshotDate, s.attendance_status AS attendanceStatus,
+              s.late_by_minutes AS lateByMinutes, s.unplanned_leave_flag AS unplannedLeaveFlag,
+              s.pip_status AS pipStatus, s.designation_id AS designationId,
+              s.quality_score AS qualityScore, s.template_metrics AS templateMetrics,
+              s.team_attrition_pct AS teamAttritionPct, s.team_shrinkage_pct AS teamShrinkagePct,
+              s.team_revenue AS teamRevenue
+         FROM employee_performance_daily_snapshot s
+         JOIN employees e ON e.id = s.employee_id
+        WHERE ${conds.join(" AND ")}
+        ORDER BY e.full_name ASC, s.snapshot_date ASC
+        LIMIT 5000`,
+      params,
+    )) as any;
+
+    res.json({ success: true, data: rows });
+  }),
+);
+
+export default router;
diff --git a/backend/src/modules/performance-scorecard/performance-scorecard.types.ts b/backend/src/modules/performance-scorecard/performance-scorecard.types.ts
new file mode 100644
index 00000000..df0dae8c
--- /dev/null
+++ b/backend/src/modules/performance-scorecard/performance-scorecard.types.ts
@@ -0,0 +1,14 @@
+export interface EmployeePerformanceSnapshotRow {
+  employeeId: string;
+  snapshotDate: string; // YYYY-MM-DD
+  attendanceStatus: string | null;
+  lateByMinutes: number;
+  unplannedLeaveFlag: boolean;
+  pipStatus: "active" | "at_risk" | "off_track" | "none";
+  designationId: string | null;
+  qualityScore: number | null;
+  templateMetrics: Record<string, number> | null;
+  teamAttritionPct: number | null;
+  teamShrinkagePct: number | null;
+  teamRevenue: number | null;
+}
diff --git a/backend/src/server.ts b/backend/src/server.ts
index beea38c6..a2a0a5a4 100644
--- a/backend/src/server.ts
+++ b/backend/src/server.ts
@@ -14,16 +14,17 @@ import { startTenureBadgeScheduler } from "./modules/engagement/tenure.cron.js";
 import { startCelebrationScheduler } from "./modules/engagement/celebration.cron.js";
 import { startDailyGamesScheduler, stopDailyGamesScheduler } from "./modules/engagement/daily-games.cron.js";
 import { startMcnmeetCron, stopMcnmeetCron } from "./modules/mcnmeet/mcnmeet.cron.js";
 import { startSocialFeedCron } from "./modules/social-feed/social-feed.cron.js";
 import { migrateLegacyIntegrationSecrets } from "./modules/external-db/external-db.service.js";
 import { startITProvisioningLockScheduler } from "./modules/it-provisioning/it-provisioning.cron.js";
 import { startPayrollWindowClosureScheduler } from "./modules/payroll/payroll-window.cron.js";
 import { startDashboardSnapshotScheduler } from "./modules/dashboards/dashboard-snapshot.cron.js";
+import { startPerformanceScorecardSnapshotScheduler } from "./modules/performance-scorecard/performance-scorecard-snapshot.cron.js";
 import { startPerformanceIngestionScheduler, stopPerformanceIngestionScheduler } from "./modules/performance-ingestion/performance-scheduler.service.js";
 import { startAttendanceEngineScheduler } from "./modules/wfm/attendance-engine.cron.js";
 import { startAttendanceReconciliationWorker } from "./modules/wfm/attendance-reconciliation.worker.js";
 // D-1 Daily Manager Intelligence Briefing Engine — dual-registered here AND in
 // workers/all-workers.ts, same convention as every other scheduler in this file
 // (see the ats-reminders/sla-breach note below this block for why a single-file
 // registration silently never runs in the WORKERS_PROCESS=external topology).
 // Off by default: MANAGER_DAILY_BRIEF_ENABLED must be explicitly "true".
@@ -225,16 +226,17 @@ function startServer() {
         startAccessExpiryScheduler();
         startMobilityTransferWorker();
         startITProvisioningLockScheduler();
         startLeaveMonthlyWorker();
         startAnnualLeaveWorker();
         startPayrollWindowClosureScheduler();
         // Records the daily metric baseline every dashboard trend arrow compares against.
         startDashboardSnapshotScheduler();
+        startPerformanceScorecardSnapshotScheduler();
         startPerformanceIngestionScheduler();
         initBusinessActionSyncJobs();
         startBreachSlaCron();
         startRetentionCron();
         // D-SLA-01: replaces the inline refreshSlaBreachFlags() call removed from
         // GET /helpdesk/dashboard in 4829f0a6 — without this, sla_breached flags
         // and the Support Command Center's breach badges never update.
         startHelpdeskSlaCron();
diff --git a/backend/src/shared/dashboardAccessRegistry.ts b/backend/src/shared/dashboardAccessRegistry.ts
index a2576b40..45d2b324 100644
--- a/backend/src/shared/dashboardAccessRegistry.ts
+++ b/backend/src/shared/dashboardAccessRegistry.ts
@@ -5,17 +5,18 @@ export type DashboardCode =
   | "WFM_DASHBOARD"
   | "WFM_ATTENDANCE_DASHBOARD"
   | "PAYROLL_HR_DASHBOARD"
   | "QUALITY_DASHBOARD"
   | "OPERATIONS_DASHBOARD"
   | "RECRUITER_DASHBOARD"
   | "IT_MANAGER_DASHBOARD"
   | "MANAGEMENT_DASHBOARD"
-  | "EMPLOYEE_SELF_DASHBOARD";
+  | "EMPLOYEE_SELF_DASHBOARD"
+  | "PERFORMANCE_SCORECARD";
 
 export type DashboardScopeType =
   | "ORGANISATION"
   | "BRANCH"
   | "PROCESS"
   | "TEAM"
   | "SELF"
   | "CUSTOM";
@@ -194,16 +195,27 @@ export const DASHBOARD_ACCESS_REGISTRY: Readonly<
     displayName: "My Dashboard",
     route: "/my-dashboard",
     pageCode: "EMPLOYEE_SELF_DASHBOARD",
     allowedRoleKeys: ["employee", "agent", "trainee", "manager", "process_manager", "assistant_manager", "branch_head", "branch_manager", "team_leader", "tl", "recruiter", "qa", "quality_analyst", "quality_lead", "qa_manager", "operations_manager", "wfm", "ho_wfm", "wfm_spoc", "rta", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "payroll", "payroll_head", "payroll_branch", "payroll_admin", "payroll_hr", "ho_payroll", "finance", "finance_head", "accounts_head", "branch_finance", "it", "branch_it", "ho_it", "it_head", "tq_head", "ceo", "coo", "management", "admin", "branch_admin", "interviewer", "trainer", "super_admin"],
     scopeTypes: ["SELF"],
     sensitiveMetrics: ["attendance", "leave", "payroll", "performance"],
     permissions: { drilldown: true, export: false, filters: false },
   }),
+  PERFORMANCE_SCORECARD: definition({
+    code: "PERFORMANCE_SCORECARD",
+    variant: "performance_scorecard",
+    displayName: "Performance Scorecard",
+    route: "/performance-scorecard/dashboard",
+    pageCode: "PERFORMANCE_SCORECARD_COMMAND_CENTER",
+    allowedRoleKeys: ["manager", "process_manager", "assistant_manager", "branch_head", "branch_manager", "team_leader", "tl", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "ceo", "coo", "management", "super_admin"],
+    scopeTypes: ["ORGANISATION", "TEAM", "BRANCH", "PROCESS"],
+    sensitiveMetrics: ["attendance", "performance", "attrition", "revenue"],
+    permissions: { drilldown: true, export: true, filters: true },
+  }),
 });
 
 export function normalizeDashboardRole(value: unknown): string {
   const normalized = String(value ?? "").trim().toLowerCase();
   return DASHBOARD_ROLE_ALIASES[normalized] ?? normalized;
 }
 
 // Lazy-built map from variant name → DashboardCode for backward-compat aliases
diff --git a/backend/src/workers/all-workers.ts b/backend/src/workers/all-workers.ts
index 525daf88..c069deac 100644
--- a/backend/src/workers/all-workers.ts
+++ b/backend/src/workers/all-workers.ts
@@ -34,16 +34,20 @@ import { startITProvisioningLockScheduler, stopITProvisioningLockScheduler } fro
 import { startEmployeeLifecycleWorker, stopEmployeeLifecycleWorker } from "./employee-lifecycle.worker.js";
 // These five were registered in server.ts ONLY. Production runs both processes
 // with WORKERS_PROCESS unset, so the API was starting every worker alongside this
 // process — 20 of them running twice. Turning that guard on without adding these
 // here first would have silently stopped all five, exactly as happened to
 // ats-reminders when it lived in one file only.
 import { initBusinessActionSyncJobs, stopBusinessActionSyncJobs } from "../cron/business-action-sync.cron.js";
 import { startDashboardSnapshotScheduler, stopDashboardSnapshotScheduler } from "../modules/dashboards/dashboard-snapshot.cron.js";
+import {
+  startPerformanceScorecardSnapshotScheduler,
+  stopPerformanceScorecardSnapshotScheduler,
+} from "../modules/performance-scorecard/performance-scorecard-snapshot.cron.js";
 import { startAttendanceReconciliationWorker, stopAttendanceReconciliationWorker } from "../modules/wfm/attendance-reconciliation.worker.js";
 // D-1 Daily Manager Intelligence Briefing Engine — dual-registered here AND in
 // server.ts (see the "These five were registered in server.ts ONLY" note above for
 // why a single-file registration silently never runs in one of the two worker
 // topologies). No-ops unless MANAGER_DAILY_BRIEF_ENABLED=true.
 import { startManagerDailyBriefScheduler, stopManagerDailyBriefScheduler } from "../modules/management/daily-brief/daily-brief.cron.js";
 import { startRetentionCron } from "./privacy-retention.worker.js";
 import { startAtsRemindersScheduler } from "../modules/ats/ats-reminders.cron.js";
@@ -234,16 +238,20 @@ const WORKERS: Array<{ name: string; start: () => Promise<void> }> = [
   {
     name: "manager-daily-brief",
     start: () => { startManagerDailyBriefScheduler(); return Promise.resolve(); },
   },
   {
     name: "dashboard-snapshot",
     start: () => { startDashboardSnapshotScheduler(); return Promise.resolve(); },
   },
+  {
+    name: "performance-scorecard-snapshot",
+    start: () => { startPerformanceScorecardSnapshotScheduler(); return Promise.resolve(); },
+  },
   {
     name: "privacy-retention",
     start: () => { startRetentionCron(); return Promise.resolve(); },
   },
   {
     name: "business-action-sync",
     start: () => { initBusinessActionSyncJobs(); return Promise.resolve(); },
   },
@@ -407,16 +415,17 @@ async function startAllWorkers(): Promise<void> {
 }
 
 function shutdown(): void {
   console.log("\n[workers] Shutting down...");
   // Newly moved here from server.ts. privacy-retention and ats-reminders export
   // no stop function, so they are not listed — their timers die with the process.
   stopBusinessActionSyncJobs();
   stopDashboardSnapshotScheduler();
+  stopPerformanceScorecardSnapshotScheduler();
   stopAttendanceReconciliationWorker();
   stopManagerDailyBriefScheduler();
   stopAccessExpiryScheduler();
   stopIntegrationScheduler();
   stopEsignComplianceWorker();
   // social-feed exports no stop — its timers are unref'd and die with the process.
   stopMcnmeetCron();
   stopEsignReconciliationWorker();
diff --git a/src/components/layout/navConfig.tsx b/src/components/layout/navConfig.tsx
index 431f966b..c6b1a58d 100644
--- a/src/components/layout/navConfig.tsx
+++ b/src/components/layout/navConfig.tsx
@@ -1,13 +1,13 @@
 import type { FC, SVGProps } from "react";
 import {
   Activity, BarChart3, Bell, Briefcase, Building2, Calendar,
   CalendarClock, CalendarDays, ClipboardList, Clock, CreditCard, FileCheck,
-  FileText, GitBranch, GraduationCap, Heart, Home, Landmark,
+  FileText, GitBranch, Gauge, GraduationCap, Heart, Home, Landmark,
   Network, Package, Search, Server, Settings, Settings2, ShieldCheck, Sparkles,
   Target, TrendingUp, Upload, User, UserMinus, UserPlus, Users, Users2, Wallet,
   Zap, DollarSign, ShoppingCart, LayoutDashboard, Crown, Receipt, CheckCircle,
   Plus, Send, Lock, Shield, ShieldAlert, PenSquare, Eye, UsersRound, RotateCcw, Mail, Share2,
   Video, PenLine, Workflow, Layers3, CalendarOff, MessageSquare, AlertCircle, Trophy, History
 } from "lucide-react";
 import type { NavGroup } from "./SidebarNav";
 
@@ -299,16 +299,17 @@ export const navGroups: NavGroup[] = [
           { label: "Performance",          href: "/performance",                icon: ic(Target),       roles: ["admin","hr","ceo","coo","manager","process_manager","branch_head","operations_manager","qa","quality_analyst","analyst","super_admin","employee","agent","team_leader","tl"], description: "Performance" },
           { label: "Performance Command",  href: "/performance/command-center", icon: ic(Target),       pageCode: "WORKFORCE_COMMAND_CENTER", description: "Perf command" },
           { label: "Agent Performance",    href: "/agent-performance",          icon: ic(Activity),     roles: ["admin","hr","ceo","coo","qa","analyst","manager","process_manager","branch_head"], description: "Cross-source KPI" },
           { label: "KPI Config",           href: "/kpi-config",                 icon: ic(Target),       pageCode: "KPI_CONFIG", roles: ["admin","hr","manager","process_manager"], description: "KPI" },
           { label: "KPI Targets", href: "/kpi-targets", icon: ic(Target), pageCode: "KPI_MASTER", description: "Targets by process & designation" },
           { label: "KPI Master", href: "/kpi-master", icon: ic(Settings2), pageCode: "KPI_MASTER", description: "KPI master configuration" },
           { label: "My KPI", href: "/my-kpi", icon: ic(Target), pageCode: "MY_KPI", description: "Personal KPI dashboard" },
           { label: "PIP Management", href: "/pip-management", icon: ic(ClipboardList), pageCode: "PIP_MANAGEMENT", description: "Performance improvement plans" },
+          { label: "Performance Scorecard", href: "/performance-command-center", icon: ic(Gauge), pageCode: "PERFORMANCE_SCORECARD_COMMAND_CENTER", description: "Full-scope performance scorecard across your team/branch/org" },
           { label: "TAT Matrix", href: "/governance/tat-matrix", icon: ic(Settings2), pageCode: "TAT_MATRIX", description: "Turnaround-time policy" },
           { label: "TAT Dashboard", href: "/governance/tat-dashboard", icon: ic(BarChart3), pageCode: "TAT_DASHBOARD", description: "Turnaround-time monitoring" },
           { label: "Operations KPI",       href: "/operations-kpi",             icon: ic(Target),       pageCode: "OPERATIONS_KPI",          description: "Ops KPI" },
           { label: "Operations Dashboard", href: "/operations/dashboard",       icon: ic(Target),       pageCode: "OPERATIONS_DASHBOARD",    description: "Ops dashboard" },
           { label: "Feedback Assignments", href: "/performance-feedback/assignments",  icon: ic(ClipboardList), roles: ["admin","hr","manager","process_manager","super_admin"], description: "Feedback tasks" },
           { label: "Team Reports",         href: "/performance-feedback/team-reports", icon: ic(BarChart3),     roles: ["admin","hr","manager"], description: "Team feedback" },
         ],
       },
diff --git a/src/components/my-team/TeamPerformanceTab.tsx b/src/components/my-team/TeamPerformanceTab.tsx
index 12a2bb1a..4ef3d2f0 100644
--- a/src/components/my-team/TeamPerformanceTab.tsx
+++ b/src/components/my-team/TeamPerformanceTab.tsx
@@ -2,24 +2,25 @@ import { useState } from "react";
 import { useQuery, useQueryClient } from "@tanstack/react-query";
 import { hrmsApi } from "@/lib/hrmsApi";
 import { Button } from "@/components/ui/button";
 import { Skeleton } from "@/components/ui/skeleton";
 import { Input } from "@/components/ui/input";
 import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
 import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
 import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
-import { AlertTriangle, Plus, BarChart2, Shield } from "lucide-react";
+import { Plus, BarChart2 } from "lucide-react";
 import { useToast } from "@/hooks/use-toast";
 import {
   ChartContainer,
   ChartTooltip,
   ChartTooltipContent,
 } from "@/components/ui/chart";
 import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, ResponsiveContainer } from "recharts";
+import PerformanceScorecardTable from "@/components/performance-scorecard/PerformanceScorecardTable";
 
 // Agent performance fields from /api/management/agent-performance
 interface AgentPerf {
   agent_id?: string;
   agent_name: string;
   quality_pct: number;    // actually KPI overall_score
   calls?: number;
   risk_score?: number;
@@ -29,41 +30,16 @@ interface AgentPerf {
 interface TeamMember { id: string; employee_code: string; full_name: string; }
 
 function scoreColor(score: number) {
   if (score >= 80) return { bar: "#22c55e", ring: "bg-emerald-100 text-emerald-700" };
   if (score >= 65) return { bar: "#f59e0b", ring: "bg-amber-100 text-amber-700" };
   return { bar: "#ef4444", ring: "bg-rose-100 text-rose-700" };
 }
 
-function riskLabel(score?: number) {
-  if (!score) return { label: "Low", cls: "bg-emerald-100 text-emerald-700" };
-  if (score >= 70) return { label: "High",   cls: "bg-rose-100 text-rose-700" };
-  if (score >= 45) return { label: "Medium", cls: "bg-amber-100 text-amber-700" };
-  return { label: "Low", cls: "bg-emerald-100 text-emerald-700" };
-}
-
-// ── Score bar visual ──────────────────────────────────────────
-function ScoreBar({ score }: { score: number }) {
-  const { bar, ring } = scoreColor(score);
-  return (
-    <div className="flex items-center gap-2.5">
-      <div className="relative h-2 w-28 overflow-hidden rounded-full bg-slate-100">
-        <div
-          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
-          style={{ width: `${Math.min(100, score)}%`, background: bar }}
-        />
-      </div>
-      <span className={`min-w-[2.5rem] rounded-full px-2 py-0.5 text-xs font-bold text-center ${ring}`}>
-        {score}
-      </span>
-    </div>
-  );
-}
-
 const chartConfig = {
   score: { label: "KPI Score", color: "#6366f1" },
 };
 
 export default function TeamPerformanceTab() {
   const [coachModal, setCoachModal] = useState(false);
   const [coachEmpId, setCoachEmpId] = useState("");
   const [coachDate, setCoachDate] = useState(
@@ -72,16 +48,23 @@ export default function TeamPerformanceTab() {
       timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
     }).format(new Date())
   );
   const [coachType, setCoachType] = useState("performance");
   const [submitting, setSubmitting] = useState(false);
   const { toast } = useToast();
   const queryClient = useQueryClient();
 
+  const [dateFrom, setDateFrom] = useState(() => {
+    const d = new Date();
+    d.setDate(d.getDate() - 30);
+    return d.toISOString().slice(0, 10);
+  });
+  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
+
   const { data: perfData, isLoading } = useQuery({
     queryKey: ["management", "agent-performance"],
     queryFn: () => hrmsApi.get<any>("/api/management/agent-performance"),
     staleTime: 5 * 60_000,
   });
 
   const { data: membersData } = useQuery({
     queryKey: ["management", "team-members"],
@@ -145,84 +128,41 @@ export default function TeamPerformanceTab() {
         <Skeleton className="h-52 w-full rounded-2xl" />
       ) : agents.length === 0 ? (
         <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-16">
           <BarChart2 className="h-8 w-8 text-slate-300 mb-2" />
           <p className="text-sm text-slate-500">No KPI data available for your team.</p>
         </div>
       ) : (
         <>
+          {/* Date range control */}
+          <div className="flex items-center gap-2 mb-4">
+            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
+            <span className="text-gray-400">to</span>
+            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
+          </div>
+
           {/* Chart */}
           <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
             <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-4">KPI Score by Agent</p>
             <ChartContainer config={chartConfig} className="h-48 w-full">
               <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                 <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                 <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                 <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                 <ChartTooltip content={<ChartTooltipContent />} />
                 <Bar dataKey="score" radius={[6, 6, 0, 0]} maxBarSize={36}>
                   {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                 </Bar>
               </BarChart>
             </ChartContainer>
           </div>
 
-          {/* Table */}
-          <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
-            <Table>
-              <TableHeader>
-                <TableRow className="bg-slate-50 hover:bg-slate-50">
-                  <TableHead className="font-semibold text-slate-600">Employee</TableHead>
-                  <TableHead className="font-semibold text-slate-600">KPI Score</TableHead>
-                  <TableHead className="font-semibold text-slate-600">Risk Level</TableHead>
-                  <TableHead className="font-semibold text-slate-600">Coaching</TableHead>
-                </TableRow>
-              </TableHeader>
-              <TableBody>
-                {agents.map((a, i) => {
-                  const risk = riskLabel(a.risk_score);
-                  return (
-                    <TableRow key={a.agent_id ?? i} className="hover:bg-slate-50/60 transition-colors">
-                      <TableCell>
-                        <div className="flex items-center gap-2">
-                          <div
-                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
-                            style={{ background: scoreColor(Math.round(a.quality_pct)).bar }}
-                          >
-                            {(a.agent_name ?? "?").charAt(0).toUpperCase()}
-                          </div>
-                          <span className="text-sm font-medium text-slate-900">{a.agent_name}</span>
-                        </div>
-                      </TableCell>
-                      <TableCell><ScoreBar score={Math.round(a.quality_pct ?? 0)} /></TableCell>
-                      <TableCell>
-                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${risk.cls}`}>
-                          <Shield className="h-3 w-3" />{risk.label}
-                        </span>
-                      </TableCell>
-                      <TableCell>
-                        {a.coaching_needed ? (
-                          <button
-                            type="button"
-                            onClick={() => { setCoachEmpId(a.agent_id ?? ""); setCoachModal(true); }}
-                            className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 cursor-pointer transition-colors"
-                          >
-                            <AlertTriangle className="h-3 w-3" />Schedule
-                          </button>
-                        ) : (
-                          <span className="text-xs text-slate-400">—</span>
-                        )}
-                      </TableCell>
-                    </TableRow>
-                  );
-                })}
-              </TableBody>
-            </Table>
-          </div>
+          {/* Scorecard table */}
+          <PerformanceScorecardTable dateFrom={dateFrom} dateTo={dateTo} />
         </>
       )}
 
       {/* Coaching modal */}
       <Dialog open={coachModal} onOpenChange={setCoachModal}>
         <DialogContent className="max-w-sm rounded-2xl">
           <DialogHeader><DialogTitle>Create Coaching Session</DialogTitle></DialogHeader>
           <div className="space-y-3">
diff --git a/src/components/performance-scorecard/PerformanceCompareModal.tsx b/src/components/performance-scorecard/PerformanceCompareModal.tsx
new file mode 100644
index 00000000..612cde61
--- /dev/null
+++ b/src/components/performance-scorecard/PerformanceCompareModal.tsx
@@ -0,0 +1,74 @@
+import { useState } from "react";
+import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
+import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
+import { Checkbox } from "@/components/ui/checkbox";
+import type { ScorecardRow } from "./performanceScorecardColumns";
+
+const COMPARABLE_METRICS: Array<{ key: keyof ScorecardRow; label: string; color: string }> = [
+  { key: "lateByMinutes", label: "Latecoming (min)", color: "#dc2626" },
+  { key: "qualityScore", label: "Quality", color: "#15803d" },
+  { key: "teamAttritionPct", label: "Attrition (%)", color: "#ea580c" },
+  { key: "teamShrinkagePct", label: "Shrinkage (%)", color: "#6d28d9" },
+];
+
+interface PerformanceCompareModalProps {
+  open: boolean;
+  onClose: () => void;
+  employeeName: string;
+  rows: ScorecardRow[]; // all snapshot-date rows for one employee across the selected range
+}
+
+export default function PerformanceCompareModal({ open, onClose, employeeName, rows }: PerformanceCompareModalProps) {
+  const [selected, setSelected] = useState<Set<string>>(new Set(["lateByMinutes", "qualityScore"]));
+
+  const toggle = (key: string) => {
+    setSelected((prev) => {
+      const next = new Set(prev);
+      if (next.has(key)) next.delete(key);
+      else if (next.size < 4) next.add(key);
+      return next;
+    });
+  };
+
+  const chartData = rows.map((r) => ({
+    date: r.snapshotDate,
+    lateByMinutes: r.lateByMinutes,
+    qualityScore: r.qualityScore,
+    teamAttritionPct: r.teamAttritionPct,
+    teamShrinkagePct: r.teamShrinkagePct,
+  }));
+
+  return (
+    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
+      <DialogContent className="max-w-3xl">
+        <DialogHeader>
+          <DialogTitle>Compare metrics — {employeeName}</DialogTitle>
+        </DialogHeader>
+        <div className="flex gap-4 flex-wrap mb-4">
+          {COMPARABLE_METRICS.map((m) => (
+            <label key={m.key} className="flex items-center gap-2 text-sm">
+              <Checkbox checked={selected.has(m.key as string)} onCheckedChange={() => toggle(m.key as string)} />
+              {m.label}
+            </label>
+          ))}
+        </div>
+        {chartData.length === 0 ? (
+          <div className="text-sm text-gray-500 py-10 text-center">No data points in the selected date range.</div>
+        ) : (
+          <ResponsiveContainer width="100%" height={320}>
+            <LineChart data={chartData}>
+              <CartesianGrid strokeDasharray="3 3" />
+              <XAxis dataKey="date" />
+              <YAxis />
+              <Tooltip />
+              <Legend />
+              {COMPARABLE_METRICS.filter((m) => selected.has(m.key as string)).map((m) => (
+                <Line key={m.key} type="monotone" dataKey={m.key as string} stroke={m.color} name={m.label} connectNulls />
+              ))}
+            </LineChart>
+          </ResponsiveContainer>
+        )}
+      </DialogContent>
+    </Dialog>
+  );
+}
diff --git a/src/components/performance-scorecard/PerformanceScorecardTable.tsx b/src/components/performance-scorecard/PerformanceScorecardTable.tsx
new file mode 100644
index 00000000..f65e4eb3
--- /dev/null
+++ b/src/components/performance-scorecard/PerformanceScorecardTable.tsx
@@ -0,0 +1,135 @@
+import { useState, useMemo } from "react";
+import { useQuery } from "@tanstack/react-query";
+import { hrmsApi, getHrmsApiErrorStatus, type HrmsEnvelope } from "@/lib/hrmsApi";
+import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
+import { Avatar, AvatarFallback } from "@/components/ui/avatar";
+import { Badge } from "@/components/ui/badge";
+import { DashboardDrilldownDrawer } from "@/components/dashboard/DashboardDrilldownDrawer";
+import { BASELINE_COLUMNS, TEMPLATE_COLUMNS, type ScorecardRow } from "./performanceScorecardColumns";
+import { Button } from "@/components/ui/button";
+import PerformanceCompareModal from "./PerformanceCompareModal";
+
+interface PerformanceScorecardTableProps {
+  dateFrom: string;
+  dateTo: string;
+}
+
+function groupByEmployee(rows: ScorecardRow[]): ScorecardRow[] {
+  const byEmployee = new Map<string, ScorecardRow>();
+  for (const row of rows) {
+    const existing = byEmployee.get(row.employeeId);
+    if (!existing || row.snapshotDate > existing.snapshotDate) byEmployee.set(row.employeeId, row);
+  }
+  return Array.from(byEmployee.values());
+}
+
+export default function PerformanceScorecardTable({ dateFrom, dateTo }: PerformanceScorecardTableProps) {
+  const [drilldown, setDrilldown] = useState<{ employeeId: string; metricCode: string; metricName: string } | null>(null);
+  const [compareEmployee, setCompareEmployee] = useState<{ id: string; name: string } | null>(null);
+
+  const { data, isLoading, error } = useQuery({
+    queryKey: ["performance-scorecard", dateFrom, dateTo],
+    queryFn: () =>
+      hrmsApi.get<HrmsEnvelope<ScorecardRow[]>>(
+        `/api/performance-scorecard?dateFrom=${dateFrom}&dateTo=${dateTo}`,
+      ),
+    staleTime: 5 * 60_000,
+  });
+
+  const rows = useMemo(() => groupByEmployee(data?.data ?? []), [data]);
+  const columns = [...BASELINE_COLUMNS, ...TEMPLATE_COLUMNS];
+
+  if (isLoading) return <div className="p-6 text-sm text-gray-500">Loading scorecard…</div>;
+
+  // The route returns 403 when the caller's role isn't granted OR their team scope
+  // can't be resolved — surface this distinctly, don't let it look like an empty table.
+  if (error) {
+    const status = getHrmsApiErrorStatus(error);
+    return (
+      <div className="p-6 text-sm text-red-600 bg-red-50 rounded-2xl border border-red-200">
+        {status === 403
+          ? "You don't have access to view this scorecard, or your team scope could not be resolved. Contact HR/IT if you believe this is an error."
+          : "Failed to load the performance scorecard. Please try again."}
+      </div>
+    );
+  }
+
+  return (
+    <div className="overflow-x-auto rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
+      <Table>
+        <TableHeader>
+          <TableRow>
+            <TableHead className="sticky left-0 bg-white/95 z-10">Employee</TableHead>
+            {columns.map((col) => (
+              <TableHead key={col.key}>{col.label}</TableHead>
+            ))}
+            <TableHead>Compare</TableHead>
+          </TableRow>
+        </TableHeader>
+        <TableBody>
+          {rows.length === 0 && (
+            <TableRow>
+              <TableCell colSpan={columns.length + 2} className="text-center text-sm text-gray-500 py-6">
+                No performance data for this date range.
+              </TableCell>
+            </TableRow>
+          )}
+          {rows.map((row) => (
+            <TableRow key={row.employeeId}>
+              <TableCell className="sticky left-0 bg-white z-10">
+                <div className="flex items-center gap-2">
+                  <Avatar className="h-8 w-8">
+                    <AvatarFallback>{row.employeeName.slice(0, 2).toUpperCase()}</AvatarFallback>
+                  </Avatar>
+                  <span className="font-semibold text-gray-800">{row.employeeName}</span>
+                </div>
+              </TableCell>
+              {columns.map((col) => (
+                <TableCell
+                  key={col.key}
+                  className="cursor-pointer hover:underline"
+                  onClick={() => setDrilldown({ employeeId: row.employeeId, metricCode: col.metricCode, metricName: col.label })}
+                >
+                  {col.key === "pipStatus" ? (
+                    <Badge variant={row.pipStatus === "off_track" ? "destructive" : row.pipStatus === "at_risk" ? "secondary" : "outline"}>
+                      {col.format(row)}
+                    </Badge>
+                  ) : (
+                    col.format(row)
+                  )}
+                </TableCell>
+              ))}
+              <TableCell>
+                <Button
+                  variant="outline"
+                  size="sm"
+                  onClick={() => setCompareEmployee({ id: row.employeeId, name: row.employeeName })}
+                >
+                  Compare
+                </Button>
+              </TableCell>
+            </TableRow>
+          ))}
+        </TableBody>
+      </Table>
+      {compareEmployee && (
+        <PerformanceCompareModal
+          open={true}
+          onClose={() => setCompareEmployee(null)}
+          employeeName={compareEmployee.name}
+          rows={(data?.data ?? []).filter((r) => r.employeeId === compareEmployee.id)}
+        />
+      )}
+      {drilldown && (
+        <DashboardDrilldownDrawer
+          open={true}
+          onClose={() => setDrilldown(null)}
+          metricCode={drilldown.metricCode}
+          metricName={drilldown.metricName}
+          dashboardCode="PERFORMANCE_SCORECARD"
+          filters={{ employeeId: drilldown.employeeId, dateFrom, dateTo }}
+        />
+      )}
+    </div>
+  );
+}
diff --git a/src/components/performance-scorecard/performanceScorecardColumns.ts b/src/components/performance-scorecard/performanceScorecardColumns.ts
new file mode 100644
index 00000000..3666ea43
--- /dev/null
+++ b/src/components/performance-scorecard/performanceScorecardColumns.ts
@@ -0,0 +1,37 @@
+export interface ScorecardColumn {
+  key: string;
+  label: string;
+  metricCode: string;
+  format: (row: ScorecardRow) => string;
+}
+
+export interface ScorecardRow {
+  employeeId: string;
+  employeeName: string;
+  employeeCode: string;
+  snapshotDate: string;
+  attendanceStatus: string | null;
+  lateByMinutes: number;
+  unplannedLeaveFlag: boolean;
+  pipStatus: "active" | "at_risk" | "off_track" | "none";
+  designationId?: string | null;
+  qualityScore: number | null;
+  templateMetrics?: Record<string, unknown> | null;
+  teamAttritionPct: number | null;
+  teamShrinkagePct: number | null;
+  teamRevenue: number | null;
+}
+
+export const BASELINE_COLUMNS: ScorecardColumn[] = [
+  { key: "attendanceStatus", label: "Attendance", metricCode: "ATTENDANCE_STATUS", format: (r) => r.attendanceStatus ?? "—" },
+  { key: "lateByMinutes", label: "Latecoming", metricCode: "LATECOMING", format: (r) => `${r.lateByMinutes} min` },
+  { key: "unplannedLeaveFlag", label: "Unplanned Leave", metricCode: "UNPLANNED_LEAVE", format: (r) => (r.unplannedLeaveFlag ? "Yes" : "No") },
+  { key: "pipStatus", label: "PIP", metricCode: "PIP_STATUS", format: (r) => r.pipStatus },
+];
+
+export const TEMPLATE_COLUMNS: ScorecardColumn[] = [
+  { key: "qualityScore", label: "Quality", metricCode: "QUALITY_BASELINE", format: (r) => (r.qualityScore === null ? "—" : r.qualityScore.toFixed(1)) },
+  { key: "teamAttritionPct", label: "Attrition", metricCode: "ATTRITION", format: (r) => (r.teamAttritionPct === null ? "—" : `${r.teamAttritionPct.toFixed(1)}%`) },
+  { key: "teamShrinkagePct", label: "Shrinkage", metricCode: "SHRINKAGE", format: (r) => (r.teamShrinkagePct === null ? "—" : `${r.teamShrinkagePct.toFixed(1)}%`) },
+  { key: "teamRevenue", label: "Revenue", metricCode: "REVENUE", format: (r) => (r.teamRevenue === null ? "—" : `₹${r.teamRevenue.toLocaleString("en-IN")}`) },
+];
diff --git a/src/config/routes/performance.routes.tsx b/src/config/routes/performance.routes.tsx
index 5a6f0cca..bdcde6a2 100644
--- a/src/config/routes/performance.routes.tsx
+++ b/src/config/routes/performance.routes.tsx
@@ -27,16 +27,17 @@ const NativePIPManagement            = lazy(() => import("@/pages/NativePIPManag
 const NativeCareerPlanning           = lazy(() => import("@/pages/NativeCareerPlanning"));
 const NativePerformanceFeedbackMyReports       = lazy(() => import("@/pages/NativePerformanceFeedbackMyReports"));
 const NativePerformanceFeedbackReportDetail    = lazy(() => import("@/pages/NativePerformanceFeedbackReportDetail"));
 const NativePerformanceFeedbackDevelopmentPlan = lazy(() => import("@/pages/NativePerformanceFeedbackDevelopmentPlan"));
 const NativePerformanceFeedbackAssignments     = lazy(() => import("@/pages/NativePerformanceFeedbackAssignments"));
 const NativePerformanceFeedbackForm            = lazy(() => import("@/pages/NativePerformanceFeedbackForm"));
 const NativePerformanceFeedbackTeamReports     = lazy(() => import("@/pages/NativePerformanceFeedbackTeamReports"));
 const PerformanceHub                 = lazy(() => import("@/pages/PerformanceHub"));
+const PerformanceCommandCenter       = lazy(() => import("@/pages/PerformanceCommandCenter"));
 const ExecutiveQualityDashboard = lazy(() => import("@/pages/ExecutiveQualityDashboard"));
 const NativeLMSMyLearning   = lazy(() => import("@/pages/NativeLMSMyLearning"));
 const NativeLMSCoordinator  = lazy(() => import("@/pages/NativeLMSCoordinator"));
 const LMSIntegrationAdmin   = lazy(() => import("@/pages/LMSIntegrationAdmin"));
 const NativeLMSIntegration  = lazy(() => import("@/pages/NativeLMSIntegration"));
 const LMSProgressDashboard  = lazy(() => import("@/pages/LMSProgressDashboard"));
 const LMSModuleLaunch       = lazy(() => import("@/pages/LMSModuleLaunch"));
 
@@ -54,16 +55,19 @@ export const performanceRouteElements = (
       <Route path="/performance-feedback/development-plan" element={<ProtectedRoute><NativePerformanceFeedbackDevelopmentPlan /></ProtectedRoute>} />
       <Route path="/performance-feedback/assignments"     element={<ProtectedRoute><NativePerformanceFeedbackAssignments /></ProtectedRoute>} />
       <Route path="/performance-feedback/form/:id"        element={<ProtectedRoute><NativePerformanceFeedbackForm /></ProtectedRoute>} />
       <Route path="/performance-feedback/team-reports"    element={<ProtectedRoute><NativePerformanceFeedbackTeamReports /></ProtectedRoute>} />
 
       {/* Performance Hub */}
       <Route path="/performance-hub" element={<ProtectedRoute><Gate pageCode="PERFORMANCE_HUB"><PerformanceHub /></Gate></ProtectedRoute>} />
 
+      {/* Performance Scorecard Command Center */}
+      <Route path="/performance-command-center" element={<ProtectedRoute><Gate pageCode="PERFORMANCE_SCORECARD_COMMAND_CENTER"><PerformanceCommandCenter /></Gate></ProtectedRoute>} />
+
       {/* Retired URLs kept resolvable.
           Both were removed from the ceo role on 31-Jul (rbacPageMatrix.ts) and deactivated
           in page_catalog by migration 1022, so the in-app launcher no longer offers them.
           Neither ever had a route, so anyone following an old link — or the URL printed in
           the UAT matrix, which is how the CEO reached them in both rounds — got a hard 404
           reading "Oops! Page not found".
           Redirecting is cheaper than building the pages and closes it for bookmarks and
           stale documents too, rather than only for the next reissue of the matrix. */}
diff --git a/src/pages/PerformanceCommandCenter.tsx b/src/pages/PerformanceCommandCenter.tsx
new file mode 100644
index 00000000..feb0fa73
--- /dev/null
+++ b/src/pages/PerformanceCommandCenter.tsx
@@ -0,0 +1,29 @@
+import { useState } from "react";
+import PerformanceScorecardTable from "@/components/performance-scorecard/PerformanceScorecardTable";
+import { useWfmScopeFilter } from "@/hooks/useWfmScopeFilter";
+import { Input } from "@/components/ui/input";
+
+export default function PerformanceCommandCenter() {
+  const { scopeDescription } = useWfmScopeFilter();
+  const [dateFrom, setDateFrom] = useState(() => {
+    const d = new Date();
+    d.setDate(d.getDate() - 30);
+    return d.toISOString().slice(0, 10);
+  });
+  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
+
+  return (
+    <div className="p-4 sm:p-6">
+      <div className="rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white p-6 mb-6">
+        <h1 className="text-2xl font-bold">Performance Scorecard</h1>
+        <p className="text-white/80 text-sm mt-1">{scopeDescription}</p>
+      </div>
+      <div className="flex items-center gap-2 mb-4">
+        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
+        <span className="text-gray-400">to</span>
+        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
+      </div>
+      <PerformanceScorecardTable dateFrom={dateFrom} dateTo={dateTo} />
+    </div>
+  );
+}
