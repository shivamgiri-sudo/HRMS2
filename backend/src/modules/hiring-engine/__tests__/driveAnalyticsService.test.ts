import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
const loadActiveStreams = vi.hoisted(() => vi.fn());
const getSources = vi.hoisted(() => vi.fn());
const mode = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: logError } }));
vi.mock("../requisition-stream.service.js", async (orig) => ({ ...(await orig<typeof import("../requisition-stream.service.js")>()), loadActiveStreams }));
vi.mock("../he-sources-window.service.js", () => ({ getSourcesForRequisitions: getSources }));
vi.mock("../qualified-followup.schedule.js", () => ({ followupMode: mode }));
// insight facts and thresholds have their own tests (driveInsightFacts.test.ts); here they must not add reads
vi.mock("../he-drive-insight-facts.service.js", () => ({ collectInsightFacts: async () => ({ facts: { today: "2026-10-14", windowDays: 14 }, failedSections: [] }) }));
vi.mock("../he-insight-params.service.js", async () => ({ loadInsightThresholds: async () => ({ ...(await import("../he-drive-insights.js")).INSIGHT_DEFAULTS }) }));

import { clearDriveAnalyticsCache, getDriveAnalytics, resolveWindow, type DriveAnalytics } from "../he-drive-analytics.service.js";
import { getDriveTrend } from "../he-drive-trend.service.js";

const NOW = new Date("2026-10-14T06:00:00Z");
const Q = { from: "2026-10-01", to: "2026-10-14" };
const ALL = { all: true } as never;
const PUNE = { all: false, branchName: "Pune" } as never;
const NOIDA = { all: false, branchName: "Noida" } as never;
const zeros = { qualified: 0, emailed: 0, whatsapped: 0, replied: 0, called: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 };
const srcRow = (sourceType: string, leads: number, extra: object = {}) => ({ sourceType, originId: `o-${sourceType}`, originLabel: sourceType, streamId: null, streamStatus: null, ...zeros, leads, shareOfLeads: 0, shareOfJoined: 0, leadToJoinRate: 0, ...extra });
const head = (id: string, branch = "Pune", day = "2026-10-12") => ({ id, requisition_code: `REQ-${id}`, designation_name: "Agent", branch_name: branch, last_drive: day });
const driveRow = (rid: string, o: Record<string, unknown> = {}) => ({ requisition_id: rid, requisition_code: `REQ-${rid}`, designation_name: "Agent", branch_name: "Pune", id: `d-${rid}`, drive_date: "2026-10-12", status: "active", target_shows: 10, stream_id: null, source_type: null, lined: 20, invited: 15, confirmed: 10, arrived: 6, no_show: 2, declined: 1, ...o });

type Impl = { discovery?: unknown[]; header?: unknown[]; drives?: unknown[]; outcomes?: unknown[]; fail?: Record<string, string>; sources?: unknown; branchKnown?: boolean };
let impl: Impl;
const kindOf = (q: string): string =>
  q.includes("FROM job_requisition WHERE id") ? "header" : q.includes("FROM he_drive d WHERE d.drive_date BETWEEN") ? "discovery" : q.includes("LEFT JOIN he_drive d ON") ? "drives"
    : q.includes("AS slot_released") ? "outcomes" : q.includes("FROM qualified_followup qf") ? "stops" : q.includes("JOIN he_message hm") ? "replies" : q.includes("JOIN he_lead_event ev") ? "arrivals" : "other";
const sqlOf = () => execute.mock.calls.map((c) => [String(c[0]), (c[1] ?? []) as unknown[]] as const);
const callsOf = (k: string) => sqlOf().filter(([q]) => kindOf(q) === k);
const noBad = (v: unknown) => { const j = JSON.stringify(v); expect(j).not.toContain("NaN"); expect(j).not.toContain("Infinity"); expect(j).not.toMatch(/\d{10}/); };
const ok = (r: unknown): DriveAnalytics => { expect(r).not.toBeNull(); expect(r).not.toHaveProperty("error"); return r as DriveAnalytics; };

