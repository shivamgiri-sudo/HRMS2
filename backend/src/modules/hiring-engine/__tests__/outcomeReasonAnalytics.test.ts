import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const loadActiveStreams = vi.hoisted(() => vi.fn());
const getSources = vi.hoisted(() => vi.fn());
const mode = vi.hoisted(() => vi.fn());
const factsSpy = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../requisition-stream.service.js", async (orig) => ({ ...(await orig<typeof import("../requisition-stream.service.js")>()), loadActiveStreams }));
vi.mock("../he-sources-window.service.js", () => ({ getSourcesForRequisitions: getSources }));
vi.mock("../qualified-followup.schedule.js", () => ({ followupMode: mode }));
vi.mock("../he-drive-insight-facts.service.js", () => ({ collectInsightFacts: async (ctx: unknown) => { factsSpy(ctx); return { facts: { today: "2026-10-14", windowDays: 14 }, failedSections: [] }; } }));
vi.mock("../he-insight-params.service.js", async () => ({ loadInsightThresholds: async () => ({ ...(await import("../he-drive-insights.js")).INSIGHT_DEFAULTS }) }));

import { waterfall, zeroStages } from "../he-drive-analytics.js";
import { clearDriveAnalyticsCache, getDriveAnalytics } from "../he-drive-analytics.service.js";
import { INSIGHT_DEFAULTS, evaluateInsights, type InsightFacts } from "../he-drive-insights.js";

const S = { leads: 100, qualified: 40, invited: 30, confirmed: 10, arrived: 6, selected: 3, joined: 1, noShow: 3, declined: 4 };
const BEFORE = '[{"from":"leads","to":"qualified","lost":60,"reasons":[{"reason":"not_qualified","n":60}]},{"from":"qualified","to":"invited","lost":10,"reasons":[{"reason":"opted_out","n":2},{"reason":"not_invited","n":8}]},{"from":"invited","to":"confirmed","lost":20,"reasons":[{"reason":"declined","n":4},{"reason":"no_reply","n":16}]},{"from":"confirmed","to":"arrived","lost":4,"reasons":[{"reason":"no_show","n":3},{"reason":"slot_released","n":1}]},{"from":"arrived","to":"selected","lost":3,"reasons":[{"reason":"not_selected","n":3}]},{"from":"selected","to":"joined","lost":2,"reasons":[{"reason":"not_joined_yet","n":2}]}]';

describe("waterfall detail", () => {
  it("attaches capped, ordered detail with the remainder as not_stated", () => {
    const w = waterfall(S, {}, 1, { declined: { distance: 2, salary: 1 }, no_show: { timing: 5 } });
    expect(w[2].reasons).toEqual([{ reason: "declined", n: 4, detail: [{ code: "distance", n: 2 }, { code: "salary", n: 1 }, { code: "not_stated", n: 1 }] }, { reason: "no_reply", n: 16 }]);
    expect(w[3].reasons[0]).toEqual({ reason: "no_show", n: 3, detail: [{ code: "timing", n: 3 }] });
    expect(w[3].reasons[1]).toEqual({ reason: "slot_released", n: 1 });
  });
  it("orders by count then code and never exceeds n", () => {
    const w = waterfall(S, {}, 0, { declined: { salary: 2, distance: 2, other: 9 } });
    expect(w[2].reasons[0].detail).toEqual([{ code: "other", n: 4 }]);
    const t = waterfall(S, {}, 0, { declined: { salary: 1, distance: 1, timing: 2 } });
    expect(t[2].reasons[0].detail).toEqual([{ code: "timing", n: 2 }, { code: "distance", n: 1 }, { code: "salary", n: 1 }]);
  });
  it("a given but empty detail puts everything under not_stated", () => {
    expect(waterfall(S, {}, 0, {})[2].reasons[0].detail).toEqual([{ code: "not_stated", n: 4 }]);
  });
  it("without the fourth argument the output is byte-identical to before", () => {
    expect(JSON.stringify(waterfall(S, { opted_out: 2 }, 1))).toBe(BEFORE);
    expect(JSON.stringify(waterfall({ ...zeroStages(), noShow: 0, declined: 0 }, {}, 0, { declined: { salary: 1 } }).flatMap((x) => x.reasons))).toBe("[]");
  });
});

const T = (o: Partial<InsightFacts["reasons"] extends infer R ? NonNullable<R> : never>) => o;
const base = (reasons: NonNullable<InsightFacts["reasons"]>): InsightFacts => ({ today: "2026-10-14", windowDays: 14, types: {} as never, tomorrow: [], contact: {} as never, reminders: {} as never, distance: {} as never, channel: {} as never, language: {} as never, slots: [], streams: [], sources: [], weekdays: [], reasons });
const empty = { no_show: {}, declined: {} };
const run = (heCounts: object) => evaluateInsights(base({ meta_live: empty, meta_old: empty, he: heCounts as never }), { ...INSIGHT_DEFAULTS }).filter((i) => i.rule === ("outcome_reason" as never));
void T;

