import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: logError } }));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});
vi.mock("../he-inbox.service.js", () => ({ listInbox: vi.fn(), getInboxThread: vi.fn(), replyToCandidate: vi.fn() }));
// the campaign dashboard's other sections are not under test here
vi.mock("../he-meta-funnel.service.js", () => ({ getMetaFunnel: vi.fn(async () => ({ campaigns: [] })) }));
vi.mock("../he-launch.service.js", () => ({ listBatches: vi.fn(async () => []), listLaunches: vi.fn(async () => []) }));
vi.mock("../he-campaign-config.service.js", () => ({ getCampaignConfig: vi.fn(async () => ({ owner: "meta" })) }));

import {
  buildDriveGroups, clearDriveTrendCache, defaultTrendDates, getDriveGroups, getDriveTrend, showRate, zeroFillPoints, type DriveAggRow,
} from "../he-drive-trend.service.js";
import { clearCampaignDashboardCache, getCampaignDashboard } from "../he-campaign-dashboard.service.js";
import { istToday, addDays } from "../requisition-stream.window.js";
import type { StreamRow } from "../requisition-stream.service.js";
import { heRouter } from "../he.routes.js";
import { UNPLANNED_ARRIVAL } from "../he-rate-buckets.js";

const RID = "0f1e2d3c-aaaa-bbbb-cccc-0000000abcde";
const SID = "1f1e2d3c-aaaa-bbbb-cccc-0000000abcde";
const ALL = { all: true, branchName: null } as never;
const PUNE = { all: false, branchName: "Pune" } as never;
const DELHI = { all: false, branchName: "Delhi" } as never;

const agg = (date: string, o: Partial<DriveAggRow> = {}): DriveAggRow => ({
  driveId: `d-${date}`, date, status: "active", wanted: 10, streamId: null, streamType: null, lined: 0, invited: 0, confirmed: 0, arrived: 0, noShow: 0, declined: 0, ...o,
});
const stream = (o: Partial<StreamRow> = {}): StreamRow => ({
  id: SID, requisitionId: RID, branchName: "Pune", sourceType: "meta_live", originId: "c1", originLabel: "Ad", openFrom: "2026-10-09", openDays: 3,
  dailyInvites: null, status: "open", closedReason: null, createdBy: null, createdAt: "2026-10-01 10:00:00", add: [], skip: [], ...o,
});

describe("unplanned arrivals count as arrivals but not in the show rate", () => {
  it("a point keeps the counts and rates (arrived - unplanned) / (confirmed - unplanned)", () => {
    const [p] = zeroFillPoints(["2026-10-10"], [agg("2026-10-10", { lined: 6, invited: 4, confirmed: 3, arrived: 2, unplanned: 1 })], null);
    expect(p).toMatchObject({ invited: 4, confirmed: 3, arrived: 2, showRate: 0.5 });
    expect(p).not.toHaveProperty("unplanned");
  });
  it("group totals rate the same way, only over the group's type and dates", () => {
    const rows = [agg("2026-10-08", { lined: 5, confirmed: 3, arrived: 2, unplanned: 1 }), agg("2026-10-09", { lined: 7, confirmed: 2, arrived: 1 })];
    const [g] = buildDriveGroups([{ requisitionId: RID, branch: "Pune", requisition: "REQ-7", role: "Agent", streams: [], rows, today: "2026-10-09" }]);
    expect(g.totals).toMatchObject({ confirmed: 5, arrived: 3, showRate: 0.5 });
    expect(g.totals).not.toHaveProperty("unplanned");
  });
  it("the drive read carries the unplanned bucket", async () => {
    execute.mockClear();
    await getDriveTrend({ requisitionId: RID }, ALL, new Date("2026-10-09T06:00:00Z"));
    const read = execute.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " ")).find((q) => q.includes("AS lined"));
    expect(read).toContain(`SUM(${UNPLANNED_ARRIVAL}) AS unplanned`);
  });
});

describe("showRate", () => {
  it("is 0 when nobody confirmed and arrived / confirmed otherwise", () => {
    expect(showRate(0, 0)).toBe(0);
    expect(showRate(3, 0)).toBe(0);
    expect(showRate(2, 4)).toBe(0.5);
  });
});

