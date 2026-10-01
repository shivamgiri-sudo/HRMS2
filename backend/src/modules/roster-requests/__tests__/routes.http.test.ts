import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  decide: vi.fn(),
  impact: vi.fn(),
  upsert: vi.fn(),
  list: vi.fn(),
  canAccessEmployee: vi.fn(),
  userCanAccessProcess: vi.fn(),
  audit: vi.fn(),
}));
let actor: { id: string; roles: string[] };

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: actor.id }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (_req: any, res: any, next: any) =>
    actor.roles.some((r) => roles.includes(r)) ? next() : res.status(403).json({ success: false }),
}));
vi.mock("../../../shared/accessGuard.js", () => ({
  hasRole: async (_id: string, ...roles: string[]) => actor.roles.some((r) => roles.includes(r)),
}));
vi.mock("../../../shared/scopeAccess.js", () => ({ ORG_WIDE_EXEMPT_ROLES: ["admin", "hr", "wfm"] }));
vi.mock("../../../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope: async () => ({}) }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: m.audit }));
vi.mock("../../wfm/branch-scope.js", () => ({
  canAccessEmployee: m.canAccessEmployee,
  OUT_OF_SCOPE_MSG: "out of scope",
  scopedProcessIdsForUser: async () => ["p1"],
  userCanAccessProcess: m.userCanAccessProcess,
}));
vi.mock("../roster-requests.impact.js", () => ({ computeImpact: m.impact }));
vi.mock("../roster-requests.decide.js", () => ({
  ALLOWED_ACTIONS: { swap: ["approve", "reject"], weekoff_rejection: ["approve", "reject", "realign", "escalate"], dispute: ["approve", "reject"], conflict: ["approve"] },
  decideRosterRequest: m.decide,
}));
vi.mock("../roster-requests.decision-log.js", () => ({ listDecisions: async () => [{ id: 1 }] }));
vi.mock("../roster-requests.auto-rule.js", () => ({ listAutoRules: m.list, upsertAutoRule: m.upsert }));

import { rosterRequestsRouter, rolesForKindAction } from "../roster-requests.routes.js";

function appFor(roles: string[]) {
  actor = { id: "u1", roles };
  const app = express();
  app.use(express.json());
  app.use("/api/roster-requests", rosterRequestsRouter);
  return app;
}
const impactOk = { week: [{ employeeId: "e1", days: [] }], blockers: [] };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.impact.mockResolvedValue(impactOk);
  m.canAccessEmployee.mockResolvedValue(true);
  m.userCanAccessProcess.mockResolvedValue(true);
  m.decide.mockImplementation(async (kind: string, id: string, input: any) => ({ ok: true, kind, id, action: input.action, applied: true }));
});

describe("rolesForKindAction", () => {
  it("mirrors per-kind restrictions", () => {
    expect(rolesForKindAction("weekoff_rejection", "realign")).toEqual(["admin", "hr", "wfm", "manager", "branch_head"]);
    expect(rolesForKindAction("swap", "approve")).toContain("team_leader");
    expect(rolesForKindAction("swap", "approve")).not.toContain("branch_head");
    expect(rolesForKindAction("conflict", "approve")).not.toContain("process_manager");
    expect(rolesForKindAction("dispute", "approve")).toContain("process_manager");
  });
});

