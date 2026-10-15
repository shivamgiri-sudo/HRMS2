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
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
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
}));
vi.mock("../dataHealth.js", () => ({ buildDataHealth: (...a: unknown[]) => buildDataHealth(...a) }));
const today = "2026-10-15";
vi.mock("../../../shared/istDate.js", () => ({ getCurrentDateIST: () => "2026-10-15" }));

import { branchHeadHealthRouter } from "../routes.js";

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
  buildOpsSections.mockReset();
  buildDataHealth.mockReset();
  buildOpsSections.mockResolvedValue({ operations: section, quality: section, callmaster: section });
  buildDataHealth.mockResolvedValue(section);
});
afterEach(() => { delete process.env.BRANCH_HEAD_HEALTH_ENABLED; });

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
});
