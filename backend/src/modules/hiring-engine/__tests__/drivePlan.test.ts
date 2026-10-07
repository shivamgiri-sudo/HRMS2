import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const getConnection = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
const loadActiveStreams = vi.hoisted(() => vi.fn());
const planStreamsForDay = vi.hoisted(() => vi.fn());
const getDailyPlan = vi.hoisted(() => vi.fn());
const readiness = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: logError } }));
vi.mock("../requisition-stream.service.js", async (orig) => ({ ...(await orig<typeof import("../requisition-stream.service.js")>()), loadActiveStreams }));
vi.mock("../he-stream-plan.service.js", async (orig) => ({ ...(await orig<typeof import("../he-stream-plan.service.js")>()), planStreamsForDay }));
vi.mock("../he-policy.service.js", async (orig) => ({ ...(await orig<typeof import("../he-policy.service.js")>()), getDailyPlan }));
vi.mock("../he-readiness.service.js", () => ({ getRequisitionReadiness: readiness }));
vi.mock("../he-insight-params.service.js", async () => ({ loadInsightThresholds: async () => ({ ...(await import("../he-drive-insights.js")).INSIGHT_DEFAULTS }) }));

import { calendarCells, planDay, streamRate, whatIf, type PlanStreamInput } from "../he-drive-plan.js";
import { clearDrivePlanCache, getDrivePlan, poolRemaining, type DrivePlan } from "../he-drive-plan.service.js";
import type { StreamRow } from "../requisition-stream.service.js";

describe("streamRate", () => {
  const base = { streamId: "s", sourceType: "meta_live" as const, planShowRate: 0.4, minSample: 30 };
  it("falls back to the plan default under the minimum sample", () => {
    expect(streamRate({ ...base, invited: 29, arrived: 20 })).toMatchObject({ rate: 0.4, basis: "plan_default" });
    expect(streamRate({ ...base, invited: 0, arrived: 0 })).toMatchObject({ rate: 0.4, basis: "plan_default" });
  });
  it("uses arrived / invited from the minimum sample", () => {
    expect(streamRate({ ...base, invited: 40, arrived: 12 })).toMatchObject({ rate: 0.3, basis: "actual", invited: 40, arrived: 12 });
  });
  it("is NaN safe", () => {
    const r = streamRate({ ...base, invited: Number.NaN, arrived: Number.POSITIVE_INFINITY, planShowRate: Number.NaN, minSample: 30 });
    expect(r.rate).toBe(0);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });
});

const rate = (streamId: string, r: number, basis: "actual" | "plan_default", invited = 0) => ({ streamId, sourceType: "meta_live" as const, invited, arrived: 0, rate: r, basis });
const input = (o: Partial<PlanStreamInput> & { streamId: string }): PlanStreamInput => ({
  sourceType: "meta_live", label: o.streamId, cap: 50, lined: 0, rate: rate(o.streamId, 0.4, "plan_default"), poolRemaining: null, covers: true, ...o,
});