describe("buildDriveGroups", () => {
  const rows = [agg("2026-10-08", { lined: 5, arrived: 1, confirmed: 3, invited: 4 }), agg("2026-10-09", { lined: 7, arrived: 2, confirmed: 3, invited: 6 })];
  const input = (streams: StreamRow[], r: DriveAggRow[]) => [{ requisitionId: RID, branch: "Pune", requisition: "REQ-7", role: "Agent", streams, rows: r, today: "2026-10-09" }];

  it("groups a requisition with no streams as one he group with summed totals", () => {
    const g = buildDriveGroups(input([], rows));
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ sourceType: "he", types: ["he"], streamIds: [], requisition: "REQ-7", role: "Agent", branch: "Pune" });
    expect(g[0].totals).toMatchObject({ lined: 12, arrived: 3, confirmed: 6, showRate: 0.5, wanted: 20 });
    expect(g[0].window).toMatchObject({ from: "2026-09-26", to: "2026-10-12" });
  });

  it("splits into he and meta_live when an open meta_live stream credits some matches", () => {
    const split = [
      agg("2026-10-08", { lined: 3, arrived: 1, confirmed: 2 }), agg("2026-10-08", { streamId: SID, streamType: "meta_live", lined: 2, confirmed: 1 }),
      agg("2026-10-09", { lined: 5, arrived: 2, confirmed: 3 }), agg("2026-10-09", { streamId: SID, streamType: "meta_live", lined: 2, arrived: 0, confirmed: 0 }),
    ];
    const g = buildDriveGroups(input([stream()], split));
    expect(g.map((x) => x.sourceType)).toEqual(["he", "meta_live"]);
    expect(g.map((x) => x.types)).toEqual([["he", "meta_live"], ["he", "meta_live"]]);
    expect(g[0].totals.lined).toBe(8);
    expect(g[1].totals.lined).toBe(4); // the 8 Oct credit lies before the stream window but still shows
    expect(g[1].streamIds).toEqual([SID]);
    // the meta_live group runs over the stream's own days, one row per planned day
    expect(g[1].days.map((d) => d.date)).toEqual(["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-12"]);
    expect(g[1].window).toMatchObject({ from: "2026-10-08", to: "2026-10-12", dayIndex: 2, days: 4 });
  });

  it("gives one group for a closed stream", () => {
    const g = buildDriveGroups(input([stream({ status: "closed" })], rows));
    expect(g.map((x) => x.sourceType)).toEqual(["he"]);
  });

  it("keeps matches credited to a closed stream in a group of their type so the per-type totals add up to the drive totals", () => {
    const split = [
      agg("2026-10-08", { lined: 3, confirmed: 1, arrived: 1, invited: 2 }), agg("2026-10-08", { streamId: SID, streamType: "meta_live", lined: 2, invited: 2, confirmed: 1, arrived: 1 }),
      agg("2026-10-09", { lined: 5, invited: 4 }), agg("2026-10-09", { streamId: SID, streamType: "meta_live", lined: 2, invited: 1 }),
    ];
    for (const status of ["closed", "paused"] as const) {
      const g = buildDriveGroups(input([stream({ status })], split));
      expect(g.map((x) => x.sourceType)).toEqual(["he", "meta_live"]);
      expect(g[1].streamIds).toEqual([]);
      const sum = (k: "lined" | "invited" | "arrived") => g.reduce((a, x) => a + x.totals[k], 0);
      expect([sum("lined"), sum("invited"), sum("arrived")]).toEqual([12, 9, 2]);
    }
  });

  it("makes a meta_live group even when the requisition has no drive yet", () => {
    const g = buildDriveGroups(input([stream()], []));
    expect(g.map((x) => x.sourceType)).toEqual(["meta_live"]);
    expect(g[0].days.every((d) => d.driveId === "" && d.status === "no_drive" && d.lined === 0)).toBe(true);
  });
});

