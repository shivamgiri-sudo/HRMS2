import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: logError } }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});
vi.mock("../he-drive-analytics.service.js", async (importOriginal) => ({ ...(await importOriginal<object>()), getDriveAnalytics: vi.fn() }));
vi.mock("../he-drive-plan.service.js", async (importOriginal) => ({ ...(await importOriginal<object>()), getDrivePlan: vi.fn() }));
vi.mock("../he-meta-funnel.service.js", () => ({ getMetaFunnel: vi.fn(async () => ({ campaigns: [] })) }));
vi.mock("../he-launch.service.js", async (importOriginal) => ({ ...(await importOriginal<object>()), listLaunches: vi.fn(async () => []), listBatches: vi.fn(async () => []) }));
vi.mock("../he-drive-trend.service.js", async (importOriginal) => ({ ...(await importOriginal<object>()), getDriveGroupsDetailed: vi.fn() }));

import { getDriveAnalytics } from "../he-drive-analytics.service.js";
import { getDrivePlan } from "../he-drive-plan.service.js";
import { getDriveGroupsDetailed } from "../he-drive-trend.service.js";
import { clearCampaignDashboardCache, getCampaignDashboard, scopeDriveGroups, type CampaignDashboard } from "../he-campaign-dashboard.service.js";
import { heRouter } from "../he.routes.js";
import { istToday, addDays } from "../requisition-stream.window.js";

const RID = "0f1e2d3c-aaaa-bbbb-cccc-0000000abcde";
function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/he", heRouter);
  return app;
}
const noLeak = (body: unknown) => { const t = JSON.stringify(body); expect(t).not.toMatch(/\d{10}/); expect(t).not.toMatch(/SELECT/i); expect(t).not.toMatch(/\bat .*\.ts/); };

let batches: unknown[] = [];
let batchesError: unknown = null;
let hrBranch = "Pune";
beforeEach(() => {
  vi.clearAllMocks();
  clearCampaignDashboardCache();
  hrBranch = "Pune"; batches = []; batchesError = null;
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM employees e")) return [[{ branch_name: hrBranch }]];
    if (q.includes("FROM qualified_followup_call_batch")) { if (batchesError) throw batchesError; return [batches]; }
    return [[]];
  });
});
afterEach(() => { vi.useRealTimers(); });

describe("GET /drive-analytics", () => {
  it("200 for ceo with the window passed through", async () => {
    vi.mocked(getDriveAnalytics).mockResolvedValue({ ok: 1 } as never);
    const r = await request(appFor("ceo")).get("/api/he/drive-analytics?from=2026-10-01&to=2026-10-14");
    expect([r.status, r.body]).toEqual([200, { success: true, data: { ok: 1 } }]);
    expect(vi.mocked(getDriveAnalytics).mock.calls[0][0]).toEqual({ from: "2026-10-01", to: "2026-10-14", requisitionId: null, branch: null });
  });
  it("no query string uses today-13..today in IST from the clock", async () => {
    vi.mocked(getDriveAnalytics).mockResolvedValue({} as never);
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T20:30:00Z") }); // 2026-10-09 02:00 IST
    const r = await request(appFor("ceo")).get("/api/he/drive-analytics");
    expect(r.status).toBe(200);
    expect(vi.mocked(getDriveAnalytics).mock.calls[0][0]).toEqual({ from: "2026-09-26", to: "2026-10-09", requisitionId: null, branch: null });
  });
  it("400 for a bad date, a 93-day span, a far-future end, a bad id or branch; service {error} is 400 too", async () => {
    const app = appFor("ceo");
    const get = (q: string) => request(app).get(`/api/he/drive-analytics${q}`);
    expect([(await get("?from=2026-02-30&to=2026-03-05")).status, (await get("?from=2026-02-30&to=2026-03-05")).body.message]).toEqual([400, "Pick a valid date range"]);
    const span = await get("?from=2026-06-01&to=2026-09-01");
    expect([span.status, span.body.message]).toEqual([400, "The range can be at most 92 days, ending at most 14 days ahead"]);
    expect((await get(`?from=${istToday()}&to=${addDays(istToday(), 15)}`)).status).toBe(400);
    expect((await get("?requisitionId=zzz")).body.message).toBe("Invalid id");
    expect((await get("?branch=")).body.message).toBe("Invalid branch");
    expect((await get(`?branch=${"x".repeat(151)}`)).status).toBe(400);
    expect(getDriveAnalytics).not.toHaveBeenCalled();
    vi.mocked(getDriveAnalytics).mockResolvedValue({ error: "SELECT secret" } as never);
    const e = await get("?from=2026-10-01&to=2026-10-05");
    expect([e.status, e.body.message]).toEqual([400, "Invalid request"]);
  });
  it("404 when the service answers null: requisition, or branch when only a branch was given", async () => {
    vi.mocked(getDriveAnalytics).mockResolvedValue(null);
    const a = await request(appFor("ceo")).get(`/api/he/drive-analytics?from=2026-10-01&to=2026-10-05&requisitionId=${RID}`);
    expect([a.status, a.body.message]).toEqual([404, "Requisition not found"]);
    const b = await request(appFor("ceo")).get("/api/he/drive-analytics?from=2026-10-01&to=2026-10-05&branch=Nowhere");
    expect([b.status, b.body.message]).toEqual([404, "Branch not found"]);
  });
  it("passes the branch scope of the caller (Pune HR)", async () => {
    vi.mocked(getDriveAnalytics).mockResolvedValue({} as never);
    await request(appFor("hr")).get("/api/he/drive-analytics?from=2026-10-01&to=2026-10-05");
    expect(vi.mocked(getDriveAnalytics).mock.calls[0][1]).toMatchObject({ all: false, branchName: "Pune" });
  });
  it("403 for a role outside view; 500 is generic", async () => {
    expect((await request(appFor("employee")).get("/api/he/drive-analytics")).status).toBe(403);
    expect(getDriveAnalytics).not.toHaveBeenCalled();
    vi.mocked(getDriveAnalytics).mockRejectedValue(new Error("SELECT * FROM he_match WHERE phone = 9876543210\n    at x.ts:1"));
    const r = await request(appFor("ceo")).get("/api/he/drive-analytics?from=2026-10-01&to=2026-10-05");
    expect([r.status, r.body.message]).toEqual([500, "Could not load the drive analytics"]);
    noLeak(r.body);
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/\d{10}/);
  });
});