describe("planDay", () => {
  const A = input({ streamId: "A", lined: 10, rate: rate("A", 0.3, "actual", 40), poolRemaining: null });
  const B = input({ streamId: "B", lined: 10, rate: rate("B", 0.4, "plan_default"), poolRemaining: 12 });
  it("allocates greedily, highest show rate first, capped by pool and seats", () => {
    const d = planDay({ date: "2026-10-15", driveId: "d1", target: 20, capacity: 60, streams: [A, B] });
    expect(d).toMatchObject({ expected: 7, gap: 13, seatsUsed: 20, capacity: 60 });
    expect(d.streams.map((s) => s.streamId)).toEqual(["B", "A"]);
    expect(d.streams[0].expected).toBe(4);
    expect(d.streams[0]).toMatchObject({ recommended: 12, reasoning: "Gap 13 shows / 40% show rate (plan default) = 33 invites; pool has 12 left, so 12" });
    // remaining 13 - 12 * 0.4 = 8.2 -> ceil(8.2 / 0.3) = 28; seats left 60 - 20 - 12 = 28 so nothing caps it
    expect(d.streams[1]).toMatchObject({ recommended: 28, reasoning: "Gap 8.2 shows / 30% show rate (14-day actual, 40 invited) = 28 invites" });
  });
  it("names the seat cap", () => {
    const d = planDay({ date: "x", driveId: null, target: 20, capacity: 25, streams: [A, B] });
    // seats left 5: B needs 33, pool 12, seats 5 -> seats cap
    expect(d.streams[0]).toMatchObject({ recommended: 5, reasoning: "Gap 13 shows / 40% show rate (plan default) = 33 invites; 5 seats left, so 5" });
    expect(d.streams[1].recommended).toBe(0);
  });
  it("recommends nothing without a gap", () => {
    const d = planDay({ date: "x", driveId: null, target: 5, capacity: 60, streams: [A, B] });
    expect(d.gap).toBe(0);
    for (const s of d.streams) { expect(s.recommended).toBe(0); expect(s.reasoning.endsWith("; no gap")).toBe(true); }
  });
  it("uses the invite floor for a 0 show rate (no Infinity)", () => {
    const z = input({ streamId: "Z", lined: 0, rate: rate("Z", 0, "actual", 50) });
    const d = planDay({ date: "x", driveId: null, target: 3, capacity: 1000, streams: [z] });
    expect(d.streams[0].recommended).toBe(60); // ceil(3 / 0.05)
    expect(JSON.stringify(d)).not.toMatch(/NaN|Infinity/);
  });
  it("does not recommend for a stream that is not open that day", () => {
    const d = planDay({ date: "x", driveId: null, target: 10, capacity: 60, streams: [input({ streamId: "N", covers: false, lined: 4 }), B] });
    const n = d.streams.find((s) => s.streamId === "N")!;
    expect(n).toMatchObject({ recommended: 0, reasoning: "Not open on this day", expected: 0 });
    expect(d.seatsUsed).toBe(14);
  });
  it("adds the arrivals of people no stream owns (extraExpected) and marks which lines cover the day", () => {
    const d = planDay({ date: "x", driveId: null, target: 20, capacity: 60, streams: [A, B], extraExpected: 5 });
    expect(d).toMatchObject({ expected: 12, gap: 8 });
    expect(d.streams[0]).toMatchObject({ streamId: "B", covers: true, recommended: 12, reasoning: "Gap 8 shows / 40% show rate (plan default) = 20 invites; pool has 12 left, so 12" });
    expect(d.streams[1]).toMatchObject({ streamId: "A", covers: true, recommended: 11 }); // ceil(3.2 / 0.3)
    expect(planDay({ date: "x", driveId: null, target: 20, capacity: 60, streams: [A], extraExpected: Number.NaN }).expected).toBe(3);
    expect(planDay({ date: "x", driveId: null, target: 10, capacity: 60, streams: [input({ streamId: "N", covers: false })] }).streams[0].covers).toBe(false);
  });
  it("is zero and NaN safe on garbage input", () => {
    const d = planDay({ date: "x", driveId: null, target: Number.NaN, capacity: -5, streams: [input({ streamId: "G", lined: Number.NaN, cap: Number.POSITIVE_INFINITY, poolRemaining: Number.NaN })] });
    expect(d).toMatchObject({ target: 0, capacity: 0, seatsUsed: 0, expected: 0, gap: 0 });
    expect(JSON.stringify(d)).not.toMatch(/NaN|Infinity/);
  });
  it("whatIf recomputes from edited numbers and leaves the base untouched", () => {
    const base = { date: "x", driveId: null, target: 20, capacity: 60, streams: [A, B] };
    const before = JSON.stringify(base);
    const w = whatIf(base, { target: 30, rate: { A: 0.5 }, pool: { B: null } });
    expect(w.target).toBe(30);
    expect(w.streams.find((s) => s.streamId === "A")!.rate).toBe(0.5);
    expect(w.expected).toBe(9);
    expect(JSON.stringify(base)).toBe(before);
    expect(whatIf(base, { rate: { A: 0 } }).gap).toBeGreaterThan(0);
    expect(whatIf(base, { target: 0 }).gap).toBe(0);
  });
});

describe("calendarCells", () => {
  it("fills by seats used over capacity and is 0 without capacity", () => {
    const d = planDay({ date: "2026-10-15", driveId: null, target: 20, capacity: 40, streams: [input({ streamId: "A", lined: 10, cap: 30 })] });
    expect(calendarCells([d])).toEqual([{ date: "2026-10-15", streamId: "A", planned: 10, cap: 30, capacity: 40, fill: 0.25 }]);
    const z = planDay({ date: "x", driveId: null, target: 20, capacity: 0, streams: [input({ streamId: "A", lined: 10 })] });
    expect(calendarCells([z])[0].fill).toBe(0);
  });
});

