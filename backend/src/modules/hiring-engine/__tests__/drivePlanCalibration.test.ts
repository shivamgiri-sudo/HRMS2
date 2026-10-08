import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const loadActiveStreams = vi.hoisted(() => vi.fn());
const planStreamsForDay = vi.hoisted(() => vi.fn());
const getDailyPlan = vi.hoisted(() => vi.fn());
const guard = vi.hoisted(() => ({ throwing: false }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../requisition-stream.service.js", async (orig) => ({ ...(await orig<typeof import("../requisition-stream.service.js")>()), loadActiveStreams }));
vi.mock("../he-stream-plan.service.js", async (orig) => ({ ...(await orig<typeof import("../he-stream-plan.service.js")>()), planStreamsForDay }));
vi.mock("../he-policy.service.js", async (orig) => ({ ...(await orig<typeof import("../he-policy.service.js")>()), getDailyPlan }));
vi.mock("../he-readiness.service.js", () => ({ getRequisitionReadiness: async () => ({ ok: true, problems: [] }) }));
vi.mock("../he-insight-params.service.js", async () => ({ loadInsightThresholds: async () => ({ ...(await import("../he-drive-insights.js")).INSIGHT_DEFAULTS }) }));
// Calibration modules: real behaviour, but they throw when `guard.throwing` (proves the switch-off path never calls them).
vi.mock("../he-showrate-calibration.service.js", async (orig) => {
  const m = await orig<typeof import("../he-showrate-calibration.service.js")>();
  const wrap = <F extends (...a: never[]) => unknown>(f: F): F => ((...a: never[]) => { if (guard.throwing) throw new Error("calibration called"); return f(...a); }) as F;
  return { ...m, loadRateBook: wrap(m.loadRateBook), rateForStream: wrap(m.rateForStream), rateForRequisition: wrap(m.rateForRequisition) };
});
vi.mock("../he-showrate-calibration.js", async (orig) => {
  const m = await orig<typeof import("../he-showrate-calibration.js")>();
  return { ...m, calibratedCaps: ((...a: Parameters<typeof m.calibratedCaps>) => { if (guard.throwing) throw new Error("calibration called"); return m.calibratedCaps(...a); }) };
});

import { clearDrivePlanCache, getDrivePlan, type DrivePlan } from "../he-drive-plan.service.js";
import type { StreamRow } from "../requisition-stream.service.js";

const NOW = new Date("2026-10-14T06:00:00Z"); // Wed 14 Oct, 11:30 IST
const ALL = { all: true } as never;
const stream = (id: string, o: Partial<StreamRow> = {}): StreamRow => ({
  id, requisitionId: "r1", branchName: "Pune", sourceType: "meta_live", originId: `c-${id}`, originLabel: `Label ${id}`, openFrom: "2026-10-14", openDays: 3, dailyInvites: null,
  status: "open", closedReason: null, createdBy: null, createdAt: "2026-10-01 10:00:00", add: [], skip: [], version: 1, ...o,
});
let sample: unknown[];
let sampleFails = false;

beforeEach(() => {
  vi.clearAllMocks();
  clearDrivePlanCache();
  guard.throwing = false; sampleFails = false;
  sample = [];
  delete process.env.HE_SHOWRATE_CALIBRATION;
  loadActiveStreams.mockResolvedValue([stream("a")]);
  planStreamsForDay.mockResolvedValue({ plans: [], closed: [] });
  getDailyPlan.mockResolvedValue({ walkInsPerDay: 100, minOutreachPerDay: 400, showRatePct: 25, slotStart: "10:00", slotEnd: "17:30", slotMinutes: 30 });
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("WEEKDAY(d.drive_date)")) { if (sampleFails) throw Object.assign(new Error("x"), { code: "ER_LOCK_DEADLOCK" }); return [sample]; }
    if (q.includes("FROM job_requisition WHERE id")) return [[{ requisition_code: "REQ-1", branch_name: "Pune", requested_headcount: 10, fulfilled_headcount: 2 }]];
    if (q.includes("he_lead_campaign")) return [[{ n: 500 }]];
    return [[]];
  });
});
afterEach(() => { delete process.env.HE_SHOWRATE_CALIBRATION; });

