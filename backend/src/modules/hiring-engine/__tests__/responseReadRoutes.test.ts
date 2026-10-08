import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "hr", scope: { all: false, branchName: "NOIDA-2" } as { all: boolean; branchName: string | null } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "U1", role: h.role }; req.userRoles = [h.role]; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => (roles.includes(req.authUser.role) ? next() : res.status(403).json({ success: false })),
}));
vi.mock("../he-stream.routes.js", async (orig) => ({ ...(await orig<object>()), branchScopeOf: vi.fn(async () => h.scope) }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../response-read.service.js", async (orig) => ({
  ...(await orig<object>()),
  listResponses: vi.fn(async () => ({ rows: [], nextCursor: null })),
  responseQueue: vi.fn(async () => ({ rows: [], counts: { total: 0 }, oldestAt: null })),
  responseSummary: vi.fn(async () => ({ byChannel: {} })),
  driveConfirmed: vi.fn(async () => null),
}));
vi.mock("../response-timeline.service.js", () => ({ personTimeline: vi.fn(async () => null) }));

import { registerResponseRoutes } from "../response.routes.js";
import { driveConfirmed, listResponses, responseQueue, responseSummary } from "../response-read.service.js";
import { personTimeline } from "../response-timeline.service.js";
import { istToday, addDays } from "../requisition-stream.window.js";

const app = express(); app.use(express.json());
const r = express.Router(); registerResponseRoutes(r, { view: ["hr", "ceo"], write: ["hr"] }); app.use("/api/he", r);
const RID = "11111111-1111-1111-1111-111111111111";
beforeEach(() => { h.role = "hr"; h.scope = { all: false, branchName: "NOIDA-2" }; vi.clearAllMocks(); });

describe("GET /api/he/responses", () => {
  it("passes validated filters and the caller's scope; defaults to the last 7 days", async () => {
    const res = await request(app).get(`/api/he/responses?requisitionId=${RID}&channel=whatsapp&answer=confirm&status=applied&driveType=meta_old&q=98765%2043210&limit=20`);
    expect(res.status).toBe(200);
    const [q, scope] = vi.mocked(listResponses).mock.calls[0];
    expect(q).toMatchObject({ requisitionId: RID, channel: "whatsapp", answer: "confirm", status: "applied", driveType: "meta_old", mobile10: "9876543210", limit: 20, to: istToday(), from: addDays(istToday(), -6) });
    expect(scope).toEqual({ all: false, branchName: "NOIDA-2" });
  });
  it.each([
    ["from=2026-02-30"], ["from=2026-10-09&to=2026-10-01"], ["from=2026-01-01&to=2026-10-01"], ["channel=fax"], ["answer=maybe"], ["status=x"], ["driveType=tv"],
    [`requisitionId=abc`], ["limit=0"], ["limit=101"], ["q=123"], ["cursor=" + "x".repeat(100)],
  ])("400 on %s", async (qs) => {
    expect((await request(app).get(`/api/he/responses?${qs}`)).status).toBe(400);
    expect(listResponses).not.toHaveBeenCalled();
  });
  it("view-only roles read (ceo), other roles are refused", async () => {
    h.role = "ceo";
    expect((await request(app).get("/api/he/responses")).status).toBe(200);
    h.role = "recruiter";
    expect((await request(app).get("/api/he/responses")).status).toBe(403);
  });
  it("a failed read is 500 with a fixed message", async () => {
    vi.mocked(listResponses).mockRejectedValueOnce(new Error("SELECT 9876543210"));
    const res = await request(app).get("/api/he/responses");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("SELECT");
  });
});

describe("queue, summary, timeline, confirmed", () => {
  it("queue and summary pass the scope", async () => {
    expect((await request(app).get("/api/he/responses/queue")).status).toBe(200);
    expect(vi.mocked(responseQueue).mock.calls[0][0]).toEqual(h.scope);
    expect((await request(app).get("/api/he/responses/summary?from=2026-10-01&to=2026-10-08")).status).toBe(200);
    expect(vi.mocked(responseSummary).mock.calls[0][0]).toMatchObject({ from: "2026-10-01", to: "2026-10-08" });
  });
  it("timeline: exactly one key; unknown or out of scope is 404", async () => {
    expect((await request(app).get("/api/he/responses/timeline")).status).toBe(400);
    expect((await request(app).get(`/api/he/responses/timeline?responseId=7&leadId=${RID}`)).status).toBe(400);
    expect((await request(app).get("/api/he/responses/timeline?responseId=x")).status).toBe(400);
    const res = await request(app).get("/api/he/responses/timeline?responseId=7");
    expect(res.status).toBe(404);
    expect(vi.mocked(personTimeline).mock.calls[0]).toEqual([{ responseId: 7 }, h.scope]);
    vi.mocked(personTimeline).mockResolvedValueOnce({ person: { name: "A", mobileMasked: "xxxxxx1234" }, items: [], truncated: false });
    expect((await request(app).get(`/api/he/responses/timeline?matchId=${RID}`)).status).toBe(200);
  });
  it("confirmed list of a drive: 404 outside scope, 200 with data in scope", async () => {
    expect((await request(app).get(`/api/he/drives/${RID}/confirmed`)).status).toBe(404);
    vi.mocked(driveConfirmed).mockResolvedValueOnce({ drive: {} as never, rows: [], counts: { total: 0, confirmed: 0, arrived: 0, noShow: 0, conflicts: 0 } });
    const res = await request(app).get(`/api/he/drives/${RID}/confirmed`);
    expect(res.status).toBe(200);
    expect(res.body.data.counts.total).toBe(0);
    expect((await request(app).get("/api/he/drives/not-an-id/confirmed")).status).toBe(404);
  });
});