beforeEach(() => {
  vi.clearAllMocks();
  clearDriveAnalyticsCache();
  impl = {};
  mode.mockReturnValue("live");
  loadActiveStreams.mockResolvedValue([]);
  getSources.mockImplementation(async (ids: string[]) => impl.sources ?? { byRequisition: ids.map((requisitionId) => ({ requisitionId, rows: [] })), partial: false, failedSections: [] });
  execute.mockImplementation(async (sql: string) => {
    const k = kindOf(String(sql));
    const code = impl.fail?.[k];
    if (code) throw Object.assign(new Error("SELECT boom WHERE mobile = 9876543210"), { code });
    if (String(sql).includes("FROM job_requisition WHERE branch_name")) return [impl.branchKnown === false ? [] : [{ 1: 1 }]];
    if (k === "header") return [impl.header ?? []];
    if (k === "discovery") return [impl.discovery ?? []];
    if (k === "drives") return [impl.drives ?? []];
    if (k === "outcomes") return [impl.outcomes ?? []];
    return [[]];
  });
});

describe("resolveWindow", () => {
  it("defaults to today-13..today IST", () => {
    expect(resolveWindow({}, new Date("2026-10-07T20:00:00Z"))).toEqual({ from: "2026-09-25", to: "2026-10-08", days: 14 });
  });
  it("accepts 92 days ending at today + 14", () => {
    expect(resolveWindow({ from: "2026-07-25", to: "2026-10-24" }, NOW)).toMatchObject({ days: 92 });
  });
  it.each([
    [{ from: "2026-07-24", to: "2026-10-24" }], [{ from: "2026-10-01", to: "2026-10-29" }], [{ from: "2026-10-10", to: "2026-10-09" }], [{ from: "garbage", to: "2026-10-09" }],
    [{ from: "2026-02-30", to: "2026-10-09" }], [{ from: "2026-10-01", to: "" }],
  ])("rejects %j", (q) => expect(resolveWindow(q, NOW)).toHaveProperty("error"));
});

