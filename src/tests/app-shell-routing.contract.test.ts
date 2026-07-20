import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("application shell routing contracts", () => {
  const appSource = read("src/App.tsx");
  const navSource = read("src/components/layout/navConfig.tsx");
  const routeSource = [
    "public",
    "dashboards",
    "people",
    "recruitment",
    "workforce",
    "payroll",
    "performance",
    "compliance",
    "finance",
    "platform",
    "portal",
    "visitor",
  ]
    .map((group) => read(`src/config/routes/${group}.routes.tsx`))
    .join("\n");

  it("mounts the canonical route elements and authenticated Copilot widget", () => {
    expect(appSource).toContain('import { appRouteElements } from "./config/routes"');
    expect(appSource).toContain("{appRouteElements}");
    expect(appSource).toContain("<AICommandBar />");
  });

  it("keeps every configured sidebar destination backed by a route", () => {
    const navPaths = [...navSource.matchAll(/href:\s*"([^"]+)"/g)]
      .map((match) => match[1].split("?")[0])
      .filter((path, index, all) => path.startsWith("/") && all.indexOf(path) === index);
    const routePaths = new Set(
      [...routeSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]),
    );

    expect(navPaths.filter((path) => !routePaths.has(path))).toEqual([]);
  });

  it("keeps canonical operational workspaces discoverable from the sidebar", () => {
    const requiredDestinations = [
      ["Employee Stat Cards", "/employee-stat-card"],
      ["Attendance Disputes", "/attendance/disputes"],
      ["Waiting Queue", "/ats/waiting-queue"],
      ["Enhanced Registration", "/ats/registration-enhanced"],
      ["Recruiter Portal", "/ats/recruiter-portal"],
      ["Name Consistency", "/ats/name-consistency"],
      ["ATS Reconciliation", "/ats/reconciliation"],
      ["ATS Extensions", "/ats/extensions"],
      ["Payroll HR Validation", "/ats/payroll-hr-validation"],
      ["Enhanced BGV", "/ats/bgv-enhanced"],
      ["Attendance Mismatch", "/wfm/mismatch-queue"],
      ["Attendance Billing", "/attendance/billing-config"],
      ["WFM Manager Approvals", "/wfm-manager-approvals"],
      ["KPI Master", "/kpi-master"],
      ["My KPI", "/my-kpi"],
      ["PIP Management", "/pip-management"],
      ["TAT Matrix", "/governance/tat-matrix"],
      ["TAT Dashboard", "/governance/tat-dashboard"],
      ["Incentives", "/payroll/incentives"],
      ["Bulk Outputs", "/payroll/bulk-outputs"],
      ["Payroll Sign-off", "/payroll/sign-off"],
      ["Reimbursements", "/payroll/reimbursements"],
      ["Salary Increment", "/salary-increment"],
      ["Vendors", "/vendors"],
      ["Procurement", "/procurement"],
      ["PeopleOS Copilot", "/peopleos/copilot"],
      ["Changelog", "/changelog"],
      ["Visitor Approvals", "/visitor-management/approvals"],
      ["Visitor Desk", "/visitor-management/desk"],
      ["Visitor Security", "/visitor-management/security"],
    ] as const;

    for (const [label, path] of requiredDestinations) {
      expect(navSource).toContain(`label: "${label}"`);
      expect(navSource).toContain(`href: "${path}"`);
    }
  });

  it("keeps restored legacy workspaces inside the shared HRMS shell", () => {
    const shellRequiredRoutes = [
      "/ats/name-consistency",
      "/ats/reconciliation",
      "/ats/bgv-enhanced",
      "/wfm/mismatch-queue",
      "/attendance/billing-config",
      "/my-kpi",
      "/salary-increment",
      "/peopleos/copilot",
      "/customization",
    ];

    for (const path of shellRequiredRoutes) {
      const routeIndex = routeSource.indexOf(`path="${path}"`);
      expect(routeIndex).toBeGreaterThanOrEqual(0);
      expect(routeSource.slice(routeIndex, routeIndex + 600)).toContain("<DashboardLayout>");
    }
  });

  it("does not use empty values in vendor Select items", () => {
    const vendorSource = read("src/pages/NativeVendorManagement.tsx");

    expect(vendorSource).toContain('<SelectItem value="_all">All types</SelectItem>');
    expect(vendorSource).not.toContain('<SelectItem value="">');
  });

  it("opens the dedicated employee stat card instead of redirecting to the directory", () => {
    expect(routeSource).toContain(
      'path="/employee-stat-card" element={<ProtectedRoute><NativeEmployeeStatCard /></ProtectedRoute>}',
    );
    expect(routeSource).not.toContain(
      'path="/employee-stat-card" element={<Navigate to="/employees" replace />}',
    );
  });

  it("keeps only intentional public, redirect, detail, and legacy routes outside navigation", () => {
    const intentionallyNonSidebarRoutes = new Set([
      "/",
      "/advanced-reports",
      "/ats/branch-head-approval",
      "/ats/candidate-registration",
      "/ats/command-centre",
      "/ats/dashboard",
      "/ats/dashboard-v2",
      "/ats/payroll-hr",
      "/ats/recruiter/calling-dashboard",
      "/ats/recruiter/calling-entry",
      "/ats/recruiter/workspace",
      "/attendance-regularization",
      "/auth",
      "/candidate-onboarding-full",
      "/candidate-portal/dashboard",
      "/candidate-portal/login",
      "/candidate-registration",
      "/change-password",
      "/customization/new",
      "/display/waiting-room",
      "/employee-lifecycle-v2",
      "/engagement/command-center",
      "/exit/resignation-command-center",
      "/features",
      "/goals",
      "/how-it-works",
      "/hr-onboarding-requests",
      "/interview-registration",
      "/it-provisioning",
      "/jobs",
      "/leave-approvals",
      "/lms",
      "/lms/management-dashboard",
      "/lms/module-launch",
      "/login",
      "/management/ceo-command-center",
      "/master-reports",
      "/onboard",
      "/onboard-full",
      "/onboard-full-legacy",
      "/onboarding-requests",
      "/onboard-v1",
      "/portal",
      "/portal/login",
      "/pricing",
      "/privacy-policy",
      "/reports/enterprise",
      "/reset-password",
      "/reviews-management",
      "/security",
      "/terms-of-service",
      "/two-factor",
      "/walkin-registration",
      "/wfm/adherence-command-center",
      "/wfm/agent-attendance-view",
      "/wfm/break-desk-devices",
      "/wfm-roster",
    ]);
    const navPaths = new Set(
      [...navSource.matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1].split("?")[0]),
    );
    const staticRoutePaths = [
      ...routeSource.matchAll(/<Route\s+path="([^"]+)"/g),
    ]
      .map((match) => match[1])
      .filter((path) => !path.includes(":") && !path.includes("*"));
    const unexpectedHiddenRoutes = staticRoutePaths
      .filter((path) => !navPaths.has(path) && !intentionallyNonSidebarRoutes.has(path))
      .sort();

    expect(unexpectedHiddenRoutes).toEqual([]);
  });

  it("keeps sales performance out of shared role dashboards", () => {
    const referenceDashboard = read("src/pages/dashboards/ReferenceRoleDashboard.tsx");
    const roleDashboard = read("src/pages/dashboards/RoleDashboardV3.tsx");

    expect(referenceDashboard).not.toContain("RoleSalesPerformancePanel");
    expect(roleDashboard).not.toContain("RoleSalesPerformancePanel");
  });

  it("uses the available new-joiner metric for the onboarding employee card", () => {
    const employeeHookSource = read("src/hooks/useEmployees.ts");

    expect(employeeHookSource).toContain("stats.onboarding_employees ?? stats.new_joiners_90d ?? 0");
  });

  it("loads WFM device health from the mounted COSEC monitoring API", () => {
    const referenceDashboard = read("src/pages/dashboards/ReferenceRoleDashboard.tsx");

    expect(referenceDashboard).toContain("/api/integrations/cosec/sync-status");
    expect(referenceDashboard).not.toContain("/api/wfm/biometric-summary/device-status");
  });
});
