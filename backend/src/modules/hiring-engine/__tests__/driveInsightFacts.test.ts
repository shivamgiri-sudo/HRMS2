import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
const getDrivePlan = vi.hoisted(() => vi.fn());
const poolRemaining = vi.hoisted(() => vi.fn());
const loadActiveStreams = vi.hoisted(() => vi.fn());
const getSources = vi.hoisted(() => vi.fn());
const thresholds = vi.hoisted(() => vi.fn());
const evaluate = vi.hoisted(() => vi.fn());
const factsOverride = vi.hoisted(() => ({ fn: null as null | ((...a: unknown[]) => unknown) }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: logError } }));
vi.mock("../he-drive-plan.service.js", () => ({ getDrivePlan, poolRemaining }));
vi.mock("../requisition-stream.service.js", async (orig) => ({ ...(await orig<typeof import("../requisition-stream.service.js")>()), loadActiveStreams }));
vi.mock("../he-sources-window.service.js", () => ({ getSourcesForRequisitions: getSources }));
vi.mock("../qualified-followup.schedule.js", () => ({ followupMode: () => "live" }));
vi.mock("../he-insight-params.service.js", () => ({ loadInsightThresholds: thresholds }));
vi.mock("../he-drive-insights.js", async (orig) => ({ ...(await orig<typeof import("../he-drive-insights.js")>()), evaluateInsights: evaluate }));
vi.mock("../he-drive-insight-facts.service.js", async (orig) => {
  const real = await orig<typeof import("../he-drive-insight-facts.service.js")>();
  return { ...real, collectInsightFacts: (...a: Parameters<typeof real.collectInsightFacts>) => (factsOverride.fn ? factsOverride.fn(...a) : real.collectInsightFacts(...a)) };
});

import { INSIGHT_DEFAULTS, type DriveInsight } from "../he-drive-insights.js";
import { collectInsightFacts } from "../he-drive-insight-facts.service.js";
import { countedNoShow } from "../he-no-show-events.js";
import { clearDriveAnalyticsCache, driveAnalyticsCacheSize, getDriveAnalytics, type DriveAnalytics } from "../he-drive-analytics.service.js";

const NOW = new Date("2026-10-14T06:00:00Z"); // 11:30 IST, Wednesday 2026-10-14; next working day 2026-10-15
const ALL = { all: true } as never;
const T = { ...INSIGHT_DEFAULTS };
const zeroStage = { leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 };
const grid = () => Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
const types = () => ({
  meta_live: { current: { ...zeroStage }, previous: { ...zeroStage } }, meta_old: { current: { ...zeroStage }, previous: { ...zeroStage } }, he: { current: { ...zeroStage }, previous: { ...zeroStage } },
});

type Rows = Record<string, unknown[]>;
let rows: Rows;
let failKind: string | null;
// Statement kinds by a distinctive fragment of their text.
const kindOf = (q: string): string =>
  q.includes("ABS(HOUR(") ? "contact" : q.includes("he_reminder_1d") ? "reminders" : q.includes("m.distance_km IS NOT NULL") ? "distance"
    : q.includes("o.delivery_status = 'failed'") ? "waFailed" : q.includes("AS wa_delivered") ? "waStatus" : q.includes("language_pref") ? "language"
      : q.includes("hl.walkin_count") ? "slotMatches" : q.includes("d.status <> 'closed'") ? "slotDrives" : q.includes("d.drive_date = ?") ? "tomorrowDrives" : "other";
const sqls = (): Array<{ sql: string; params: unknown[]; kind: string }> => execute.mock.calls.map((c) => ({ sql: String(c[0]), params: (c[1] ?? []) as unknown[], kind: kindOf(String(c[0])) }));

const ctxOf = (o: Record<string, unknown> = {}) => ({
  requisitionIds: ["r1"], from: "2026-10-01", to: "2026-10-14", today: "2026-10-14", windowDays: 14, types: types(), agg: [], sources: [], codes: new Map([["r1", "REQ-1"]]),
  t: T, arrivals: { meta_live: grid(), meta_old: grid(), he: grid() }, streams: [], now: NOW, ...o,
}) as never;

