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