describe("zeroFillPoints and the window dates", () => {
  it("fills every non-Sunday date and leaves a Sunday out unless a drive sits on it", () => {
    const dates = defaultTrendDates("2026-10-09", "2026-10-13", []);
    expect(dates).toEqual(["2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13"]);
    const pts = zeroFillPoints(dates, [agg("2026-10-10", { lined: 4, invited: 3, confirmed: 2, arrived: 1 })], null);
    expect(pts.map((p) => p.date)).toEqual(dates);
    expect(pts[1]).toMatchObject({ driveId: "d-2026-10-10", status: "active", wanted: 10, lined: 4, confirmed: 2, arrived: 1, showRate: 0.5 });
    for (const i of [0, 2, 3]) expect(pts[i]).toMatchObject({ driveId: null, status: "no_drive", wanted: 0, lined: 0, invited: 0, confirmed: 0, arrived: 0, noShow: 0, declined: 0, showRate: 0 });
    expect(defaultTrendDates("2026-10-09", "2026-10-13", ["2026-10-11"])).toContain("2026-10-11");
  });

  it("only counts matches credited to the chosen type, and uncredited matches count as he", () => {
    const rows = [agg("2026-10-10", { lined: 3 }), agg("2026-10-10", { streamId: SID, streamType: "meta_live", lined: 2, invited: 2, confirmed: 1, arrived: 1 })];
    const all = zeroFillPoints(["2026-10-10"], rows, null)[0];
    expect(all.lined).toBe(5);
    expect(all.wanted).toBe(10);
    expect(all.streams).toEqual([{ streamId: SID, lined: 2, invited: 2, confirmed: 1, arrived: 1 }]);
    const live = zeroFillPoints(["2026-10-10"], rows, "meta_live")[0];
    expect(live).toMatchObject({ lined: 2, arrived: 1, driveId: "d-2026-10-10" });
    const he = zeroFillPoints(["2026-10-10"], rows, "he")[0];
    expect(he).toMatchObject({ lined: 3, streams: [] });
    const old = zeroFillPoints(["2026-10-10"], rows, "meta_old")[0];
    expect(old).toMatchObject({ lined: 0, driveId: "d-2026-10-10", showRate: 0 });
  });
});

let header: Array<Record<string, unknown>>;
let streamRows: Array<Record<string, unknown>>;
let driveRows: Array<Record<string, unknown>>;
let failOn: string | null;

const dbRow = (date: string, o: Record<string, unknown> = {}) => ({
  id: `d-${date}`, drive_date: date, status: "active", target_shows: 10, stream_id: null, source_type: null,
  lined: 0, invited: 0, confirmed: 0, arrived: 0, no_show: 0, declined: 0, ...o,
});
const aggCalls = () => execute.mock.calls.filter((c) => /FROM he_drive d/.test(String(c[0])));

beforeEach(() => {
  vi.clearAllMocks();
  clearDriveTrendCache();
  clearCampaignDashboardCache();
  failOn = null;
  header = [{ branch_name: "Pune" }];
  streamRows = [];
  driveRows = [];
  execute.mockImplementation(async (sql: string, params: unknown[]) => {
    const q = String(sql);
    if (failOn && q.includes(failOn)) { failOn = null; throw Object.assign(new Error("SELECT boom WHERE phone = 9876543210"), { code: "ER_X" }); }
    if (q.includes("FROM job_requisition WHERE id")) return [params[0] === RID ? header : []];
    if (q.includes("FROM requisition_stream WHERE")) return [streamRows];
    if (q.includes("FROM requisition_stream_day")) return [[]];
    if (q.includes("FROM he_drive d")) return [driveRows];
    if (q.includes("FROM employees e")) return [[{ branch_name: "Pune" }]];
    return [[]];
  });
});

