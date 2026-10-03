import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { canViewEmployee } = vi.hoisted(() => ({ canViewEmployee: vi.fn() }));
vi.mock("../../../../shared/enterpriseScope.js", () => ({ canViewEmployee }));

const { loadRehireFacts } = vi.hoisted(() => ({ loadRehireFacts: vi.fn() }));
vi.mock("../rehireFacts.js", async (orig) => ({ ...(await orig<typeof import("../rehireFacts.js")>()), loadRehireFacts }));

const { isFormerReport } = vi.hoisted(() => ({ isFormerReport: vi.fn() }));
vi.mock("../rehireAccess.js", () => ({ isFormerReport }));

const { logSensitiveAction } = vi.hoisted(() => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../../../shared/auditLog.js", () => ({ logSensitiveAction }));

let authUser = { id: "u1", role: "hr", roles: ["hr"] };
vi.mock("../../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: typeof authUser }).authUser = authUser;
    next();
  },
}));

const { employeeGovernanceRouter } = await import("../../employee-governance.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/employees", employeeGovernanceRouter); return a; };

const EMP = "11111111-1111-4111-8111-111111111111";
const cleanFacts = {
  exitRequestId: "x1", previousEndDate: "2026-09-10", ffAlreadyPaid: false,
  facts: { hasExitRecord: true, exitType: "voluntary", exitSubType: "resignation", exitReasonCategory: "relocation", legacyStatusText: "Resigned",
    disciplinaryFlag: false, blockLifted: false, gapDays: 10, priorRejoinCount: 0, totalAbscondingExits: 0,
    openClearanceCase: false, assetsUnreturned: false, ffAlreadyPaid: false },
};

beforeEach(() => {
  dbExecute.mockReset(); canViewEmployee.mockReset(); loadRehireFacts.mockReset(); isFormerReport.mockReset(); logSensitiveAction.mockReset();
  canViewEmployee.mockResolvedValue(true);
  isFormerReport.mockResolvedValue(true);
  dbExecute.mockResolvedValue([[], []]);
  loadRehireFacts.mockResolvedValue(cleanFacts);
});

describe("GET /:id/rehire-eligibility", () => {
  it("403s a role with no business asking", async () => {
    authUser = { id: "u1", role: "employee", roles: ["employee"] };
    const res = await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=2026-09-20`);
    expect(res.status).toBe(403);
  });

  it("400s a missing or malformed proposed_joining_date", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    expect((await request(app()).get(`/api/employees/${EMP}/rehire-eligibility`)).status).toBe(400);
    expect((await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=20-09-2026`)).status).toBe(400);
  });

  it("403s a caller outside the employee's scope", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=2026-09-20`);
    expect(res.status).toBe(403);
    expect(loadRehireFacts).not.toHaveBeenCalled();
  });

  it("403s a manager who never managed the employee", async () => {
    authUser = { id: "m1", role: "manager", roles: ["manager"] };
    isFormerReport.mockResolvedValue(false);
    const res = await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=2026-09-20`);
    expect(res.status).toBe(403);
    expect(isFormerReport).toHaveBeenCalledWith(expect.anything(), EMP, "m1");
  });

  it("404s an unknown employee", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    loadRehireFacts.mockResolvedValue(null);
    expect((await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=2026-09-20`)).status).toBe(404);
  });

  it("returns the verdict for an eligible leaver, and read-only (no writes)", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    const res = await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=2026-09-20`);
    expect(res.status).toBe(200);
    expect(res.body.data.eligibility.status).toBe("eligible");
    expect(res.body.data.gapDays).toBe(10);
    expect(dbExecute.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/i.test(String(sql)))).toBe(false);
  });

  it("returns blocked with reasons for a terminated employee", async () => {
    authUser = { id: "u1", role: "hr", roles: ["hr"] };
    loadRehireFacts.mockResolvedValue({ ...cleanFacts, facts: { ...cleanFacts.facts, exitSubType: "termination" } });
    const res = await request(app()).get(`/api/employees/${EMP}/rehire-eligibility?proposed_joining_date=2026-09-20`);
    expect(res.status).toBe(200);
    expect(res.body.data.eligibility.status).toBe("blocked");
    expect(res.body.data.eligibility.reasons[0].code).toBe("TERMINATED");
  });
});

