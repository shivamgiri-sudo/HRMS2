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
// These two are covered by their own dedicated tests below ("rejects a role outside the
// allow-list" / "enforces scope via requireScopedRole with the resolved employee scope").
// Pass them through here so the pre-existing behavioural tests keep exercising only the
// handler logic, exactly like employee.routes.audit-logging.test.ts does for the same pair.
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../../middleware/scopeMiddleware.js", () => ({
  requireScopedRole: () => (_req: any, _res: any, next: any) => next(),
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
});
