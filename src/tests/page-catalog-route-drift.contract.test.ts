/**
 * Guards the gap that produced the CEO UAT's two hard 404s.
 *
 * page_catalog.page_path is a database copy of where a page lives, and
 * ModuleLauncher navigates users straight to it. When the two disagree, the user
 * lands on "Oops! Page not found" — there is no fallback.
 *
 * That is exactly what happened to WORKFORCE_COMMAND_CENTER:
 *   sql/170_access_improvements.sql seeded '/performance/command-center' (correct)
 *   sql/216_missing_page_catalog_entries.sql overwrote it with
 *     '/workforce/command-center' (never mounted) via
 *     ON DUPLICATE KEY UPDATE page_path = VALUES(page_path)
 * and eight roles — admin, branch_wfm, ceo, manager, operations_manager,
 * process_manager, super_admin, wfm — got a 404 from their own launcher.
 *
 * The existing contract test could not catch it. page-access-deployment.contract.test.ts
 * asserts every KEY of PAGE_CODE_BY_ROUTE is a mounted <Route>, but
 * WORKFORCE_COMMAND_CENTER had no entry in that map at all, so it was never checked.
 * Anything absent from the map is invisible to the whole test suite.
 *
 * This file closes that hole with a ratchet: the set of granted page codes that
 * lack a route mapping is pinned. It may shrink freely; growing it fails, which
 * forces the next person adding a grant to also say where the page lives.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAGE_CODE_BY_ROUTE, PAGE_CODE_BY_ROUTE_PATTERN } from "@/lib/pageRoutePageCodes";

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");

const ROUTE_GROUPS = [
  "dashboards",
  "people",
  "payroll",
  "performance",
  "compliance",
  "finance",
  "platform",
  "portal",
  "visitor",
];

const routeSource = ROUTE_GROUPS.map((group) => read(`src/config/routes/${group}.routes.tsx`)).join("\n");
const mountedRoutes = new Set(
  [...routeSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]),
);

const mappedCodes = new Set([
  ...Object.values(PAGE_CODE_BY_ROUTE),
  ...Object.values(PAGE_CODE_BY_ROUTE_PATTERN),
]);

/** Page codes granted to at least one role in the RBAC matrix. */
function grantedPageCodes(): Set<string> {
  const source = read("backend/src/shared/rbacPageMatrix.ts");
  // Only the code arrays, not prose in comments: page codes are SCREAMING_SNAKE
  // string literals, and comment bodies are stripped first.
  const withoutComments = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...withoutComments.matchAll(/"([A-Z][A-Z0-9_]{2,})"/g)].map((m) => m[1]));
}

/**
 * Granted page codes with no route mapping. These are invisible to the
 * mounted-route assertion in page-access-deployment.contract.test.ts, so each one
 * is a place where a page_catalog path could drift unnoticed.
 *
 * Shrinking this list is always welcome — add the route to PAGE_CODE_BY_ROUTE and
 * delete the entry here. Do not add to it.
 */
const KNOWN_UNMAPPED_PAGE_CODES = [
  "APPOINTMENT_ESIGN",
  "ATS_OFFER",
  "BENEFITS",
  "CLIENT_MASTER",
  "COACHING",
  "COMPLIANCE_DASHBOARD",
  "CUSTOMIZATION_MANAGER",
  "DIALER_INTEGRATION",
  "EMPLOYEES",
  "EMPLOYEE_EPF_COMPLIANCE",
  "FINANCE_HEAD_DASHBOARD",
  "HELPDESK",
  "IT_MANAGER_DASHBOARD",
  "KPI_DASHBOARD",
  "LEAVE_MANAGEMENT",
  "ORG_CHART",
  "ORG_MASTERS",
  "PERFORMANCE_DASHBOARD",
  "PROCESS_CONFIG",
  "PROCESS_MANAGER_DASHBOARD",
  "PROVISIONING_DASHBOARD",
  "SALARY_PREP",
  "SALARY_PROPOSAL_APPROVALS",
  "SALARY_REGISTER",
  "TEAM_ATTENDANCE",
  "WFM_ROSTER_MANAGER_QUEUE",
].sort();

describe("page catalog / router drift", () => {
  it("does not grow the set of granted page codes with no route mapping", () => {
    const unmapped = [...grantedPageCodes()].filter((code) => !mappedCodes.has(code)).sort();
    const added = unmapped.filter((code) => !KNOWN_UNMAPPED_PAGE_CODES.includes(code));

    expect(
      added,
      "These page codes are granted to a role but have no entry in PAGE_CODE_BY_ROUTE, " +
        "so nothing verifies that the page they point at actually exists. Add the route " +
        "mapping — that is what stops a page_catalog path silently 404ing, as " +
        "WORKFORCE_COMMAND_CENTER did for eight roles."
    ).toEqual([]);
  });

  it("keeps the workforce command centre mapped and mounted", () => {
    // The specific regression. Both halves matter: the mapping makes it visible to
    // the contract suite, and the route must actually exist.
    expect(mappedCodes.has("WORKFORCE_COMMAND_CENTER")).toBe(true);
    expect(PAGE_CODE_BY_ROUTE["/performance/command-center"]).toBe("WORKFORCE_COMMAND_CENTER");
    expect(mountedRoutes.has("/performance/command-center")).toBe(true);
  });

  it("never mounts the bad path that migration 216 wrote", () => {
    expect(mountedRoutes.has("/workforce/command-center")).toBe(false);
    expect(Object.keys(PAGE_CODE_BY_ROUTE)).not.toContain("/workforce/command-center");
  });

  it("ships a migration that repairs the drifted paths", () => {
    const migration = read("backend/sql/1022_page_catalog_path_reconciliation.sql");
    expect(migration).toMatch(/page_path = '\/performance\/command-center'/);
    expect(migration).toMatch(/page_code = 'WORKFORCE_COMMAND_CENTER'/);
    // And it must be manifested, or it can never run — the reason sql/601 and
    // sql/099 have sat unapplied.
    expect(read("backend/src/db/runPendingMigrations.ts")).toContain(
      '"1022_page_catalog_path_reconciliation.sql"',
    );
  });

  it("stops the launcher trusting a database path over the router", () => {
    const launcher = read("src/pages/ModuleLauncher.tsx");
    expect(launcher).toContain("ROUTE_BY_PAGE_CODE");
    expect(launcher).toMatch(/route_path:\s*\n?\s*ROUTE_BY_PAGE_CODE\[page\.page_code\]/);
  });

  it("no longer advertises pages that have no implementation to the CEO", () => {
    const rbac = read("backend/src/shared/rbacPageMatrix.ts");
    const ceoBlock = rbac.slice(rbac.indexOf("ceo: ["), rbac.indexOf("],", rbac.indexOf("ceo: [")));
    const codes = [...ceoBlock.matchAll(/"([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]);
    // /kpi/dashboard was never mounted; /advanced-reports is a redirect stub.
    expect(codes).not.toContain("KPI_DASHBOARD");
    expect(codes).not.toContain("ADVANCED_REPORTS");
    // The pages that replace them must still be there.
    expect(codes).toContain("OPERATIONS_KPI");
    expect(codes).toContain("REPORTS_CENTER");
    expect(codes).toContain("WORKFORCE_COMMAND_CENTER");
  });
});
