import express from "express";
import request from "supertest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const resolveHeadBranches = vi.fn();
const loadReport = vi.fn();
const buildOverview = vi.fn();
const listBranchProcesses = vi.fn();
const getProcessDrilldown = vi.fn();
const computeScore = vi.fn();
const writeSnapshot = vi.fn();
const readTrend = vi.fn();

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", email: "u1@x.in", role: req.headers["x-auth-role"] }; next(); },
}));
const requireRoleSpy = vi.hoisted(() => vi.fn());
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => {
    requireRoleSpy(...roles);
    return (req: any, res: any, next: any) =>
      req.headers["x-role"] === "employee" ? res.status(403).json({ success: false, message: "Forbidden" }) : next();
  },
}));
vi.mock("../scope.js", () => ({ resolveHeadBranches: (...a: unknown[]) => resolveHeadBranches(...a) }));
vi.mock("../overview.js", () => ({
  loadReport: (...a: unknown[]) => loadReport(...a),
  buildOverview: (...a: unknown[]) => buildOverview(...a),
}));
vi.mock("../processes.js", () => ({
  listBranchProcesses: (...a: unknown[]) => listBranchProcesses(...a),
  getProcessDrilldown: (...a: unknown[]) => getProcessDrilldown(...a),
}));
vi.mock("../score.js", () => ({ computeScore: (...a: unknown[]) => computeScore(...a) }));
vi.mock("../snapshot.js", () => ({
  writeSnapshot: (...a: unknown[]) => writeSnapshot(...a),
  readTrend: (...a: unknown[]) => readTrend(...a),
}));
const buildOpsSections = vi.fn();
const buildDataHealth = vi.fn();
vi.mock("../ops.js", () => ({
  buildOpsSections: (...a: unknown[]) => buildOpsSections(...a),
  monthStart: (d: string) => `${d.slice(0, 7)}-01`,
  SECTION_TIMEOUT_MS: 20_000,
}));
const noteActivity = vi.fn();
const warmInBackground = vi.fn();
vi.mock("../warmer.js", () => ({ noteActivity: (...a: unknown[]) => noteActivity(...a), warmInBackground: () => warmInBackground() }));
const buildProcessPnl = vi.fn();
vi.mock("../pnl.js", () => ({ buildProcessPnl: (...a: unknown[]) => buildProcessPnl(...a) }));
vi.mock("../dataHealth.js", () => ({ buildDataHealth: (...a: unknown[]) => buildDataHealth(...a) }));
const today = "2026-10-15";
vi.mock("../../../shared/istDate.js", () => ({ getCurrentDateIST: () => "2026-10-15" }));

import { branchHeadHealthRouter, clearBranchHeadHealthCaches } from "../routes.js";

const b1 = { branchId: "b1", branchCode: "C1", branchName: "One" };
const b2 = { branchId: "b2", branchCode: "C2", branchName: "Two" };
const section = { status: "ok", data: {}, asOf: today };

function app() {
  const a = express();
  a.use("/api/branch-head-health", branchHeadHealthRouter);
  a.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ success: false, message: err.message }));
  return a;
}

beforeEach(() => {
  process.env.BRANCH_HEAD_HEALTH_ENABLED = "true";
  [resolveHeadBranches, loadReport, buildOverview, listBranchProcesses, getProcessDrilldown, computeScore, writeSnapshot, readTrend].forEach((m) => m.mockReset());
  resolveHeadBranches.mockResolvedValue({ branches: [b1, b2], viaHomeFallback: false, orgWide: false, emptyReason: null });
  loadReport.mockResolvedValue({ raw: { shrinkage: { shrinkagePct: 5 }, lateStats: { totalLate: 2 }, headcount: { totalActive: 9 }, budget: { utilizationPct: 40 } } });
  buildOverview.mockImplementation(async (branch: any, date: string) => ({ branch, date, status: "healthy", attention: [], positives: [], people: section, attendance: section, hiring: section, finance: section, leaderboard: section }));
  computeScore.mockReturnValue({ score: 80, pillars: [], excluded: [] });
  listBranchProcesses.mockResolvedValue({ active: [], unmapped: [] });
  writeSnapshot.mockResolvedValue(undefined);
  clearBranchHeadHealthCaches();
  buildOpsSections.mockReset();
  buildDataHealth.mockReset();
  buildProcessPnl.mockReset();
  noteActivity.mockReset(); warmInBackground.mockReset();
  buildProcessPnl.mockResolvedValue(section);
  buildOpsSections.mockResolvedValue({ operations: section, quality: section, callmaster: section });
  buildDataHealth.mockResolvedValue(section);
});
afterEach(() => { delete process.env.BRANCH_HEAD_HEALTH_ENABLED; delete process.env.BRANCH_HEAD_HEALTH_PILOT_USERS; });

