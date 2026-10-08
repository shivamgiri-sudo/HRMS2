import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamRow } from "../requisition-stream.service.js";

/** Calibrated show-up rate in the live planner (HE_SHOWRATE_CALIBRATION): the sample read, the stream pass and the legacy plan. */
const PLAN = { walkInsPerDay: 100, minOutreachPerDay: 0, showRatePct: 25, slotStart: "10:00", slotEnd: "17:30", slotMinutes: 30 };
const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  rateRows: [] as Array<Record<string, unknown>>,
  rateError: null as null | { code: string; message?: string },
  streams: [] as StreamRow[],
  existing: null as null | Record<string, unknown>,
  createDrive: vi.fn(async (i: { requisitionId: string; driveDate: string }) => ({ id: `d-${i.requisitionId}-${i.driveDate}`, invites: 1, targetShows: 1, capacity: 1 })),
  warn: vi.fn(), error: vi.fn(),
}));

const stream = (id: string, sourceType: StreamRow["sourceType"], originId: string, dailyInvites: number | null): StreamRow => ({
  id, requisitionId: "r1", branchName: "Noida", sourceType, originId, originLabel: "", openFrom: "2026-10-12", openDays: 10, dailyInvites,
  status: "open", closedReason: null, createdBy: null, createdAt: "2026-10-10 10:00:00", add: [], skip: [], version: 1,
});

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.calls.push([q, params]);
      if (q.includes("WEEKDAY(")) { if (h.rateError) throw Object.assign(new Error(h.rateError.message ?? "boom"), h.rateError); return [h.rateRows]; }
      if (q.includes("FROM job_requisition WHERE id = ?")) return [[{ id: "r1", requisition_code: "REQ-1", designation_name: "Agent", branch_name: "Noida", approval_status: "approved", active_status: 1, requested_headcount: 10, fulfilled_headcount: 2 }]];
      if (q.includes("FROM he_drive WHERE requisition_id = ? AND branch_name = ? AND drive_date = ?")) return [h.existing ? [h.existing] : []];
      if (q.startsWith("SELECT status, run_label")) return [[{ status: "draft", run_label: "Streams", source_kind: "pool", created_by: null }]];
      if (q.includes("COUNT(*) AS n")) return [[{ n: 0 }]];
      if (q.startsWith("INSERT") || q.startsWith("UPDATE")) return [{ affectedRows: 1 }];
      return [[]];
    }),
    getConnection: vi.fn(async () => ({
      execute: vi.fn(async (sql: string) => (sql.includes("GET_LOCK") ? [[{ got: 1 }]] : [[{ released: 1 }]])),
      release: vi.fn(), destroy: vi.fn(),
    })),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: h.warn, info: vi.fn(), error: h.error } }));
vi.mock("../qualified-followup.service.js", () => ({ enqueueMatchedFollowups: vi.fn() }));
vi.mock("../requisition-stream.service.js", async (orig) => ({
  ...(await orig<typeof import("../requisition-stream.service.js")>()),
  loadActiveStreams: vi.fn(async () => h.streams.map((s) => ({ ...s }))),
  autoCloseStreams: vi.fn(async () => []),
}));
vi.mock("../he-drive.service.js", () => ({
  createDrive: h.createDrive, setDriveStatus: vi.fn(async () => undefined), suggestMatches: vi.fn(async () => 5),
  lineUpCandidates: vi.fn(async () => ({ suggested: 0, blockedByReason: {}, considered: 0, leadIds: [] })),
}));
vi.mock("../he-meta-bridge.service.js", () => ({
  bridgeMetaLeads: vi.fn(async () => ({ poolRows: 0, linked: 0 })), sweepOwnedCampaigns: vi.fn(async () => ({ poolRows: 0, linked: 0 })),
  bridgeAllMetaLeads: vi.fn(async () => ({ poolRows: 0, linked: 0 })),
}));
vi.mock("../he-policy.service.js", () => ({
  getDailyPlan: vi.fn(async () => ({ walkInsPerDay: 100, minOutreachPerDay: 0, showRatePct: 25, slotStart: "10:00", slotEnd: "17:30", slotMinutes: 30 })),
  getPlanMetaOnly: vi.fn(async () => false), getPlanRequisitions: vi.fn(async () => ["r1"]),
}));

