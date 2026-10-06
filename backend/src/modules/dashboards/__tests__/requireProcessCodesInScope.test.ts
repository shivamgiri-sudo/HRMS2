/**
 * BLA BLI BLU dashboard scope. It is its own process (BLA_BLI_BLU, NOIDA-2); the router used to check
 * Bellavita (BELLA_VITA, NOIDA) and so refused BLA BLI BLU's own process managers (Bhavesh Dayal,
 * 2026-10-06, whose scope holds BLA_BLI_BLU but not BELLA_VITA).
 */
import { describe, expect, it, vi } from "vitest";

const { execute, isOrgWide } = vi.hoisted(() => ({ execute: vi.fn(), isOrgWide: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ buildScopeWhereClause: async () => ({ sql: "1=1", params: [] }) }));
vi.mock("../../analytics-catalogue/scope.js", () => ({ ANALYTICS_VIEWER_ROLES: [], isOrgWide }));
vi.mock("../../tpz-access/tpz-access.middleware.js", () => ({ accessOf: vi.fn() }));

const { requireProcessCodesInScope } = await import("../process-scope-guards.js");

function run(method: string, processCodes: string[], orgWide = false) {
  isOrgWide.mockResolvedValue(orgWide);
  execute.mockResolvedValue([processCodes.map((c, i) => ({ id: `p${i}`, process_code: c }))]);
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn();
  return requireProcessCodesInScope(["BLA_BLI_BLU"])({ method, authUser: { id: "u1" } }, res, next).then(() => ({ res, next }));
}

describe("requireProcessCodesInScope(['BLA_BLI_BLU'])", () => {
  it("lets in a process manager whose scope holds BLA_BLI_BLU though not BELLA_VITA", async () => {
    const { next, res } = await run("GET", ["BTM", "BLA_BLI_BLU", "REGINALD"]);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("refuses a caller whose scope has only Bellavita", async () => {
    const { next, res } = await run("GET", ["BELLA_VITA"]);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("lets org-wide callers through", async () => {
    const { next } = await run("GET", [], true);
    expect(next).toHaveBeenCalledWith();
  });

  it("leaves writes to their own role guards", async () => {
    const { next } = await run("POST", []);
    expect(next).toHaveBeenCalledWith();
  });
});
