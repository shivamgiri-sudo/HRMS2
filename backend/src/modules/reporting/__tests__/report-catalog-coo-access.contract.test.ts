import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * IMPORTANT-2 (final whole-branch review): reporting.scope.ts grants 'coo' the same org-wide
 * SCOPE as 'ceo' (see reporting-scope-roles.contract.test.ts), but reportCatalogAccessMiddleware
 * runs BEFORE scope resolution and 403s any role absent from a report's viewRoles list.
 * ROLES_ALL_MANAGEMENT -- the viewRoles list behind ~130 catalog reports, including every AON
 * report -- listed 'ceo' but not 'coo', so a COO was refused every one of those reports before
 * the scope fix could ever be consulted. The scope grant was inert.
 */
const SRC = readFileSync(resolve(process.cwd(), "src/modules/reporting/report-catalog.ts"), "utf8");
const roleList = () => /const ROLES_ALL_MANAGEMENT\s*=\s*\[([^\]]*)\]/.exec(SRC)?.[1] ?? "";

describe("report catalog ROLES_ALL_MANAGEMENT", () => {
  it("includes coo alongside ceo, so the org-wide scope grant is reachable", () => {
    expect(roleList(), "ceo must still be listed").toContain('"ceo"');
    expect(roleList(), "coo must be listed alongside ceo").toContain('"coo"');
  });
});