describe("getDriveTrend", () => {
  const now = new Date("2026-10-09T10:00:00+05:30");

  it("runs one aggregate SELECT filtered by requisition, branch and the date range, and zero-fills the default window", async () => {
    driveRows = [dbRow("2026-10-08", { lined: 5, confirmed: 3, arrived: 1 }), dbRow("2026-10-09", { lined: 7, confirmed: 3, arrived: 2 })];
    const t = await getDriveTrend({ requisitionId: RID }, ALL, now);
    expect(aggCalls()).toHaveLength(1);
    const [sql, params] = aggCalls()[0] as [string, unknown[]];
    expect(sql).toMatch(/d\.requisition_id = \?/);
    expect(sql).toMatch(/d\.branch_name = \?/);
    expect(sql).toMatch(/GROUP BY d\.id, s\.id/);
    expect(sql).not.toMatch(/he_lead/);
    expect(params).toEqual([RID, "Pune", "2026-09-26", "2026-10-12"]);
    // 2026-09-26 .. 2026-10-12 is 17 days, 3 of them Sundays (27 Sep, 4 Oct, 11 Oct)
    expect(t!.points).toHaveLength(14);
    expect(t!.window).toMatchObject({ from: "2026-09-26", to: "2026-10-12", days: 14, dayIndex: 12 });
    expect(t!).toMatchObject({ requisitionId: RID, branch: "Pune", sourceType: null, partial: false, failedSections: [] });
    expect(t!.points.filter((p) => p.driveId === null)).toHaveLength(12);
    expect(t!.points.find((p) => p.date === "2026-10-09")).toMatchObject({ lined: 7, showRate: 2 / 3 });
  });

  it("keeps a Sunday that holds a drive", async () => {
    driveRows = [dbRow("2026-10-04", { lined: 1 })];
    const t = await getDriveTrend({ requisitionId: RID }, ALL, now);
    expect(t!.points.map((p) => p.date)).toContain("2026-10-04");
    expect(t!.points).toHaveLength(15);
  });

  it("uses the stream window when the chosen type has streams and counts only that type's credited matches", async () => {
    streamRows = [{ id: SID, requisition_id: RID, branch_name: "Pune", source_type: "meta_live", origin_id: "c1", origin_label: "Ad", open_from: "2026-10-09", open_days: 3, daily_invites: null, status: "open", closed_reason: null, created_by: null, created_at: "2026-10-01 10:00:00" }];
    driveRows = [
      dbRow("2026-10-09", { lined: 3 }), dbRow("2026-10-09", { stream_id: SID, source_type: "meta_live", lined: 2, invited: 2, confirmed: 1, arrived: 1 }),
      dbRow("2026-10-10", { stream_id: SID, source_type: "meta_live", lined: 4, invited: 4, confirmed: 2 }),
    ];
    const t = await getDriveTrend({ requisitionId: RID, sourceType: "meta_live" }, ALL, now);
    expect(t!.points.map((p) => p.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-12"]);
    expect(t!.points.map((p) => p.lined)).toEqual([2, 4, 0]);
    expect(t!.points[0].streams).toEqual([{ streamId: SID, lined: 2, invited: 2, confirmed: 1, arrived: 1 }]);
    expect(t!.window).toMatchObject({ from: "2026-10-09", to: "2026-10-12", dayIndex: 1, days: 3 });
    expect(aggCalls()[0][1]).toEqual([RID, "Pune", "2026-10-09", "2026-10-12"]);
  });

  it("falls back to the default window when the chosen type has no stream", async () => {
    const t = await getDriveTrend({ requisitionId: RID, sourceType: "meta_old" }, ALL, now);
    expect(t!.window).toMatchObject({ from: "2026-09-26", to: "2026-10-12" });
  });

  it("answers null outside the caller's branch (also for another branch than the requisition's) and for an unknown requisition", async () => {
    expect(await getDriveTrend({ requisitionId: RID }, DELHI, now)).toBeNull();
    expect(await getDriveTrend({ requisitionId: RID, branch: "Delhi" }, PUNE, now)).toBeNull();
    expect(await getDriveTrend({ requisitionId: "00000000-0000-0000-0000-000000000000" }, ALL, now)).toBeNull();
    expect(aggCalls()).toHaveLength(0);
    expect(await getDriveTrend({ requisitionId: RID }, PUNE, now)).not.toBeNull();
  });

  it("caches 60 seconds per requisition, scope and type, and never serves another scope's data", async () => {
    vi.useFakeTimers({ now });
    try {
      await getDriveTrend({ requisitionId: RID }, PUNE, now);
      await getDriveTrend({ requisitionId: RID }, PUNE, now);
      expect(aggCalls()).toHaveLength(1);
      await getDriveTrend({ requisitionId: RID }, ALL, now);
      await getDriveTrend({ requisitionId: RID, sourceType: "he" }, PUNE, now);
      expect(aggCalls()).toHaveLength(3);
      expect(await getDriveTrend({ requisitionId: RID }, DELHI, now)).toBeNull();
      vi.advanceTimersByTime(61_000);
      await getDriveTrend({ requisitionId: RID }, PUNE, now);
      expect(aggCalls()).toHaveLength(4);
    } finally { vi.useRealTimers(); }
  });

  it("returns a partial zero-filled series with failedSections when the aggregate fails, logs no driver text, and does not cache it", async () => {
    failOn = "FROM he_drive d";
    const t = await getDriveTrend({ requisitionId: RID }, ALL, now);
    expect(t).toMatchObject({ partial: true, failedSections: ["drives"] });
    expect(t!.points).toHaveLength(14);
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/9876543210|SELECT/);
    const again = await getDriveTrend({ requisitionId: RID }, ALL, now);
    expect(again!.partial).toBe(false);
  });

  it("falls back to the default window when the streams read fails", async () => {
    failOn = "FROM requisition_stream WHERE";
    const t = await getDriveTrend({ requisitionId: RID, sourceType: "meta_live" }, ALL, now);
    expect(t).toMatchObject({ partial: true, failedSections: ["streams"] });
    expect(t!.window.from).toBe("2026-09-26");
  });
});

describe("getDriveGroups", () => {
  it("runs one batched aggregate for every requisition, joined to job_requisition with an explicit collation, and groups per requisition", async () => {
    const today = istToday();
    const R2 = "2f1e2d3c-aaaa-bbbb-cccc-0000000abcde";
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("FROM requisition_stream WHERE")) return [[]];
      if (q.includes("SELECT DISTINCT d.requisition_id")) return [[{ requisition_id: RID, branch_name: "Pune" }, { requisition_id: R2, branch_name: "Delhi" }]];
      if (q.includes("FROM job_requisition jr")) return [[
        { requisition_id: RID, branch_name: "Pune", requisition_code: "REQ-7", designation_name: "Agent", ...dbRow(today, { lined: 4, confirmed: 2, arrived: 1 }) },
        { requisition_id: R2, branch_name: "Delhi", requisition_code: "REQ-8", designation_name: "TL", ...dbRow(today, { id: "d-r2", lined: 1 }) },
      ]];
      return [[]];
    });
    const groups = await getDriveGroups();
    const batched = execute.mock.calls.filter((c) => /FROM job_requisition jr/.test(String(c[0])));
    expect(batched).toHaveLength(1);
    expect(String(batched[0][0])).toMatch(/COLLATE utf8mb4_unicode_ci/);
    expect(groups.map((g) => [g.requisition, g.sourceType, g.totals.lined])).toEqual([["REQ-8", "he", 1], ["REQ-7", "he", 4]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    expect(groups.every((g) => g.days.some((d) => d.driveId !== ""))).toBe(true);
    expect(JSON.stringify(groups)).not.toMatch(/\d{10}/);
  });
});

