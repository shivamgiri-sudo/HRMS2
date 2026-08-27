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

    expect(routeSource).toContain(
      'path="/ats/bgv-enhanced" element={<Navigate to="/ats/bgv" replace />}',
    );
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
      // Routes reachable from a parent screen rather than the sidebar: payroll sub-queues
      // opened from the payroll workspace, report detail pages opened from the report
      // library, IJP from recruitment, and so on. Listing them here is what distinguishes
      // "deliberately not in the menu" from "someone forgot to add it" — which is the whole
      // point of this test, and the sixteen added below had accumulated unlisted.
      "/",
      "/admin/report-audit",
      "/advanced-reports",
      "/ats/branch-head-approval",
      "/ats/candidate-registration",
      "/ats/command-centre",
      "/ats/dashboard",
      "/ats/dashboard-v2",
      "/ats/payroll-hr",
      // Consolidated into /ats/onboarding-requests (commit 49efe7fd, "remove duplicate
      // payroll-hr-validation page") — this path is now only a <Navigate> redirect for old
      // links/bookmarks, not a real destination, so it no longer belongs in the sidebar.
      "/ats/payroll-hr-validation",
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
      // Retired module. These five now redirect to /payroll/reimbursements, which is
      // what the sidebar links to instead — the backing tables (expense_claims,
      // expense_items, …) have never existed in mas_hrms, so every page 500'd.
      // Kept as redirects rather than deleted so existing links and bookmarks land
      // somewhere useful. See src/config/routes/finance.routes.tsx.
      "/expenses",
      "/expenses/approvals",
      "/expenses/finance",
      "/expenses/new",
      "/expenses/reports",
      "/exit/resignation-command-center",
      "/features",
      "/finance/process-pnl/lobs",
      "/goals",
      "/how-it-works",
      "/hr-onboarding-requests",
      "/interview-registration",
      "/it-provisioning",
      // Retired pages kept resolvable as redirects rather than 404s. Both were removed
      // from the ceo role on 31-Jul and deactivated in page_catalog by migration 1022, so
      // neither belongs in the sidebar — but the URLs are still printed in the UAT matrix
      // and in bookmarks, and both returned "Oops! Page not found" in two rounds of CEO
      // testing. /kpi/dashboard -> /operations-kpi, /workforce/command-center ->
      // /performance/command-center.
      "/kpi/dashboard",
      "/jobs",
      "/leave-approvals",
      "/leave/requests",
      "/lms",
      "/lms/management-dashboard",
      "/lms/module-launch",
      "/login",
      "/management/ceo-command-center",
      "/master-reports",
      "/my-report-requests",
      // Redirect-only since the 2026-08-27 de-duplication: its component made no network
      // calls at all, so every toggle a user set there was discarded. The sidebar entry was
      // removed and this URL now redirects to /communication/preferences, which saves.
      "/notification-preferences",
      "/onboard",
      "/onboard-full",
      "/onboard-full-legacy",
      "/onboard-v1",
      "/onboarding-requests",
      "/payroll/cheque-validation",
      "/payroll/holiday-work-approvals",
      "/payroll/holiday-work-requests",
      "/payroll/pf-batches",
      "/payroll/pf-creation-queue",
      "/people/ijp",
      "/portal",
      "/portal/login",
      "/pricing",
      "/privacy-policy",
      "/quality/audit",
      "/recruitment/ijp",
      "/reports/control-room",
      "/reports/enterprise",
      "/reports/library",
      "/reports/source-validation",
      "/reset-password",
      "/reviews-management",
      // Admin surface for the Social Media page, gated to super_admin/hr_admin/admin and
      // opened from /social-feed — which is itself in the sidebar. Same class as the other
      // parent-screen entries above, not a forgotten menu item.
      "/social-feed/admin",
      "/security",
      "/super-admin/live-location",
      "/terms-of-service",
      "/two-factor",
      // Public kiosk/gate pages, same class as the two below: reached by QR or a
      // direct link at reception, never from the sidebar. /visitor-gate was mounted
      // without an allowlist entry, which left this contract red on main.
      "/visitor-gate",
      "/visitor-register",
      "/visitor-status",
      "/walkin-registration",
      "/workforce/command-center",
      "/wfm-roster",
      "/wfm/adherence-command-center",
      "/wfm/agent-attendance-view",
      "/wfm/break-desk-devices",
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

    expect(referenceDashboard).not.toContain("RoleSalesPerformancePanel");
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
