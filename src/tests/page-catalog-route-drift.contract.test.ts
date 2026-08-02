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
import {
  UNROUTED_GRANTED_CODES,
  UNROUTED_GRANTED_PAGE_CODES,
  INHERITED_UNCLASSIFIED_COUNT,
} from "@/config/rbac/unroutedGrantedPageCodes";

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
 * Granted page codes with no route mapping now live in an evidence-carrying register:
 * src/config/rbac/unroutedGrantedPageCodes.ts
 *
 * The bare array that used to sit here listed twenty-six codes and nothing else — no reason,
 * no evidence, no decision. Adding a line made this contract pass and asserted nothing.
 * The register requires a disposition per code and is self-tested below.
 */

describe("page catalog / router drift", () => {
  it("does not grow the set of granted page codes with no route mapping", () => {
    const unmapped = [...grantedPageCodes()].filter((code) => !mappedCodes.has(code)).sort();
    const added = unmapped.filter((code) => !UNROUTED_GRANTED_CODES.includes(code));

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

  it("never serves the bad path that migration 216 wrote as a real page", () => {
    // The drift this guards against is the Command Center being *mounted* at the path
    // migration 216 wrote, which is how the catalog and the router disagreed. A redirect
    // to the canonical path is the opposite of that: it resolves the old URL without
    // giving it a page of its own, so the old links printed in the UAT matrix stop 404ing.
    const routeSource = read("src/config/routes/performance.routes.tsx");
    const index = routeSource.indexOf('path="/workforce/command-center"');
    if (index > -1) {
      const element = routeSource.slice(index, index + 200);
      expect(element, "the bad path must only ever be a redirect").toContain(
        '<Navigate to="/performance/command-center"',
      );
    }
    // It must still never be the page code's canonical route.
    expect(PAGE_CODE_BY_ROUTE["/workforce/command-center"]).toBeUndefined();
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

/**
 * The register replaces a bare allowlist, so it has to be harder to abuse than one.
 *
 * Two properties matter. A code may only be in it if it genuinely has no route — otherwise
 * the register becomes a way to skip mapping. And the inherited, uninvestigated backlog may
 * not grow — otherwise "unclassified" becomes the new allowlist.
 */
describe("unrouted granted page code register", () => {
  const mapped = new Set(Object.values(PAGE_CODE_BY_ROUTE));

  it("only holds codes that really have no route mapping", () => {
    const wronglyRegistered = UNROUTED_GRANTED_PAGE_CODES.filter((e) => mapped.has(e.code)).map(
      (e) => e.code,
    );
    expect(
      wronglyRegistered,
      "These codes DO have a route mapping, so they must not be registered as unrouted — " +
        "registering a mapped code hides it from the drift assertion for no reason.",
    ).toEqual([]);
  });

  it("requires a disposition and evidence for every entry", () => {
    for (const entry of UNROUTED_GRANTED_PAGE_CODES) {
      expect(entry.evidence.trim().length, `${entry.code} has no evidence`).toBeGreaterThan(30);
      if (entry.disposition !== "unclassified") {
        expect(
          entry.proposedAction.trim().length,
          `${entry.code} is classified as "${entry.disposition}" but proposes no action`,
        ).toBeGreaterThan(30);
      }
    }
  });

  it("does not let the uninvestigated backlog grow", () => {
    // Fixed at what was inherited on 2026-08-03. A new unrouted grant must be investigated
    // and classified, not appended to the pile that already had no reasons recorded.
    const unclassified = UNROUTED_GRANTED_PAGE_CODES.filter((e) => e.disposition === "unclassified");
    expect(
      unclassified.length,
      "The uninvestigated backlog grew. Classify the new code with evidence and a proposed " +
        "action instead of adding it to the inherited list.",
    ).toBeLessThanOrEqual(INHERITED_UNCLASSIFIED_COUNT);
  });

  it("keeps the sixteen investigated codes in the RBAC matrix, not deleted from it", () => {
    // The correction that produced this file. LIVE_IMPORTED_PAGE_CODES records what
    // production's role_page_access actually grants, and apply-rbac-page-matrix.mjs revokes
    // every grant absent from the matrix — so deleting an entry there is a revocation, not a
    // cleanup. Removing HELPDESK_KB and ENGAGEMENT_COMMAND_CENTER would have revoked them for
    // all 1,357 employees. Revocation belongs in migration 1061, deliberately and reviewed.
    const matrix = readFileSync(
      resolve(process.cwd(), "backend/src/shared/rbacPageMatrix.ts"),
      "utf8",
    );
    for (const entry of UNROUTED_GRANTED_PAGE_CODES) {
      if (entry.disposition === "unclassified") continue;
      expect(
        matrix.includes(`"${entry.code}"`),
        `${entry.code} was removed from rbacPageMatrix.ts. That makes the applier revoke it ` +
          `in production. Propose the revocation in backend/sql/1061_... instead.`,
      ).toBe(true);
    }
  });
});