describe("campaign dashboard: driveGroups beside drives", () => {
  it("returns drives unchanged, adds only driveGroups, and serves both from the same 60 second cache", async () => {
    const today = istToday();
    const dashRow = { id: "dr1", drive_date: today, branch_name: "Pune", status: "active", target_shows: 9, requisition_code: "REQ-7", designation_name: "Agent", lined: 4, invited: 3, confirmed: 2, arrived: 1, no_show: 0, declined: 0 };
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("SELECT DISTINCT d.requisition_id")) return [[{ requisition_id: RID, branch_name: "Pune" }]];
      if (q.includes("FROM job_requisition jr")) return [[{ requisition_id: RID, branch_name: "Pune", requisition_code: "REQ-7", designation_name: "Agent", ...dbRow(today, { id: "dr1", lined: 4 }) }]];
      if (q.includes("FROM requisition_stream WHERE")) return [[]];
      if (q.includes("FROM he_drive d JOIN job_requisition")) return [[dashRow]];
      return [[]];
    });
    const first = await getCampaignDashboard();
    expect(first.drives).toEqual([{ driveId: "dr1", date: today, branch: "Pune", requisition: "REQ-7", role: "Agent", status: "active", wanted: 9, lined: 4, invited: 3, confirmed: 2, arrived: 1, noShow: 0, declined: 0 }]);
    expect(first.driveGroups).toHaveLength(1);
    expect(Object.keys(first).sort()).toEqual(["driveGroups", "drives", "generatedAt", "live", "reruns", "saved"]);
    const { driveGroups, ...rest } = first;
    void driveGroups;
    expect(Object.keys(rest).sort()).toEqual(["drives", "generatedAt", "live", "reruns", "saved"]);
    const calls = execute.mock.calls.length;
    const second = await getCampaignDashboard();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(execute.mock.calls.length).toBe(calls);
  });

  it("an unexpected throw inside the grouped read keeps drives and reports driveGroups as failed", async () => {
    const today = istToday();
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("FROM requisition_stream WHERE")) return [[]];
      if (q.includes("SELECT DISTINCT d.requisition_id")) return [[{ requisition_id: RID, branch_name: "Pune" }]];
      // parsing a row throws outside every guarded sub-query
      if (q.includes("FROM job_requisition jr")) return [[{ requisition_id: RID, branch_name: "Pune", requisition_code: "R", designation_name: "A", id: "d1", drive_date: { toString() { throw new Error("bad row"); } } }]];
      if (q.includes("FROM he_drive d JOIN job_requisition")) return [[{ id: "dr1", drive_date: today, branch_name: "Pune", status: "active", target_shows: 9, requisition_code: "REQ-7", designation_name: "Agent", lined: 1, invited: 0, confirmed: 0, arrived: 0, no_show: 0, declined: 0 }]];
      return [[]];
    });
    const d = await getCampaignDashboard();
    expect(d.drives).toHaveLength(1);
    expect(d.driveGroups).toEqual([]);
    expect(d.failedSections).toEqual(["driveGroups"]);
  });

  it("before 2135 is applied (no stream tables) the dashboard is complete and cached: no failed section", async () => {
    const today = istToday();
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("requisition_stream")) throw Object.assign(new Error("Table 'mas_hrms.requisition_stream' doesn't exist"), { code: "ER_NO_SUCH_TABLE" });
      if (q.includes("FROM job_requisition WHERE id")) return [[{ branch_name: "Pune" }]];
      if (q.includes("SELECT DISTINCT d.requisition_id")) return [[{ requisition_id: RID, branch_name: "Pune" }]];
      if (q.includes("FROM job_requisition jr")) return [[{ requisition_id: RID, branch_name: "Pune", requisition_code: "REQ-7", designation_name: "Agent", ...dbRow(today, { id: "dr1", lined: 4 }) }]];
      return [[]];
    });
    const first = await getCampaignDashboard();
    expect(first.failedSections ?? []).toEqual([]);
    expect(first.driveGroups).toHaveLength(1);
    const calls = execute.mock.calls.length;
    await getCampaignDashboard();
    expect(execute.mock.calls.length).toBe(calls);
    const t = await getDriveTrend({ requisitionId: RID, sourceType: "he" }, ALL, new Date());
    expect(t).toMatchObject({ partial: false, failedSections: [] });
  });

  it("keeps drives working and reports failedSections when the grouped read fails", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("SELECT DISTINCT d.requisition_id")) throw new Error("boom");
      if (q.includes("FROM requisition_stream WHERE")) return [[]];
      return [[]];
    });
    const d = await getCampaignDashboard();
    expect(d.drives).toEqual([]);
    expect(d.driveGroups).toEqual([]);
    expect(d.failedSections).toEqual(["driveGroups"]);
  });
});

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/he", heRouter);
  return app;
}

