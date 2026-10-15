import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const resolveDashboardScope = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { query: (...a: unknown[]) => query(...a) } }));
vi.mock("../../../shared/dashboardScope.js", () => ({
  resolveDashboardScope: (...a: unknown[]) => resolveDashboardScope(...a),
}));

import { resolveHeadBranches } from "../scope.js";

const EMPTY = "No MAS Call Net branch in your scope";
const row = (id: string, code: string, name: string) => ({ id, branch_code: code, branch_name: name });

function scope(level: string, branchIds: string[]) {
  resolveDashboardScope.mockResolvedValue({ level, branchIds, processIds: [], employeeIds: [], userId: "u1", role: "branch_head" });
}

/** employeesRows: result of the home-branch lookup; branchRows: result of the branch_master query. */
function dbReturns(branchRows: unknown[], employeesRows: unknown[] = []) {
  query.mockImplementation(async (sql: string) =>
    /FROM employees/i.test(sql) ? [employeesRows] : [branchRows]);
}

beforeEach(() => {
  query.mockReset();
  resolveDashboardScope.mockReset();
});

describe("resolveHeadBranches", () => {
  it("scoped to NOIDA and NOIDA-2 returns both", async () => {
    scope("BRANCH_ALL", ["b1", "b2"]);
    dbReturns([row("b1", "NOIDA", "NOIDA"), row("b2", "NOIDA-2", "NOIDA-2")]);
    const r = await resolveHeadBranches("u1");
    expect(resolveDashboardScope).toHaveBeenCalledWith("u1", "branch_head");
    expect(r.branches).toEqual([
      { branchId: "b1", branchCode: "NOIDA", branchName: "NOIDA" },
      { branchId: "b2", branchCode: "NOIDA-2", branchName: "NOIDA-2" },
    ]);
    expect(r).toMatchObject({ viaHomeFallback: false, orgWide: false, emptyReason: null });
  });

  it("role without scope row falls back to home branch and sets viaHomeFallback", async () => {
    scope("SELF_ONLY", []);
    dbReturns([row("h1", "JPR", "Jaipur")], [{ branch_id: "h1" }]);
    const r = await resolveHeadBranches("u1");
    expect(r.branches).toEqual([{ branchId: "h1", branchCode: "JPR", branchName: "Jaipur" }]);
    expect(r.viaHomeFallback).toBe(true);
    expect(r.emptyReason).toBeNull();
  });

  it("scope containing NOIDA-DIALDESK drops it and keeps the rest", async () => {
    scope("BRANCH_ALL", ["b1", "dd"]);
    // the SQL MAS filter removes the DialDesk row
    dbReturns([row("b1", "NOIDA", "NOIDA")]);
    const r = await resolveHeadBranches("u1");
    expect(r.branches.map((b) => b.branchId)).toEqual(["b1"]);
    const sql = query.mock.calls.find((c) => /FROM branch_master/i.test(String(c[0])))![0] as string;
    expect(sql).toMatch(/dialdesk/i);
  });

  it('only a non-MAS branch returns branches [] with emptyReason "No MAS Call Net branch in your scope"', async () => {
    scope("BRANCH_ALL", ["dd"]);
    dbReturns([]);
    const r = await resolveHeadBranches("u1");
    expect(r.branches).toEqual([]);
    expect(r.emptyReason).toBe(EMPTY);
  });

  it("ORG_ALL returns every active MAS branch with orgWide true", async () => {
    scope("ORG_ALL", []);
    dbReturns([row("b1", "A", "A"), row("b2", "B", "B")]);
    const r = await resolveHeadBranches("u1");
    expect(r.orgWide).toBe(true);
    expect(r.viaHomeFallback).toBe(false);
    expect(r.branches).toHaveLength(2);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/\bIN \(/i);
  });

  it("inactive or closed branch is dropped", async () => {
    scope("BRANCH_ALL", ["b1", "b2"]);
    dbReturns([row("b1", "A", "A")]);
    const r = await resolveHeadBranches("u1");
    expect(r.branches.map((b) => b.branchId)).toEqual(["b1"]);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain("active_status = 1");
    expect(sql).toContain("close_date IS NULL");
  });
});
