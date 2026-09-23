import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Audit item 26 — static contract over process-pnl.routes.ts.
 *
 * 1. The three routes feeding one Process P&L page load (CEO Overview, YTD strip, Live P&L) must
 *    resolve role scope from the SAME source, actor(req).roles, so a user can never be scoped to
 *    different branches on different panels of the same page.
 * 2. /pnl/statement carries no requireRole of its own; it is gated ONLY by the prefix-level
 *    router.use("/pnl", requireRole(...PNL_READ_ROLES)). That is correct only while the use() is
 *    registered BEFORE the route — this pins the order so a refactor cannot silently open it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(here, "../process-pnl.routes.ts"), "utf8");

function routeBlock(routePath: string): string {
  const start = source.indexOf(`"${routePath}"`);
  expect(start, `${routePath} route not found`).toBeGreaterThan(-1);
  const next = source.indexOf("router.", start + routePath.length);
  return source.slice(start, next === -1 ? undefined : next);
}

describe("P&L page routes resolve role scope from one source", () => {
  for (const route of ["/pnl/ceo-overview", "/pnl/ytd-summary", "/pnl/reconciliation"]) {
    it(`${route} reads roles through actor(req), never req.userRoles directly`, () => {
      const block = routeBlock(route);
      expect(block).toContain("requireRole(...PNL_READ_ROLES)");
      expect(block).toContain("userRoles: user.roles");
      expect(block).not.toContain("userRoles: req.userRoles");
    });
  }
});

describe("/pnl/statement access gate", () => {
  it("is registered after the /pnl prefix requireRole(...PNL_READ_ROLES) gate", () => {
    const gate = source.indexOf(`router.use("/pnl", requireRole(...PNL_READ_ROLES))`);
    const statement = source.indexOf(`router.get("/pnl/statement"`);
    expect(gate, "prefix gate missing").toBeGreaterThan(-1);
    expect(statement, "statement route missing").toBeGreaterThan(-1);
    expect(gate, "the prefix gate must run before /pnl/statement").toBeLessThan(statement);
  });
});
