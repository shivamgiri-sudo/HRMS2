STAT:
commit 417be5416eeae187872723b8b7f2d78546a9d279
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 04:30:43 2026 +0530

    feat: register PERFORMANCE_SCORECARD dashboard metrics
    
    Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

 .../dashboards/dashboard-definition.service.ts     | 32 +++++++++++++++++++++-
 backend/src/shared/dashboardAccessRegistry.ts      | 14 +++++++++-
 2 files changed, 44 insertions(+), 2 deletions(-)

FULL DIFF:
commit 417be5416eeae187872723b8b7f2d78546a9d279
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 04:30:43 2026 +0530

    feat: register PERFORMANCE_SCORECARD dashboard metrics
    
    Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

diff --git a/backend/src/modules/dashboards/dashboard-definition.service.ts b/backend/src/modules/dashboards/dashboard-definition.service.ts
index cd5eab21..68b2ac80 100644
--- a/backend/src/modules/dashboards/dashboard-definition.service.ts
+++ b/backend/src/modules/dashboards/dashboard-definition.service.ts
@@ -11,51 +11,69 @@ import {
   getDpdpWithdrawalMetrics,
   getHeadcountMetrics,
   getIncentiveMetrics,
   getJoiningDocEsignMetrics,
   getLeaveApprovalMetrics,
   getNameMismatchMetrics,
   getOnboardingMetrics,
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
   | "resign"
   | "dpdp"
   | "appointmentEsign"
   | "bgv"
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
   denominatorKey?: string;
   /**
    * Direction of goodness, used to seed dashboard_metric_catalog.higher_is_better and to
    * decide whether a value above its target reads as good or critical.
    *
    * This must equal the flag the metric passes to wrapEnriched; the two are different
    * expressions of one fact and drifting them would make a tile show "good" for a rising
@@ -75,30 +93,38 @@ const METRICS: Readonly<Record<MetricKey, MetricDefinition>> = {
   incentive: { code: "INCENTIVE", label: "Pending incentive batches", unit: "batches", source: "Incentive upload", sourceTable: "incentive_upload_batch", higherIsBetter: false, moduleCode: "payroll", execute: getIncentiveMetrics },
   tat: { code: "TAT", label: "Open TAT items", unit: "items", source: "TAT governance", sourceTable: "task_tat_instance", higherIsBetter: false, moduleCode: "governance", execute: getTatMetrics },
   resign: { code: "RESIGNATION", label: "Active exits", unit: "requests", source: "Exit management", sourceTable: "exit_request", higherIsBetter: false, moduleCode: "exit", execute: getResignationMetrics },
   dpdp: { code: "DPDP", label: "Pending DPDP requests", unit: "requests", source: "DPDP consent withdrawal", sourceTable: "dpdp_consent_withdrawal", higherIsBetter: false, moduleCode: "compliance", execute: getDpdpWithdrawalMetrics },
   appointmentEsign: { code: "APPOINTMENT_ESIGN", label: "Appointment eSign pending", unit: "requests", source: "Appointment letters", sourceTable: "appointment_letter_request", higherIsBetter: false, moduleCode: "onboarding", execute: getAppointmentEsignMetrics },
   bgv: { code: "BGV", label: "BGV pending", unit: "candidates", source: "Candidate BGV", sourceTable: "candidate_bgv_check", higherIsBetter: false, moduleCode: "ats", execute: getBgvMetrics },
   nm: { code: "NAME_MISMATCH", label: "Name mismatches", unit: "candidates", source: "Name match summary", sourceTable: "candidate_name_match_summary", higherIsBetter: false, moduleCode: "ats", execute: getNameMismatchMetrics },
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
  * donut, so four KPI cards and a chart were permanently blank on the most privileged
  * dashboard — with no UI change needed to fix them once the bundle is populated.
  *
  * Bundles are chosen against sources that actually hold rows. `tat` is deliberately
  * absent everywhere it was not already present: task_tat_instance is empty in
  * production, so adding it would ship more blank tiles.
  */
@@ -126,30 +152,34 @@ const DASHBOARD_METRICS: Readonly<Record<DashboardCode, readonly MetricKey[]>> =
   WFM_DASHBOARD: ["hc", "att", "attException", "biometric"],
   // "hc" added — WfmAttendanceReferenceLayout.tsx's first tile, "Total Employees",
   // reads metricDetail(m, "hc", "active") but this bundle never requested it, so
   // it rendered a permanent blank. getHeadcountMetrics is cheap post-fix (already
   // parallelized this session), so there's no cost concern to adding it here.
   WFM_ATTENDANCE_DASHBOARD: ["hc", "att", "attException", "biometric"],
   PAYROLL_HR_DASHBOARD: ["payroll", "incentive", "salaryComponents", "attException"],
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
 
 /**
  * A metric-supplied `asOf` is usually a bare date ("2026-08-11" — the day the metric's
  * own query is anchored on), not a full ISO datetime, so it fails the contract's
  * `z.string().datetime()` check as-is. Anchoring it to midnight UTC keeps the day the
  * metric actually describes while still satisfying the schema. Falls back to the
  * request's own generation time when the metric didn't compute one of its own.
  */
diff --git a/backend/src/shared/dashboardAccessRegistry.ts b/backend/src/shared/dashboardAccessRegistry.ts
index a2576b40..4b22ee68 100644
--- a/backend/src/shared/dashboardAccessRegistry.ts
+++ b/backend/src/shared/dashboardAccessRegistry.ts
@@ -1,28 +1,29 @@
 export type DashboardCode =
   | "SUPER_ADMIN_DASHBOARD"
   | "CEO_DASHBOARD"
   | "HR_DASHBOARD"
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
 
 export type DashboardAccessDefinition = {
   code: DashboardCode;
   variant: string;
   displayName: string;
   route: string;
   pageCode: string;
@@ -187,30 +188,41 @@ export const DASHBOARD_ACCESS_REGISTRY: Readonly<
     scopeTypes: ["BRANCH", "PROCESS", "TEAM"],
     sensitiveMetrics: ["performance", "attendance", "attrition"],
     permissions: { drilldown: true, export: true, filters: true },
   }),
   EMPLOYEE_SELF_DASHBOARD: definition({
     code: "EMPLOYEE_SELF_DASHBOARD",
     variant: "employee",
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
+    pageCode: "PERFORMANCE_SCORECARD",
+    allowedRoleKeys: ["employee", "agent", "trainee", "manager", "process_manager", "assistant_manager", "branch_head", "branch_manager", "team_leader", "tl", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "ceo", "coo", "management", "super_admin"],
+    scopeTypes: ["SELF", "TEAM", "BRANCH", "PROCESS"],
+    sensitiveMetrics: ["attendance", "performance", "attrition", "revenue"],
+    permissions: { drilldown: true, export: true, filters: true },
+  }),
 });
 
 export function normalizeDashboardRole(value: unknown): string {
   const normalized = String(value ?? "").trim().toLowerCase();
   return DASHBOARD_ROLE_ALIASES[normalized] ?? normalized;
 }
 
 // Lazy-built map from variant name → DashboardCode for backward-compat aliases
 // e.g. "hr" → "HR_DASHBOARD", "wfm" → "WFM_DASHBOARD"
 let _variantIndex: Map<string, DashboardCode> | null = null;
 function variantIndex(): Map<string, DashboardCode> {
   if (!_variantIndex) {
     _variantIndex = new Map();
     for (const def of Object.values(DASHBOARD_ACCESS_REGISTRY)) {
       if (def.variant) _variantIndex.set(def.variant.toLowerCase(), def.code);
