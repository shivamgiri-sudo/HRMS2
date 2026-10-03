import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute, getConnection } = vi.hoisted(() => ({ dbExecute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({ db: { execute: dbExecute, getConnection } }));

const { canViewEmployee } = vi.hoisted(() => ({ canViewEmployee: vi.fn() }));
vi.mock("../../../../shared/enterpriseScope.js", () => ({
  canViewEmployee,
  resolveUserBusinessScope: vi.fn(),
  buildEmployeeScopeCondition: vi.fn(() => ({ sql: "1=1", params: [] })),
}));

const { loadRehireFacts, activateRejoin } = vi.hoisted(() => ({ loadRehireFacts: vi.fn(), activateRejoin: vi.fn() }));
vi.mock("../rehireFacts.js", async (orig) => ({ ...(await orig<typeof import("../rehireFacts.js")>()), loadRehireFacts }));
vi.mock("../rejoinActivation.js", async (orig) => ({ ...(await orig<typeof import("../rejoinActivation.js")>()), activateRejoin }));

let authUser = { id: "u1", role: "hr", roles: ["hr"] };
vi.mock("../../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: typeof authUser }).authUser = authUser;
    next();
  },
}));

const { employeeReactivationRouter } = await import("../../employee-reactivation.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/employees", employeeReactivationRouter); return a; };

const cleanFacts = {
  exitRequestId: "x1", previousEndDate: "2026-09-10", ffAlreadyPaid: false,
  facts: { hasExitRecord: true, exitType: "voluntary", exitSubType: "resignation", exitReasonCategory: "relocation", legacyStatusText: "Resigned",
    disciplinaryFlag: false, blockLifted: false, gapDays: 10, priorRejoinCount: 0, totalAbscondingExits: 0,
    openClearanceCase: false, assetsUnreturned: false, ffAlreadyPaid: false },
};
const initiateBody = { employee_id: "11111111-1111-4111-8111-111111111111", proposed_joining_date: "2026-09-20", reinstatement_reason: "Returned, good record at the branch" };

beforeEach(() => {
  dbExecute.mockReset(); getConnection.mockReset(); canViewEmployee.mockReset(); loadRehireFacts.mockReset(); activateRejoin.mockReset();
  canViewEmployee.mockResolvedValue(true);
  dbExecute.mockResolvedValue([[], []]);
});

describe("POST /reactivation/initiate", () => {
  it("403s a branch_head (cannot raise)", async () => {
    authUser = { id: "u1", role: "branch_head", roles: ["branch_head"] };
    const res = await request(app()).post("/api/employees/reactivation/initiate").send(initiateBody);
    expect(res.status).toBe(403);
  });

  it("400s a blocked employee with the reasons and writes nothing", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    loadRehireFacts.mockResolvedValue({ ...cleanFacts, facts: { ...cleanFacts.facts, exitSubType: "termination" } });
    const res = await request(app()).post("/api/employees/reactivation/initiate").send(initiateBody);
    expect(res.status).toBe(400);
    expect(res.body.eligibility.status).toBe("blocked");
    expect(dbExecute.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO employee_reactivation_requests"))).toBe(false);
  });

  it("keeps the fresh-onboarding code for a gap over 30 days", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    loadRehireFacts.mockResolvedValue({ ...cleanFacts, facts: { ...cleanFacts.facts, gapDays: 45 } });
    const res = await request(app()).post("/api/employees/reactivation/initiate").send(initiateBody);
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("REQUIRES_FRESH_ONBOARDING");
  });

  it("403s a manager who is not the employee's reporting manager", async () => {
    authUser = { id: "u2", role: "manager", roles: ["manager"] };
    loadRehireFacts.mockResolvedValue(cleanFacts);
    dbExecute.mockImplementation(async (sql: string) =>
      String(sql).includes("reporting_manager_id") ? [[{ is_manager: 0 }], []] : [[], []]);
    const res = await request(app()).post("/api/employees/reactivation/initiate").send(initiateBody);
    expect(res.status).toBe(403);
  });

  it("creates the request for HR on an eligible employee and stores the snapshot", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    loadRehireFacts.mockResolvedValue(cleanFacts);
    dbExecute.mockImplementation(async (sql: string) =>
      String(sql).includes("INSERT INTO employee_reactivation_requests") ? [{ insertId: 7 }, []] : [[], []]);
    const res = await request(app()).post("/api/employees/reactivation/initiate").send(initiateBody);
    expect(res.status).toBe(201);
    const ins = dbExecute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO employee_reactivation_requests"))!;
    expect(String(ins[0])).toContain("eligibility_snapshot");
    expect(ins[1]).toContain("hr");
  });
});

