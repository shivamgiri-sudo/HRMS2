import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const err = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: err } }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});
vi.mock("../he-outcome-reason.service.js", async (importOriginal) => ({ ...(await importOriginal<object>()), recordOutcomeReason: vi.fn(), listOutcomes: vi.fn() }));

import { listOutcomes, recordOutcomeReason } from "../he-outcome-reason.service.js";
import { heRouter } from "../he.routes.js";

const ID = "0f1e2d3c-aaaa-bbbb-cccc-0000000abcde";
function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/he", heRouter);
  return app;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers();
  execute.mockImplementation(async (sql: string) => (String(sql).includes("FROM employees e") ? [[{ branch_name: "Pune" }]] : [[]]));
});

describe("POST /matches/:id/outcome-reason", () => {
  const url = `/api/he/matches/${ID}/outcome-reason`;
  it("off: 404 Not found, no service call", async () => {
    const r = await request(appFor("hr")).post(url).send({ reason: "distance" });
    expect([r.status, r.body.message]).toEqual([404, "Not found"]);
    expect(recordOutcomeReason).not.toHaveBeenCalled();
  });
  it("ceo cannot write: 403", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    expect((await request(appFor("ceo")).post(url).send({ reason: "distance" })).status).toBe(403);
  });
  it("bad id and bad body: 400", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    expect((await request(appFor("hr")).post("/api/he/matches/nope/outcome-reason").send({ reason: "distance" })).body.message).toBe("Invalid id");
    const b = await request(appFor("hr")).post(url).send({ reason: "weather" });
    expect([b.status, b.body.message]).toEqual([400, "Pick a reason from the list"]);
  });
  it("saved: 200 with outcome, reason and note; scope is passed", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    vi.mocked(recordOutcomeReason).mockResolvedValueOnce({ status: "saved", outcome: "no_show", reason: "salary", note: null });
    const r = await request(appFor("hr")).post(url).send({ reason: "salary" });
    expect([r.status, r.body]).toEqual([200, { success: true, data: { outcome: "no_show", reason: "salary", note: null } }]);
    expect(vi.mocked(recordOutcomeReason).mock.calls[0]).toEqual([ID, { reason: "salary", note: null }, { all: false, branchName: "Pune" }, "u-hr"]);
  });
  it("not_found 404 and wrong_state 409 with exact text", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    vi.mocked(recordOutcomeReason).mockResolvedValueOnce({ status: "not_found" });
    const a = await request(appFor("hr")).post(url).send({ reason: "salary" });
    expect([a.status, a.body.message]).toEqual([404, "Candidate not found"]);
    vi.mocked(recordOutcomeReason).mockResolvedValueOnce({ status: "wrong_state" });
    const b = await request(appFor("hr")).post(url).send({ reason: "salary" });
    expect([b.status, b.body.message]).toEqual([409, "Only a no-show or a decline can have a reason"]);
  });
  it("a thrown error is 500 with a generic message and no digits logged", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    vi.mocked(recordOutcomeReason).mockRejectedValueOnce(Object.assign(new Error("dup 9876543210"), { code: "ER_X" }));
    const r = await request(appFor("hr")).post(url).send({ reason: "salary" });
    expect([r.status, r.body.message]).toEqual([500, "Could not save the reason"]);
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/\d{6,}/);
  });
});

describe("GET /outcome-reasons", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T06:00:00Z")); });
  it("defaults to today - 2 .. today (IST) and lets ceo read", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    vi.mocked(listOutcomes).mockResolvedValueOnce({ enabled: true, rows: [], truncated: false, partial: false });
    const r = await request(appFor("ceo")).get("/api/he/outcome-reasons");
    expect(r.status).toBe(200);
    expect(vi.mocked(listOutcomes).mock.calls[0][0]).toEqual({ from: "2026-10-06", to: "2026-10-08" });
  });
  it("rejects a 15-day span, a future end and a non-date", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    const msg = "Pick up to 14 days ending today";
    const a = await request(appFor("hr")).get("/api/he/outcome-reasons?from=2026-09-24&to=2026-10-08");
    expect([a.status, a.body.message]).toEqual([400, msg]);
    expect((await request(appFor("hr")).get("/api/he/outcome-reasons?from=2026-10-08&to=2026-10-09")).body.message).toBe(msg);
    expect((await request(appFor("hr")).get("/api/he/outcome-reasons?from=2026-13-01&to=2026-10-08")).status).toBe(400);
    vi.mocked(listOutcomes).mockResolvedValueOnce({ enabled: true, rows: [], truncated: false, partial: false });
    expect((await request(appFor("hr")).get("/api/he/outcome-reasons?from=2026-09-25&to=2026-10-08")).status).toBe(200);
  });
  it("off: enabled false without a service call", async () => {
    const r = await request(appFor("hr")).get("/api/he/outcome-reasons");
    expect(r.body.data).toEqual({ enabled: false, rows: [], truncated: false, partial: false });
    expect(listOutcomes).not.toHaveBeenCalled();
  });
});
