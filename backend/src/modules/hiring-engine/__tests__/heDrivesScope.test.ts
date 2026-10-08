/** Drive routes are branch-scoped like the analytics: a branch user sees and touches only drives of their branch; outside scope = 404. */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const h = vi.hoisted(() => ({ userBranch: "PUNE" as string | null, driveBranch: "PUNE" as string | null }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});
vi.mock("../he-inbox.service.js", () => ({ listInbox: vi.fn(), getInboxThread: vi.fn(), replyToCandidate: vi.fn() }));
vi.mock("../he-meta-recruitment.service.js", () => ({ getMetaRecruitment: vi.fn(async () => ({ campaigns: [], total: {} })) }));
vi.mock("../he-readiness.service.js", () => ({ getDriveReadiness: vi.fn(async () => ({ ok: true })) }));
vi.mock("../he-shortlist.service.js", () => ({ SHORTLIST_FILTERS: ["all"], getDriveShortlist: vi.fn(async () => ({ rows: [] })) }));
vi.mock("../he-superbot-sheet.service.js", () => ({ buildSuperbotSheet: vi.fn(async () => ({ csv: "a", rows: 1, skippedNoAddress: 0 })) }));
vi.mock("../he-drive.service.js", () => ({ createDrive: vi.fn(async () => ({ id: "D9" })), setDriveStatus: vi.fn(async () => undefined), suggestMatchesDetailed: vi.fn(async () => ({})) }));
vi.mock("../he-stream-guard.service.js", () => ({ DRIVE_STREAM_FED: "x", STREAM_CHECK_FAILED: "y", driveStreamCheck: vi.fn(async () => "none") }));
vi.mock("../he-engine.service.js", () => ({ inviteForDrive: vi.fn(async () => ({ sent: 0, blocked: 0 })), runEngineTick: vi.fn(), runFollowUps: vi.fn() }));

import { heRouter } from "../he.routes.js";
import { setDriveStatus } from "../he-drive.service.js";

const app = express(); app.use(express.json()); app.use("/api/he", heRouter);
const as = (role: string) => { actor = { id: `u-${role}`, role, roles: [role] }; };
const DRIVE_ROUTES: Array<["get" | "post", string, object?]> = [
  ["get", "/api/he/drives/D1/matches"], ["get", "/api/he/drives/D1/readiness"], ["get", "/api/he/drives/D1/shortlist"],
  ["post", "/api/he/drives/D1/status", { status: "paused" }], ["post", "/api/he/drives/D1/suggest"], ["post", "/api/he/drives/D1/launch", { dryRun: true }],
  ["get", "/api/he/drives/D1/superbot-sheet"],
];

beforeEach(() => {
  as("hr"); h.userBranch = "PUNE"; h.driveBranch = "PUNE";
  execute.mockReset();
  vi.mocked(setDriveStatus).mockClear();
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM employees e")) return [h.userBranch ? [{ branch_name: h.userBranch }] : []];
    if (q.includes("FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id WHERE d.id = ?")) return [h.driveBranch ? [{ branch_name: h.driveBranch }] : []];
    if (q.includes("FROM job_requisition WHERE id = ?")) return [h.driveBranch ? [{ branch_name: h.driveBranch }] : []];
    if (q.includes("SELECT status FROM he_drive")) return [[{ status: "active" }]];
    return [[{ id: "D1" }]];
  });
});

describe("GET /api/he/drives is branch-scoped", () => {
  it("a branch user's list is filtered to their branch", async () => {
    const r = await request(app).get("/api/he/drives");
    expect(r.status).toBe(200);
    const call = execute.mock.calls.find(([q]) => String(q).includes("FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id LEFT JOIN"));
    expect(String(call?.[0])).toContain("AND jr.branch_name = ?");
    expect(call?.[1]).toEqual(["PUNE"]);
  });
  it("a branch user without a branch gets an empty list and no drive read", async () => {
    h.userBranch = null;
    const r = await request(app).get("/api/he/drives");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect(execute.mock.calls.some(([q]) => String(q).includes("LEFT JOIN he_match m ON m.drive_id"))).toBe(false);
  });
});

describe("drive routes answer 404 outside the caller's branch", () => {
  it.each(DRIVE_ROUTES)("%s %s", async (method, url, body) => {
    h.driveBranch = "DELHI";
    const r = await request(app)[method](url).send(body ?? {});
    expect(r.status).toBe(404);
    expect(r.body.message).toBe("Drive not found");
  });
  it.each(DRIVE_ROUTES)("%s %s in scope is served", async (method, url, body) => {
    const r = await request(app)[method](url).send(body ?? {});
    expect(r.status).not.toBe(404);
  });
  it("an unknown drive is 404 for a branch user", async () => {
    h.driveBranch = null;
    expect((await request(app).get("/api/he/drives/D1/matches")).status).toBe(404);
  });
  it("status change outside scope never reaches the service", async () => {
    h.driveBranch = "DELHI";
    await request(app).post("/api/he/drives/D1/status").send({ status: "paused" });
    expect(setDriveStatus).not.toHaveBeenCalled();
  });
  it("creating a drive on another branch's requisition is 404", async () => {
    h.driveBranch = "DELHI";
    const r = await request(app).post("/api/he/drives").send({ requisitionId: "R1", driveDate: "2026-10-10" });
    expect(r.status).toBe(404);
  });
  it("org-wide caller: no scope lookup on a drive route", async () => {
    as("ceo");
    await request(app).get("/api/he/drives/D1/matches");
    expect(execute.mock.calls.some(([q]) => String(q).includes("WHERE d.id = ? LIMIT 1") && String(q).includes("jr.branch_name"))).toBe(false);
  });
});
