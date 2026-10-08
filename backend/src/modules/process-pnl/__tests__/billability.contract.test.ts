import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const repoRoot = path.resolve(backendRoot, "..");
const read = (fromRepoRoot: string) => fs.readFileSync(path.join(repoRoot, fromRepoRoot), "utf8");

const PAGE_CODE = "FINANCE_BILLABILITY_SEAT_COST";
const EXPECTED_ROLES = ["super_admin", "finance", "payroll_head", "payroll_branch"];

/**
 * The audience for this screen is stated in four places: the SQL grant, the API guard, the
 * route guard and the nav entry. They are independent files and nothing makes them agree.
 *
 * Each way of drifting fails differently and none of them fails loudly:
 *   grant missing a role   -> the page gate hides it; the user sees nothing and reports nothing
 *   API missing a role     -> the page loads and every save 403s
 *   route missing a role   -> the nav link is visible and leads to a denial
 *   nav missing a role     -> the page works but is unreachable unless the URL is typed
 *
 * FINANCE_COST_CENTRES is the live example of the first: a real route, a real page, a real
 * pageCode, and zero rows in role_page_access — invisible to everyone but super_admin.
 */
describe("billability screen — the four role lists agree", () => {
  it("grants exactly the intended roles in the migration", () => {
    const sql = read("backend/sql/1066_billability_page_access.sql");
    // Strip comment lines first: the rationale above the statement legitimately names roles
    // that are deliberately NOT granted, and a whole-file match would read those as grants.
    const sqlOnly = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

    // Collapse whitespace on BOTH sides — the VALUES list is column-aligned for readability,
    // so the gap between the role and the page code is padding, not a single space.
    const flat = sqlOnly.replace(/\s+/g, " ");
    for (const role of EXPECTED_ROLES) {
      expect(flat, `${role} should be granted ${PAGE_CODE}`).toContain(`'${role}', '${PAGE_CODE}'`);
    }
    // Count the grant rows so an accidental extra role is caught, not just a missing one.
    const grantRows = (sqlOnly.match(new RegExp(`'${PAGE_CODE}'`, "g")) ?? []).length;
    expect(grantRows, "one page_catalog row + one grant per role").toBe(EXPECTED_ROLES.length + 1);
  });

  it("guards the API with the same roles", () => {
    const routes = read("backend/src/modules/process-pnl/billability.routes.ts");
    const match = routes.match(/const BILLABILITY_ROLES = \[([^\]]*)\]/);
    expect(match, "BILLABILITY_ROLES must be declared as a literal array").not.toBeNull();
    const roles = Array.from(match![1].matchAll(/"([a-z_]+)"/g)).map((m) => m[1]);
    expect(roles.sort()).toEqual([...EXPECTED_ROLES].sort());
  });

  it("guards the route with the same roles", () => {
    const routes = read("src/config/routes/finance.routes.tsx");
    const match = routes.match(/const billabilityRoles = \[([^\]]*)\]/);
    expect(match, "billabilityRoles must be declared as a literal array").not.toBeNull();
    const roles = Array.from(match![1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
    expect(roles.sort()).toEqual([...EXPECTED_ROLES].sort());
  });

  it("is reachable — route, page code map and nav entry all exist", () => {
    // A service that imports cleanly can still have no route and no link. Assert the whole
    // chain a user actually walks: nav link -> route -> page code -> gate.
    const routes = read("src/config/routes/finance.routes.tsx");
    expect(routes).toContain('path="/finance/billability"');
    expect(routes).toContain(`pageCode="${PAGE_CODE}"`);
    expect(routes).toContain("BillabilitySeatCostPage");

    const nav = read("src/components/layout/navConfig.tsx");
    expect(nav).toContain('href: "/finance/billability"');
    expect(nav).toContain(PAGE_CODE);

    const codes = read("src/lib/pageRoutePageCodes.ts");
    expect(codes).toContain(`"/finance/billability": "${PAGE_CODE}"`);

    expect(fs.existsSync(path.join(repoRoot, "src/pages/finance/BillabilitySeatCostPage.tsx"))).toBe(true);
  });

  it("mounts the router on its own base", () => {
    const app = read("backend/src/app.ts");
    expect(app).toContain('app.use("/api/finance/billability", billabilityRouter)');
    expect(app).toContain("billability.routes.js");
  });

  it("registers both migrations — an unregistered file never runs", () => {
    const manifest = read("backend/src/db/runPendingMigrations.ts");
    expect(manifest).toContain('"1065_billability_seat_cost.sql"');
    expect(manifest).toContain('"1066_billability_page_access.sql"');
    expect(fs.existsSync(path.join(repoRoot, "backend/sql/1065_billability_seat_cost.sql"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "backend/sql/1066_billability_page_access.sql"))).toBe(true);
  });

  it("collates every new table explicitly", () => {
    // A table defaulting to utf8mb4_0900_ai_ci cannot carry an FK to employees(id), which is
    // utf8mb4_unicode_ci — it fails at CREATE with errno 3780, mid-migration.
    const sql = read("backend/sql/1065_billability_seat_cost.sql");
    const creates = sql.match(/CREATE TABLE IF NOT EXISTS/g) ?? [];
    const collations = sql.match(/COLLATE=utf8mb4_unicode_ci/g) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    expect(collations.length, "every CREATE TABLE needs an explicit COLLATE").toBe(creates.length);
  });
});
