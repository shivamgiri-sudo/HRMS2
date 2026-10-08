import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { upsertOpenWorkItem } = vi.hoisted(() => ({ upsertOpenWorkItem: vi.fn() }));
vi.mock("../../../shared/workItem.js", () => ({ upsertOpenWorkItem }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
import { db } from "../../../db/mysql.js";
const mockExecute = db.execute as ReturnType<typeof vi.fn>;

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", role: "hr" }; next(); },
}));
// requireRole's own allow-list behaviour is exercised by requireRole's own middleware tests,
// not here. Pass it through unconditionally so the pre-existing behavioural tests below keep
// exercising only the handler logic, exactly like employee.routes.audit-logging.test.ts does
// for the same middleware. requireScopedRole is different: it is covered by its own dedicated
// test below ("enforces scope via requireScopedRole with the resolved employee scope"), which
// captures the real targetResolver (resolveFlagTargetScope) from the mock below and invokes it
// directly.
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
// Capture the (allowedRoles, targetResolver, options) the route wires up so the dedicated
// scope test below can invoke the real targetResolver (resolveFlagTargetScope) directly --
// while every other test in this file still passes through untouched, exactly like the
// requireRole mock above.
const { requireScopedRoleCalls } = vi.hoisted(() => ({
  requireScopedRoleCalls: [] as Array<[string[], (req: any) => unknown, Record<string, unknown>?]>,
}));
vi.mock("../../../middleware/scopeMiddleware.js", () => ({
  requireScopedRole: (...args: [string[], (req: any) => unknown, Record<string, unknown>?]) => {
    requireScopedRoleCalls.push(args);
    return (_req: any, _res: any, next: any) => next();
  },
}));

import { aonRetentionFlagRouter } from "../aon-retention-flag.routes.js";

const app = express();
app.use(express.json());
app.use("/api/reports/aon-analytics", aonRetentionFlagRouter);

describe("POST /api/reports/aon-analytics/flag-retention", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls upsertOpenWorkItem with RETENTION_REVIEW, routed to the manager's highest-priority role", async () => {
    // employees WHERE id = ? (the flagged employee, looked up by real UUID, not employee_code)
    mockExecute.mockResolvedValueOnce([[{
      id: "emp-1", reporting_manager_id: "mgr-1", branch_id: "b1",
    }], []]);
    // The manager holds MULTIPLE active roles (a common real-world case verified against the
    // live DB -- e.g. a branch admin who is also flagged "employee") -- resolvePrimaryRole must
    // pick the highest-priority one (payroll_admin, canonicalized to "payroll" by
    // normalizeDashboardRole), never an arbitrary/first row such as "employee".
    mockExecute.mockResolvedValueOnce([[
      { role_key: "employee" },
      { role_key: "payroll_admin" },
    ], []]);
    upsertOpenWorkItem.mockResolvedValueOnce("created");

    const res = await request(app)
      .post("/api/reports/aon-analytics/flag-retention")
      .send({ employeeId: "emp-1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, outcome: "created" });
    expect(upsertOpenWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemType: "RETENTION_REVIEW",
        entityType: "employee",
        entityId: "emp-1",
        assignedToRole: "payroll",
      }),
    );

    // The employee lookup must key off employees.id (the real UUID), not employee_code.
    expect(mockExecute.mock.calls[0][0]).toMatch(/employees/i);
    expect(mockExecute.mock.calls[0][0]).toMatch(/WHERE\s+id\s*=\s*\?/i);
    expect(mockExecute.mock.calls[0][1]).toEqual(["emp-1"]);
  });

  it("falls back to branch_head when the manager resolves to no role but employee (or no roles at all)", async () => {
    mockExecute.mockResolvedValueOnce([[{
      id: "emp-2", reporting_manager_id: "mgr-2", branch_id: "b1",
    }], []]);
    mockExecute.mockResolvedValueOnce([[], []]); // no active roles found for the manager
    upsertOpenWorkItem.mockResolvedValueOnce("refreshed");

    const res = await request(app)
      .post("/api/reports/aon-analytics/flag-retention")
      .send({ employeeId: "emp-2" });

    expect(res.status).toBe(200);
    expect(upsertOpenWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ assignedToRole: "branch_head" }),
    );
  });

  it("falls back to branch_head when the employee has no reporting_manager_id", async () => {
    mockExecute.mockResolvedValueOnce([[{
      id: "emp-3", reporting_manager_id: null, branch_id: "b1",
    }], []]);
    upsertOpenWorkItem.mockResolvedValueOnce("created");

    const res = await request(app)
      .post("/api/reports/aon-analytics/flag-retention")
      .send({ employeeId: "emp-3" });

    expect(res.status).toBe(200);
    expect(upsertOpenWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ assignedToRole: "branch_head" }),
    );
    // Only the employee lookup should run -- no wasted role query when there's no manager.
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("400s when employeeId is missing", async () => {
    const res = await request(app).post("/api/reports/aon-analytics/flag-retention").send({});
    expect(res.status).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("enforces scope via requireScopedRole with the resolved employee scope", async () => {
    // The router wires requireScopedRole up once at import time -- confirm it actually did,
    // and grab the targetResolver (resolveFlagTargetScope) it was given.
    expect(requireScopedRoleCalls.length).toBe(1);
    const [, targetResolver] = requireScopedRoleCalls[0];

    // The resolver must key off the TARGET employee named in the request body (employeeId),
    // never the caller's own branch/process -- so return a branch/process for the target
    // employee that is deliberately different from anything the caller would carry.
    mockExecute.mockResolvedValueOnce([[
      { branch_id: "target-branch-99", process_id: "target-process-99" },
    ], []]);

    const scope = await targetResolver({
      authUser: { id: "caller-1", role: "hr" },
      body: { employeeId: "emp-target-1" },
    } as any);

    expect(scope).toEqual({ branchId: "target-branch-99", processId: "target-process-99" });

    // Reads employees keyed by the posted employeeId, not any caller-derived id.
    expect(mockExecute.mock.calls[0][0]).toMatch(/employees/i);
    expect(mockExecute.mock.calls[0][0]).toMatch(/branch_id,\s*process_id/i);
    expect(mockExecute.mock.calls[0][1]).toEqual(["emp-target-1"]);
  });
});