// ---- service ----------------------------------------------------------------------------------------------------------------------------
const NOW = new Date("2026-10-14T06:00:00Z"); // 11:30 IST Wed 14 Oct: checklist date Thu 15 Oct
const ALL = { all: true } as never;
const PUNE = { all: false, branchName: "Pune" } as never;
const NOIDA = { all: false, branchName: "Noida" } as never;
const stream = (id: string, o: Partial<StreamRow> = {}): StreamRow => ({
  id, requisitionId: "r1", branchName: "Pune", sourceType: "meta_live", originId: `c-${id}`, originLabel: `Label ${id}`, openFrom: "2026-10-15", openDays: 3, dailyInvites: null,
  status: "open", closedReason: null, createdBy: null, createdAt: "2026-10-01 10:00:00", add: [], skip: [], version: 1, ...o,
});
const dryPlan = { requisitionId: "r1", code: "REQ-1", branch: "Pune", date: "2026-10-15", driveId: null, drive: "would_create", streams: [
  { streamId: "s1", sourceType: "meta_live", originLabel: "Label s1", cap: 100, alreadyLined: 0, lined: 0, wouldLine: 60 },
  { streamId: "s2", sourceType: "he", originLabel: "Pool", cap: 40, alreadyLined: 0, lined: 0, wouldLine: 25 }] };

type Impl = { header?: unknown[]; drives?: unknown[]; lined?: unknown[]; rates?: unknown[]; planned?: unknown[]; pool?: unknown[]; fail?: Record<string, string> };
let impl: Impl;
const kindOf = (q: string): string =>
  q.includes("FROM job_requisition WHERE id") ? "header" : q.includes("FROM he_drive WHERE requisition_id") ? "drives" : q.includes("AS stream_id, COUNT(*)") ? "lined"
    : q.includes("SUM(m.state IN") ? "rates" : q.includes("requisition_stream_plan") ? "planned" : q.includes("he_lead_campaign") || q.includes("he_lead_batch") ? "pool" : q.includes("FROM he_drive WHERE id") ? "origin" : "other";
const sqls = () => execute.mock.calls.map((c) => String(c[0]));
const ok = (r: DrivePlan | null): DrivePlan => { expect(r).not.toBeNull(); return r as DrivePlan; };

beforeEach(() => {
  vi.clearAllMocks();
  clearDrivePlanCache();
  impl = {};
  loadActiveStreams.mockResolvedValue([stream("s1"), stream("s2", { sourceType: "he", originId: "pool", originLabel: "Pool" })]);
  planStreamsForDay.mockResolvedValue({ plans: [dryPlan], closed: [] });
  getDailyPlan.mockResolvedValue({ walkInsPerDay: 100, minOutreachPerDay: 400, showRatePct: 25, slotStart: "10:00", slotEnd: "17:30", slotMinutes: 30 });
  readiness.mockResolvedValue({ requisitionId: "r1", code: "REQ-1", branch: "Pune", ok: true, problems: [] });
  execute.mockImplementation(async (sql: string) => {
    const k = kindOf(String(sql));
    const c = impl.fail?.[k];
    if (c) throw Object.assign(new Error("SELECT boom WHERE mobile = 9876543210"), { code: c });
    if (k === "header") return [impl.header ?? [{ requisition_code: "REQ-1", branch_name: "Pune", requested_headcount: 10, fulfilled_headcount: 2 }]];
    if (k === "drives") return [impl.drives ?? []];
    if (k === "lined") return [impl.lined ?? []];
    if (k === "rates") return [impl.rates ?? []];
    if (k === "planned") return [impl.planned ?? []];
    if (k === "pool") return [impl.pool ?? [{ n: 500 }]];
    return [[]];
  });
});