describe("POST /:id/rehire-block/flag", () => {
  const body = { reason: "Fraudulent expense claims found after exit", flag_date: "2026-09-30" };

  it("403s a role that cannot flag (branch_head, manager)", async () => {
    for (const role of ["branch_head", "manager", "employee"]) {
      authUser = { id: "u1", role, roles: [role] };
      expect((await request(app()).post(`/api/employees/${EMP}/rehire-block/flag`).send(body)).status).toBe(403);
    }
  });

  it("400s a short reason", async () => {
    authUser = { id: "hr1", role: "hr", roles: ["hr"] };
    const res = await request(app()).post(`/api/employees/${EMP}/rehire-block/flag`).send({ reason: "bad" });
    expect(res.status).toBe(400);
  });

  it("403s an employee outside scope and writes nothing", async () => {
    authUser = { id: "hr1", role: "hr", roles: ["hr"] };
    canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).post(`/api/employees/${EMP}/rehire-block/flag`).send(body);
    expect(res.status).toBe(403);
    expect(dbExecute).not.toHaveBeenCalled();
  });

  it("404s an unknown employee", async () => {
    authUser = { id: "hr1", role: "hr", roles: ["hr"] };
    dbExecute.mockResolvedValue([[], []]);
    expect((await request(app()).post(`/api/employees/${EMP}/rehire-block/flag`).send(body)).status).toBe(404);
  });

  it("upserts the flag, re-arms a previous lift, and audits", async () => {
    authUser = { id: "hr1", role: "hr", roles: ["hr"] };
    dbExecute.mockImplementation(async (sql: string) =>
      String(sql).includes("SELECT id FROM employees") ? [[{ id: EMP }], []] : [{ affectedRows: 1 }, []]);
    const res = await request(app()).post(`/api/employees/${EMP}/rehire-block/flag`).send(body);
    expect(res.status).toBe(200);
    const up = dbExecute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO employee_rehire_control"))!;
    const sql = String(up[0]);
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/i);
    expect(sql).toMatch(/block_lifted_at\s*=\s*NULL/i);
    expect(up[1]).toEqual([EMP, body.reason, "2026-09-30", "hr1", null]);
    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({
      actor_user_id: "hr1", action_type: "REHIRE_DISCIPLINARY_FLAG_SET", entity_id: EMP, employee_id: EMP,
    }));
  });

  it("defaults the flag date to today when none is given", async () => {
    authUser = { id: "hr1", role: "hr", roles: ["hr"] };
    dbExecute.mockImplementation(async (sql: string) =>
      String(sql).includes("SELECT id FROM employees") ? [[{ id: EMP }], []] : [{ affectedRows: 1 }, []]);
    await request(app()).post(`/api/employees/${EMP}/rehire-block/flag`).send({ reason: "Misconduct discovered on audit" });
    const up = dbExecute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO employee_rehire_control"))!;
    expect((up[1] as unknown[])[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("POST /:id/rehire-block/lift", () => {
  const body = { reason: "Cleared after legal review, written approval on file" };

  it("403s everyone but super_admin — including admin and hr", async () => {
    for (const role of ["admin", "hr", "branch_head"]) {
      authUser = { id: "u1", role, roles: [role] };
      expect((await request(app()).post(`/api/employees/${EMP}/rehire-block/lift`).send(body)).status).toBe(403);
    }
  });

  it("400s a reason under 20 characters", async () => {
    authUser = { id: "sa1", role: "super_admin", roles: ["super_admin"] };
    expect((await request(app()).post(`/api/employees/${EMP}/rehire-block/lift`).send({ reason: "short reason" })).status).toBe(400);
  });

  it("409s when there is no active flag to lift", async () => {
    authUser = { id: "sa1", role: "super_admin", roles: ["super_admin"] };
    dbExecute.mockResolvedValue([[], []]);
    expect((await request(app()).post(`/api/employees/${EMP}/rehire-block/lift`).send(body)).status).toBe(409);
  });

  it("409s when the flag was already lifted", async () => {
    authUser = { id: "sa1", role: "super_admin", roles: ["super_admin"] };
    dbExecute.mockResolvedValue([[{ disciplinary_flag: 1, block_lifted_at: "2026-09-01 10:00:00" }], []]);
    expect((await request(app()).post(`/api/employees/${EMP}/rehire-block/lift`).send(body)).status).toBe(409);
  });

  it("lifts an active flag, records who and why, and audits", async () => {
    authUser = { id: "sa1", role: "super_admin", roles: ["super_admin"] };
    dbExecute.mockImplementation(async (sql: string) =>
      String(sql).includes("FROM employee_rehire_control") ? [[{ disciplinary_flag: 1, block_lifted_at: null }], []] : [{ affectedRows: 1 }, []]);
    const res = await request(app()).post(`/api/employees/${EMP}/rehire-block/lift`).send(body);
    expect(res.status).toBe(200);
    const up = dbExecute.mock.calls.find(([sql]) => String(sql).includes("UPDATE employee_rehire_control"))!;
    expect(up[1]).toEqual(["sa1", body.reason, EMP]);
    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({
      actor_user_id: "sa1", action_type: "REHIRE_BLOCK_LIFTED", entity_id: EMP, reason: body.reason,
    }));
  });
});