describe("POST /:kind/:id/decide", () => {
  it("400 on bad kind and bad action", async () => {
    const app = appFor(["admin"]);
    expect((await request(app).post("/api/roster-requests/nope/1/decide").send({ action: "approve" })).status).toBe(400);
    expect((await request(app).post("/api/roster-requests/swap/1/decide").send({ action: "escalate" })).status).toBe(400);
  });
  it("403 for a role not allowed on the kind", async () => {
    const res = await request(appFor(["team_leader"])).post("/api/roster-requests/weekoff_rejection/1/decide").send({ action: "approve", reason: "x" });
    expect(res.status).toBe(403);
    expect(m.decide).not.toHaveBeenCalled();
  });
  it("403 out-of-scope before applying", async () => {
    m.canAccessEmployee.mockResolvedValue(false);
    const res = await request(appFor(["manager"])).post("/api/roster-requests/swap/1/decide").send({ action: "approve" });
    expect(res.status).toBe(403);
    expect(m.decide).not.toHaveBeenCalled();
  });
  it("200 success shape", async () => {
    const res = await request(appFor(["manager"])).post("/api/roster-requests/swap/1/decide").send({ action: "approve" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { ok: true, kind: "swap", id: "1", action: "approve", applied: true } });
  });
  it("409 blockers keep impact in the body", async () => {
    m.decide.mockRejectedValue(Object.assign(new Error("Cannot approve: x"), { statusCode: 409, impact: { blockers: ["x"] } }));
    const res = await request(appFor(["manager"])).post("/api/roster-requests/swap/1/decide").send({ action: "approve" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: "Cannot approve: x", impact: { blockers: ["x"] } });
  });
});

describe("POST /bulk-decide", () => {
  it("400 when more than 50 items", async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ kind: "swap", id: String(i) }));
    expect((await request(appFor(["admin"])).post("/api/roster-requests/bulk-decide").send({ items, action: "approve" })).status).toBe(400);
  });
  it("400 on realign action", async () => {
    expect((await request(appFor(["admin"])).post("/api/roster-requests/bulk-decide").send({ items: [{ kind: "swap", id: "1" }], action: "realign" })).status).toBe(400);
  });
  it("partial failure does not abort the batch", async () => {
    m.decide
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(Object.assign(new Error("Cannot approve: b1"), { statusCode: 409, impact: { blockers: ["b1"] } }));
    const res = await request(appFor(["admin"])).post("/api/roster-requests/bulk-decide").send({
      items: [{ kind: "swap", id: "1" }, { kind: "swap", id: "2" }, { kind: "bogus", id: "3" }],
      action: "approve",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.okCount).toBe(1);
    expect(res.body.data.failCount).toBe(2);
    expect(res.body.data.results[0]).toEqual({ kind: "swap", id: "1", ok: true });
    expect(res.body.data.results[1]).toMatchObject({ id: "2", ok: false, status: 409, blockers: ["b1"] });
    expect(res.body.data.results[2]).toMatchObject({ id: "3", ok: false, status: 400 });
  });
});

describe("history", () => {
  it("403 out of scope, 200 in scope", async () => {
    m.canAccessEmployee.mockResolvedValue(false);
    expect((await request(appFor(["manager"])).get("/api/roster-requests/swap/1/history")).status).toBe(403);
    m.canAccessEmployee.mockResolvedValue(true);
    const ok = await request(appFor(["manager"])).get("/api/roster-requests/swap/1/history");
    expect(ok.body).toEqual({ success: true, data: [{ id: 1 }] });
  });
});

describe("auto-rules", () => {
  const body = { processId: "11111111-1111-1111-1111-111111111111", kind: "swap", enabled: true };
  it("PUT forbidden for team_leader", async () => {
    expect((await request(appFor(["team_leader"])).put("/api/roster-requests/auto-rules").send(body)).status).toBe(403);
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("PUT 403 when process not accessible", async () => {
    m.userCanAccessProcess.mockResolvedValue(false);
    expect((await request(appFor(["ho_wfm"])).put("/api/roster-requests/auto-rules").send(body)).status).toBe(403);
  });
  it("PUT upserts and audits", async () => {
    const res = await request(appFor(["admin"])).put("/api/roster-requests/auto-rules").send(body);
    expect(res.status).toBe(200);
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ maxCoverageDrop: 0, requireCounterpartAccept: true }), "u1");
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action_type: "ROSTER_REQUEST_AUTO_RULE_UPDATED", module_key: "WFM" }));
  });
  it("GET /auto-rules is not swallowed by /:kind/:id routes", async () => {
    m.list.mockResolvedValue([]);
    const res = await request(appFor(["manager"])).get("/api/roster-requests/auto-rules");
    expect(res.status).toBe(200);
    expect(m.list).toHaveBeenCalledWith(["p1"]);
  });
});