const stream = (id: string, req: string, openFrom = "2026-10-10", openDays = 10) => ({
  id, requisitionId: req, branchName: "Pune", sourceType: "meta_old", originId: "o", originLabel: "L", openFrom, openDays, dailyInvites: 50, status: "open", closedReason: null,
  createdBy: null, createdAt: "", add: [], skip: [], version: 1,
});
const planFor = (req: string, expected = 4) => ({
  requisitionId: req, code: `REQ-${req}`, partial: false, failedSections: [],
  days: [{ date: "2026-10-15", driveId: null, target: 10, capacity: 40, seatsUsed: 0, expected, gap: 6, streams: [{ streamId: "s-" + req, sourceType: "meta_old", cap: 50, recommended: 7, lined: 0, expected: 0, rate: 0.3, basis: "plan_default", label: "L", reasoning: "", covers: true }] }],
});

beforeEach(() => {
  vi.clearAllMocks();
  clearDriveAnalyticsCache();
  rows = {}; failKind = null; factsOverride.fn = null;
  execute.mockImplementation(async (sql: string) => {
    const k = kindOf(String(sql));
    if (failKind && k === failKind) throw Object.assign(new Error("boom WHERE mobile = 9876543210"), { code: "ER_LOCK_DEADLOCK" });
    return [rows[k] ?? []];
  });
  getDrivePlan.mockImplementation(async (q: { requisitionId: string }) => planFor(q.requisitionId));
  poolRemaining.mockResolvedValue(30);
});

