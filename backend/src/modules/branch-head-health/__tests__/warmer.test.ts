import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listAllMasBranches = vi.fn();
const listBranchProcesses = vi.fn();
const getReportCached = vi.fn();
const getPnlCached = vi.fn();
const getOpsCached = vi.fn();
const registerTimer = vi.fn();
vi.mock("../scope.js", () => ({ listAllMasBranches: (...a: unknown[]) => listAllMasBranches(...a) }));
vi.mock("../processes.js", () => ({ listBranchProcesses: (...a: unknown[]) => listBranchProcesses(...a) }));
vi.mock("../loaders.js", () => ({
  getReportCached: (...a: unknown[]) => getReportCached(...a),
  getPnlCached: (...a: unknown[]) => getPnlCached(...a),
  getOpsCached: (...a: unknown[]) => getOpsCached(...a),
}));
vi.mock("../ops.js", () => ({ monthStart: (d: string) => `${d.slice(0, 7)}-01` }));
vi.mock("../../../shared/istDate.js", () => ({ getCurrentDateIST: () => "2026-10-15" }));
vi.mock("../../../logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../../workers/worker-utils.js", () => ({ registerTimer: (...a: unknown[]) => registerTimer(...a) }));

import { warmOnce, startBranchHealthWarmer, stopBranchHealthWarmerForTests } from "../warmer.js";

const br = (id: string) => ({ branchId: id, branchCode: id, branchName: id });
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  [listAllMasBranches, listBranchProcesses, getReportCached, getPnlCached, getOpsCached, registerTimer].forEach((m) => m.mockReset());
  listAllMasBranches.mockResolvedValue([br("a"), br("b"), br("c")]);
  listBranchProcesses.mockImplementation(async (ids: string[]) => ({
    active: [{ processId: "p" + ids[0], billingMirror: false, branchIds: ids }, { processId: "m", billingMirror: true, branchIds: ids }],
    unmapped: [],
  }));
  getReportCached.mockResolvedValue({}); getPnlCached.mockResolvedValue({}); getOpsCached.mockResolvedValue({});
});
afterEach(() => { vi.useRealTimers(); stopBranchHealthWarmerForTests(); delete process.env.BRANCH_HEAD_HEALTH_ENABLED; });

describe("warmOnce", () => {
  it("visits branches sequentially and fills all three caches with non-mirror processes", async () => {
    let inFlight = 0; let peak = 0;
    getReportCached.mockImplementation(async () => { inFlight++; peak = Math.max(peak, inFlight); await tick(); inFlight--; return {}; });
    const r = await warmOnce(new Date());
    expect(r.branches).toBe(3);
    expect(peak).toBe(1);
    expect(getPnlCached).toHaveBeenCalledTimes(3);
    expect(getOpsCached).toHaveBeenCalledTimes(3);
    const [br0, procs, range, date] = getOpsCached.mock.calls[0];
    expect(br0.branchId).toBe("a");
    expect(procs.map((p: any) => p.processId)).toEqual(["pa"]);
    expect(range).toEqual({ startDate: "2026-10-01", endDate: "2026-10-15" });
    expect(date).toBe("2026-10-15");
  });
  it("an overlapping call returns immediately", async () => {
    getReportCached.mockImplementation(async () => { await tick(); return {}; });
    const first = warmOnce();
    const second = await warmOnce();
    expect(second).toEqual({ branches: 0, ms: 0 });
    expect(listAllMasBranches).toHaveBeenCalledTimes(1);
    await first;
  });
  it("an error for one branch does not stop the others", async () => {
    getReportCached.mockImplementation(async (b: any) => { if (b.branchId === "a") throw new Error("boom"); return {}; });
    getOpsCached.mockImplementation(async (b: any) => { if (b.branchId === "b") throw new Error("boom"); return {}; });
    const r = await warmOnce();
    expect(r.branches).toBe(3);
    expect(getReportCached).toHaveBeenCalledTimes(3);
    expect(getPnlCached).toHaveBeenCalledTimes(3);
    expect(getOpsCached).toHaveBeenCalledTimes(3);
  });
});

describe("startBranchHealthWarmer", () => {
  it("schedules nothing unless the flag is true", () => {
    vi.useFakeTimers();
    startBranchHealthWarmer();
    expect(registerTimer).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("first warm at 45s then every 4 minutes; flag re-read each tick", async () => {
    vi.useFakeTimers();
    process.env.BRANCH_HEAD_HEALTH_ENABLED = "true";
    startBranchHealthWarmer();
    expect(registerTimer).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(44_000);
    expect(listAllMasBranches).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(listAllMasBranches).toHaveBeenCalledTimes(1);
    process.env.BRANCH_HEAD_HEALTH_ENABLED = "false";
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(listAllMasBranches).toHaveBeenCalledTimes(1);
    process.env.BRANCH_HEAD_HEALTH_ENABLED = "true";
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(listAllMasBranches).toHaveBeenCalledTimes(2);
  });
});
