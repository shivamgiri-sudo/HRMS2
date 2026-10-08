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

const { runRejoinFollowUps } = vi.hoisted(() => ({ runRejoinFollowUps: vi.fn() }));
vi.mock("../rejoinFollowUps.js", () => ({ runRejoinFollowUps }));
vi.mock("../rejoinFollowUps.deps.js", () => ({ realFollowUpDeps: { marker: "deps" } }));

const { notifyRejoinRequested, notifyRejoinDecided, notifyFollowUpAttention } = vi.hoisted(() => ({
  notifyRejoinRequested: vi.fn(), notifyRejoinDecided: vi.fn(), notifyFollowUpAttention: vi.fn(),
}));
vi.mock("../rejoinNotifications.js", () => ({ notifyRejoinRequested, notifyRejoinDecided, notifyFollowUpAttention }));

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
  runRejoinFollowUps.mockReset(); runRejoinFollowUps.mockResolvedValue([{ step: "auth", ok: true }]);
  notifyRejoinRequested.mockReset().mockResolvedValue(true);
  notifyRejoinDecided.mockReset().mockResolvedValue(true);
  notifyFollowUpAttention.mockReset().mockResolvedValue(true);
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
    expect(notifyRejoinRequested).not.toHaveBeenCalled();
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
    expect(notifyRejoinRequested).not.toHaveBeenCalled();
  });

  it("a throwing notifier does not change the 201", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    loadRehireFacts.mockResolvedValue(cleanFacts);
    notifyRejoinRequested.mockRejectedValue(new Error("boom"));
    dbExecute.mockImplementation(async (sql: string) =>
      String(sql).includes("ORDER BY created_at DESC LIMIT 1") ? [[{ id: "req-uuid-1" }], []] : [[], []]);
    const res = await request(app()).post("/api/employees/reactivation/initiate").send(initiateBody);
    expect(res.status).toBe(201);
  });

  it("creates the request for HR on an eligible employee and stores the snapshot", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    loadRehireFacts.mockResolvedValue(cleanFacts);
    dbExecute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("INSERT INTO employee_reactivation_requests")) return [{ insertId: 0 }, []];
      if (q.includes("ORDER BY created_at DESC LIMIT 1")) return [[{ id: "req-uuid-1" }], []];
      return [[], []];
    });
    const res = await request(app()).post("/api/employees/reactivation/initiate").send(initiateBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("req-uuid-1");
    expect(notifyRejoinRequested).toHaveBeenCalledWith("req-uuid-1");
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

  it("runs the follow-ups only AFTER the approval commits, and returns their outcome", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    const c = conn();
    activateRejoin.mockResolvedValue({ status: "eligible", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false });
    const order: string[] = [];
    c.commit.mockImplementation(async () => { order.push("commit"); });
    runRejoinFollowUps.mockImplementation(async () => { order.push("followups"); return [{ step: "auth", ok: true }]; });
    const res = await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "fine to rejoin" });
    expect(res.status).toBe(200);
    expect(order).toEqual(["commit", "followups"]);
    expect(runRejoinFollowUps).toHaveBeenCalledWith(
      expect.anything(), { marker: "deps" },
      { requestId: "r1", employeeId: "e1", approverId: "bh1", rejoinDate: "2026-09-20" },
    );
    expect(res.body.followUps).toEqual([{ step: "auth", ok: true }]);
  });

  it("a failing follow-up does not change the outcome: still 200, the failure is reported", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn();
    activateRejoin.mockResolvedValue({ status: "eligible", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false });
    runRejoinFollowUps.mockResolvedValue([{ step: "it_provisioning", ok: false, detail: "IT down" }]);
    const res = await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "fine to rejoin" });
    expect(res.status).toBe(200);
    expect(res.body.followUps[0].ok).toBe(false);
  });

  it("even if the follow-up runner itself throws, the approval stands", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn();
    activateRejoin.mockResolvedValue({ status: "eligible", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false });
    runRejoinFollowUps.mockRejectedValue(new Error("boom"));
    const res = await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "fine to rejoin" });
    expect(res.status).toBe(200);
    expect(res.body.followUps).toEqual([]);
  });

  it("does not run follow-ups on a rejection", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn();
    await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "rejected", remarks: "poor record" });
    expect(runRejoinFollowUps).not.toHaveBeenCalled();
  });

  it("does not run follow-ups when activation refuses", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn();
    const { RejoinBlockedError } = await import("../rejoinActivation.js");
    activateRejoin.mockRejectedValue(new RejoinBlockedError({ status: "blocked", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false }, "Left through termination"));
    await request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action: "approved", remarks: "fine to rejoin" });
    expect(runRejoinFollowUps).not.toHaveBeenCalled();
  });
});