describe("getDriveAnalytics", () => {
  it("returns three typed funnels for a requisition fed by all three types", async () => {
    impl.discovery = [head("r1")];
    impl.drives = [
      driveRow("r1"), driveRow("r1", { stream_id: "s1", source_type: "meta_live", lined: 8, invited: 6, confirmed: 4, arrived: 2 }),
      driveRow("r1", { stream_id: "s2", source_type: "meta_old", lined: 5, invited: 4, confirmed: 3, arrived: 1 }),
    ];
    impl.sources = {
      byRequisition: [{ requisitionId: "r1", rows: [srcRow("meta_live", 60, { qualified: 40, joined: 3 }), srcRow("meta_old", 30), srcRow("he", 20)] }], partial: false, failedSections: [],
    };
    const r = ok(await getDriveAnalytics(Q, ALL, NOW));
    expect(r.types.meta_live.stages).toMatchObject({ leads: 60, qualified: 40, invited: 6, confirmed: 4, arrived: 2, joined: 3 });
    expect(r.types.he.stages).toMatchObject({ leads: 20, invited: 15, confirmed: 10, arrived: 6 });
    expect(r.types.he).toMatchObject({ noShow: 2, declined: 1 });
    expect(r.typesPresent).toEqual(["meta_live", "meta_old", "he"]);
    expect(r.window).toEqual({ from: "2026-10-01", to: "2026-10-14", days: 14 });
    expect(r.previousWindow).toEqual({ from: "2026-09-17", to: "2026-09-30" });
    expect(r.cost).toEqual({ available: false, note: "Cost per source arrives with Plan 5" });
    expect(r.insights).toEqual([]);
    expect(r.groups.length).toBeGreaterThanOrEqual(1);
    expect(r.qualifiedTracked).toBe(true);
    expect(r.requisitionCount).toBe(1);
    expect(r.types.he.sparkline).toHaveLength(r.daily.length);
    expect(r.scatter.length).toBeGreaterThan(0);
    expect(r.partial).toBe(false);
    noBad(r);
  });

  it("is all zeros and not partial when every read returns nothing", async () => {
    const r = ok(await getDriveAnalytics(Q, ALL, NOW));
    expect(Object.keys(r.types)).toEqual(["meta_live", "meta_old", "he"]);
    for (const t of Object.values(r.types)) { expect(Object.values(t.stages).every((v) => v === 0)).toBe(true); expect(t.conversions).toHaveLength(6); }
    expect(r.typesPresent).toEqual([]);
    expect(r.daily.length).toBeGreaterThan(0);
    expect(r.daily.every((d) => d.target === 0)).toBe(true);
    expect(r.partial).toBe(false);
    expect(r.failedSections).toEqual([]);
    expect(r.requisitionCount).toBe(0);
    expect(execute).toHaveBeenCalledTimes(1); // only discovery: nothing to read for no requisitions
    noBad(r);
    for (const c of r.types.he.conversions) expect(c.rate === null || Number.isFinite(c.rate)).toBe(true);
  });

  it("flags qualifiedTracked false while follow-up mode is off", async () => {
    mode.mockReturnValue("off");
    const r = ok(await getDriveAnalytics(Q, ALL, NOW));
    expect(r).toMatchObject({ followupMode: "off", qualifiedTracked: false });
  });

  it("binds IST day bounds: replies as datetimes, drives as dates", async () => {
    impl.discovery = [head("r1")];
    await getDriveAnalytics(Q, ALL, NOW);
    const reply = callsOf("replies")[0];
    expect(reply[1]).toContain("2026-10-01 00:00:00");
    expect(reply[1]).toContain("2026-10-15 00:00:00");
    expect(reply[0]).toContain("WEEKDAY(hm.created_at)");
    const drives = callsOf("drives")[0][1];
    expect(drives).toContain("2026-10-01");
    expect(drives).toContain("2026-10-14");
    expect(callsOf("arrivals")[0][1]).toEqual(["r1", "2026-10-01", "2026-10-14"]);
    expect(callsOf("stops")[0][1]).toEqual(["r1", "2026-10-01 00:00:00", "2026-10-15 00:00:00"]);
    expect(callsOf("outcomes")).toHaveLength(2); // window and previous window
  });

  it("caps at 200 requisitions, flags truncated and reads them in one batched statement", async () => {
    impl.discovery = Array.from({ length: 201 }, (_, i) => head(`r${i}`));
    const r = ok(await getDriveAnalytics(Q, ALL, NOW));
    expect(r).toMatchObject({ requisitionCount: 200, truncated: true });
    const drives = callsOf("drives");
    expect(drives.filter(([, p]) => p[0] === "2026-10-01")).toHaveLength(1);
    expect(drives[0][1]).toHaveLength(2 + 200);
    expect(getSources.mock.calls[0][0]).toHaveLength(200);
    expect(callsOf("discovery")[0][0]).toContain("LIMIT 201");
  });

  it("reads 200 or fewer without truncation", async () => {
    impl.discovery = Array.from({ length: 200 }, (_, i) => head(`r${i}`));
    expect(ok(await getDriveAnalytics(Q, ALL, NOW))).toMatchObject({ requisitionCount: 200, truncated: false });
  });

  describe("scope", () => {
    it("returns null for a branch outside the scope without reading anything", async () => {
      expect(await getDriveAnalytics({ ...Q, branch: "Noida" }, PUNE, NOW)).toBeNull();
      expect(execute).not.toHaveBeenCalled();
    });
    it("returns null for a branch user without a resolved branch", async () => {
      expect(await getDriveAnalytics(Q, { all: false, branchName: null } as never, NOW)).toBeNull();
      expect(execute).not.toHaveBeenCalled();
    });
    it("returns null for a requisition of another branch and for an unknown one (same answer)", async () => {
      impl.header = [{ branch_name: "Noida" }];
      expect(await getDriveAnalytics({ ...Q, requisitionId: "r-noida" }, PUNE, NOW)).toBeNull();
      impl.header = [];
      expect(await getDriveAnalytics({ ...Q, requisitionId: "nope" }, ALL, NOW)).toBeNull();
      expect(callsOf("discovery")).toHaveLength(0);
    });
    it("restricts discovery to the scope's branch under an explicit collation", async () => {
      await getDriveAnalytics(Q, PUNE, NOW);
      const [sql, params] = callsOf("discovery")[0];
      expect(params).toContain("Pune");
      expect(sql).toContain("jr.branch_name COLLATE utf8mb4_unicode_ci = ?");
    });
    it("lets an org-wide caller filter by branch and requisition", async () => {
      impl.header = [{ branch_name: "Noida" }];
      await getDriveAnalytics({ ...Q, branch: "Noida", requisitionId: "r9" }, ALL, NOW);
      const [sql, params] = callsOf("discovery")[0];
      expect(sql).toContain("jr.id = ? COLLATE utf8mb4_unicode_ci");
      expect(params).toEqual(["2026-10-01", "2026-10-14", "r9", "Noida", "r9"]);
    });
    it("rejects a requisition that is not in the requested branch", async () => {
      impl.header = [{ branch_name: "Noida" }];
      expect(await getDriveAnalytics({ ...Q, branch: "Pune", requisitionId: "r9" }, ALL, NOW)).toBeNull();
    });
  });

  describe("validation happens before any read", () => {
    it.each([
      [{ from: "not-a-date", to: "2026-10-14" }], [{ from: "2026-10-01", to: "2026-13-45" }], [{ from: "2026-10-10", to: "2026-10-01" }],
      [{ from: "2026-01-01", to: "2026-10-14" }], [{ from: "2026-10-01", to: "2026-11-30" }], [{ from: "2026-10-01", to: "" }], [{ from: 20261001 as never, to: "2026-10-14" }],
    ])("returns an error object for %j and does not touch the database", async (q) => {
      const r = await getDriveAnalytics(q, ALL, NOW);
      expect(r).toEqual({ error: expect.any(String) });
      expect(execute).not.toHaveBeenCalled();
      expect(getSources).not.toHaveBeenCalled();
    });
    it("rejects an over-long filter value", async () => {
      expect(await getDriveAnalytics({ ...Q, branch: "x".repeat(300) }, ALL, NOW)).toHaveProperty("error");
    });
    it("defaults the window when none is given", async () => {
      expect(ok(await getDriveAnalytics({}, ALL, NOW)).window).toEqual({ from: "2026-10-01", to: "2026-10-14", days: 14 });
    });
  });

  describe("partial results and the cache", () => {
    it("flags a rejecting outcomes read, keeps other numbers and does not cache it", async () => {
      impl.discovery = [head("r1")];
      impl.drives = [driveRow("r1")];
      impl.fail = { outcomes: "ER_BAD_FIELD_ERROR" };
      const r = ok(await getDriveAnalytics(Q, ALL, NOW));
      expect(r).toMatchObject({ partial: true, failedSections: ["outcomes", "previous"] }); // the previous period reads outcomes too
      expect(r.types.he.stages.invited).toBe(15);
      for (const c of logError.mock.calls) expect(JSON.stringify(c)).not.toMatch(/boom|9876543210|message/);
      expect(logError).toHaveBeenCalledWith({ section: "outcomes", code: "ER_BAD_FIELD_ERROR" }, expect.any(String));
      const before = execute.mock.calls.length;
      impl.fail = {};
      const again = ok(await getDriveAnalytics(Q, ALL, NOW));
      expect(execute.mock.calls.length).toBeGreaterThan(before);
      expect(again.partial).toBe(false);
    });
    it("flags a partial sources slice", async () => {
      impl.discovery = [head("r1")];
      impl.sources = { byRequisition: [{ requisitionId: "r1", rows: [] }], partial: true, failedSections: ["stages"] };
      expect(ok(await getDriveAnalytics(Q, ALL, NOW))).toMatchObject({ partial: true, failedSections: ["sources", "previous"] });
    });
    it("flags a failing discovery and answers with empty numbers", async () => {
      impl.fail = { discovery: "ER_LOCK_DEADLOCK" };
      expect(ok(await getDriveAnalytics(Q, ALL, NOW))).toMatchObject({ partial: true, failedSections: ["requisitions"], requisitionCount: 0 });
    });
    it("serves a clean second call from the cache and re-queries for another scope or filter", async () => {
      impl.discovery = [head("r1")];
      const a = await getDriveAnalytics(Q, ALL, NOW);
      const n = execute.mock.calls.length;
      const again = await getDriveAnalytics(Q, ALL, NOW);
      expect(again).toEqual(a); // served from the cache as a copy, so a caller cannot edit the cached object
      expect(again).not.toBe(a);
      expect(execute.mock.calls.length).toBe(n);
      await getDriveAnalytics(Q, PUNE, NOW);
      expect(execute.mock.calls.length).toBeGreaterThan(n);
      const m = execute.mock.calls.length;
      await getDriveAnalytics({ ...Q, branch: "Pune" }, ALL, NOW);
      expect(execute.mock.calls.length).toBeGreaterThan(m);
    });
    it("never hands one branch's cached data to another branch scope", async () => {
      impl.discovery = [head("r1")];
      await getDriveAnalytics(Q, PUNE, NOW);
      const n = execute.mock.calls.length;
      await getDriveAnalytics(Q, NOIDA, NOW);
      expect(execute.mock.calls.length).toBeGreaterThan(n);
      expect(callsOf("discovery").map(([, p]) => p.at(-1))).toEqual(["Pune", "Noida"]);
    });
    it("expires entries after 60 seconds", async () => {
      const spy = vi.spyOn(Date, "now");
      spy.mockReturnValue(1_000_000);
      await getDriveAnalytics(Q, ALL, NOW);
      const n = execute.mock.calls.length;
      spy.mockReturnValue(1_059_000);
      await getDriveAnalytics(Q, ALL, NOW);
      expect(execute.mock.calls.length).toBe(n);
      spy.mockReturnValue(1_061_000);
      await getDriveAnalytics(Q, ALL, NOW);
      expect(execute.mock.calls.length).toBeGreaterThan(n);
      spy.mockRestore();
    });
    it("keeps at most 100 entries, evicting the oldest", async () => {
      const reads = () => execute.mock.calls.filter((c) => !String(c[0]).includes("FROM job_requisition WHERE branch_name")).length; // the branch probe runs before the cache
      for (let i = 0; i < 101; i++) await getDriveAnalytics({ ...Q, branch: `B${i}` }, ALL, NOW);
      const n = reads();
      await getDriveAnalytics({ ...Q, branch: "B100" }, ALL, NOW);
      expect(reads()).toBe(n);
      await getDriveAnalytics({ ...Q, branch: "B0" }, ALL, NOW);
      expect(reads()).toBeGreaterThan(n);
    });
  });

  it("treats ER_NO_SUCH_TABLE on the stops read as no rows, not a failed section", async () => {
    impl.discovery = [head("r1")];
    impl.fail = { stops: "ER_NO_SUCH_TABLE" };
    expect(ok(await getDriveAnalytics(Q, ALL, NOW))).toMatchObject({ partial: false, failedSections: [] });
  });

  it("counts opt-out stops into the waterfall and reads reply and arrival grids by IST weekday and hour", async () => {
    impl.sources = { byRequisition: [{ requisitionId: "r1", rows: [srcRow("he", 30, { qualified: 30 })] }], partial: false, failedSections: [] };
    execute.mockImplementation(async (sql: string) => {
      const k = kindOf(String(sql));
      if (k === "discovery") return [[head("r1")]];
      if (k === "drives") return [[driveRow("r1")]];
      if (k === "stops") return [[{ source_type: "he", stopped_reason: "opted_out", n: 4 }]];
      if (k === "replies") return [[{ source_type: "he", wd: 6, hr: 23, n: 5 }, { source_type: "he", wd: 9, hr: 1, n: 5 }]];
      if (k === "arrivals") return [[{ source_type: "he", wd: 0, hr: 10, n: 2 }]];
      return [[]];
    });
    const r = ok(await getDriveAnalytics(Q, ALL, NOW));
    expect(r.timing.replies.he[6][23]).toBe(5);
    expect(r.timing.arrivals.he[0][10]).toBe(2);
    expect(r.timing.arrivalsWithoutTime).toBe(4); // 6 arrived, 2 with an event time
    expect(r.waterfall.he.find((s) => s.to === "invited")!.reasons).toContainEqual({ reason: "opted_out", n: 4 });
  });

  it("uses open stream windows for the drive read and groups, only for discovered requisitions", async () => {
    impl.discovery = [head("r1")];
    loadActiveStreams.mockResolvedValue([
      { id: "s1", requisitionId: "r1", branchName: "Pune", sourceType: "meta_old", originId: "o", originLabel: "L", openFrom: "2026-10-12", openDays: 10, dailyInvites: null, status: "open", closedReason: null, createdBy: null, createdAt: "x", add: [], skip: [], version: 1 },
      { id: "s2", requisitionId: "other", branchName: "Pune", sourceType: "meta_old", originId: "o", originLabel: "L", openFrom: "2026-12-01", openDays: 10, dailyInvites: null, status: "open", closedReason: null, createdBy: null, createdAt: "x", add: [], skip: [], version: 1 },
    ]);
    const r = ok(await getDriveAnalytics(Q, ALL, NOW));
    const drive = callsOf("drives")[0][1];
    expect(drive.slice(0, 2)).toEqual(["2026-10-01", "2026-10-22"]); // 10 planned days from 12 Oct, Sunday skipped
    expect(callsOf("discovery")[0][1]).toContain("s1");
    expect(callsOf("discovery")[0][1]).not.toContain("s2");
    expect(r.groups.map((g) => g.sourceType)).toContain("meta_old");
  });

  it("never selects from the candidate tables directly: they only appear after JOIN", async () => {
    impl.discovery = [head("r1")];
    await getDriveAnalytics(Q, ALL, NOW);
    expect(execute.mock.calls.length).toBeGreaterThan(5);
    for (const [q] of sqlOf()) for (const t of ["he_lead", "he_message", "he_lead_event", "meta_lead_raw"]) expect(q).not.toContain(`FROM ${t} `);
  });
});

describe("existing reads are untouched", () => {
  it("getDriveTrend still answers null for an unknown requisition", async () => {
    execute.mockResolvedValue([[]]);
    expect(await getDriveTrend({ requisitionId: "x" }, ALL, NOW)).toBeNull();
  });
});
