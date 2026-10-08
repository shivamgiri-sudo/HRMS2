import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Branch scoping, batch 2 (dashboard-family modules): the role gate says who may open a page, the scope helpers say
 * whose records they may see. Org-wide roles are never narrowed.
 */
const { canViewEmployee, resolveScope, buildCond, dbExecute, hasRole } = vi.hoisted(() => ({
  canViewEmployee: vi.fn(),
  resolveScope: vi.fn(async () => ({ employeeId: "emp-me" })),
  buildCond: vi.fn((): { sql: string; params: unknown[] } => ({ sql: "e.branch_id = ?", params: ["branch-a"] })),
  dbExecute: vi.fn(async () => [[], []]),
  hasRole: vi.fn(async () => true),
}));

vi.mock("../../../shared/enterpriseScope.js", () => ({
  canViewEmployee, resolveUserBusinessScope: resolveScope, buildEmployeeScopeCondition: buildCond,
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/accessGuard.js", () => ({
  hasRole, getEmployeeForUser: vi.fn(async () => ({ id: "emp-me", employee_code: "E1" })),
}));
vi.mock("../../skill-roadmap/skill-roadmap.service.js", () => ({
  skillRoadmapService: { assignRoadmap: vi.fn(async () => undefined), unassignRoadmap: vi.fn(async () => undefined) },
}));

beforeEach(() => {
  canViewEmployee.mockReset();
  dbExecute.mockReset();
  dbExecute.mockResolvedValue([[], []]);
  buildCond.mockReset();
  buildCond.mockReturnValue({ sql: "e.branch_id = ?", params: ["branch-a"] });
});

describe("branch-scope-guards", () => {
  it("employeeListScope is null for org-wide callers and a predicate otherwise", async () => {
    const { employeeListScope } = await import("../branch-scope-guards.js");
    buildCond.mockReturnValueOnce({ sql: "1=1", params: [] });
    expect(await employeeListScope({ id: "u" }, "e")).toBeNull();
    const pred = await employeeListScope({ id: "u" }, "e");
    expect(pred?.sql).toContain("e.branch_id = ?");
    expect(pred?.sql).toContain("e.reporting_manager_id = ?");
  });

  it("canAccessEmployeeRecord: branch scope, direct report, else refused", async () => {
    const { canAccessEmployeeRecord } = await import("../branch-scope-guards.js");
    canViewEmployee.mockResolvedValueOnce(true);
    expect(await canAccessEmployeeRecord({ id: "u" }, "emp-x")).toBe(true);
    canViewEmployee.mockResolvedValueOnce(false);
    dbExecute.mockResolvedValueOnce([[{ ok: 1 }], []]);
    expect(await canAccessEmployeeRecord({ id: "u" }, "emp-report")).toBe(true);
    canViewEmployee.mockResolvedValueOnce(false);
    expect(await canAccessEmployeeRecord({ id: "u" }, "emp-other")).toBe(false);
  });
});

describe("skill-roadmap", () => {
  const app = async () => {
    const { skillRoadmapRouter } = await import("../../skill-roadmap/skill-roadmap.routes.js");
    const a = express(); a.use(express.json()); a.use("/sr", skillRoadmapRouter); return a;
  };
  it("refuses assign for an employee outside the caller's scope", async () => {
    canViewEmployee.mockResolvedValue(false);
    const res = await request(await app()).post("/sr/employee/emp-b/assign").send({ roadmap_id: "r1" });
    expect(res.status).toBe(403);
  });
  it("allows assign inside scope", async () => {
    canViewEmployee.mockResolvedValue(true);
    const res = await request(await app()).post("/sr/employee/emp-a/assign").send({ roadmap_id: "r1" });
    expect(res.status).toBe(200);
  });
});

describe("ops-control-tower", () => {
  it("scopeSummaryToBranches keeps org-wide untouched and cuts + re-totals for a branch set", async () => {
    const { scopeSummaryToBranches } = await import("../../ops-control-tower/ops-control-tower.logic.js");
    const summary = {
      nowMs: 1,
      fnfPending: { branches: [{ branchId: "a", count: 2 }, { branchId: "b", count: 5 }], grandTotal: 7 },
    };
    expect(scopeSummaryToBranches(summary, null)).toBe(summary);
    const out = scopeSummaryToBranches(summary, new Set(["a"]));
    expect(out.fnfPending.branches).toHaveLength(1);
    expect(out.fnfPending.grandTotal).toBe(2);
    expect(scopeSummaryToBranches(summary, new Set()).fnfPending.grandTotal).toBe(0);
  });
});

describe("call-master client scoping", () => {
  it("narrowClientIds only intersects and never widens; empty -> matches nothing", async () => {
    const { narrowClientIds } = await import("../../call-master/call-master.scope.js");
    expect(narrowClientIds(undefined, [1, 2])).toEqual([1, 2]);
    expect(narrowClientIds([2, 9], [1, 2])).toEqual([2]);
    expect(narrowClientIds([9], [1, 2])).toEqual([-1]);
    expect(narrowClientIds(undefined, [])).toEqual([-1]);
  });
});

describe("process-scope-guards", () => {
  it("tpzCompanyAllowed / inboundProjectAllowed follow the caller's processes", async () => {
    const { tpzCompanyAllowed, inboundProjectAllowed } = await import("../process-scope-guards.js");
    const scoped = { orgWide: false as const, processIds: new Set(["p1"]), processCodes: new Set(["GNC"]) };
    expect(tpzCompanyAllowed({ orgWide: true }, "bellavita")).toBe(true);
    expect(tpzCompanyAllowed(scoped, "gnc")).toBe(true);
    expect(tpzCompanyAllowed(scoped, "bellavita")).toBe(false);
    expect(inboundProjectAllowed(scoped, { key: "gnc" })).toBe(true);
    expect(inboundProjectAllowed(scoped, { key: "clovia" })).toBe(false);
    expect(inboundProjectAllowed(scoped, { key: "x", processId: "p1" })).toBe(true);
    expect(inboundProjectAllowed(scoped, { key: "unknownkey" })).toBe(false);
  });
});
