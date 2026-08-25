commit b18cba8ec2d215d0e040c0b08a8749e621f034ef
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 04:38:45 2026 +0530

    fix: scope PERFORMANCE_SCORECARD dashboard access to manager/HR/CEO roles only

diff --git a/backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts b/backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts
index 2e6219c8..b0741452 100644
--- a/backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts
+++ b/backend/src/modules/dashboards/__tests__/dashboard-access-registry.test.ts
@@ -1,33 +1,33 @@
 import { describe, expect, it } from "vitest";
 import { readFileSync } from "node:fs";
 import { resolve } from "node:path";
 
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
 
   it("does not grant business dashboards to admin implicitly", () => {
     expect(canAccessDashboard("CEO_DASHBOARD", ["admin"])).toBe(false);
     expect(canAccessDashboard("SUPER_ADMIN_DASHBOARD", ["admin"])).toBe(false);
     expect(canAccessDashboard("SUPER_ADMIN_DASHBOARD", ["super_admin"])).toBe(true);
   });
 
   it("grants only explicitly listed role-dashboard combinations", () => {
@@ -36,47 +36,47 @@ describe("dashboard access registry", () => {
     expect(canAccessDashboard("QUALITY_DASHBOARD", ["recruiter"])).toBe(false);
     expect(getDashboardDefinition("NOT_A_DASHBOARD")).toBeNull();
   });
 
   it("matches the complete production role-dashboard matrix", () => {
     // Realigned to workforce_role_catalog (see workforceRoleCatalog.ts). Previously
     // `admin` expected [] — 8 real users held that role and could open nothing, while
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
   });
 
   it("enforces entitlement on dynamic and fixed dashboard API routes", () => {
     const routes = readFileSync(
       resolve(process.cwd(), "src/modules/dashboards/dashboard.routes.ts"),
       "utf8",
     );
diff --git a/backend/src/shared/dashboardAccessRegistry.ts b/backend/src/shared/dashboardAccessRegistry.ts
index 4b22ee68..5a43be9c 100644
--- a/backend/src/shared/dashboardAccessRegistry.ts
+++ b/backend/src/shared/dashboardAccessRegistry.ts
@@ -194,32 +194,32 @@ export const DASHBOARD_ACCESS_REGISTRY: Readonly<
     variant: "employee",
     displayName: "My Dashboard",
     route: "/my-dashboard",
     pageCode: "EMPLOYEE_SELF_DASHBOARD",
     allowedRoleKeys: ["employee", "agent", "trainee", "manager", "process_manager", "assistant_manager", "branch_head", "branch_manager", "team_leader", "tl", "recruiter", "qa", "quality_analyst", "quality_lead", "qa_manager", "operations_manager", "wfm", "ho_wfm", "wfm_spoc", "rta", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "payroll", "payroll_head", "payroll_branch", "payroll_admin", "payroll_hr", "ho_payroll", "finance", "finance_head", "accounts_head", "branch_finance", "it", "branch_it", "ho_it", "it_head", "tq_head", "ceo", "coo", "management", "admin", "branch_admin", "interviewer", "trainer", "super_admin"],
     scopeTypes: ["SELF"],
     sensitiveMetrics: ["attendance", "leave", "payroll", "performance"],
     permissions: { drilldown: true, export: false, filters: false },
   }),
   PERFORMANCE_SCORECARD: definition({
     code: "PERFORMANCE_SCORECARD",
     variant: "performance_scorecard",
     displayName: "Performance Scorecard",
     route: "/performance-scorecard/dashboard",
     pageCode: "PERFORMANCE_SCORECARD",
-    allowedRoleKeys: ["employee", "agent", "trainee", "manager", "process_manager", "assistant_manager", "branch_head", "branch_manager", "team_leader", "tl", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "ceo", "coo", "management", "super_admin"],
-    scopeTypes: ["SELF", "TEAM", "BRANCH", "PROCESS"],
+    allowedRoleKeys: ["manager", "process_manager", "assistant_manager", "branch_head", "branch_manager", "team_leader", "tl", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "ceo", "coo", "management", "super_admin"],
+    scopeTypes: ["ORGANISATION", "TEAM", "BRANCH", "PROCESS"],
     sensitiveMetrics: ["attendance", "performance", "attrition", "revenue"],
     permissions: { drilldown: true, export: true, filters: true },
   }),
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