describe("GET /drive-plan", () => {
  it("200 valid, 400 missing id / days=15 / days=0 / bad from, 404 null, 403 employee", async () => {
    vi.mocked(getDrivePlan).mockResolvedValue({ plan: 1 } as never);
    const app = appFor("ceo");
    const ok = await request(app).get(`/api/he/drive-plan?requisitionId=${RID}&from=2026-10-09&days=5`);
    expect([ok.status, ok.body]).toEqual([200, { success: true, data: { plan: 1 } }]);
    expect(vi.mocked(getDrivePlan).mock.calls[0][0]).toEqual({ requisitionId: RID, from: "2026-10-09", days: 5 });
    expect((await request(app).get("/api/he/drive-plan")).body.message).toBe("requisitionId is required");
    const d15 = await request(app).get(`/api/he/drive-plan?requisitionId=${RID}&days=15`);
    expect([d15.status, d15.body.message]).toEqual([400, "Days must be a whole number from 1 to 14"]);
    expect((await request(app).get(`/api/he/drive-plan?requisitionId=${RID}&days=0`)).status).toBe(400);
    expect((await request(app).get(`/api/he/drive-plan?requisitionId=${RID}&days=2.5`)).status).toBe(400);
    expect((await request(app).get(`/api/he/drive-plan?requisitionId=${RID}&from=2026-13-01`)).body.message).toBe("Pick a valid date");
    vi.mocked(getDrivePlan).mockResolvedValue(null);
    expect((await request(app).get(`/api/he/drive-plan?requisitionId=${RID}`)).status).toBe(404);
    expect((await request(appFor("employee")).get(`/api/he/drive-plan?requisitionId=${RID}`)).status).toBe(403);
  });
  it("fractions go out at 4 decimals (no long digit runs in the JSON), whole numbers untouched", async () => {
    vi.mocked(getDrivePlan).mockResolvedValue({ calendar: [{ planned: 12, fill: 24 / 90 }], rates: [{ rate: 2 / 3, invited: 30 }], label: "x" } as never);
    const r = await request(appFor("ceo")).get(`/api/he/drive-plan?requisitionId=${RID}`);
    expect(r.body.data).toEqual({ calendar: [{ planned: 12, fill: 0.2667 }], rates: [{ rate: 0.6667, invited: 30 }], label: "x" });
    noLeak(r.body);
  });
  it("500 is generic", async () => {
    vi.mocked(getDrivePlan).mockRejectedValue(new Error("SELECT boom 1234567890"));
    const r = await request(appFor("ceo")).get(`/api/he/drive-plan?requisitionId=${RID}`);
    expect([r.status, r.body.message]).toEqual([500, "Could not load the plan"]);
    noLeak(r.body);
  });
});