describe("GET /api/he/drive-trend", () => {
  it("400 without or with a bad requisitionId, 400 for an unknown source type", async () => {
    expect((await request(appFor("ceo")).get("/api/he/drive-trend")).status).toBe(400);
    expect((await request(appFor("ceo")).get("/api/he/drive-trend?requisitionId=nope")).status).toBe(400);
    const r = await request(appFor("ceo")).get(`/api/he/drive-trend?requisitionId=${RID}&sourceType=x`);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Unknown source type");
  });

  it("200 for ceo with the trend and no phone numbers or SQL in the body", async () => {
    const r = await request(appFor("ceo")).get(`/api/he/drive-trend?requisitionId=${RID}&sourceType=he`);
    expect(r.status).toBe(200);
    expect(r.body.data.points.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.body)).not.toMatch(/\d{10}|SELECT/i);
  });

  it("404 for an unknown requisition and for one outside the caller's branch", async () => {
    expect((await request(appFor("ceo")).get("/api/he/drive-trend?requisitionId=00000000-0000-0000-0000-000000000000")).status).toBe(404);
    execute.mockImplementation(async (sql: string, params: unknown[]) => {
      const q = String(sql);
      if (q.includes("FROM job_requisition WHERE id")) return [[{ branch_name: "Pune" }]];
      if (q.includes("FROM employees e")) return [[{ branch_name: "Delhi" }]];
      void params;
      return [[]];
    });
    const r = await request(appFor("hr")).get(`/api/he/drive-trend?requisitionId=${RID}`);
    expect(r.status).toBe(404);
  });

  it("403 for a role outside the view roles and 500 with a generic message on a failure", async () => {
    expect((await request(appFor("employee")).get(`/api/he/drive-trend?requisitionId=${RID}`)).status).toBe(403);
    execute.mockImplementation(async () => { throw new Error("SELECT secret FROM x"); });
    const r = await request(appFor("ceo")).get(`/api/he/drive-trend?requisitionId=${RID}`);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/SELECT/);
  });
});