describe("collectInsightFacts", () => {
  it("builds contact facts from outbound invites vs the best hour, with the tolerance as a parameter", async () => {
    rows.contact = [
      { source_type: "he", outside: 0, n: 20, hits: 10 },
      { source_type: "he", outside: 1, n: 40, hits: 8 },
    ];
    const { facts, failedSections } = await collectInsightFacts(ctxOf(), ALL);
    expect(facts.contact.he).toEqual({ inside: { n: 20, hits: 10 }, outside: { n: 40, hits: 8 } });
    expect(facts.contact.meta_live).toEqual({ inside: { n: 0, hits: 0 }, outside: { n: 0, hits: 0 } });
    expect(failedSections).toEqual([]);
    const c = sqls().find((s) => s.kind === "contact")!;
    expect(c.sql).toContain("d.requisition_id IN");
    expect(c.sql).toContain("ABS(HOUR(");
    expect(c.sql).toContain("he_walkin_invite%");
    expect(c.params[0]).toBe(1);
    expect(c.params).toEqual(expect.arrayContaining(["r1", "2026-10-01 00:00:00", "2026-10-15 00:00:00"]));
  });

  it("groups WhatsApp failures by Meta error code in code and never puts error text in the facts", async () => {
    rows.waFailed = [
      { source_type: "he", err: "(#132018) issue", n: 1 }, { source_type: "he", err: "(#132018) x", n: 1 }, { source_type: "he", err: "boom", n: 1 },
    ];
    rows.waStatus = [{ source_type: "he", wa_delivered: 30, wa_unread: 12 }];
    const sources = [{ requisitionId: "r1", rows: [
      { sourceType: "he", qualified: 100, emailed: 60, whatsapped: 80, arrived: 20 }, { sourceType: "he", qualified: 10, emailed: 0, whatsapped: 0, arrived: 0 },
    ] }];
    const { facts } = await collectInsightFacts(ctxOf({ sources }), ALL);
    expect(facts.channel.he.waFailedByCode).toEqual({ "132018": 2, other: 1 });
    expect(facts.channel.he).toMatchObject({ qualified: 110, unreached: 30, reachedArrivalRate: 0.25, waDelivered: 30, waUnread: 12 });
    expect(JSON.stringify(facts)).not.toMatch(/issue|boom|\(#/);
  });

  it("summarises reminders, distance and language", async () => {
    rows.reminders = [{ source_type: "he", has_reminder: 0, n: 10, hits: 2 }, { source_type: "he", has_reminder: 1, n: 30, hits: 21 }];
    rows.distance = [{ source_type: "he", far: 0, n: 50, hits: 30 }, { source_type: "he", far: 1, n: 25, hits: 5 }];
    rows.language = [{ source_type: "he", hi: 1, n: 60, hits: 6 }, { source_type: "he", hi: 0, n: 80, hits: 24 }];
    const { facts } = await collectInsightFacts(ctxOf(), ALL);
    expect(facts.reminders.he).toEqual({ confirmed: 40, missing: 10, withReminder: { n: 30, hits: 21 }, withoutReminder: { n: 10, hits: 2 } });
    expect(facts.distance.he).toEqual({ near: { n: 50, hits: 30 }, far: { n: 25, hits: 5 } });
    expect(facts.language.he).toEqual({ hi: { n: 60, hits: 6 }, other: { n: 80, hits: 24 } });
    const rem = sqls().find((s) => s.kind === "reminders")!;
    expect(rem.sql).toContain("he_reminder_2h%");
    expect(rem.params.slice(-2)).toEqual(["2026-10-01", "2026-10-14"]); // dated up to today
    expect(sqls().find((s) => s.kind === "distance")!.params).toContain(15); // insight.distance_band_km
  });

  it("derives slots: capacity, expected arrivals and the busy hours' seats and bookings", async () => {
    rows.slotDrives = [{ id: "d1", requisition_id: "r1", drive_date: "2026-10-15", slot_start: "10:00:00", slot_end: "13:00:00", slot_minutes: 30, slot_capacity: 2 }];
    rows.slotMatches = [
      { drive_id: "d1", state: "confirmed", distance_km: null, slot_at: "2026-10-15 11:00:00", walkin_count: 0, past_no_shows: 0, shared_location: 0, replied_yes: 0 },
      { drive_id: "d1", state: "invited", distance_km: null, slot_at: "2026-10-15 11:30:00", walkin_count: 0, past_no_shows: 0, shared_location: 0, replied_yes: 0 },
      { drive_id: "d1", state: "arrived", distance_km: null, slot_at: "2026-10-15 12:00:00", walkin_count: 0, past_no_shows: 0, shared_location: 0, replied_yes: 0 },
    ];
    const arrivals = { meta_live: grid(), meta_old: grid(), he: grid() };
    arrivals.he[2][11] = 9; arrivals.he[3][12] = 5; arrivals.meta_live[0][10] = 2; arrivals.meta_old[1][15] = 1; // busy: 11, 12, 10
    const { facts } = await collectInsightFacts(ctxOf({ arrivals }), ALL);
    expect(facts.slots).toHaveLength(1);
    // 6 slots x 2 seats; busy hours 10, 11, 12 hold 6 slots = 12 seats; three bookings with a slot in those hours
    expect(facts.slots[0]).toMatchObject({ driveId: "d1", requisitionId: "r1", code: "REQ-1", date: "2026-10-15", capacity: 12, busyHourSeats: 12, busyHourBooked: 3 });
    expect(facts.slots[0].expected).toBeCloseTo(0.55 + 0.3 + 1, 3); // pShow(confirmed) + pShow(invited) + the arrived one
    expect(sqls().filter((s) => s.kind === "slotMatches")).toHaveLength(1);
    // past no-shows skip the ones a later arrival at the same drive corrected
    expect(sqls().find((s) => s.kind === "slotMatches")!.sql).toContain(countedNoShow("e"));
  });

  it("calls getDrivePlan for at most 20 requisitions, earliest stream end first", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `r${i}`);
    // r0 ends last, r24 ends first: openFrom 2026-10-10 + openDays 10 + i
    const streams = ids.map((id, i) => stream(`s${i}`, id, "2026-10-10", 30 - i));
    await collectInsightFacts(ctxOf({ requisitionIds: ids, streams, codes: new Map(ids.map((i) => [i, `C-${i}`])) }), ALL);
    expect(getDrivePlan).toHaveBeenCalledTimes(20);
    const called = getDrivePlan.mock.calls.map((c) => c[0].requisitionId).sort();
    expect(called).toEqual(ids.slice(5).sort()); // r5..r24 have the earliest ends
    expect(getDrivePlan.mock.calls[0][0]).toMatchObject({ from: "2026-10-15", days: 1 });
  });

  it("fills tomorrow and streams from the plan, pool and remaining planned days", async () => {
    const streams = [stream("s1", "r1", "2026-10-10", 10)]; // 10 planned days from Sat 10-10 skipping Sundays: ends 10-21; planned from 10-15: 15,16,17,19,20,21
    const { facts } = await collectInsightFacts(ctxOf({ streams }), ALL);
    expect(facts.tomorrow).toEqual([{ requisitionId: "r1", code: "REQ-1", date: "2026-10-15", target: 10, projected: 4, recommended: [{ streamId: "s-r1", sourceType: "meta_old", invites: 7 }] }]);
    expect(facts.streams).toEqual([{ streamId: "s1", requisitionId: "r1", code: "REQ-1", sourceType: "meta_old", cap: 50, remainingDays: 6, poolRemaining: 30 }]);
  });

  it("skips a degraded plan: no tomorrow fact, section flagged", async () => {
    getDrivePlan.mockImplementation(async (q: { requisitionId: string }) => ({ ...planFor(q.requisitionId), partial: true, failedSections: ["rates"] }));
    const { facts, failedSections } = await collectInsightFacts(ctxOf({ streams: [stream("s1", "r1")] }), ALL);
    expect(failedSections).toContain("insight:tomorrow");
    expect(facts.tomorrow).toEqual([]);
  });

  it("passes the request's thresholds to every plan build", async () => {
    await collectInsightFacts(ctxOf({ streams: [stream("s1", "r1")] }), ALL);
    expect(getDrivePlan.mock.calls[0][3]).toBe(T);
  });

  it("does not count a FAILED reminder send as a reminder", async () => {
    await collectInsightFacts(ctxOf(), ALL);
    const r = sqls().find((x) => x.kind === "reminders")!;
    expect(r.sql).toContain("(r1.delivery_status IS NULL OR r1.delivery_status <> 'failed')");
    expect(r.sql).toContain("(r2.delivery_status IS NULL OR r2.delivery_status <> 'failed')");
  });

  it("measures the hour distance around midnight", async () => {
    await collectInsightFacts(ctxOf(), ALL);
    const c = sqls().find((s) => s.kind === "contact")!;
    expect(c.sql).toContain("LEAST(ABS(HOUR(o.created_at) - CAST(li.best_hour_ist AS SIGNED)), 24 - ABS(HOUR(o.created_at) - CAST(li.best_hour_ist AS SIGNED)))");
  });

  it("builds NO plan and NO under_target for a requisition without an open stream, even with a drive tomorrow", async () => {
    rows.tomorrowDrives = [{ requisition_id: "r1" }];
    const paused = { ...stream("s1", "r1"), status: "paused" };
    const { facts } = await collectInsightFacts(ctxOf({ streams: [paused] }), ALL);
    expect(getDrivePlan).not.toHaveBeenCalled();
    expect(facts.tomorrow).toEqual([]);
    expect(sqls().some((x) => x.kind === "tomorrowDrives")).toBe(false);
    const { evaluateInsights } = await vi.importActual<typeof import("../he-drive-insights.js")>("../he-drive-insights.js");
    expect(evaluateInsights(facts, T).filter((i) => i.rule === "under_target")).toEqual([]);
  });

  it("a requisition with 30 confirmed for tomorrow and no stream yields no critical insight", async () => {
    // production today: drives without streams. A plan built for it would read expected 0 against the drive's target.
    getDrivePlan.mockImplementation(async (q: { requisitionId: string }) => ({ ...planFor(q.requisitionId, 0), days: [{ date: "2026-10-15", driveId: "d1", target: 30, capacity: 60, seatsUsed: 30, expected: 0, gap: 30, streams: [] }] }));
    rows.tomorrowDrives = [{ requisition_id: "r1" }];
    const ctx = ctxOf({ agg: [{ requisitionId: "r1", branch: "Pune", date: "2026-10-15", driveId: "d1", streamType: null, wanted: 30, lined: 30, invited: 30, confirmed: 30, arrived: 0, noShow: 0, declined: 0 }] });
    const { facts } = await collectInsightFacts(ctx, ALL);
    const { evaluateInsights } = await vi.importActual<typeof import("../he-drive-insights.js")>("../he-drive-insights.js");
    expect(evaluateInsights(facts, T).filter((i) => i.severity === "critical")).toEqual([]);
  });

  it("skips a tomorrow entry whose day no stream covers", async () => {
    getDrivePlan.mockImplementation(async (q: { requisitionId: string }) => {
      const p = planFor(q.requisitionId, 0);
      return { ...p, days: p.days.map((d) => ({ ...d, streams: d.streams.map((l) => ({ ...l, covers: false, reasoning: "Not open on this day" })) })) };
    });
    const { facts } = await collectInsightFacts(ctxOf({ streams: [stream("s1", "r1")] }), ALL);
    expect(facts.tomorrow).toEqual([]);
  });

  it("a stream-covered day below target still fires under_target", async () => {
    const { facts } = await collectInsightFacts(ctxOf({ streams: [stream("s1", "r1")] }), ALL); // plan: target 10, expected 4
    const { evaluateInsights } = await vi.importActual<typeof import("../he-drive-insights.js")>("../he-drive-insights.js");
    const u = evaluateInsights(facts, T).filter((i) => i.rule === "under_target");
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ severity: "critical", requisitionId: "r1" });
  });

  it("builds sources and weekdays from the drive aggregates", async () => {
    const agg = [
      { driveId: "d1", date: "2026-10-12", status: "active", wanted: 10, streamId: null, streamType: null, lined: 9, invited: 8, confirmed: 5, arrived: 3, noShow: 1, declined: 0, requisitionId: "r1", branch: "Pune" },
      { driveId: "d2", date: "2026-10-13", status: "active", wanted: 10, streamId: "s", streamType: "meta_live", lined: 5, invited: 4, confirmed: 2, arrived: 2, noShow: 0, declined: 0, requisitionId: "r1", branch: "Pune" },
      { driveId: "d3", date: "2026-09-01", status: "active", wanted: 10, streamId: null, streamType: null, lined: 9, invited: 99, confirmed: 99, arrived: 99, noShow: 0, declined: 0, requisitionId: "r1", branch: "Pune" },
    ];
    const sources = [{ requisitionId: "r1", rows: [{ sourceType: "he", leads: 40, joined: 4 }, { sourceType: "meta_live", leads: 20, joined: 1 }] }];
    const { facts } = await collectInsightFacts(ctxOf({ agg, sources }), ALL);
    expect(facts.sources).toEqual([{ requisitionId: "r1", code: "REQ-1", byType: { meta_live: { leads: 20, joined: 1, invited: 4 }, he: { leads: 40, joined: 4, invited: 8 } } }]);
    expect(facts.weekdays).toEqual([{ weekday: 0, confirmed: 5, arrived: 3 }, { weekday: 1, confirmed: 2, arrived: 2 }]); // 12 Oct 2026 is a Monday
  });

  it("leaves only the failed fact group at zero and names it", async () => {
    rows.contact = [{ source_type: "he", outside: 0, n: 20, hits: 10 }];
    rows.language = [{ source_type: "he", hi: 1, n: 60, hits: 6 }];
    failKind = "language";
    const { facts, failedSections } = await collectInsightFacts(ctxOf(), ALL);
    expect(failedSections).toEqual(["insight:language"]);
    expect(facts.language.he).toEqual({ hi: { n: 0, hits: 0 }, other: { n: 0, hits: 0 } });
    expect(facts.contact.he.inside).toEqual({ n: 20, hits: 10 });
    expect(JSON.stringify(logError.mock.calls)).not.toContain("9876543210");
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ section: "insight:language", code: "ER_LOCK_DEADLOCK" }), expect.any(String));
  });

  it("treats a missing table as no rows and a getDrivePlan failure as a failed section", async () => {
    getDrivePlan.mockRejectedValue(Object.assign(new Error("x"), { code: "ER_X" }));
    const { facts, failedSections } = await collectInsightFacts(ctxOf({ streams: [stream("s1", "r1")] }), ALL);
    expect(failedSections).toContain("insight:tomorrow");
    expect(facts.tomorrow).toEqual([]);
  });

  it("starts every statement from he_drive and reaches messages and insights only by key through a JOIN", async () => {
    await collectInsightFacts(ctxOf({ streams: [stream("s1", "r1")] }), ALL);
    const all = sqls().filter((s) => !s.sql.includes("he_model_param")); // the learned show-up parameters are a plain parameter read
    expect(all.length).toBeGreaterThanOrEqual(8); // the drive-tomorrow probe is gone (plans need an open stream)
    // drop parenthesised subselects (EXISTS (...) probes are keyed by lead_id), then the first FROM is the statement's start
    const strip = (s: string): string => { let p = s; let n = ""; while (p !== n) { n = p; p = p.replace(/\((?:[^()]*)\)/g, (m) => (/SELECT/i.test(m) ? "" : m.replace(/[()]/g, "#"))); } return p; };
    for (const s of all) {
      const top = strip(s.sql).replace(/\s+/g, " ");
      expect(top, s.kind).toMatch(/FROM he_drive d\b/);
      expect(top, s.kind).not.toMatch(/FROM he_message|FROM he_lead_insight|FROM he_lead /);
      expect(s.sql, s.kind).toContain("d.requisition_id IN");
    }
    for (const s of all.filter((x) => x.sql.includes("JOIN he_message o"))) expect(s.sql).toContain("o.lead_id = m.lead_id");
  });
});