describe("GET /qualified-followup/status", () => {
  it("is routed before /qualified-followup/:id (200, not the 400 of :id), with no digit runs or addresses in errors", async () => {
    batches = [
      { id: "b1", created_at: new Date("2026-10-08T03:00:00Z"), row_count: 12, status: "failed", error: "smtp 9876543210 rejected ops@example.com" },
      { id: "b2", created_at: new Date("2026-10-07T03:00:00Z"), row_count: 3, status: "sent", error: null },
    ];
    const r = await request(appFor("ceo")).get("/api/he/qualified-followup/status");
    expect(r.status).toBe(200);
    expect(r.body.data.callFiles[0]).toEqual({ id: "b1", createdAt: "2026-10-08T03:00:00.000Z", rows: 12, status: "failed", error: "smtp # rejected [email]" });
    expect(r.body.data.callFiles[1].error).toBeNull();
    expect(r.body.data.report.last).toBeNull(); // unknown since restart
    expect(r.body.data.mode).toBe("off");
    const q = execute.mock.calls.find((c) => String(c[0]).includes("qualified_followup_call_batch"))![0];
    expect(String(q)).toMatch(/ORDER BY created_at DESC LIMIT 10/);
    expect(JSON.stringify(r.body)).not.toMatch(/\d{6,}|@/);
  });
  it("the :id route still answers 400 for a non-id", async () => {
    expect((await request(appFor("ceo")).get("/api/he/qualified-followup/not-an-id")).status).toBe(400);
  });
  it("a missing table gives an empty list; 403 for employee; 500 generic", async () => {
    batchesError = Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" });
    const r = await request(appFor("ceo")).get("/api/he/qualified-followup/status");
    expect([r.status, r.body.data.callFiles]).toEqual([200, []]);
    expect((await request(appFor("employee")).get("/api/he/qualified-followup/status")).status).toBe(403);
    batchesError = new Error("SELECT x FROM y 5551234567");
    const e = await request(appFor("ceo")).get("/api/he/qualified-followup/status");
    expect([e.status, e.body.message]).toEqual([500, "Could not load the follow-up status"]);
    noLeak(e.body);
  });
});

const group = (branch: string) => ({ requisitionId: `r-${branch}`, branch, requisition: "R", role: "Agent", sourceType: "he", types: ["he"], streamIds: [], window: {}, totals: {}, days: [] });
const baseDash = (): CampaignDashboard => ({
  generatedAt: "t", live: [{ campaignId: "c" } as never], reruns: [{ id: "l" } as never], saved: { batches: [], sources: [], batchLaunches: [] },
  drives: [{ driveId: "d" } as never], driveGroups: [group("Pune"), group("Delhi")] as never,
});

describe("scopeDriveGroups", () => {
  it("org-wide returns the same object; a branch scope copies and filters only driveGroups", () => {
    const d = baseDash();
    expect(scopeDriveGroups(d, { all: true, branchName: null } as never)).toBe(d);
    const s = scopeDriveGroups(d, { all: false, branchName: "Pune" } as never);
    expect(s).not.toBe(d);
    expect(s.driveGroups.map((g) => g.branch)).toEqual(["Pune"]);
    expect(s.live).toBe(d.live); expect(s.reruns).toBe(d.reruns); expect(s.saved).toBe(d.saved); expect(s.drives).toBe(d.drives);
    expect(d.driveGroups).toHaveLength(2); // the cached object is not mutated
    expect(scopeDriveGroups(d, { all: false, branchName: null } as never).driveGroups).toEqual([]);
  });
});

describe("GET /campaign-dashboard", () => {
  it("org-wide gets every group and the same payload as the unscoped build; Pune HR only Pune; one cached build", async () => {
    vi.mocked(getDriveGroupsDetailed).mockResolvedValue({ groups: [group("Pune"), group("Delhi")] as never, failedSections: [] });
    const ceo = await request(appFor("ceo")).get("/api/he/campaign-dashboard");
    expect(ceo.status).toBe(200);
    const unscoped = JSON.parse(JSON.stringify(await getCampaignDashboard()));
    expect(ceo.body.data).toEqual(unscoped); // byte-identical to the previous behaviour for an org-wide user
    expect(ceo.body.data.driveGroups).toHaveLength(2);
    const sqlBefore = execute.mock.calls.length;
    const hr = await request(appFor("hr")).get("/api/he/campaign-dashboard");
    expect(hr.body.data.driveGroups.map((g: { branch: string }) => g.branch)).toEqual(["Pune"]);
    const { driveGroups: _a, ...hrRest } = hr.body.data; const { driveGroups: _b, ...ceoRest } = ceo.body.data;
    expect(hrRest).toEqual(ceoRest);
    expect(getDriveGroupsDetailed).toHaveBeenCalledTimes(1);
    // the only new SQL on the second request is the scope lookup, never a dashboard read
    expect(execute.mock.calls.slice(sqlBefore).every((c) => /employees|roles?/i.test(String(c[0])))).toBe(true);
    const again = await request(appFor("ceo")).get("/api/he/campaign-dashboard");
    expect(again.body.data.driveGroups).toHaveLength(2);
  });
});
