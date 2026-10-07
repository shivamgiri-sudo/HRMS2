import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: logError } }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});
vi.mock("../requisition-stream.service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../requisition-stream.service.js")>();
  return { ...original, listStreams: vi.fn(), getStream: vi.fn(), listStreamEvents: vi.fn(), tryCreateStream: vi.fn(), tryChangeStream: vi.fn(), loadActiveStreams: vi.fn() };
});
vi.mock("../he-readiness.service.js", async (importOriginal) => ({ ...(await importOriginal<object>()), getRequisitionReadiness: vi.fn() }));
vi.mock("../he-stream-plan.service.js", async (importOriginal) => ({ ...(await importOriginal<object>()), planStreamsForDay: vi.fn() }));
vi.mock("../he-inbox.service.js", () => ({ listInbox: vi.fn(async () => ({ conversations: [] })), getInboxThread: vi.fn(), replyToCandidate: vi.fn() }));

import { getStream, listStreamEvents, listStreams, loadActiveStreams, tryChangeStream, tryCreateStream } from "../requisition-stream.service.js";
import { getRequisitionReadiness } from "../he-readiness.service.js";
import { planStreamsForDay } from "../he-stream-plan.service.js";
import { listInbox } from "../he-inbox.service.js";
import { heRouter } from "../he.routes.js";
import { istToday, addDays } from "../requisition-stream.window.js";

const RID = "0f1e2d3c-aaaa-bbbb-cccc-0000000abcde";
const SID = "1f1e2d3c-aaaa-bbbb-cccc-0000000abcde";
const stream = { id: SID, requisitionId: RID, status: "open", openFrom: "2026-10-08", openDays: 3, add: [], skip: [] };

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/he", heRouter);
  return app;
}
const tomorrow = () => addDays(istToday(), 1);
const noLeak = (body: unknown) => { const t = JSON.stringify(body); expect(t).not.toMatch(/\d{10}/); expect(t).not.toMatch(/SELECT/i); expect(t).not.toMatch(/\bat .*\.ts/); };

// requisition lookups: RID lives in "Pune"; "hr" is scoped to Pune or to Delhi (outside) per test
let hrBranch = "Pune";
beforeEach(() => {
  vi.clearAllMocks();
  hrBranch = "Pune";
  execute.mockImplementation(async (sql: string, params: unknown[]) => {
    const q = String(sql);
    if (q.includes("FROM job_requisition WHERE id")) return [params[0] === RID ? [{ branch_name: "Pune" }] : []];
    if (q.includes("FROM employees e")) return [[{ branch_name: hrBranch }]];
    return [[]];
  });
});

