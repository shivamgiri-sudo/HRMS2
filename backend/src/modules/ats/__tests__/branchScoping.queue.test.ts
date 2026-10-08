import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Walk-in queue (owner ruling 2026-10-01): ?branch= from the browser may only narrow the caller's own branch
 * scope, and every queue_id mutation is checked against the owning candidate's branch first.
 */
const { dbExecute, canAccess, resolveScope, branchScope, updateStatus, getLive } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  canAccess: vi.fn(),
  resolveScope: vi.fn(),
  branchScope: vi.fn(),
  updateStatus: vi.fn(),
  getLive: vi.fn(async () => []),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr", roles: ["hr"] }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../candidate-access.js", () => ({ canAccessCandidate: canAccess, resolveCandidateScope: resolveScope }));
vi.mock("../ats-branch-scope.js", () => ({
  resolveAtsBranchScope: branchScope,
  branchInScope: (s: any, b: string) => s.orgWide || s.spellings.includes(b),
  OUT_OF_BRANCH_MESSAGE: "Forbidden: outside your branch",
}));
vi.mock("../queue.enhanced.service.js", () => ({
  getLiveQueue: getLive, getQueueMetrics: vi.fn(async () => ({})), getNextCandidate: vi.fn(), updateQueueStatus: updateStatus,
  getRecruiterQueue: vi.fn(), callNextCandidate: vi.fn(), markNoShow: vi.fn(), getQueuePosition: vi.fn(async () => 1),
  cleanupStaleInterviews: vi.fn(), getOpsRoundQueue: vi.fn(), getOpsBoard: vi.fn(),
}));
vi.mock("../ats.email.service.js", () => ({ sendRejectedEmailProfessional: vi.fn() }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: {} }));

import { queueRouter } from "../queue.routes.js";

const app = express();
app.use(express.json());
app.use("/q", queueRouter);

beforeEach(() => {
  dbExecute.mockReset(); canAccess.mockReset(); updateStatus.mockReset(); getLive.mockClear();
  resolveScope.mockResolvedValue({ sql: "c.applied_for_branch IN (?)", params: ["NOIDA-2"] });
  branchScope.mockResolvedValue({ orgWide: false, spellings: ["NOIDA-2"] });
});

describe("walk-in queue", () => {
  it("GET /live passes the caller's scope to the service", async () => {
    const res = await request(app).get("/q/live");
    expect(res.status).toBe(200);
    expect(getLive).toHaveBeenCalledWith(expect.objectContaining({ scope: { sql: "c.applied_for_branch IN (?)", params: ["NOIDA-2"] } }));
  });

  it("GET /live?branch=<foreign> is refused (client branch is not scoping)", async () => {
    const res = await request(app).get("/q/live?branch=Pune");
    expect(res.status).toBe(403);
    expect(getLive).not.toHaveBeenCalled();
  });

  it("GET /live?branch=<own> narrows", async () => {
    expect((await request(app).get("/q/live?branch=NOIDA-2")).status).toBe(200);
  });

  it("POST /update-status on a token of another branch is refused and writes nothing", async () => {
    dbExecute.mockResolvedValue([[{ candidate_id: "cand-b" }], []]);
    canAccess.mockResolvedValue(false);
    const res = await request(app).post("/q/update-status").send({ queue_id: "t1", status: "called" });
    expect(res.status).toBe(403);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("POST /update-status in the caller's branch goes through", async () => {
    dbExecute.mockResolvedValue([[{ candidate_id: "cand-a" }], []]);
    canAccess.mockResolvedValue(true);
    const res = await request(app).post("/q/update-status").send({ queue_id: "t1", status: "called" });
    expect(res.status).toBe(200);
    expect(updateStatus).toHaveBeenCalledWith("t1", "called");
  });

  it("an unknown token is 404, GET /position/:candidateId outside the branch is 404", async () => {
    dbExecute.mockResolvedValue([[], []]);
    expect((await request(app).post("/q/call-next").send({ queue_id: "nope" })).status).toBe(404);
    canAccess.mockResolvedValue(false);
    expect((await request(app).get("/q/position/cand-b")).status).toBe(404);
  });
});