describe("branch-head-health routes", () => {
  it("400 on invalid date", async () => {
    const r = await request(app()).get("/api/branch-head-health/overview?date=15-10-2026");
    expect(r.status).toBe(400);
    expect(r.body.success).toBe(false);
  });
  it("400 on impossible calendar date", async () => {
    const r = await request(app()).get("/api/branch-head-health/overview?date=2026-02-31");
    expect(r.status).toBe(400);
  });
  it("400 on future date", async () => {
    const r = await request(app()).get("/api/branch-head-health/overview?date=2026-10-16");
    expect(r.status).toBe(400);
  });
  it("missing date defaults to today IST", async () => {
    const r = await request(app()).get("/api/branch-head-health/overview");
    expect(r.status).toBe(200);
    expect(r.body.data.branches).toHaveLength(2);
    expect(loadReport).toHaveBeenCalledWith(b1, today);
    expect(r.body.data.branches[0].score.score).toBe(80);
    expect(writeSnapshot).toHaveBeenCalledTimes(2);
  });
  it("drops branchIds outside the resolved scope", async () => {
    const r = await request(app()).get("/api/branch-head-health/overview?branchIds=b2,evil");
    expect(r.status).toBe(200);
    expect(r.body.data.branches.map((x: any) => x.branch.branchId)).toEqual(["b2"]);
    expect(listBranchProcesses).toHaveBeenCalledWith(["b2"]);
  });
  it("flag off returns 404", async () => {
    process.env.BRANCH_HEAD_HEALTH_ENABLED = "false";
    const r = await request(app()).get("/api/branch-head-health/overview");
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, message: "Not found" });
  });
  it("non-permitted role gets 403", async () => {
    const r = await request(app()).get("/api/branch-head-health/overview").set("x-role", "employee");
    expect(r.status).toBe(403);
  });
  it("drilldown 403 for out-of-scope branch", async () => {
    const r = await request(app()).get("/api/branch-head-health/process/p1/drilldown?branchId=zzz");
    expect(r.status).toBe(403);
    expect(getProcessDrilldown).not.toHaveBeenCalled();
  });
  it("drilldown defaults metric", async () => {
    getProcessDrilldown.mockResolvedValue([{ employeeCode: "E1", name: "A", value: 1, metric: "QA_QUALITY_PCT" }]);
    const r = await request(app()).get("/api/branch-head-health/process/p1/drilldown?branchId=b1");
    expect(r.status).toBe(200);
    expect(getProcessDrilldown).toHaveBeenCalledWith("b1", "p1", "QA_QUALITY_PCT");
    expect(r.body.data).toHaveLength(1);
  });
  it("trend 403 out of scope; clamps days", async () => {
    expect((await request(app()).get("/api/branch-head-health/trend?branchId=zzz")).status).toBe(403);
    readTrend.mockResolvedValue([]);
    const r = await request(app()).get("/api/branch-head-health/trend?branchId=b1&metric=score&days=500");
    expect(r.status).toBe(200);
    expect(readTrend).toHaveBeenCalledWith("b1", "score", 90);
  });
  it("one branch failing loadReport yields error sections, other fine", async () => {
    loadReport.mockImplementation(async (b: any) => { if (b.branchId === "b1") throw new Error("boom"); return { raw: {} }; });
    const r = await request(app()).get("/api/branch-head-health/overview");
    expect(r.status).toBe(200);
    const [x, y] = r.body.data.branches;
    expect(x.overview.people.status).toBe("error");
    expect(x.score).toBeNull();
    expect(y.overview.people.status).toBe("ok");
    expect(y.score).not.toBeNull();
  });
  it("snapshot failure does not fail the request", async () => {
    writeSnapshot.mockRejectedValue(new Error("db down"));
    const r = await request(app()).get("/api/branch-head-health/overview");
    expect(r.status).toBe(200);
  });
  it("requireRole is configured with exactly the four roles", () => {
    expect(requireRoleSpy).toHaveBeenCalledWith("branch_head", "ceo", "coo", "super_admin");
  });
  it("400 on unknown trend metric and invalid drilldown metric", async () => {
    expect((await request(app()).get("/api/branch-head-health/trend?branchId=b1&metric=evil")).status).toBe(400);
    expect((await request(app()).get("/api/branch-head-health/process/p1/drilldown?branchId=b1&metric=a;drop")).status).toBe(400);
  });
  it("listBranchProcesses failure is isolated", async () => {
    listBranchProcesses.mockRejectedValue(new Error("boom"));
    const r = await request(app()).get("/api/branch-head-health/overview");
    expect(r.status).toBe(200);
    expect(r.body.data.processes).toEqual({ active: [], unmapped: [] });
    expect(r.body.data.processesError).toBe(true);
    expect(r.body.data.branches).toHaveLength(2);
  });
  it("caps loadReport concurrency at 3 and keeps order", async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ branchId: `m${i}`, branchCode: `C${i}`, branchName: `N${i}` }));
    resolveHeadBranches.mockResolvedValue({ branches: many, viaHomeFallback: false, orgWide: true, emptyReason: null });
    let inFlight = 0; let peak = 0;
    loadReport.mockImplementation(async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return { raw: {} };
    });
    const r = await request(app()).get("/api/branch-head-health/overview");
    expect(r.status).toBe(200);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(r.body.data.branches.map((x: any) => x.branch.branchId)).toEqual(many.map((m) => m.branchId));
  });

  it("attaches ops sections with the branch's non-mirror processes; failures isolate", async () => {
    const pr = (id: string, branchIds: string[], billingMirror = false) => ({ processId: id, billingMirror, branchIds });
    listBranchProcesses.mockResolvedValue({ active: [pr("p1", ["b1"]), pr("p2", ["b2"]), pr("m", ["b1"], true)], unmapped: [] });
    buildOpsSections.mockImplementation(async (procs: any[]) => {
      if (procs[0]?.processId === "p2") throw new Error("boom");
      return { operations: section, quality: section, callmaster: section };
    });
    const r = await request(app()).get("/api/branch-head-health/overview");
    expect(r.status).toBe(200);
    const [o1, o2] = r.body.data.branches.map((x: any) => x.overview);
    expect(buildOpsSections.mock.calls[0][0].map((p: any) => p.processId)).toEqual(["p1"]);
    expect(buildOpsSections.mock.calls[0][1]).toEqual({ startDate: "2026-10-01", endDate: today });
    for (const k of ["operations", "quality", "callmaster"]) expect(o1[k].status).toBe("ok");
    expect(o1.dataHealth).toBeUndefined();
    expect(r.body.data.dataHealth.status).toBe("ok");
    expect(buildDataHealth.mock.calls[0][2]).toEqual(r.body.data.processes);
    expect(o2.operations.status).toBe("error");
    expect(buildDataHealth).toHaveBeenCalledTimes(1);
  });

  it("processes failure attaches error sections instead of omitting them", async () => {
    listBranchProcesses.mockRejectedValue(new Error("x"));
    const r = await request(app()).get("/api/branch-head-health/overview");
    const o = r.body.data.branches[0].overview;
    for (const k of ["operations", "quality", "callmaster"]) expect(o[k].status).toBe("error");
    expect(r.body.data.dataHealth.status).toBe("error");
  });

  it("caches loadReport and ops sections per branch+date within the TTL", async () => {
    await request(app()).get("/api/branch-head-health/overview?date=2026-10-14");
    await request(app()).get("/api/branch-head-health/overview?date=2026-10-14");
    expect(loadReport).toHaveBeenCalledTimes(2); // b1 and b2 once each
    expect(buildOpsSections).toHaveBeenCalledTimes(2);
    await request(app()).get("/api/branch-head-health/overview?date=2026-10-13");
    expect(loadReport).toHaveBeenCalledTimes(4);
  });
  it("does not cache failed ops sections", async () => {
    buildOpsSections.mockResolvedValue({ operations: { status: "error", data: null, asOf: today }, quality: section, callmaster: section });
    await request(app()).get("/api/branch-head-health/overview?date=2026-10-14&branchIds=b1");
    await request(app()).get("/api/branch-head-health/overview?date=2026-10-14&branchIds=b1");
    expect(buildOpsSections).toHaveBeenCalledTimes(2);
  });
  it("attaches processPnl per branch, caches it, and does not cache or propagate failures", async () => {
    const r1 = await request(app()).get("/api/branch-head-health/overview");
    expect(r1.status).toBe(200);
    expect(r1.body.data.branches.map((b: any) => b.overview.processPnl.status)).toEqual(["ok", "ok"]);
    expect(buildProcessPnl).toHaveBeenCalledWith(b1, today);
    await request(app()).get("/api/branch-head-health/overview");
    expect(buildProcessPnl).toHaveBeenCalledTimes(2);

    clearBranchHeadHealthCaches();
    buildProcessPnl.mockReset();
    buildProcessPnl.mockResolvedValue({ status: "error", data: null, asOf: today, message: "P&L could not be loaded" });
    await request(app()).get("/api/branch-head-health/overview");
    await request(app()).get("/api/branch-head-health/overview");
    expect(buildProcessPnl).toHaveBeenCalledTimes(4);

    clearBranchHeadHealthCaches();
    buildProcessPnl.mockReset();
    buildProcessPnl.mockRejectedValue(new Error("x"));
    const r3 = await request(app()).get("/api/branch-head-health/overview");
    expect(r3.status).toBe(200);
    expect(r3.body.data.branches[0].overview.processPnl).toMatchObject({ status: "error", message: "P&L could not be loaded" });
  });
  it("processPnl is attached even when the process list fails", async () => {
    listBranchProcesses.mockRejectedValue(new Error("down"));
    const r = await request(app()).get("/api/branch-head-health/overview");
    expect(r.body.data.processesError).toBe(true);
    expect(r.body.data.branches[0].overview.processPnl.status).toBe("ok");
  });
  it("starts P&L loads before the report loads finish and still isolates a failing branch", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const order: string[] = [];
    loadReport.mockImplementation(async (br: any) => { order.push(`report:${br.branchId}`); await gate; if (br.branchId === "b1") throw new Error("boom"); return { raw: {} }; });
    buildProcessPnl.mockImplementation(async (br: any) => { order.push(`pnl:${br.branchId}`); release(); return section; });
    const r = await request(app()).get("/api/branch-head-health/overview");
    expect(r.status).toBe(200);
    expect(order.indexOf("pnl:b1")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("pnl:b1")).toBeLessThan(order.length - 1);
    expect(order.filter((x) => x.startsWith("pnl:")).length).toBe(2);
    expect(r.body.data.branches[0].overview.people.status).toBe("error");
    expect(r.body.data.branches[1].overview.people.status).toBe("ok");
    expect(r.body.data.branches[0].overview.processPnl.status).toBe("ok");
  });
  it("all requested branchIds out of scope gives a clear emptyReason", async () => {
    const r = await request(app()).get("/api/branch-head-health/overview?branchIds=zzz");
    expect(r.body.data.branches).toEqual([]);
    expect(r.body.data.scope.emptyReason).toBe("No branch in your scope matches the request");
  });

  it("GET /enabled: 200 for a passing caller", async () => {
    const r = await request(app()).get("/api/branch-head-health/enabled");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { enabled: true } });
  });
  it("authorised requests note activity; /enabled triggers a background warm; gated requests do neither", async () => {
    await request(app()).get("/api/branch-head-health/overview");
    expect(noteActivity).toHaveBeenCalledTimes(1);
    expect(warmInBackground).not.toHaveBeenCalled();
    await request(app()).get("/api/branch-head-health/enabled");
    expect(warmInBackground).toHaveBeenCalledTimes(1);
    noteActivity.mockReset(); warmInBackground.mockReset();
    await request(app()).get("/api/branch-head-health/enabled").set("x-role", "employee");
    process.env.BRANCH_HEAD_HEALTH_ENABLED = "false";
    await request(app()).get("/api/branch-head-health/enabled");
    expect(noteActivity).not.toHaveBeenCalled();
    expect(warmInBackground).not.toHaveBeenCalled();
  });
  it("GET /enabled: 404 when flag off", async () => {
    delete process.env.BRANCH_HEAD_HEALTH_ENABLED;
    expect((await request(app()).get("/api/branch-head-health/enabled")).status).toBe(404);
  });
  it("GET /enabled: 404 for a non-pilot caller, 200 for a listed one (by email) and super_admin", async () => {
    process.env.BRANCH_HEAD_HEALTH_PILOT_USERS = "someone@else.in";
    const denied = await request(app()).get("/api/branch-head-health/enabled");
    expect(denied.status).toBe(404);
    expect(denied.body).toEqual({ success: false, message: "Not found" });
    expect((await request(app()).get("/api/branch-head-health/overview")).status).toBe(404);
    process.env.BRANCH_HEAD_HEALTH_PILOT_USERS = "U1@X.in";
    expect((await request(app()).get("/api/branch-head-health/enabled")).status).toBe(200);
    process.env.BRANCH_HEAD_HEALTH_PILOT_USERS = "someone@else.in";
    expect((await request(app()).get("/api/branch-head-health/enabled").set("x-auth-role", "super_admin")).status).toBe(200);
  });
  it("GET /enabled: 403 for a wrong role", async () => {
    expect((await request(app()).get("/api/branch-head-health/enabled").set("x-role", "employee")).status).toBe(403);
  });
});