describe("stream reads", () => {
  it("lists streams for ceo (200), rejects a missing or bad requisitionId (400)", async () => {
    vi.mocked(listStreams).mockResolvedValue([stream] as never);
    const ok = await request(appFor("ceo")).get(`/api/he/requisition-streams?requisitionId=${RID}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true, data: [stream] });
    const none = await request(appFor("ceo")).get("/api/he/requisition-streams");
    expect([none.status, none.body.message]).toEqual([400, "requisitionId is required"]);
    expect((await request(appFor("ceo")).get("/api/he/requisition-streams?requisitionId=zzz")).status).toBe(400);
  });

  it("403 for a role outside the view roles", async () => {
    expect((await request(appFor("employee")).get(`/api/he/requisition-streams?requisitionId=${RID}`)).status).toBe(403);
  });

  it("gets one stream (200), 404 when null or out of scope, 400 on a bad id", async () => {
    vi.mocked(getStream).mockResolvedValueOnce(stream as never).mockResolvedValueOnce(null);
    expect((await request(appFor("ceo")).get(`/api/he/requisition-streams/${SID}`)).status).toBe(200);
    const nf = await request(appFor("ceo")).get(`/api/he/requisition-streams/${SID}`);
    expect([nf.status, nf.body.message]).toEqual([404, "Stream not found"]);
    expect((await request(appFor("ceo")).get("/api/he/requisition-streams/not-an-id")).body.message).toBe("Invalid id");
  });

  it("lists events (200) and answers 404 when the stream is out of scope", async () => {
    vi.mocked(listStreamEvents).mockResolvedValueOnce([{ id: "e1", action: "create" }] as never).mockResolvedValueOnce(null);
    expect((await request(appFor("hr")).get(`/api/he/requisition-streams/${SID}/events`)).body.data).toHaveLength(1);
    expect((await request(appFor("hr")).get(`/api/he/requisition-streams/${SID}/events`)).status).toBe(404);
  });
});

describe("POST /requisition-streams", () => {
  const body = { requisitionId: RID, sourceType: "he", originId: "pool", openFrom: "2026-10-08", openDays: 3 };

  it("403 for ceo; hr passes isAdmin false, admin passes isAdmin true (override only honoured for admins)", async () => {
    vi.mocked(tryCreateStream).mockResolvedValue({ ok: true, stream } as never);
    expect((await request(appFor("ceo")).post("/api/he/requisition-streams").send(body)).status).toBe(403);
    const hr = await request(appFor("hr")).post("/api/he/requisition-streams").send({ ...body, override: true });
    expect(hr.status).toBe(200);
    expect(vi.mocked(tryCreateStream).mock.calls[0][1]).toMatchObject({ isAdmin: false });
    expect(vi.mocked(tryCreateStream).mock.calls[0][0]).toMatchObject({ override: false });
    await request(appFor("admin")).post("/api/he/requisition-streams").send({ ...body, override: true });
    expect(vi.mocked(tryCreateStream).mock.calls[1][1]).toMatchObject({ isAdmin: true });
    expect(vi.mocked(tryCreateStream).mock.calls[1][0]).toMatchObject({ override: true });
  });

  it("400 on invalid bodies without calling the service", async () => {
    const app = appFor("hr");
    for (const bad of [{ ...body, requisitionId: "x" }, { ...body, sourceType: "sms" }, { ...body, openDays: 61 }, { ...body, openDays: 0 }, { ...body, dailyInvites: 501 }, { ...body, openFrom: "tomorrow" }, { ...body, reason: "x".repeat(256) }]) {
      expect((await request(app).post("/api/he/requisition-streams").send(bad)).status).toBe(400);
    }
    expect(tryCreateStream).not.toHaveBeenCalled();
  });

  it("409 carries the readiness problems", async () => {
    const problems = [{ code: "no_branch_address", severity: "blocking", message: "Add the branch address" }];
    vi.mocked(tryCreateStream).mockResolvedValue({ ok: false, reason: "not_ready", statusCode: 409, message: "The requisition is not ready", problems } as never);
    const r = await request(appFor("hr")).post("/api/he/requisition-streams").send(body);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ success: false, message: "The requisition is not ready", problems });
  });

  it("404 when the service says the requisition is outside the caller's branch", async () => {
    vi.mocked(tryCreateStream).mockResolvedValue({ ok: false, reason: "not_found", statusCode: 404, message: "Requisition not found" } as never);
    expect((await request(appFor("hr")).post("/api/he/requisition-streams").send(body)).status).toBe(404);
  });

  it("an unexpected error answers 500 with a generic body and logs without the SQL or digits", async () => {
    vi.mocked(tryCreateStream).mockRejectedValue(new Error("SELECT * FROM x WHERE mobile = 9876543210\n    at foo.ts:1"));
    const r = await request(appFor("hr")).post("/api/he/requisition-streams").send(body);
    expect([r.status, r.body.message]).toEqual([500, "Could not update the stream"]);
    noLeak(r.body);
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/\d{10}/);
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/foo\.ts/);
  });
});

describe("POST /requisition-streams/:id/change", () => {
  it("passes extend through and answers { changed, data }", async () => {
    vi.mocked(tryChangeStream).mockResolvedValue({ ok: true, changed: true, stream } as never);
    const r = await request(appFor("hr")).post(`/api/he/requisition-streams/${SID}/change`).send({ action: "extend", days: 3 });
    expect(r.body).toEqual({ success: true, changed: true, data: stream });
    expect(vi.mocked(tryChangeStream).mock.calls[0][0]).toBe(SID);
    expect(vi.mocked(tryChangeStream).mock.calls[0][1]).toMatchObject({ action: "extend", days: 3 });
  });
  it("400 Unknown action, 400 bad id, 403 for ceo", async () => {
    const r = await request(appFor("hr")).post(`/api/he/requisition-streams/${SID}/change`).send({ action: "explode" });
    expect([r.status, r.body.message]).toEqual([400, "Unknown action"]);
    expect((await request(appFor("hr")).post("/api/he/requisition-streams/abc/change").send({ action: "close" })).status).toBe(400);
    expect((await request(appFor("ceo")).post(`/api/he/requisition-streams/${SID}/change`).send({ action: "close" })).status).toBe(403);
    expect(tryChangeStream).not.toHaveBeenCalled();
  });
  it("404 and 409 map from the service", async () => {
    vi.mocked(tryChangeStream)
      .mockResolvedValueOnce({ ok: false, reason: "not_found", statusCode: 404, message: "Stream not found" } as never)
      .mockResolvedValueOnce({ ok: false, reason: "conflict", statusCode: 409, message: "Reopen the stream first" } as never);
    expect((await request(appFor("hr")).post(`/api/he/requisition-streams/${SID}/change`).send({ action: "extend", days: 1 })).status).toBe(404);
    expect((await request(appFor("hr")).post(`/api/he/requisition-streams/${SID}/change`).send({ action: "extend", days: 1 })).status).toBe(409);
  });
});

describe("GET /requisitions/:id/readiness", () => {
  it("200 with the stream's source type passed through; 400 bad source; 403; 404 outside the branch and for an unknown id", async () => {
    vi.mocked(getRequisitionReadiness).mockResolvedValue({ requisitionId: RID, code: "R1", branch: "Pune", ok: true, problems: [] } as never);
    const ok = await request(appFor("hr")).get(`/api/he/requisitions/${RID}/readiness?sourceType=meta_live`);
    expect(ok.status).toBe(200);
    expect(vi.mocked(getRequisitionReadiness)).toHaveBeenCalledWith(RID, "meta_live");
    expect((await request(appFor("hr")).get(`/api/he/requisitions/${RID}/readiness?sourceType=sms`)).status).toBe(400);
    expect((await request(appFor("hr")).get(`/api/he/requisitions/${RID}/readiness`)).status).toBe(400);
    expect((await request(appFor("employee")).get(`/api/he/requisitions/${RID}/readiness?sourceType=he`)).status).toBe(403);
    hrBranch = "Delhi";
    expect((await request(appFor("hr")).get(`/api/he/requisitions/${RID}/readiness?sourceType=he`)).status).toBe(404);
    expect((await request(appFor("admin")).get(`/api/he/requisitions/${SID}/readiness?sourceType=he`)).status).toBe(404);
  });
});

describe("calendar dates are real dates", () => {
  const create = (openFrom: string) => request(appFor("hr")).post("/api/he/requisition-streams").send({ requisitionId: RID, sourceType: "he", originId: "pool", openFrom, openDays: 3 });
  it("rejects 2026-11-31 and 2026-02-29 with 400 on every date input, accepts 2028-02-29", async () => {
    vi.mocked(tryCreateStream).mockResolvedValue({ ok: true, stream } as never);
    vi.mocked(tryChangeStream).mockResolvedValue({ ok: true, changed: true, stream } as never);
    for (const d of ["2026-11-31", "2026-02-29"]) {
      expect((await create(d)).status).toBe(400);
      expect((await request(appFor("hr")).post(`/api/he/requisition-streams/${SID}/change`).send({ action: "add_day", day: d })).status).toBe(400);
      expect((await request(appFor("hr")).post(`/api/he/requisition-streams/${SID}/change`).send({ action: "extend_to", toDate: d })).status).toBe(400);
      expect((await request(appFor("hr")).post(`/api/he/requisitions/${RID}/plan-now`).send({ date: d })).status).toBe(400);
    }
    expect((await create("2028-02-29")).status).toBe(200);
  });
});

describe("POST /requisitions/:id/plan-now", () => {
  const plan = (drive: string) => ({ plans: [{ requisitionId: RID, drive, streams: [] }], closed: [] });
  const covering = () => vi.mocked(loadActiveStreams).mockResolvedValue([{ ...stream, openFrom: tomorrow(), openDays: 5, dailyInvites: null }] as never);
  const post = (role: string, b: object, id = RID) => request(appFor(role)).post(`/api/he/requisitions/${id}/plan-now`).send(b);

  it("400 for today, the past, more than 7 days ahead and a malformed date", async () => {
    covering();
    for (const date of [istToday(), addDays(istToday(), -1), addDays(istToday(), 8), "2026-13-45", "soon"]) {
      const r = await post("hr", { date });
      expect([r.status, r.body.message]).toEqual([400, "Pick a day after today, at most 7 days ahead"]);
    }
    expect(planStreamsForDay).not.toHaveBeenCalled();
  });

  it("dryRun returns the mocked plan and passes dryRun true with the requisition", async () => {
    covering();
    vi.mocked(planStreamsForDay).mockResolvedValue(plan("would_create") as never);
    const r = await post("hr", { date: tomorrow(), dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.data.drive).toBe("would_create");
    expect(planStreamsForDay).toHaveBeenCalledWith({ date: tomorrow(), dryRun: true, requisitionId: RID });
  });

  it("the second live call is wired to the same service and reports the drive as existing", async () => {
    covering();
    vi.mocked(planStreamsForDay).mockResolvedValueOnce(plan("created") as never).mockResolvedValueOnce(plan("exists") as never);
    const a = await post("hr", { date: tomorrow() });
    const b = await post("hr", { date: tomorrow() });
    expect([a.body.data.drive, b.body.data.drive]).toEqual(["created", "exists"]);
    expect(vi.mocked(planStreamsForDay).mock.calls.every(([o]) => o.dryRun === false)).toBe(true);
  });

  it("409 when no open stream covers the date, 403 for ceo, 404 outside the branch", async () => {
    vi.mocked(loadActiveStreams).mockResolvedValue([{ ...stream, status: "paused", openFrom: tomorrow(), openDays: 5 }] as never);
    const r = await post("hr", { date: tomorrow() });
    expect([r.status, r.body.message]).toEqual([409, "No open stream covers that day"]);
    expect((await post("ceo", { date: tomorrow() })).status).toBe(403);
    covering();
    hrBranch = "Delhi";
    expect((await post("hr", { date: tomorrow() })).status).toBe(404);
    expect(planStreamsForDay).not.toHaveBeenCalled();
  });

  it("an unexpected error answers 500 Could not plan the day with no leak", async () => {
    covering();
    vi.mocked(planStreamsForDay).mockRejectedValue(new Error("SELECT secret FROM t WHERE p = 9876543210"));
    const r = await post("hr", { date: tomorrow() });
    expect([r.status, r.body.message]).toEqual([500, "Could not plan the day"]);
    noLeak(r.body);
  });
});

describe("inbox scope refactor", () => {
  it("GET /inbox still answers 200 through branchScopeOf", async () => {
    const r = await request(appFor("admin")).get("/api/he/inbox");
    expect(r.status).toBe(200);
    expect(listInbox).toHaveBeenCalledWith({ all: false, branchName: "Pune" }, undefined);
    expect(JSON.stringify(r.body)).not.toMatch(/\d{10}/);
  });
});
