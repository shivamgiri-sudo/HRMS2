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
      ["Attendance Integrity", "/wfm/attendance-integrity"],
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
      "/wfm/attendance-integrity",
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
      // The four pre-merge attendance paths (Task 6 of the WFM attendance-page merge) —
      // each is now a bare query-string-preserving redirect into /wfm/attendance-integrity
      // (AttendanceIntegrityRedirect), which is what the sidebar links to instead. Kept
      // resolvable for bookmarks and the reference dashboards' deep links, but they no
      // longer render a page of their own, so they don't belong in the sidebar.
      "/attendance/billing-config",
      "/wfm/attendance-exceptions",
      "/wfm/cosec-monitoring",
      "/wfm/mismatch-queue",
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
      // Redirect-only since 2026-08-27: SalaryPackageManager writes phantom columns
      // (grade_id/slab_id/basic_amt) that salary_package_master does not have, so its save
      // never worked. The sidebar entry now points at /payroll/package-admin, which posts
      // the real columns; this URL redirects there for bookmarks.
      "/payroll/salary-packages",
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
      // Public exit-pass verification page (commit 5c5514ca, "public QR verify page") —
      // same class as the visitor-gate pages below: reached by scanning a printed QR
      // code, never from the sidebar. Missing here for the same reason /visitor-gate
      // once was: the route was mounted without an allowlist entry.
      "/verify/gp",
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

      // ── Added 2026-08-28. Each route below was checked for inbound links from a
      // non-route, non-nav source file, so the three groups are evidence, not labels.

      // (a) Opened from a parent screen — the case this list was created for. Link counts
      // are inbound references from real pages: statutory-filing 4, statutory 4,
      // branch-readiness 3, process-readiness 3, bank-readiness 2, disbursal 2,
      // statutory-config 2, and one each for the rest.
      "/compliance/audit-report",
      "/compliance/labour",
      "/compliance/statutory",
      "/payroll/bank-readiness",
      "/payroll/branch-readiness",
      "/payroll/cost-summary",
      "/payroll/disbursal",
      "/payroll/process-readiness",
      // Added 2026-09-03 with the cost-centre attendance sign-off. A drill-down, not a page:
      // PayrollReadinessDashboard links to it twice as
      // /payroll/readiness/cost-centres?branchId=…&month=…, and it shares that dashboard's own
      // page code (PAYROLL_BRANCH_READINESS). A sidebar entry would open it with no branch.
      "/payroll/readiness/cost-centres",
      "/payroll/run-lifecycle",
      "/payroll/statutory-config",
      "/payroll/statutory-filing",
      "/payroll/variance",
      "/payroll/variance-analysis",

      // (b) Prototypes and comparison harnesses. Deliberately unlinked; kept because
      // CLAUDE.md forbids deleting page flows to simplify, not because they are wanted.
      "/onboard-full-v2",
      "/onboarding-demo",
      "/onboarding-step10-demo",
      "/profile-compare",
      "/profile-enhanced",
      "/profile-v2",
      "/profile-v3",
      "/profile-v3-demo",
      "/ux-skill-compare",
      "/ux-skill-demo",

      // (c) Unlinked because their backend does not answer. Putting one in the sidebar would
      // advertise a page that cannot load.
      //
      // /wfm/tni-analysis LEFT this group on 2026-08-28 and is now in the menu: its two
      // /api/quality-dashboard/tni-* endpoints turned out to be a fully-written service that
      // nothing imported, and mounting them was the whole fix. Its LMS-assign action is still
      // unbuilt, but that is one action on a page whose analysis now works, not a page that
      // cannot load.
      //
      // /ops/command-center stays. It is not only the two unserved endpoints
      // (/api/call-master/inbound/today, /api/operations-live/summary) — the page also
      // hardcodes its Escalation Signals and Process Utilization sections to empty arrays
      // behind "mock for now - replace with real endpoints" comments. Serving the two feeds
      // would still leave half the screen stubbed, so linking it is premature regardless.
      "/ops/command-center",

      // (d) Was an undifferentiated "ORPHANED — someone must decide" block. Each of the eight
      // has since been checked against the router, page_catalog and role_page_access, and they
      // are not one problem. /bulk-upload/approvals is gone from this list entirely: it is now
      // in navConfig, which is what it always needed.

      // (d1) Redirects. `<Navigate to=... replace />` shims onto a tab of a page that IS in the
      // menu — exactly the "redirect" category this list's own header names. Nothing orphaned.
      //   salary-disputes/{queue,team} -> /payroll/salary-disputes?tab=... (in navConfig)
      "/payroll/salary-disputes/queue",
      "/payroll/salary-disputes/team",
      "/payroll/salary-package-manager",
      //   /ats/bgv-enhanced, /ats/bgv-report -> /ats/bgv (in navConfig). Both pages were
      //   retired by c0203458; the routes stay only so old bookmarks land on the canonical
      //   BGV verification center.
      "/ats/bgv-enhanced",
      "/ats/bgv-report",

      // (d2) ⚠️ Gated shut, so a menu entry would be a dead link. FINANCE_CLIENT_PAYMENTS has
      // NO page_catalog row and ZERO role grants, so <Gate> denies every user — the page is
      // unreachable today even by URL. Registering and granting the page code is a governance
      // action, not a nav change; linking it first would only add a menu item nobody can open.
      "/finance/client-payments",

      // (d3) Reachable (WFM_ROSTER: 8 roles, 64 users) and backed by live endpoints, but each
      // raises an information-architecture question a contract test cannot answer:
      //   roster-analytics-panel — RosterAnalyticsPanel, a DIFFERENT component from the
      //     RosterAnalyticsDashboard already in the menu at /wfm/roster-analytics. Which is
      //     canonical is an owner's call; linking both would put two "Roster Analytics" entries
      //     side by side.
      //   mobile-attendance — a phone-oriented view of a desktop page that is already in the
      //     menu; plausibly meant to be opened on a device rather than listed in a sidebar.
      "/wfm/mobile-attendance",
      "/wfm/roster-analytics-panel",

      // (d4) Ungated (ProtectedRoute only, no pageCode) and overlapping two entries already in
      // the menu — "Onboarding Bridge" and "Onboarding Requests". Whether this hub supersedes
      // them or predates them is not answerable from the routing table.
      "/ats/onboarding",

      // (d5) Token-gated KPI capture page — opened via a direct link with an access token,
      // not navigable from the sidebar.
      "/kpi-capture",

      // (d6) Drill-down of a page that IS in the menu. BranchCostCentreAttendance is reached
      // from PayrollReadinessDashboard by <Link to="/payroll/readiness/cost-centres?branchId=
      // ...&month=..."> in two places (the branch row and the detail panel), and it is
      // meaningless without those parameters — a sidebar entry would open it for no branch and
      // no month. It carries the same pageCode as its parent (PAYROLL_BRANCH_READINESS, see
      // pageRoutePageCodes.ts), so it inherits the parent's access rather than needing a grant
      // of its own.
      "/payroll/readiness/cost-centres",
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