describe("insights in getDriveAnalytics", () => {
  const ins: DriveInsight = {
    id: "under_target:all:r1:", rule: "under_target", severity: "warn", sourceType: null, requisitionId: "r1", title: "t", evidence: [], suggestion: "s", effect: null, action: { type: "none" },
  };
  const Q = { from: "2026-10-01", to: "2026-10-14" };
  const wire = (): void => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("FROM he_drive d WHERE d.drive_date BETWEEN")) return [[{ id: "r1", requisition_code: "REQ-1", designation_name: "Agent", branch_name: "Pune", last_drive: "2026-10-12" }]];
      return [[]];
    });
    loadActiveStreams.mockResolvedValue([]);
    getSources.mockImplementation(async (ids: string[]) => ({ byRequisition: ids.map((requisitionId) => ({ requisitionId, rows: [] })), partial: false, failedSections: [] }));
    thresholds.mockResolvedValue(T);
    evaluate.mockReturnValue([ins]);
    factsOverride.fn = async () => ({ facts: { today: "2026-10-14" }, failedSections: [] });
  };

  it("returns the insights from evaluateInsights and loads thresholds once per uncached call", async () => {
    wire();
    const a = (await getDriveAnalytics(Q, ALL, NOW)) as DriveAnalytics;
    expect(a.insights).toEqual([ins]);
    expect(a.partial).toBe(false);
    expect(thresholds).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledWith(expect.anything(), T);
    const b = (await getDriveAnalytics(Q, ALL, NOW)) as DriveAnalytics;
    expect(b.insights).toEqual([ins]);
    expect(thresholds).toHaveBeenCalledTimes(1); // cache hit
  });

  it("never lets a caller mutate the cached result", async () => {
    wire();
    const a = (await getDriveAnalytics(Q, ALL, NOW)) as DriveAnalytics;
    a.insights.push({ ...ins, id: "x" });
    a.types.he.stages.arrived = 999;
    const b = (await getDriveAnalytics(Q, ALL, NOW)) as DriveAnalytics;
    expect(b).not.toBe(a);
    expect(b.insights).toEqual([ins]);
    expect(b.types.he.stages.arrived).toBe(0);
  });

  it("gives empty insights, partial and a failed 'insights' section when the facts path throws", async () => {
    wire();
    factsOverride.fn = async () => { throw Object.assign(new Error("SELECT 9876543210"), { code: "ER_BOOM" }); };
    const a = (await getDriveAnalytics(Q, ALL, NOW)) as DriveAnalytics;
    expect(a.insights).toEqual([]);
    expect(a.partial).toBe(true);
    expect(a.failedSections).toContain("insights");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("9876543210");
    await getDriveAnalytics(Q, ALL, NOW);
    expect(thresholds).toHaveBeenCalledTimes(2); // partial results are not cached
  });

  it("carries the fact groups' failed sections into the response", async () => {
    wire();
    factsOverride.fn = async () => ({ facts: { today: "2026-10-14" }, failedSections: ["insight:language"] });
    const a = (await getDriveAnalytics(Q, ALL, NOW)) as DriveAnalytics;
    expect(a).toMatchObject({ partial: true, failedSections: ["insight:language"] });
    expect(a.insights).toEqual([ins]);
  });

  it("answers null for an unknown branch asked by an org-wide caller, and data for a known one", async () => {
    wire();
    const base = execute.getMockImplementation()!;
    let known = false;
    execute.mockImplementation(async (sql: string, p: unknown[]) => (String(sql).includes("FROM job_requisition WHERE branch_name") ? [known ? [{ 1: 1 }] : []] : base(sql, p)));
    expect(await getDriveAnalytics({ ...Q, branch: "Nowhere" }, ALL, NOW)).toBeNull();
    const probe = execute.mock.calls.find((c) => String(c[0]).includes("branch_name COLLATE utf8mb4_unicode_ci = ?"))!;
    expect(probe[1]).toEqual(["Nowhere"]);
    known = true;
    expect(await getDriveAnalytics({ ...Q, branch: "Pune" }, ALL, NOW)).toMatchObject({ requisitionCount: 1 });
  });

  it("continues when the branch probe fails", async () => {
    wire();
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, p: unknown[]) => { if (String(sql).includes("FROM job_requisition WHERE branch_name")) throw Object.assign(new Error("x"), { code: "ER_X" }); return base(sql, p); });
    const a = (await getDriveAnalytics({ ...Q, branch: "Pune" }, ALL, NOW)) as DriveAnalytics;
    expect(a.partial).toBe(false);
  });

  it("drops expired cache entries on every write", async () => {
    wire();
    vi.useFakeTimers({ now: NOW });
    try {
      await getDriveAnalytics({ from: "2026-10-01", to: "2026-10-10" }, ALL, NOW);
      await getDriveAnalytics({ from: "2026-10-02", to: "2026-10-10" }, ALL, NOW);
      expect(driveAnalyticsCacheSize()).toBe(2);
      vi.setSystemTime(new Date(NOW.getTime() + 61_000));
      await getDriveAnalytics({ from: "2026-10-03", to: "2026-10-10" }, ALL, NOW);
      expect(driveAnalyticsCacheSize()).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it("shares one in-flight build between concurrent calls with the same key, never across scopes", async () => {
    wire();
    const [a, b] = await Promise.all([getDriveAnalytics(Q, ALL, NOW), getDriveAnalytics(Q, ALL, NOW)]);
    expect(thresholds).toHaveBeenCalledTimes(1);
    expect(getSources).toHaveBeenCalledTimes(2); // current + previous period of ONE build
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // each caller gets its own copy
    clearDriveAnalyticsCache();
    thresholds.mockClear();
    await Promise.all([getDriveAnalytics(Q, ALL, NOW), getDriveAnalytics(Q, { all: false, branchName: "Pune" } as never, NOW)]);
    expect(thresholds).toHaveBeenCalledTimes(2);
  });

  it("concurrent callers share a partial result, which is still not cached", async () => {
    wire();
    factsOverride.fn = async () => { throw Object.assign(new Error("x"), { code: "ER_BOOM" }); };
    const [a, b] = await Promise.all([getDriveAnalytics(Q, ALL, NOW), getDriveAnalytics(Q, ALL, NOW)]);
    expect((a as DriveAnalytics).partial).toBe(true);
    expect((b as DriveAnalytics).partial).toBe(true);
    expect(thresholds).toHaveBeenCalledTimes(1);
    expect(driveAnalyticsCacheSize()).toBe(0);
    await getDriveAnalytics(Q, ALL, NOW);
    expect(thresholds).toHaveBeenCalledTimes(2); // the in-flight entry is gone and nothing was cached
  });

  it("skips the facts when there are no requisitions", async () => {
    wire();
    execute.mockImplementation(async () => [[]]);
    const factsFn = vi.fn();
    factsOverride.fn = factsFn;
    const a = (await getDriveAnalytics(Q, ALL, NOW)) as DriveAnalytics;
    expect(a.insights).toEqual([]);
    expect(factsFn).not.toHaveBeenCalled();
  });
});
