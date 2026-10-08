import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const info = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info, error: vi.fn() } }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});
vi.mock("../he-action-queue.service.js", async (importOriginal) => ({ ...(await importOriginal<object>()), getActionQueue: vi.fn() }));

import { getActionQueue } from "../he-action-queue.service.js";
import { heRouter } from "../he.routes.js";

const ID = "0f1e2d3c-aaaa-bbbb-cccc-0000000abcde";
function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use("/api/he", heRouter);
  return app;
}
let hrBranch = "Pune";
let contactRows: unknown[] = [];
const contactBranches: string[] = [];
beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); hrBranch = "Pune"; contactRows = []; contactBranches.length = 0;
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const q = String(sql);
    if (q.includes("FROM employees e")) return [[{ branch_name: hrBranch }]];
    if (q.includes("SELECT l.mobile10 FROM he_match")) { contactBranches.push(String(params[1] ?? "")); return [contactRows]; }
    return [[]];
  });
});

describe("GET /action-queue", () => {
  it("switch off: enabled false, zero counts, no service call", async () => {
    const r = await request(appFor("ceo")).get("/api/he/action-queue");
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ enabled: false, items: [], truncated: false, partial: false, failedSections: [], counts: { replied_not_confirmed: 0, confirmed_no_reminder: 0, no_show_recovery: 0, wa_failed: 0, high_score_not_reached: 0 } });
    expect(getActionQueue).not.toHaveBeenCalled();
  });
  it("switch on: 200 for ceo; filters pass through; bad ids 400; null is 404", async () => {
    vi.stubEnv("HE_ACTION_QUEUE", "true");
    vi.mocked(getActionQueue).mockResolvedValueOnce({ enabled: true, items: [] } as never);
    const ok = await request(appFor("ceo")).get(`/api/he/action-queue?requisitionId=${ID}`);
    expect(ok.status).toBe(200);
    expect(vi.mocked(getActionQueue).mock.calls[0][0]).toEqual({ requisitionId: ID, branch: null });
    expect((await request(appFor("ceo")).get("/api/he/action-queue?requisitionId=x")).body.message).toBe("Invalid id");
    expect((await request(appFor("ceo")).get("/api/he/action-queue?branch=")).body.message).toBe("Invalid branch");
    vi.mocked(getActionQueue).mockResolvedValueOnce(null);
    const nf = await request(appFor("ceo")).get(`/api/he/action-queue?requisitionId=${ID}`);
    expect([nf.status, nf.body.message]).toEqual([404, "Requisition not found"]);
    vi.mocked(getActionQueue).mockResolvedValueOnce(null);
    expect((await request(appFor("ceo")).get("/api/he/action-queue?branch=Nowhere")).body.message).toBe("Branch not found");
  });
});

describe("GET /action-queue/contact", () => {
  it("off: 404 Not found", async () => {
    const r = await request(appFor("hr")).get(`/api/he/action-queue/contact?ref=match:${ID}&kind=tel`);
    expect([r.status, r.body.message]).toEqual([404, "Not found"]);
  });
  it("ceo is 403 (write roles only)", async () => {
    vi.stubEnv("HE_ACTION_QUEUE", "true");
    expect((await request(appFor("ceo")).get(`/api/he/action-queue/contact?ref=match:${ID}&kind=tel`)).status).toBe(403);
  });
  it("bad ref or kind is 400", async () => {
    vi.stubEnv("HE_ACTION_QUEUE", "true");
    for (const qs of ["ref=match:not-a-uuid&kind=tel", `ref=match:${ID}&kind=sms`, `kind=tel`]) {
      const r = await request(appFor("hr")).get(`/api/he/action-queue/contact?${qs}`);
      expect([r.status, r.body.message]).toEqual([400, "Invalid contact request"]);
    }
  });
  it("another branch's ref is 404; the scope is applied in the statement", async () => {
    vi.stubEnv("HE_ACTION_QUEUE", "true");
    contactRows = []; // the Pune-scoped statement finds nothing for a Noida match
    const r = await request(appFor("hr")).get(`/api/he/action-queue/contact?ref=match:${ID}&kind=tel`);
    expect([r.status, r.body.message]).toEqual([404, "Not found"]);
    expect(contactBranches).toEqual(["Pune"]);
  });
  it("a valid ref: 200 href, no-store, and the log has no 10-digit run", async () => {
    vi.stubEnv("HE_ACTION_QUEUE", "true");
    contactRows = [{ mobile10: "9876543210" }];
    const r = await request(appFor("hr")).get(`/api/he/action-queue/contact?ref=match:${ID}&kind=tel`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ href: "tel:+919876543210" });
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/\d{10}/);
    expect(info.mock.calls.at(-1)![0]).toEqual({ refType: "match", kind: "tel", userId: "u-hr" });
  });
  it("an invalid stored number is 404", async () => {
    vi.stubEnv("HE_ACTION_QUEUE", "true");
    contactRows = [{ mobile10: "1234567890" }];
    expect((await request(appFor("hr")).get(`/api/he/action-queue/contact?ref=match:${ID}&kind=whatsapp`)).status).toBe(404);
  });
});