describe("getDrivePlan", () => {
  it("answers null outside the caller's scope or for an unknown requisition, before any other read", async () => {
    expect(await getDrivePlan({ requisitionId: "r1" }, NOIDA, NOW)).toBeNull();
    expect(await getDrivePlan({ requisitionId: "r1" }, { all: false, branchName: null } as never, NOW)).toBeNull();
    impl.header = [];
    expect(await getDrivePlan({ requisitionId: "nope" }, ALL, NOW)).toBeNull();
    expect(sqls().filter((q) => kindOf(q) !== "header")).toEqual([]);
    expect(planStreamsForDay).not.toHaveBeenCalled();
  });

  it("plans the next days, adding a Sunday the stream opens", async () => {
    loadActiveStreams.mockResolvedValue([stream("s1", { openDays: 3 }), stream("s2", { sourceType: "he", openFrom: "2026-10-18", openDays: 1, add: ["2026-10-18"] })]);
    const r = ok(await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 3 }, ALL, NOW));
    expect(r.days.map((d) => d.date)).toEqual(["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(r.calendar).toHaveLength(8);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity|\d{10}/);
  });

  it("clamps days and defaults from to the next working day", async () => {
    const a = ok(await getDrivePlan({ requisitionId: "r1", days: 99 }, ALL, NOW));
    expect(a.from).toBe("2026-10-15");
    expect(a.days).toHaveLength(14);
    clearDrivePlanCache();
    expect(ok(await getDrivePlan({ requisitionId: "r1", days: Number.NaN, from: "2026-02-30" }, ALL, NOW)).days).toHaveLength(7);
  });

  it("runs the stream pass once, as a dry run, and never writes or locks", async () => {
    const r = ok(await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 3 }, ALL, NOW));
    expect(planStreamsForDay).toHaveBeenCalledTimes(1);
    expect(planStreamsForDay).toHaveBeenCalledWith({ date: "2026-10-15", dryRun: true, requisitionId: "r1" });
    for (const q of sqls()) { expect(q.trim()).toMatch(/^SELECT/i); expect(q).not.toMatch(/\b(INSERT|UPDATE|DELETE|GET_LOCK)\b/i); }
    expect(getConnection).not.toHaveBeenCalled();
    expect(r.checklist.items[0]).toEqual({ kind: "will_plan", text: "Tonight the evening pass will create the drive and line up 85 people (Label s1 60, Pool 25)" });
  });

  it("builds the checklist: already planned, fill soon, stream ends, pool below quota, readiness", async () => {
    loadActiveStreams.mockResolvedValue([stream("s1", { openDays: 1, dailyInvites: 100 })]);
    impl.header = [{ requisition_code: "REQ-1", branch_name: "Pune", requested_headcount: 10, fulfilled_headcount: 9 }];
    impl.planned = [{ stream_id: "s1", lined: 30 }];
    impl.pool = [{ n: 40 }];
    readiness.mockResolvedValue({ ok: false, problems: [{ code: "no_bmi_link", severity: "warning", message: "No BookMyInterview link" }] });
    const items = ok(await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 2 }, ALL, NOW)).checklist.items;
    const kinds = items.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["will_plan", "already_planned", "fill_soon", "stream_ends_tomorrow", "pool_below_quota", "readiness"]));
    expect(items.find((i) => i.kind === "already_planned")!.text).toBe("Label s1: 30 already lined up");
    expect(items.find((i) => i.kind === "fill_soon")!.text).toBe("Only 1 positions left: the requisition is about to be filled");
    expect(items.find((i) => i.kind === "pool_below_quota")!.text).toContain("40 people left");
    expect(items.find((i) => i.kind === "readiness")!.text).toBe("No BookMyInterview link");
  });

  it("gives no fill_soon item when plenty of positions are left and no preview without a covering stream", async () => {
    loadActiveStreams.mockResolvedValue([stream("s1", { openFrom: "2026-10-20" })]);
    const r = ok(await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 2 }, ALL, NOW));
    expect(r.checklist.preview).toBeNull();
    expect(planStreamsForDay).not.toHaveBeenCalled();
    expect(r.checklist.items.some((i) => i.kind === "fill_soon")).toBe(false);
  });

  it("joins credits through he_match (a stale credit drive_id is ignored) and counts uncredited people for the he stream", async () => {
    impl.drives = [{ id: "d1", drive_date: "2026-10-15", status: "active", target_shows: 30, slot_start: "10:00:00", slot_end: "12:00:00", slot_minutes: 30, slot_capacity: 5 }];
    impl.lined = [{ drive_id: "d1", stream_id: "s1", n: 12 }, { drive_id: "d1", stream_id: null, n: 3 }];
    const r = ok(await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 1 }, ALL, NOW));
    const day = r.days[0];
    expect(day).toMatchObject({ driveId: "d1", target: 30, capacity: 20, seatsUsed: 15 });
    expect(day.streams.find((s) => s.streamId === "s1")!.lined).toBe(12);
    expect(day.streams.find((s) => s.streamId === "s2")!.lined).toBe(3);
    const lined = sqls().find((q) => kindOf(q) === "lined")!;
    expect(lined).toContain("JOIN he_match m ON m.drive_id = d.id");
    expect(lined).toContain("sm.match_id = m.id");
    expect(lined).not.toContain("sm.drive_id");
  });

  it("counts uncredited people as used seats even when there is no Hiring Engine stream", async () => {
    loadActiveStreams.mockResolvedValue([stream("s1")]);
    impl.drives = [{ id: "d1", drive_date: "2026-10-15", status: "active", target_shows: 30, slot_start: "10:00:00", slot_end: "12:00:00", slot_minutes: 30, slot_capacity: 5 }];
    impl.lined = [{ drive_id: "d1", stream_id: "s1", n: 12 }, { drive_id: "d1", stream_id: null, n: 3 }];
    const day = ok(await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 1 }, ALL, NOW)).days[0];
    expect(day.seatsUsed).toBe(15); // capacity 20: 5 seats left, not 8
    expect(day.streams.map((x) => [x.streamId, x.lined])).toEqual([["s1", 12]]);
    expect(day.streams[0].recommended).toBeLessThanOrEqual(5);
  });

  it("counts the arrivals of unowned people at the plan default show rate when a Live Meta stream is open (20 orphans)", async () => {
    loadActiveStreams.mockResolvedValue([stream("s1")]);
    impl.drives = [{ id: "d1", drive_date: "2026-10-15", status: "active", target_shows: 30, slot_start: "10:00:00", slot_end: "12:00:00", slot_minutes: 30, slot_capacity: 10 }];
    impl.lined = [{ drive_id: "d1", stream_id: "s1", n: 12 }, { drive_id: "d1", stream_id: null, n: 20 }];
    const day = ok(await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 1 }, ALL, NOW)).days[0];
    // 12 credited x 25% + 20 unowned x 25% (plan default) = 8; before the fix the 20 held seats but added nothing
    expect(day).toMatchObject({ seatsUsed: 32, capacity: 40, expected: 8, gap: 22 });
    expect(day.streams[0]).toMatchObject({ streamId: "s1", lined: 12, expected: 3, covers: true, recommended: 8 }); // 8 seats left
  });

  it("uses the thresholds it is given instead of loading them", async () => {
    const t = { ...(await import("../he-drive-insights.js")).INSIGHT_DEFAULTS, "insight.plan_trailing_days": 3 };
    ok(await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 1 }, ALL, NOW, t));
    const rates = execute.mock.calls.find((c) => kindOf(String(c[0])) === "rates")!;
    expect(rates[1]).toEqual(["r1", "2026-10-11", "2026-10-13"]); // today 14 Oct minus 3 days
  });

  it("returns copies from the cache so an edited result never leaks into the next one", async () => {
    const q = { requisitionId: "r1", from: "2026-10-15", days: 1 };
    const a = ok(await getDrivePlan(q, ALL, NOW));
    a.days[0].target = 12345;
    a.checklist.items.push({ kind: "readiness", text: "x" });
    const b = ok(await getDrivePlan(q, ALL, NOW));
    const c = ok(await getDrivePlan(q, ALL, NOW));
    expect(b.days[0].target).not.toBe(12345);
    expect(b.checklist.items.some((i) => i.text === "x")).toBe(false);
    b.days[0].target = 7;
    expect(c.days[0].target).not.toBe(7);
  });

  it("uses the plan target and capacity when the day has no drive", async () => {
    const r = ok(await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 1 }, ALL, NOW));
    expect(r.days[0]).toMatchObject({ driveId: null, target: 100, capacity: 405 });
  });

  it("shows the actual 14-day rate from 30 invited and flags a rates failure with plan defaults", async () => {
    impl.rates = [{ stream_id: "s1", invited: 50, arrived: 20 }];
    const a = ok(await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 1 }, ALL, NOW));
    expect(a.rates.find((x) => x.streamId === "s1")).toMatchObject({ rate: 0.4, basis: "actual", invited: 50, arrived: 20 });
    expect(a.rates.find((x) => x.streamId === "s2")).toMatchObject({ rate: 0.25, basis: "plan_default" });
    const trail = execute.mock.calls.find((c) => kindOf(String(c[0])) === "rates")!;
    expect(trail[1]).toEqual(["r1", "2026-09-30", "2026-10-13"]);

    clearDrivePlanCache();
    impl.fail = { rates: "ER_BAD_FIELD_ERROR" };
    const b = ok(await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 1 }, ALL, NOW));
    expect(b.partial).toBe(true);
    expect(b.failedSections).toContain("rates");
    expect(b.rates.every((x) => x.basis === "plan_default")).toBe(true);
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/boom|9876543210/);
    expect(logError).toHaveBeenCalledWith({ section: "rates", code: "ER_BAD_FIELD_ERROR" }, expect.any(String));
  });

  it("treats missing stream tables as no rows, not a failed section", async () => {
    loadActiveStreams.mockRejectedValue(Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" }));
    impl.fail = { planned: "ER_NO_SUCH_TABLE" };
    const r = ok(await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 2 }, ALL, NOW));
    expect(r.partial).toBe(false);
    expect(r.days).toHaveLength(2);
    expect(r.days[0].streams).toEqual([]);
  });

  it("caches 60 s per scope and never caches a partial result", async () => {
    const q = { requisitionId: "r1", from: "2026-10-15", days: 1 };
    ok(await getDrivePlan(q, ALL, NOW));
    const n = execute.mock.calls.length;
    ok(await getDrivePlan(q, ALL, NOW));
    expect(execute.mock.calls.length).toBe(n + 1); // only the header (scope check) is read again
    ok(await getDrivePlan(q, PUNE, NOW));
    expect(execute.mock.calls.length).toBeGreaterThan(n + 2); // another scope key reads again
    clearDrivePlanCache();
    impl.fail = { drives: "ER_X" };
    ok(await getDrivePlan(q, ALL, NOW));
    impl.fail = {};
    const m = execute.mock.calls.length;
    ok(await getDrivePlan(q, ALL, NOW));
    expect(execute.mock.calls.length).toBeGreaterThan(m + 1);
  });

  it("carries the pool down across days so it is not counted twice", async () => {
    loadActiveStreams.mockResolvedValue([stream("s1", { openDays: 3 })]);
    impl.pool = [{ n: 100 }];
    const r = ok(await getDrivePlan({ requisitionId: "r1", from: "2026-10-15", days: 2 }, ALL, NOW));
    expect(r.days[0].streams[0].recommended).toBe(100);
    expect(r.days[1].streams[0].recommended).toBe(0);
  });
});