describe("legacy 'branch_head_approved' requests (old flow, stuck at the removed HR step)", () => {
  // Old rows predate raised_by_role / eligibility_snapshot, so both are NULL.
  const legacyRow = { id: "r9", employee_id: "e9", status: "branch_head_approved", proposed_joining_date: "2026-09-20",
    absconding_acknowledged: 0, raised_by_role: null, eligibility_snapshot: null, branch_head_actioned_by: "bh-old" };
  function conn(row: Record<string, unknown> = legacyRow) {
    const c = { execute: vi.fn(async (sql: string) => String(sql).includes("FOR UPDATE") ? [[row], []] : [{ affectedRows: 1 }, []]),
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
    getConnection.mockResolvedValue(c);
    return c;
  }
  const eligible = { status: "eligible", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false };
  const act = (action: string) => request(app()).post("/api/employees/reactivation/r9/branch-action").send({ action, remarks: "fine to rejoin" });

  it("approving activates through the same checked path and marks it approved, then runs follow-ups", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    const c = conn(); activateRejoin.mockResolvedValue(eligible);
    const res = await act("approved");
    expect(res.status).toBe(200);
    expect(activateRejoin).toHaveBeenCalledOnce();
    expect(activateRejoin.mock.calls[0][1]).toMatchObject({ id: "r9", employee_id: "e9", absconding_acknowledged: 0 });
    expect(c.commit).toHaveBeenCalledOnce();
    const upd = c.execute.mock.calls.find(([sql]) => String(sql).includes("UPDATE employee_reactivation_requests"))!;
    expect((upd[1] as unknown[])[0]).toBe("approved");
    expect(runRejoinFollowUps).toHaveBeenCalledWith(expect.anything(), { marker: "deps" },
      { requestId: "r9", employeeId: "e9", approverId: "bh1", rejoinDate: "2026-09-20" });
    expect(notifyRejoinDecided).toHaveBeenCalledWith("r9", "approved");
  });

  it("rejecting closes it without activation", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    const c = conn();
    const res = await act("rejected");
    expect(res.status).toBe(200);
    expect(activateRejoin).not.toHaveBeenCalled();
    const upd = c.execute.mock.calls.find(([sql]) => String(sql).includes("UPDATE employee_reactivation_requests"))!;
    expect((upd[1] as unknown[])[0]).toBe("rejected");
  });

  it("a live absconding verdict still refuses an unacknowledged approval even with no stored snapshot", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    const c = conn();
    const { RejoinBlockedError } = await import("../rejoinActivation.js");
    activateRejoin.mockRejectedValue(new RejoinBlockedError({ ...eligible, status: "review", requiresAbscondingAck: true }, "Absconding rejoin requires the branch head's acknowledgement"));
    const res = await act("approved");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Absconding rejoin requires the branch head's acknowledgement");
    expect(c.rollback).toHaveBeenCalledOnce();
    expect(c.commit).not.toHaveBeenCalled();
  });

  it("a legacy absconder (no stored snapshot) approved by a direct API call with a short remark is rolled back", async () => {
    // The route's own 20-character rule reads the stored snapshot, which legacy rows lack. The live verdict returned
    // by activateRejoin must therefore enforce it, or a direct API call could skip what the UI demands.
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    const c = conn();
    activateRejoin.mockResolvedValue({ ...eligible, status: "review", requiresAbscondingAck: true });
    const res = await request(app()).post("/api/employees/reactivation/r9/branch-action")
      .send({ action: "approved", remarks: "ok, rejoin", absconding_acknowledged: true });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 20 characters/i);
    expect(c.rollback).toHaveBeenCalledOnce();
    expect(c.commit).not.toHaveBeenCalled();
    expect(runRejoinFollowUps).not.toHaveBeenCalled();
  });

  it("a legacy absconder with an acknowledgement and a 20+ character remark is approved", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    const c = conn();
    activateRejoin.mockResolvedValue({ ...eligible, status: "review", requiresAbscondingAck: true });
    const res = await request(app()).post("/api/employees/reactivation/r9/branch-action")
      .send({ action: "approved", remarks: "Reviewed the full history, accepting the risk", absconding_acknowledged: true });
    expect(res.status).toBe(200);
    expect(c.commit).toHaveBeenCalledOnce();
  });

  it.each(["approved", "rejected", "cancelled"])("still 400s a request already '%s'", async (status) => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    const c = conn({ ...legacyRow, status });
    const res = await act("approved");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Request is not pending branch head action");
    expect(activateRejoin).not.toHaveBeenCalled();
    expect(c.rollback).toHaveBeenCalledOnce();
  });
});