describe("POST /reactivation/:id/branch-action", () => {
  const pendingRow = { id: "r1", employee_id: "e1", status: "pending", proposed_joining_date: "2026-09-20", absconding_acknowledged: 0 };
  function conn(row: Record<string, unknown> = pendingRow) {
    const c = { execute: vi.fn(async (sql: string) => String(sql).includes("FOR UPDATE") ? [[row], []] : [{ affectedRows: 1 }, []]),
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
    getConnection.mockResolvedValue(c);
    return c;
  }

  it("403s hr — approval belongs to the branch head alone", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    const res = await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "fine to rejoin" });
    expect(res.status).toBe(403);
  });

  it("approve activates in one transaction and marks the request approved", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    const c = conn();
    activateRejoin.mockResolvedValue({ status: "eligible", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false });
    const res = await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "fine to rejoin" });
    expect(res.status).toBe(200);
    expect(activateRejoin).toHaveBeenCalledOnce();
    expect(c.commit).toHaveBeenCalledOnce();
    expect(c.rollback).not.toHaveBeenCalled();
    const upd = c.execute.mock.calls.find(([sql]) => String(sql).includes("UPDATE employee_reactivation_requests"))!;
    expect((upd[1] as unknown[])[0]).toBe("approved");
  });

  it("rolls back and returns 400 when activation refuses", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    const c = conn();
    const { RejoinBlockedError } = await import("../rejoinActivation.js");
    activateRejoin.mockRejectedValue(new RejoinBlockedError({ status: "blocked", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false }, "Left through termination"));
    const res = await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "fine to rejoin" });
    expect(res.status).toBe(400);
    expect(c.rollback).toHaveBeenCalledOnce();
    expect(c.commit).not.toHaveBeenCalled();
  });

  it("rejecting needs no activation", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn();
    const res = await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "rejected", remarks: "poor record" });
    expect(res.status).toBe(200);
    expect(activateRejoin).not.toHaveBeenCalled();
  });

  it("400s an absconding approval without the acknowledgement, writing and activating nothing", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    const c = conn({ ...pendingRow, eligibility_snapshot: { reasons: [{ code: "ABSCONDING" }] } });
    const res = await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "fine to rejoin, reviewed" });
    expect(res.status).toBe(400);
    expect(activateRejoin).not.toHaveBeenCalled();
    expect(c.execute.mock.calls.some(([sql]) => String(sql).includes("UPDATE employee_reactivation_requests"))).toBe(false);
  });

  it("400s an absconding approval with a short remark even when acknowledged", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn({ ...pendingRow, eligibility_snapshot: { reasons: [{ code: "ABSCONDING" }] } });
    const res = await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "ok rejoin", absconding_acknowledged: true });
    expect(res.status).toBe(400);
  });

  it("approves an acknowledged absconding rejoin with a 20+ character remark", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn({ ...pendingRow, eligibility_snapshot: { reasons: [{ code: "ABSCONDING" }] } });
    activateRejoin.mockResolvedValue({ status: "review", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: true });
    const res = await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "Reviewed history, accepting the risk", absconding_acknowledged: true });
    expect(res.status).toBe(200);
    expect(activateRejoin).toHaveBeenCalledOnce();
  });
});

describe("POST /reactivation/:id/hr-action", () => {
  it("is gone (410) — the HR confirmation step was removed", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    const res = await request(app()).post("/api/employees/reactivation/r1/hr-action").send({ action: "confirmed", remarks: "ok then" });
    expect(res.status).toBe(410);
  });
});
