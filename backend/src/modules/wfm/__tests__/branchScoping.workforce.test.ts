import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Branch scoping for the workforce modules (owner ruling 2026-10-01): org-wide roles untouched, a browser
 * ?branchId= may only NARROW the caller's own branch, no resolvable scope = nothing (fail closed).
 */
const { dbExecute, resolveScope, canViewEmployee } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  resolveScope: vi.fn(),
  canViewEmployee: vi.fn(async () => false),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: resolveScope,
  buildEmployeeScopeCondition: () => ({ sql: "1=0", params: [] }),
  canViewEmployee,
}));

import {
  branchScopeGuard, employeeParamGuard, rosterOwnerGuard, scopePredicate, rowInScope, isOrgWide,
} from "../branch-scope.js";

const hr = (over: Record<string, unknown> = {}) => ({
  userId: "u1", roles: ["hr"], employeeId: "e-self", employeeCode: "C1", branchId: "branch-a",
  processId: null, lobId: null, departmentId: null, isSuperAdmin: false, isAdmin: false, isHr: true,
  isPayroll: false, isFinance: false, assignments: [], ...over,
});
// Org-wide = ORG_WIDE_EXEMPT_ROLES (super_admin/ceo/coo/cfo/payroll_head/finance_head/accounts_head/finance).
// `admin` is branch-scoped too (owner ruling 2026-10-01), see the admin test below.
const admin = () => hr({ roles: ["super_admin"], isSuperAdmin: true, isHr: false });
const branchAdmin = () => hr({ roles: ["admin"], isAdmin: true, isHr: false });

function app(mw: any, path = "/x") {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => { req.authUser = { id: "u1" }; next(); });
  a.all(path, mw, (req, res) => res.json({ ok: true, query: req.query }));
  return a;
}

beforeEach(() => { dbExecute.mockReset(); resolveScope.mockReset(); canViewEmployee.mockReset().mockResolvedValue(false); });

describe("branchScopeGuard", () => {
  it("org-wide role passes untouched, any branch", async () => {
    resolveScope.mockResolvedValue(admin());
    const res = await request(app(branchScopeGuard())).get("/x?branchId=branch-z");
    expect(res.status).toBe(200);
  });
  it("admin is branch-scoped: another branch is refused", async () => {
    resolveScope.mockResolvedValue(branchAdmin());
    expect((await request(app(branchScopeGuard())).get("/x?branchId=branch-z")).status).toBe(403);
  });
  it("hr asking another branch is refused (client filter does not widen)", async () => {
    resolveScope.mockResolvedValue(hr());
    expect((await request(app(branchScopeGuard())).get("/x?branchId=branch-b")).status).toBe(403);
  });
  it("hr smuggling a foreign branch in the body is refused even when the query is own branch", async () => {
    resolveScope.mockResolvedValue(hr());
    const res = await request(app(branchScopeGuard())).post("/x?branch_id=branch-a").send({ branch_id: "branch-b" });
    expect(res.status).toBe(403);
  });
  it("hr with no filter is pinned to its own branch", async () => {
    resolveScope.mockResolvedValue(hr());
    const res = await request(app(branchScopeGuard())).get("/x");
    expect(res.status).toBe(200);
    expect(res.body.query.branchId).toBe("branch-a");
  });
  it("a caller with no resolvable scope sees nothing", async () => {
    resolveScope.mockResolvedValue(hr({ roles: ["manager"], branchId: null }));
    expect((await request(app(branchScopeGuard())).get("/x")).status).toBe(403);
  });
  it("requireTarget refuses an un-targeted write for a branch-scoped caller", async () => {
    resolveScope.mockResolvedValue(hr());
    expect((await request(app(branchScopeGuard({ inject: false, requireTarget: true }))).post("/x").send({})).status).toBe(400);
  });
});

describe("by-id guards", () => {
  it("employeeParamGuard refuses an employee outside the branch", async () => {
    resolveScope.mockResolvedValue(hr());
    dbExecute.mockResolvedValue([[{ branch_id: "branch-b", reporting_manager_id: null }], []]);
    const a = express();
    a.use((req: any, _r, n) => { req.authUser = { id: "u1" }; n(); });
    a.param("employeeId", employeeParamGuard());
    a.get("/emp/:employeeId", (_q, r) => r.json({ ok: true }));
    expect((await request(a).get("/emp/e-other")).status).toBe(403);
  });
  it("employeeParamGuard lets hr open an employee of its own branch", async () => {
    resolveScope.mockResolvedValue(hr());
    dbExecute.mockResolvedValue([[{ branch_id: "branch-a", reporting_manager_id: null }], []]);
    const a = express();
    a.use((req: any, _r, n) => { req.authUser = { id: "u1" }; n(); });
    a.param("employeeId", employeeParamGuard());
    a.get("/emp/:employeeId", (_q, r) => r.json({ ok: true }));
    expect((await request(a).get("/emp/e-mine")).status).toBe(200);
  });
  it("rosterOwnerGuard refuses a cycle that belongs to another branch", async () => {
    resolveScope.mockResolvedValue(hr());
    dbExecute.mockResolvedValue([[{ branch_id: "branch-b", process_id: null }], []]);
    const res = await request(app(rosterOwnerGuard("weekly_roster_cycle", "cycleId"))).post("/x").send({ cycleId: "c1" });
    expect(res.status).toBe(403);
  });
  it("rosterOwnerGuard lets an org-wide role publish any cycle", async () => {
    resolveScope.mockResolvedValue(admin());
    const res = await request(app(rosterOwnerGuard("weekly_roster_cycle", "cycleId"))).post("/x").send({ cycleId: "c1" });
    expect(res.status).toBe(200);
    expect(dbExecute).not.toHaveBeenCalled();
  });
});

describe("predicates", () => {
  it("org-wide gets the literal 1=1 (unfiltered SQL untouched)", () => {
    expect(scopePredicate(admin() as any, { branchId: "e.branch_id" })).toEqual({ sql: "1=1", params: [] });
    expect(isOrgWide(admin() as any)).toBe(true);
    expect(isOrgWide(branchAdmin() as any)).toBe(false);
  });
  it("hr gets its own branch only", () => {
    const p = scopePredicate(hr() as any, { branchId: "e.branch_id" });
    expect(p.sql).toContain("e.branch_id = ?");
    expect(p.params).toContain("branch-a");
  });
  it("rowInScope: own branch yes, other branch no", () => {
    expect(rowInScope(hr() as any, { id: "x", branch_id: "branch-a" })).toBe(true);
    expect(rowInScope(hr() as any, { id: "x", branch_id: "branch-b" })).toBe(false);
  });
});