describe("GET /reactivation/pending", () => {
  it("lists both new 'pending' and legacy 'branch_head_approved' requests, keeping the scope", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    const res = await request(app()).get("/api/employees/reactivation/pending");
    expect(res.status).toBe(200);
    const sql = String(dbExecute.mock.calls[0][0]).replace(/\s+/g, " ");
    expect(sql).toContain("r.status IN ('pending', 'branch_head_approved')");
    expect(sql).toContain("AND (1=1)");
  });
});

describe("POST /reactivation/:id/hr-action", () => {
  it("is gone (410) — the HR confirmation step was removed", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    const res = await request(app()).post("/api/employees/reactivation/r1/hr-action").send({ action: "confirmed", remarks: "ok then" });
    expect(res.status).toBe(410);
  });
});

describe("branch-action notifications", () => {
  const row = { id: "r1", employee_id: "e1", status: "pending", proposed_joining_date: "2026-09-20", absconding_acknowledged: 0 };
  function conn() {
    const c = { execute: vi.fn(async (sql: string) => String(sql).includes("FOR UPDATE") ? [[row], []] : [{ affectedRows: 1 }, []]),
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
    getConnection.mockResolvedValue(c);
    return c;
  }
  const act = (action: string) => request(app()).post("/api/employees/reactivation/r1/branch-action").send({ action, remarks: "fine to rejoin" });
  const eligible = { status: "eligible", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false };

  it("approve notifies the decision after the commit and the follow-ups", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    const c = conn(); activateRejoin.mockResolvedValue(eligible);
    const order: string[] = [];
    c.commit.mockImplementation(async () => { order.push("commit"); });
    runRejoinFollowUps.mockImplementation(async () => { order.push("followups"); return [{ step: "auth", ok: true }]; });
    notifyRejoinDecided.mockImplementation(async () => { order.push("notify"); return true; });
    const res = await act("approved");
    expect(res.status).toBe(200);
    expect(order).toEqual(["commit", "followups", "notify"]);
    expect(notifyRejoinDecided).toHaveBeenCalledWith("r1", "approved");
    expect(notifyFollowUpAttention).not.toHaveBeenCalled();
  });

  it("approve with a failed follow-up also raises the attention notice", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn(); activateRejoin.mockResolvedValue(eligible);
    const fu = [{ step: "it_provisioning", ok: false }];
    runRejoinFollowUps.mockResolvedValue(fu);
    const res = await act("approved");
    expect(res.status).toBe(200);
    expect(notifyFollowUpAttention).toHaveBeenCalledWith("r1", fu);
  });

  it("reject notifies the rejection", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn();
    const res = await act("rejected");
    expect(res.status).toBe(200);
    expect(notifyRejoinDecided).toHaveBeenCalledWith("r1", "rejected");
  });

  it("a throwing notifier does not change the 200", async () => {
    authUser = { id: "bh1", role: "branch_head", roles: ["branch_head"] };
    conn(); activateRejoin.mockResolvedValue(eligible);
    runRejoinFollowUps.mockResolvedValue([{ step: "x", ok: false }]);
    notifyRejoinDecided.mockRejectedValue(new Error("boom"));
    notifyFollowUpAttention.mockRejectedValue(new Error("boom"));
    expect((await act("approved")).status).toBe(200);
    notifyRejoinDecided.mockRejectedValue(new Error("boom"));
    expect((await act("rejected")).status).toBe(200);
  });
});