describe("outcome_reason insight", () => {
  it("fires once at the sample minimum with a share of 0.4 or more", () => {
    const r = run({ no_show: { distance: 12, timing: 5, other: 3 }, declined: {} });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      id: "outcome_reason:he:all:no_show.distance", severity: "info", sourceType: "he", requisitionId: null, effect: null, action: { type: "none" },
      title: 'Most no-shows from Hiring Engine say "Distance" (60%)', suggestion: "Line up people nearer the branch, or offer the nearer branch",
    });
  });
  it("evidence names the type's total no-shows or declines in range", () => {
    const f = base({ meta_live: empty, meta_old: empty, he: { no_show: { distance: 12, timing: 5, other: 3 }, declined: { salary: 10, other_job: 10 } } as never });
    f.types = { meta_live: { current: zeroStages(), previous: zeroStages() }, meta_old: { current: zeroStages(), previous: zeroStages() }, he: { current: zeroStages(), previous: zeroStages(), noShow: 31, declined: 44 } };
    const r = evaluateInsights(f, { ...INSIGHT_DEFAULTS }).filter((i) => i.rule === ("outcome_reason" as never));
    expect(r.find((i) => i.id.includes("no_show"))?.evidence).toContainEqual({ label: "No-shows in range", value: "31" });
    expect(r.find((i) => i.id.includes("declined"))?.evidence).toContainEqual({ label: "Declines in range", value: "44" });
  });
  it("needs the sample and the share", () => {
    expect(run({ no_show: { distance: 12, timing: 4, other: 3 }, declined: {} })).toHaveLength(0);
    expect(run({ no_show: { distance: 7, timing: 7, other: 6 }, declined: {} })).toHaveLength(0);
    expect(run({ no_show: { distance: 8, timing: 7, other: 5 }, declined: {} })).toHaveLength(1);
  });
  it("declines use their own wording and suggestions", () => {
    const r = run({ no_show: {}, declined: { salary: 10, other_job: 10 } });
    expect(r.map((i) => i.id)).toEqual(["outcome_reason:he:all:declined.other_job"]);
    expect(r[0].title).toBe('Most declines from Hiring Engine say "Got another job" (50%)');
    expect(r[0].suggestion).toBe("Invite sooner after people qualify; they are taking other offers");
  });
  it("has no insight without reasons", () => {
    const f = base({ meta_live: empty, meta_old: empty, he: empty as never });
    delete f.reasons;
    expect(evaluateInsights(f, { ...INSIGHT_DEFAULTS }).filter((i) => i.rule === ("outcome_reason" as never))).toHaveLength(0);
  });
});

const NOW = new Date("2026-10-14T06:00:00Z");
const Q = { from: "2026-10-01", to: "2026-10-14" };
const ALL = { all: true } as never;
const zeros = { qualified: 0, emailed: 0, whatsapped: 0, replied: 0, called: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 };
const srcRow = (sourceType: string, leads: number) => ({ sourceType, originId: `o-${sourceType}`, originLabel: sourceType, streamId: null, streamStatus: null, ...zeros, leads, shareOfLeads: 0, shareOfJoined: 0, leadToJoinRate: 0 });
const driveRow = { requisition_id: "r1", requisition_code: "REQ-r1", designation_name: "Agent", branch_name: "Pune", id: "d-r1", drive_date: "2026-10-12", status: "active", target_shows: 10, stream_id: null, source_type: null, lined: 20, invited: 15, confirmed: 10, arrived: 6, no_show: 2, declined: 1 };
let reasonRows: unknown[] | "missing";
const stmts = (): string[] => execute.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " ").trim());

beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); clearDriveAnalyticsCache();
  mode.mockReturnValue("live"); loadActiveStreams.mockResolvedValue([]);
  reasonRows = [{ source_type: "he", outcome: "declined", reason_code: "salary", n: 1 }, { source_type: "he", outcome: "no_show", reason_code: "timing", n: 5 }];
  getSources.mockResolvedValue({ byRequisition: [{ requisitionId: "r1", rows: [srcRow("he", 20)] }], partial: false, failedSections: [] });
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const q = String(sql);
    if (q.includes("he_match_outcome_reason")) {
      if (reasonRows === "missing") throw Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" });
      return [reasonRows];
    }
    if (q.includes("FROM he_drive d WHERE d.drive_date BETWEEN")) return [[{ id: "r1", requisition_code: "REQ-r1", designation_name: "Agent", branch_name: "Pune", last_drive: "2026-10-12" }]];
    // events-based persons read (checked first: it also LEFT JOINs he_drive): the people of the bucket row
    if (q.includes("AS lead_rows") && Array.isArray(params) && !params.includes("2026-10-15 00:00:00")) return [[]]; // the previous window's read
    if (q.includes("AS lead_rows")) return [[{ requisition_id: "r1", source_type: "he", campaign_id: null, leads: driveRow.lined, qualified: 0, contacted: driveRow.invited, invited: driveRow.invited, confirmed: driveRow.confirmed, arrived: driveRow.arrived, selected: 0, joined: 0 }]];
    if (q.includes("LEFT JOIN he_drive d ON")) return [[driveRow]];
    return [[]];
  });
});

describe("analytics with HE_OUTCOME_REASONS", () => {
  it("on: one reasons statement from he_drive joining the reason table, detail on declined and no_show, ids and reasons reach the insight facts", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    const r = (await getDriveAnalytics(Q, ALL, NOW)) as never as { waterfall: Record<string, Array<{ reasons: Array<{ reason: string; n: number; detail?: unknown[] }> }>>; partial: boolean };
    const q = stmts().filter((s) => s.includes("he_match_outcome_reason"));
    expect(q).toHaveLength(1);
    expect(q[0]).toContain("FROM he_drive d");
    expect(q[0]).toContain("JOIN he_match_outcome_reason r ON r.match_id = m.id");
    const entries = r.waterfall.he.flatMap((s) => s.reasons);
    const dec = entries.find((e) => e.reason === "declined"), ns = entries.find((e) => e.reason === "no_show");
    expect(dec?.detail).toBeDefined();
    expect(ns?.detail).toBeDefined();
    expect(entries.filter((e) => e.detail).map((e) => e.reason).sort()).toEqual(["declined", "no_show"]);
    for (const e of [dec, ns]) expect((e?.detail as Array<{ n: number }>).reduce((a, d) => a + d.n, 0)).toBe(e?.n);
    expect(r.partial).toBe(false);
    expect(factsSpy.mock.calls[0][0].reasons.he.no_show).toEqual({ timing: 5 });
  });
  it("a missing table gives no detail and stays complete", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    reasonRows = "missing";
    const r = (await getDriveAnalytics(Q, ALL, NOW)) as never as { waterfall: Record<string, Array<{ reasons: Array<{ detail?: unknown }> }>>; partial: boolean; failedSections: string[] };
    expect(r.waterfall.he.flatMap((s) => s.reasons).filter((e) => e.detail)).toHaveLength(0);
    expect([r.partial, r.failedSections]).toEqual([false, []]);
  });
  it("a failing read is a named partial section and the waterfall stays as today", async () => {
    vi.stubEnv("HE_OUTCOME_REASONS", "true");
    execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const q = String(sql);
      if (q.includes("he_match_outcome_reason")) throw Object.assign(new Error("boom"), { code: "ER_X" });
      if (q.includes("FROM he_drive d WHERE d.drive_date BETWEEN")) return [[{ id: "r1", requisition_code: "REQ-r1", designation_name: "Agent", branch_name: "Pune", last_drive: "2026-10-12" }]];
      // events-based persons read (checked first: it also LEFT JOINs he_drive): the people of the bucket row
    if (q.includes("AS lead_rows") && Array.isArray(params) && !params.includes("2026-10-15 00:00:00")) return [[]]; // the previous window's read
    if (q.includes("AS lead_rows")) return [[{ requisition_id: "r1", source_type: "he", campaign_id: null, leads: driveRow.lined, qualified: 0, contacted: driveRow.invited, invited: driveRow.invited, confirmed: driveRow.confirmed, arrived: driveRow.arrived, selected: 0, joined: 0 }]];
    if (q.includes("LEFT JOIN he_drive d ON")) return [[driveRow]];
      return [[]];
    });
    const r = (await getDriveAnalytics(Q, ALL, NOW)) as never as { partial: boolean; failedSections: string[]; waterfall: Record<string, Array<{ reasons: Array<{ detail?: unknown }> }>> };
    expect([r.partial, r.failedSections]).toEqual([true, ["reasons"]]);
    expect(r.waterfall.he.flatMap((s) => s.reasons).filter((e) => e.detail)).toHaveLength(0);
  });
  it("off: no reason statement at all", async () => {
    await getDriveAnalytics(Q, ALL, NOW);
    expect(stmts().some((s) => s.includes("he_match_outcome_reason"))).toBe(false);
    expect(factsSpy.mock.calls[0][0].reasons).toBeUndefined();
  });
});