const run = async (): Promise<DrivePlan> => { clearDrivePlanCache(); const r = await getDrivePlan({ requisitionId: "r1", from: "2026-10-14", days: 3 }, ALL, NOW); expect(r).not.toBeNull(); return r as DrivePlan; };
const line = (r: DrivePlan, date: string) => r.days.find((d) => d.date === date)!.streams.find((s) => s.streamId === "a")!;

describe("drive plan with HE_SHOWRATE_CALIBRATION on", () => {
  beforeEach(() => { process.env.HE_SHOWRATE_CALIBRATION = "true"; });

  it("uses the same-weekday rate on a Wednesday and falls back for Thursday", async () => {
    sample = [{ requisition_id: "r1", stream_id: "a", wd: 2, invited: 30, arrived: 12 }, { requisition_id: "r1", stream_id: "a", wd: 3, invited: 5, arrived: 1 }];
    const r = await run();
    expect(r.showRateMode).toBe("calibrated");
    expect(line(r, "2026-10-14")).toMatchObject({ rate: 0.4, basis: "actual_weekday" });
    expect(line(r, "2026-10-14").reasoning).toContain("(Wed 14-day actual, 30 invited)");
    // Thursday has only 5 invited, the whole window 35: 13 / 35
    expect(line(r, "2026-10-15")).toMatchObject({ rate: 0.3714, basis: "actual" });
    expect(line(r, "2026-10-15").reasoning).toContain("(14-day actual, 35 invited)");
  });

  it("shows the plan default (never a made-up number) when the sample is too small", async () => {
    sample = [{ requisition_id: "r1", stream_id: "a", wd: 2, invited: 10, arrived: 9 }];
    const r = await run();
    expect(line(r, "2026-10-14")).toMatchObject({ rate: 0.25, basis: "plan_default" });
    expect(line(r, "2026-10-14").reasoning).toContain("(plan default)");
  });

  it("derives the caps from the calibrated rate, like the planner", async () => {
    sample = [{ requisition_id: "r1", stream_id: "a", wd: 2, invited: 40, arrived: 4 }]; // 10% on Wednesday: twice today's invites at most
    const r = await run();
    const on = line(r, "2026-10-14").cap;
    delete process.env.HE_SHOWRATE_CALIBRATION;
    const off = line(await run(), "2026-10-14").cap;
    expect(on).toBeGreaterThan(off);
    expect(on).toBeLessThanOrEqual(off * 2);
  });

  it("keeps today's numbers and flags the section when the sample read fails", async () => {
    sampleFails = true;
    const r = await run();
    expect(r.showRateMode).toBeUndefined();
    expect(r.failedSections).toContain("calibration");
    expect(line(r, "2026-10-14").basis).toBe("plan_default");
  });
});

describe("drive plan with the switch off", () => {
  it("never calls the calibration modules and is identical to a run that would have thrown on them", async () => {
    sample = [{ requisition_id: "r1", stream_id: "a", wd: 2, invited: 40, arrived: 4 }];
    const plain = await run();
    guard.throwing = true;
    const guarded = await run();
    expect(guarded).toEqual(plain);
    expect("showRateMode" in guarded).toBe(false);
    expect(JSON.stringify(guarded)).toBe(JSON.stringify(plain));
    expect(execute.mock.calls.some((c) => String(c[0]).includes("WEEKDAY("))).toBe(false);
    for (const d of guarded.days) for (const s of d.streams) expect(["actual", "plan_default"]).toContain(s.basis);
    expect(guarded.rates.every((x) => !("weekday" in x))).toBe(true);
  });

  it("treats any value other than exactly true as off", async () => {
    process.env.HE_SHOWRATE_CALIBRATION = "1";
    expect("showRateMode" in (await run())).toBe(false);
  });
});