import { clearRateBookCache, loadRateBook, rateForStream, type RateBook } from "../he-showrate-calibration.service.js";
import { calibratedPlanNumbers } from "../he-showrate-calibration.js";
import { RATE_ARRIVED_SQL, RATE_INVITED_SQL } from "../he-rate-buckets.js";
import { planStreamsForDay } from "../he-stream-plan.service.js";
import { planNextDay } from "../he-plan.service.js";

const rateStatements = () => h.calls.filter(([q]) => q.includes("WEEKDAY("));
const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);

beforeEach(() => {
  delete process.env.HE_SHOWRATE_CALIBRATION;
  h.calls.length = 0;
  h.rateRows = [];
  h.rateError = null;
  h.streams = [];
  h.existing = null;
  clearRateBookCache();
  h.createDrive.mockClear(); h.warn.mockClear(); h.error.mockClear();
});
afterEach(() => { delete process.env.HE_SHOWRATE_CALIBRATION; });

describe("loadRateBook", () => {
  it("one statement per 200 ids, none for no ids", async () => {
    await loadRateBook({ requisitionIds: ids(450), today: "2026-10-14", trailingDays: 14, heStreamOf: new Map() });
    expect(rateStatements()).toHaveLength(3);
    expect(rateStatements().map(([, p]) => p.length)).toEqual([202, 202, 52]);
    h.calls.length = 0;
    const empty = await loadRateBook({ requisitionIds: [], today: "2026-10-14", trailingDays: 14, heStreamOf: new Map() });
    expect(h.calls).toHaveLength(0);
    expect(empty?.byStream.size).toBe(0);
  });

  it("reads the 14 days ending yesterday, keyed by requisition through he_drive", async () => {
    await loadRateBook({ requisitionIds: ["r1"], today: "2026-10-14", trailingDays: 14, heStreamOf: new Map() });
    const [[sql, params]] = rateStatements();
    expect(params).toEqual(["r1", "2026-09-30", "2026-10-13"]);
    expect(sql).toMatch(/FROM he_drive d JOIN he_match m ON m.drive_id = d.id/);
    expect(sql).toContain("WHERE d.requisition_id IN (?) AND d.drive_date BETWEEN ? AND ?");
    expect(sql).not.toMatch(/he_lead|he_message/);
    // an unplanned walk-in (arrived / selected with no slot ever booked) is not a sample of the invite-to-show rate
    expect(sql).toContain(`${RATE_INVITED_SQL}, ${RATE_ARRIVED_SQL}`);
  });

  it("an uncredited row counts for the Hiring Engine stream and every row for the requisition", async () => {
    h.rateRows = [
      { requisition_id: "r1", stream_id: null, wd: 2, invited: 10, arrived: 4 },
      { requisition_id: "r1", stream_id: "s-meta", wd: 2, invited: 20, arrived: 5 },
      { requisition_id: "r2", stream_id: null, wd: 3, invited: 7, arrived: 1 },
    ];
    const b = await loadRateBook({ requisitionIds: ["r1", "r2"], today: "2026-10-14", trailingDays: 14, heStreamOf: new Map([["r1", "s-he"]]) }) as RateBook;
    expect(b.byStream.get("s-he")?.overall).toEqual({ invited: 10, arrived: 4 });
    expect(b.byStream.get("s-meta")?.byWeekday.get(2)).toEqual({ invited: 20, arrived: 5 });
    expect(b.byStream.size).toBe(2); // r2 has no Hiring Engine stream: its uncredited row counts for the requisition only
    expect(b.byRequisition.get("r1")?.overall).toEqual({ invited: 30, arrived: 9 });
    expect(b.byRequisition.get("r2")?.byWeekday.get(3)).toEqual({ invited: 7, arrived: 1 });
  });

  it("retries without the stream joins when the stream tables do not exist", async () => {
    let first = true;
    const { db } = await import("../../../db/mysql.js");
    vi.mocked(db.execute).mockImplementationOnce((async (sql: string, params: unknown[]) => {
      h.calls.push([sql.replace(/\s+/g, " ").trim(), params]);
      if (first) { first = false; throw Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" }); }
      return [[]];
    }) as never);
    const b = await loadRateBook({ requisitionIds: ["r1"], today: "2026-10-14", trailingDays: 14, heStreamOf: new Map() });
    expect(b).not.toBeNull();
    expect(rateStatements()).toHaveLength(2);
    expect(rateStatements()[1][0]).not.toContain("requisition_stream");
  });

  it("a failed read gives null and logs the code only", async () => {
    h.rateError = { code: "ER_BAD_FIELD_ERROR", message: "Unknown column 9876543210" };
    const b = await loadRateBook({ requisitionIds: ["r1"], today: "2026-10-14", trailingDays: 14, heStreamOf: new Map() });
    expect(b).toBeNull();
    expect(h.warn).toHaveBeenCalledTimes(1);
    const [obj] = h.warn.mock.calls[0];
    expect(obj).toEqual({ code: "ER_BAD_FIELD_ERROR" });
    expect(JSON.stringify(h.warn.mock.calls)).not.toMatch(/message|9876543210/);
  });
});

describe("rate book cache (10 minutes, keyed by ids, IST day and window)", () => {
  const read = (o: Partial<{ requisitionIds: string[]; today: string; trailingDays: number }> = {}) =>
    loadRateBook({ requisitionIds: ["r2", "r1"], today: "2026-10-14", trailingDays: 14, heStreamOf: new Map(), ...o });

  it("a second read of the same ids (any order) is served from the cache, as a copy", async () => {
    h.rateRows = [{ requisition_id: "r1", stream_id: null, wd: 2, invited: 10, arrived: 4 }];
    const a = await read();
    a!.byRequisition.get("r1")!.overall.invited = 999; // a caller editing its copy
    const b = await read({ requisitionIds: ["r1", "r2"] });
    expect(rateStatements()).toHaveLength(1);
    expect(b!.byRequisition.get("r1")!.overall).toEqual({ invited: 10, arrived: 4 });
  });

  it("the stream mapping is applied per call, not cached", async () => {
    h.rateRows = [{ requisition_id: "r1", stream_id: null, wd: 2, invited: 10, arrived: 4 }];
    await read();
    const b = await loadRateBook({ requisitionIds: ["r1", "r2"], today: "2026-10-14", trailingDays: 14, heStreamOf: new Map([["r1", "s-he"]]) });
    expect(rateStatements()).toHaveLength(1);
    expect(b!.byStream.get("s-he")!.overall).toEqual({ invited: 10, arrived: 4 });
  });

  it("another day, other ids or another window read again", async () => {
    await read();
    await read({ today: "2026-10-15" });
    await read({ requisitionIds: ["r1"] });
    await read({ trailingDays: 7 });
    expect(rateStatements()).toHaveLength(4);
  });

  it("expires after 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
      await read();
      vi.setSystemTime(new Date("2026-10-14T10:09:59Z"));
      await read();
      expect(rateStatements()).toHaveLength(1);
      vi.setSystemTime(new Date("2026-10-14T10:10:01Z"));
      await read();
      expect(rateStatements()).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it("never caches a failed read", async () => {
    h.rateError = { code: "ER_LOCK_WAIT_TIMEOUT" };
    expect(await read()).toBeNull();
    h.rateError = null;
    expect(await read()).not.toBeNull();
    expect(rateStatements()).toHaveLength(2);
  });
});

describe("rateForStream", () => {
  it("uses the same-weekday sample of the target date", () => {
    const book: RateBook = { byStream: new Map([["s1", { byWeekday: new Map([[2, { invited: 30, arrived: 15 }]]), overall: { invited: 60, arrived: 18 } }]]), byRequisition: new Map() };
    expect(rateForStream(book, "s1", "2026-10-14", 0.25, 30)).toMatchObject({ rate: 0.5, basis: "actual_weekday" });
    expect(rateForStream(null, "s1", "2026-10-14", 0.25, 30)).toMatchObject({ rate: 0.25, basis: "plan_default" });
  });

  it("clamps a measured 4% to 5% and a measured 96% to 95%", () => {
    const book = (invited: number, arrived: number): RateBook => ({ byStream: new Map([["s1", { byWeekday: new Map(), overall: { invited, arrived } }]]), byRequisition: new Map() });
    expect(rateForStream(book(100, 4), "s1", "2026-10-14", 0.25, 30)).toMatchObject({ rate: 0.05, basis: "actual", invited: 100, arrived: 4 });
    expect(rateForStream(book(100, 96), "s1", "2026-10-14", 0.25, 30)).toMatchObject({ rate: 0.95, basis: "actual", invited: 100, arrived: 96 });
    expect(rateForStream(book(100, 5), "s1", "2026-10-14", 0.25, 30).rate).toBe(0.05);
    expect(rateForStream(book(100, 95), "s1", "2026-10-14", 0.25, 30).rate).toBe(0.95);
  });
});

describe("planStreamsForDay with HE_SHOWRATE_CALIBRATION=true", () => {
  beforeEach(() => {
    h.streams = [stream("a", "he", "r1", null), stream("b", "meta_live", "c1", 40)];
    // stream a: 20 credited + 20 uncredited (Hiring Engine stream) = {40, 16} over the window, nothing on Thursdays
    h.rateRows = [
      { requisition_id: "r1", stream_id: "a", wd: 0, invited: 20, arrived: 8 },
      { requisition_id: "r1", stream_id: null, wd: 1, invited: 20, arrived: 8 },
    ];
  });

  it("caps the shared stream on its measured rate and keeps the HR quota", async () => {
    process.env.HE_SHOWRATE_CALIBRATION = "true";
    const r = await planStreamsForDay({ date: "2026-10-15", dryRun: false });
    const capA = Math.ceil(calibratedPlanNumbers(PLAN, 0.4).invites / 1);
    expect(capA).toBe(250);
    expect(r.plans[0].streams.map((l) => [l.streamId, l.cap])).toEqual([["a", capA], ["b", 40]]);
    const created = h.createDrive.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(created.showRatePct).toBe(Math.round(((250 * 0.4 + 40 * 0.25) / 290) * 100));
    expect(created.targetShows).toBe(110);
    expect(created.slotCapacity).toBe(27);
    expect(r.plans[0].rates).toEqual([{ streamId: "a", rate: 0.4, basis: "actual" }, { streamId: "b", rate: 0.25, basis: "plan_default" }]);
    expect(rateStatements()).toHaveLength(1);
    expect(rateStatements()[0][1].slice(0, 1)).toEqual(["r1"]);
  });

  it("seats grow with the calibrated caps (rate 10%: caps 800 + 40 at 405 seats), at most 50 a slot", async () => {
    process.env.HE_SHOWRATE_CALIBRATION = "true";
    h.rateRows = [{ requisition_id: "r1", stream_id: "a", wd: 0, invited: 40, arrived: 4 }];
    const r = await planStreamsForDay({ date: "2026-10-15", dryRun: false });
    expect(r.plans[0].streams.map((l) => l.cap)).toEqual([800, 40]);
    const created = h.createDrive.mock.calls[0][0] as unknown as Record<string, number>;
    expect(created.slotCapacity).toBe(Math.min(50, Math.max(27, Math.ceil(840 / 15)))); // 50: the hard limit; the send loop stops at "drive full"
  });

  it("seats cover every invite the caps line up when they fit under 50 a slot", async () => {
    process.env.HE_SHOWRATE_CALIBRATION = "true";
    h.rateRows = [{ requisition_id: "r1", stream_id: "a", wd: 0, invited: 40, arrived: 6 }]; // 15%
    const r = await planStreamsForDay({ date: "2026-10-15", dryRun: false });
    const lined = r.plans[0].streams.reduce((a, l) => a + l.cap, 0);
    expect(lined).toBe(667 + 40);
    const created = h.createDrive.mock.calls[0][0] as unknown as Record<string, number>;
    expect(created.slotCapacity).toBe(48);
    expect(lined).toBeLessThanOrEqual(created.slotCapacity * 15);
  });

  it("never changes an existing drive's seats", async () => {
    process.env.HE_SHOWRATE_CALIBRATION = "true";
    h.existing = { id: "hr-drive", status: "active", run_label: null, source_kind: "pool", created_by: "u1" };
    h.rateRows = [{ requisition_id: "r1", stream_id: "a", wd: 0, invited: 40, arrived: 4 }];
    const r = await planStreamsForDay({ date: "2026-10-15", dryRun: false });
    expect(r.plans[0].drive).toBe("exists");
    expect(h.createDrive).not.toHaveBeenCalled();
    expect(h.calls.some(([q]) => /UPDATE he_drive|slot_capacity/.test(q))).toBe(false);
  });

  it("a failed sample read keeps today's caps and drive numbers", async () => {
    process.env.HE_SHOWRATE_CALIBRATION = "true";
    h.rateError = { code: "ER_LOCK_WAIT_TIMEOUT" };
    const r = await planStreamsForDay({ date: "2026-10-15", dryRun: false });
    expect(r.failed).toBeUndefined();
    expect(r.plans[0].streams.map((l) => [l.streamId, l.cap])).toEqual([["a", 400], ["b", 40]]); // heStreamPassLegacy snapshot
    expect(h.createDrive.mock.calls[0][0]).toMatchObject({ showRatePct: 25, targetShows: 110, slotCapacity: 27 });
    expect(r.plans[0].rates?.every((x) => x.basis === "plan_default" && x.rate === 0.25)).toBe(true);
  });

  it("dry run calibrates the preview without writing", async () => {
    process.env.HE_SHOWRATE_CALIBRATION = "true";
    const r = await planStreamsForDay({ date: "2026-10-15", dryRun: true });
    expect(r.plans[0].streams.map((l) => l.wouldLine)).toEqual([250, 40]);
    expect(h.createDrive).not.toHaveBeenCalled();
  });

  it("switch unset: no sample read and no rates on the plan", async () => {
    for (const v of [undefined, "1", "yes", "false"]) {
      if (v === undefined) delete process.env.HE_SHOWRATE_CALIBRATION; else process.env.HE_SHOWRATE_CALIBRATION = v;
      h.calls.length = 0;
      const r = await planStreamsForDay({ date: "2026-10-15", dryRun: true });
      expect(h.calls.some(([q]) => q.includes("WEEKDAY(") || q.includes("he_model_param"))).toBe(false);
      expect(r.plans[0]).not.toHaveProperty("rates");
      expect(r.plans[0].streams.map((l) => l.cap)).toEqual([400, 40]);
    }
  });
});

describe("planNextDay (legacy requisitions) with HE_SHOWRATE_CALIBRATION=true", () => {
  beforeEach(() => {
    h.rateRows = [{ requisition_id: "r1", stream_id: null, wd: 1, invited: 40, arrived: 16 }];
  });

  it("sizes the drive on the requisition's measured rate", async () => {
    process.env.HE_SHOWRATE_CALIBRATION = "true";
    const r = await planNextDay({ date: "2026-10-15" });
    expect(h.createDrive.mock.calls[0][0]).toMatchObject({ showRatePct: 40, slotCapacity: 17, targetShows: 100 });
    expect(r.days[0]).toMatchObject({ requisitionId: "r1", status: "created", invitesWanted: 250, showRate: { rate: 0.4, basis: "actual" } });
    expect(rateStatements()).toHaveLength(1);
    expect(rateStatements()[0][1][0]).toBe("r1");
    expect(r.invitesPerDay).toBe(400); // the plan's own numbers are reported unchanged
  });

  it("a failed read keeps today's numbers", async () => {
    process.env.HE_SHOWRATE_CALIBRATION = "true";
    h.rateError = { code: "ER_LOCK_WAIT_TIMEOUT" };
    const r = await planNextDay({ date: "2026-10-15" });
    expect(h.createDrive.mock.calls[0][0]).toMatchObject({ showRatePct: 25, slotCapacity: 27, targetShows: 100 });
    expect(r.days[0]).toMatchObject({ invitesWanted: 400, showRate: { rate: 0.25, basis: "plan_default" } });
  });

  it("switch unset: no sample read, no showRate", async () => {
    const r = await planNextDay({ date: "2026-10-15" });
    expect(h.calls.some(([q]) => q.includes("WEEKDAY(") || q.includes("he_model_param"))).toBe(false);
    expect(r.days[0]).not.toHaveProperty("showRate");
    expect(h.createDrive.mock.calls[0][0]).toMatchObject({ showRatePct: 25, slotCapacity: 27, targetShows: 100 });
  });
});