describe("poolRemaining", () => {
  beforeEach(() => { execute.mockReset(); execute.mockResolvedValue([[{ n: 7 }]]); });
  it("is null without a query for the whole Hiring Engine pool", async () => {
    expect(await poolRemaining(stream("h", { sourceType: "he" }))).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
  it("counts qualified form fills of the campaign with no match for the requisition", async () => {
    expect(await poolRemaining(stream("c", { originId: "camp1" }))).toBe(7);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("lc.campaign_id IN (?)");
    expect(sql).toContain("m.requisition_id = ?");
    expect(sql).toContain("COLLATE utf8mb4_unicode_ci");
    expect(params).toEqual(["camp1", "r1"]);
  });
  it("reads a meta_old launch's campaign or batch audience, and is null for any other kind", async () => {
    execute.mockResolvedValueOnce([[{ source_kind: "batch", source_ids: JSON.stringify(["b1", "b2"]) }]]).mockResolvedValueOnce([[{ n: 3 }]]);
    expect(await poolRemaining(stream("o", { sourceType: "meta_old", originId: "d7" }))).toBe(3);
    expect(String(execute.mock.calls[1][0])).toContain("lb.batch_id IN (?,?)");
    expect(execute.mock.calls[1][1]).toEqual(["b1", "b2", "r1"]);
    execute.mockReset();
    execute.mockResolvedValueOnce([[{ source_kind: "meta", source_ids: null }]]);
    expect(await poolRemaining(stream("o", { sourceType: "meta_old", originId: "d8" }))).toBeNull();
    execute.mockReset();
    execute.mockResolvedValueOnce([[]]);
    expect(await poolRemaining(stream("o", { sourceType: "meta_old", originId: "gone" }))).toBeNull();
  });
});
