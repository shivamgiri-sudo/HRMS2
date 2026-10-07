import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
vi.mock("../../../logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { INSIGHT_DEFAULTS, evaluateInsights, effectText, type InsightFacts, type InsightThresholds, type RateFact } from "../he-drive-insights.js";
import { loadInsightThresholds } from "../he-insight-params.service.js";
import { SOURCE_TYPES, zeroStages } from "../he-drive-analytics.js";
import type { SourceType } from "../qualified-followup.types.js";

const t: InsightThresholds = { ...INSIGHT_DEFAULTS };
const R = (n = 0, hits = 0): RateFact => ({ n, hits });
const per = <T>(make: () => T): Record<SourceType, T> => ({ meta_live: make(), meta_old: make(), he: make() });
const baseFacts = (): InsightFacts => ({
  today: "2026-10-14", windowDays: 14,
  types: per(() => ({ current: zeroStages(), previous: zeroStages() })),
  tomorrow: [],
  contact: per(() => ({ inside: R(), outside: R() })),
  reminders: per(() => ({ confirmed: 0, missing: 0, withReminder: R(), withoutReminder: R() })),
  distance: per(() => ({ near: R(), far: R() })),
  channel: per(() => ({ qualified: 0, unreached: 0, reachedArrivalRate: 0, waFailedByCode: {}, waDelivered: 0, waUnread: 0 })),
  language: per(() => ({ hi: R(), other: R() })),
  slots: [], streams: [], sources: [], weekdays: [],
});
const mod = (fn: (f: InsightFacts) => void): InsightFacts => { const f = baseFacts(); fn(f); return f; };
const ofRule = (f: InsightFacts, rule: string, th = t) => evaluateInsights(f, th).filter((i) => i.rule === rule);
const noBad = (v: unknown) => { const j = JSON.stringify(v); expect(j).not.toContain("NaN"); expect(j).not.toContain("Infinity"); };

describe("effectText", () => {
  it.each([
    [6, "arrivals_per_day", "about +6 arrivals a day"], [2.5, "replies_per_day", "about +2.5 replies a day"], [12, "people", "about 12 people"],
    [4, "seats", "about 4 seats"], [0.1, "joins_per_day", "about +0.1 joins a day"], [1, "people", "about 1 person"],
  ] as const)("%s %s", (v, u, text) => expect(effectText(v, u)).toBe(text));
});

describe("empty and zero input", () => {
  it("returns nothing for baseFacts, no throw, no NaN", () => { const r = evaluateInsights(baseFacts(), t); expect(r).toEqual([]); noBad(r); });
  it("tolerates missing sections and garbage numbers", () => {
    const f = { today: "x", windowDays: 0 } as unknown as InsightFacts;
    expect(() => evaluateInsights(f, t)).not.toThrow();
    const g = mod((x) => { x.tomorrow = [{ requisitionId: "r", code: "C", date: "d", target: NaN, projected: Infinity, recommended: [] }]; x.windowDays = NaN; });
    expect(evaluateInsights(g, t)).toEqual([]);
  });
  it("min_sample 0 does not fire on zero denominators", () => {
    expect(evaluateInsights(baseFacts(), { ...t, "insight.min_sample": 0 })).toEqual([]);
  });
});

describe("under_target", () => {
  const row = (target: number, projected: number) => mod((f) => { f.tomorrow = [{ requisitionId: "r1", code: "R-1", date: "2026-10-15", target, projected, recommended: [{ streamId: "s1", sourceType: "meta_old", invites: 14 }] }]; });
  it("critical below half the target", () => {
    const [i] = ofRule(row(20, 8), "under_target");
    expect(i).toMatchObject({ id: "under_target:all:r1:", severity: "critical", action: { type: "open_plan", requisitionId: "r1", date: "2026-10-15" }, effect: { value: 12, unit: "arrivals_per_day", text: "about +12 arrivals a day" } });
    expect(i.suggestion).toContain("14 more invites from Old Meta data");
    expect(i.evidence).toEqual([{ label: "Target arrivals", value: "20" }, { label: "Projected arrivals", value: "8" }]);
  });
  it("warn between half and 90 percent", () => expect(ofRule(row(20, 15), "under_target")[0]).toMatchObject({ severity: "warn", effect: { value: 5 } }));
  it("fires just inside the margin: 17.9 of 20 is warn with effect 2.1 (M7)", () => {
    expect(ofRule(row(20, 17.9), "under_target")[0]).toMatchObject({ severity: "warn", effect: { value: 2.1, unit: "arrivals_per_day" } });
  });
  it("skips a row whose projected is not a finite number (M4)", () => {
    for (const p of [Number.NaN, Number.POSITIVE_INFINITY, undefined, null, "8"]) expect(ofRule(row(20, p as never), "under_target")).toEqual([]);
  });
  it("does not fire inside the margin or at target 0", () => {
    expect(ofRule(row(20, 18.5), "under_target")).toEqual([]);
    expect(ofRule(row(20, 18), "under_target")).toEqual([]);
    expect(ofRule(row(0, 0), "under_target")).toEqual([]);
  });
});

describe("window days evidence (M3)", () => {
  it("adds the days of the window to every per-day effect, but not to under_target", () => {
    const f = mod((x) => {
      x.windowDays = 28;
      x.types.he = { current: { ...zeroStages(), invited: 100, confirmed: 20 }, previous: { ...zeroStages(), invited: 100, confirmed: 60 } };
      x.tomorrow = [{ requisitionId: "r1", code: "R-1", date: "2026-10-15", target: 20, projected: 8, recommended: [] }];
    });
    const weak = ofRule(f, "weak_stage")[0];
    expect(weak.evidence).toContainEqual({ label: "Days in the window", value: "28" });
    expect(ofRule(f, "under_target")[0].evidence.map((e) => e.label)).not.toContain("Days in the window");
  });
});

describe("weak_stage", () => {
  const heFacts = (prevConfirmed: number) => mod((f) => {
    f.types.he.current = { ...zeroStages(), confirmed: 20, arrived: 4 };
    f.types.he.previous = { ...zeroStages(), confirmed: prevConfirmed, arrived: Math.round(prevConfirmed * 0.4) };
  });
  it("fires versus the previous period", () => {
    const [i] = ofRule(heFacts(30), "weak_stage");
    expect(i).toMatchObject({ id: "weak_stage:he:all:confirmed_arrived", severity: "warn", sourceType: "he", action: { type: "open_section", section: "he" }, effect: { value: 0.3, unit: "arrivals_per_day" } });
    expect(i.evidence.map((e) => e.value)).toEqual(["20%", "40%", "20", "14"]);
  });
  it("needs previous denominator >= min", () => expect(ofRule(heFacts(19), "weak_stage")).toEqual([]));
  it("fires versus the best other source with replies unit", () => {
    const f = mod((x) => {
      x.types.meta_live.current = { ...zeroStages(), invited: 40, confirmed: 24 };
      x.types.meta_old.current = { ...zeroStages(), invited: 40, confirmed: 10 };
    });
    const r = ofRule(f, "weak_stage");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "weak_stage:meta_old:all:invited_confirmed", effect: { unit: "replies_per_day", value: 1 }, action: { section: "old" } });
  });
  it("does not fire exactly at the margin or with no data", () => {
    const f = mod((x) => { x.types.he.current = { ...zeroStages(), confirmed: 20, arrived: 8 }; x.types.he.previous = { ...zeroStages(), confirmed: 30, arrived: 15 }; });
    expect(ofRule(f, "weak_stage")).toEqual([]);
  });
});

describe("contact_timing", () => {
  const mkf = (inside: RateFact, outside: RateFact) => mod((f) => { f.contact.he = { inside, outside }; });
  it("fires", () => expect(ofRule(mkf(R(20, 10), R(40, 8)), "contact_timing")[0]).toMatchObject({ id: "contact_timing:he:all:", action: { type: "none" }, effect: { value: 0.9, unit: "replies_per_day" } }));
  it.each([
    ["outside share at the limit", R(40, 20), R(40, 8)], ["inside not better", R(20, 4), R(40, 8)], ["inside below min", R(19, 10), R(60, 8)], ["zero", R(), R()],
  ])("does not fire: %s", (_n, a, b) => expect(ofRule(mkf(a, b), "contact_timing")).toEqual([]));
});

describe("reminder_gap", () => {
  const mkf = (missing: number, w: RateFact, wo: RateFact) => mod((f) => { f.reminders.meta_live = { confirmed: 50, missing, withReminder: w, withoutReminder: wo }; });
  it("fires with null effect when the without sample is small", () => {
    const [i] = ofRule(mkf(15, R(35, 21), R(15, 3)), "reminder_gap");
    expect(i).toMatchObject({ id: "reminder_gap:meta_live:all:", effect: null, action: { type: "open_followup" } });
  });
  it("fires with effect", () => expect(ofRule(mkf(15, R(35, 21), R(25, 5)), "reminder_gap")[0].effect).toMatchObject({ value: 0.4, unit: "arrivals_per_day" }));
  it("does not fire at 20 percent or with zero confirmed", () => {
    expect(ofRule(mkf(10, R(35, 21), R(25, 5)), "reminder_gap")).toEqual([]);
    expect(ofRule(baseFacts(), "reminder_gap")).toEqual([]);
  });
});

describe("distance", () => {
  const mkf = (far: RateFact) => mod((f) => { f.distance.he = { near: R(40, 20), far }; });
  it("fires", () => {
    const [i] = ofRule(mkf(R(25, 5)), "distance");
    expect(i).toMatchObject({ id: "distance:he:all:", action: { type: "open_section", section: "he" }, effect: { value: 0.5, unit: "arrivals_per_day" } });
    expect(i.evidence[0].label).toContain("15 km");
  });
  it("does not fire at the gap, small far sample or zero", () => {
    expect(ofRule(mkf(R(20, 7)), "distance")).toEqual([]);
    expect(ofRule(mkf(R(19, 1)), "distance")).toEqual([]);
    expect(ofRule(baseFacts(), "distance")).toEqual([]);
  });
});

describe("channel_gap", () => {
  const ch = (o: Partial<InsightFacts["channel"]["he"]>) => mod((f) => { f.channel.he = { ...f.channel.he, ...o }; });
  it("unreached form", () => expect(ofRule(ch({ qualified: 100, unreached: 30, reachedArrivalRate: 0.1 }), "channel_gap")[0]).toMatchObject({ id: "channel_gap:he:all:", effect: { value: 0.2, unit: "arrivals_per_day" } }));
  it("error code form: one per code at or above the minimum", () => {
    const r = ofRule(ch({ waFailedByCode: { "132018": 12, "131026": 3 } }), "channel_gap");
    expect(r).toHaveLength(1);
    expect(r[0].id.endsWith(":132018")).toBe(true);
    expect(r[0]).toMatchObject({ effect: { value: 12, unit: "people" } });
    expect(r[0].evidence).toEqual([{ label: "Meta error 132018", value: "12" }]);
  });
  it("unread form has no effect", () => expect(ofRule(ch({ waDelivered: 40, waUnread: 30 }), "channel_gap")[0]).toMatchObject({ id: "channel_gap:he:all:unread", effect: null }));
  it("does not fire at the limits or on zero", () => {
    expect(ofRule(ch({ qualified: 100, unreached: 20 }), "channel_gap")).toEqual([]);
    expect(ofRule(ch({ qualified: 10, unreached: 9 }), "channel_gap")).toEqual([]);
    expect(ofRule(ch({ waFailedByCode: { "1": 9 } }), "channel_gap")).toEqual([]);
    expect(ofRule(ch({ waDelivered: 40, waUnread: 20 }), "channel_gap")).toEqual([]);
    expect(ofRule(baseFacts(), "channel_gap")).toEqual([]);
  });
});

describe("language", () => {
  const mkf = (hi: RateFact, other: RateFact) => mod((f) => { f.language.he = { hi, other }; });
  it("fires as info", () => {
    const [i] = ofRule(mkf(R(30, 3), R(60, 30)), "language");
    expect(i).toMatchObject({ id: "language:he:all:", severity: "info", action: { type: "none" }, effect: { value: 0.9, unit: "replies_per_day" } });
    expect(i.suggestion).toBe("Only English templates are approved; ask Meta to approve Hindi versions");
  });
  it("does not fire at the gap or with a small sample", () => {
    expect(ofRule(mkf(R(30, 3), R(60, 12)), "language")).toEqual([]);
    expect(ofRule(mkf(R(10, 0), R(60, 30)), "language")).toEqual([]);
  });
});

describe("overbooking", () => {
  const slot = (o: Partial<InsightFacts["slots"][number]>) => mod((f) => { f.slots = [{ driveId: "d1", requisitionId: "r1", code: "R-1", date: "2026-10-15", capacity: 60, expected: 50, busyHourSeats: 0, busyHourBooked: 0, ...o }]; });
  it("overbooked", () => expect(ofRule(slot({ expected: 70 }), "overbooking")[0]).toMatchObject({ id: "overbooking:all:r1:d1", effect: { value: 10, unit: "seats" }, action: { type: "open_plan", requisitionId: "r1", date: "2026-10-15" } }));
  it("empty busy slots", () => {
    const [i] = ofRule(slot({ busyHourSeats: 18, busyHourBooked: 6 }), "overbooking");
    expect(i).toMatchObject({ id: "overbooking:all:r1:d1/empty", effect: { value: 12, unit: "seats" } });
    expect(i.title).toContain("empty busy slots");
  });
  it("empty busy slots only for the next working day's drive (people are lined up the evening before)", () => {
    expect(ofRule(slot({ date: "2026-10-17", busyHourSeats: 18, busyHourBooked: 6 }), "overbooking")).toEqual([]); // 3 days ahead
    expect(ofRule(slot({ date: "2026-10-14", busyHourSeats: 18, busyHourBooked: 6 }), "overbooking")).toHaveLength(1); // today
    const sat = (date: string) => mod((f) => { f.today = "2026-10-17"; f.slots = [{ driveId: "d1", requisitionId: "r1", code: "R-1", date, capacity: 60, expected: 50, busyHourSeats: 18, busyHourBooked: 6 }]; });
    expect(ofRule(sat("2026-10-19"), "overbooking")).toHaveLength(1); // Saturday: Monday is the next working day
    expect(ofRule(sat("2026-10-20"), "overbooking")).toEqual([]);
    expect(ofRule(slot({ date: "2026-10-17", expected: 70 }), "overbooking")).toHaveLength(1); // overbooking itself is not date-gated
  });
  it("does not fire inside margins or on zeros", () => {
    expect(ofRule(slot({ expected: 66 }), "overbooking")).toEqual([]);
    expect(ofRule(slot({ busyHourSeats: 20, busyHourBooked: 10 }), "overbooking")).toEqual([]);
    expect(ofRule(slot({ capacity: 0, expected: 0 }), "overbooking")).toEqual([]);
  });
});

describe("stream_dry", () => {
  const st = (sourceType: SourceType, poolRemaining: number | null) => mod((f) => { f.streams = [{ streamId: "s1", requisitionId: "r1", code: "R-1", sourceType, cap: 15, remainingDays: 3, poolRemaining }]; });
  it("warn with create_stream for a live stream", () => expect(ofRule(st("meta_live", 20), "stream_dry")[0]).toMatchObject({ id: "stream_dry:meta_live:r1:s1", severity: "warn", effect: { value: 25, unit: "people" }, action: { type: "create_stream", requisitionId: "r1", sourceType: "meta_old" } }));
  it("critical below one day, extend for meta_old", () => expect(ofRule(st("meta_old", 10), "stream_dry")[0]).toMatchObject({ severity: "critical", action: { type: "extend_stream", streamId: "s1", requisitionId: "r1" } }));
  it("nothing for null pool, enough pool or zero cap", () => {
    expect(ofRule(st("he", null), "stream_dry")).toEqual([]);
    expect(ofRule(st("he", 45), "stream_dry")).toEqual([]);
    expect(ofRule(mod((f) => { f.streams = [{ streamId: "s", requisitionId: "r", code: "c", sourceType: "he", cap: 0, remainingDays: 0, poolRemaining: 0 }]; }), "stream_dry")).toEqual([]);
  });
});

describe("best_source", () => {
  const src = (live: { leads: number; joined: number; invited: number }, he: { leads: number; joined: number; invited: number }) => mod((f) => { f.sources = [{ requisitionId: "r1", code: "R-1", byType: { meta_live: live, he } }]; });
  it("fires", () => {
    const [i] = ofRule(src({ leads: 100, joined: 5, invited: 30 }, { leads: 100, joined: 2, invited: 90 }), "best_source");
    expect(i).toMatchObject({ id: "best_source:meta_live:r1:", severity: "info", effect: { value: 0.1, unit: "joins_per_day" }, action: { type: "open_plan", requisitionId: "r1", date: "2026-10-15" } });
    expect(i.evidence).toContainEqual({ label: "Share of invites", value: "25%" });
    expect(i.evidence).toContainEqual({ label: "Shift assumed", value: "20%" });
  });
  it("does not fire: share high, lift small, one type, small sample, no invites", () => {
    expect(ofRule(src({ leads: 100, joined: 5, invited: 100 }, { leads: 100, joined: 2, invited: 20 }), "best_source")).toEqual([]);
    expect(ofRule(src({ leads: 100, joined: 5, invited: 30 }, { leads: 100, joined: 4, invited: 90 }), "best_source")).toEqual([]);
    expect(ofRule(src({ leads: 100, joined: 5, invited: 30 }, { leads: 19, joined: 0, invited: 90 }), "best_source")).toEqual([]);
    expect(ofRule(src({ leads: 100, joined: 5, invited: 0 }, { leads: 100, joined: 2, invited: 0 }), "best_source")).toEqual([]);
    expect(ofRule(mod((f) => { f.sources = [{ requisitionId: "r", code: "c", byType: {} }]; }), "best_source")).toEqual([]);
  });
});

describe("weekday", () => {
  const wd = (tue: { confirmed: number; arrived: number }) => mod((f) => { f.weekdays = [{ weekday: 0, confirmed: 45, arrived: 15 }, { weekday: 1, ...tue }, { weekday: 2, confirmed: 45, arrived: 15 }]; });
  it("fires on the best day", () => {
    const [i] = ofRule(wd({ confirmed: 30, arrived: 18 }), "weekday");
    expect(i).toMatchObject({ id: "weekday:all:all:1", severity: "info", action: { type: "none" } });
    expect(i.evidence[0]).toEqual({ label: "Tuesday arrival rate", value: "60%" });
    expect(i.effect?.unit).toBe("arrivals_per_day");
  });
  it("does not fire without lift, below min, or empty", () => {
    expect(ofRule(wd({ confirmed: 30, arrived: 11 }), "weekday")).toEqual([]);
    expect(ofRule(wd({ confirmed: 19, arrived: 19 }), "weekday")).toEqual([]);
    expect(ofRule(baseFacts(), "weekday")).toEqual([]);
  });
});

describe("ranking and cap", () => {
  it("critical first, warn by effect desc, info last, ties by id", () => {
    const f = mod((x) => {
      x.tomorrow = [{ requisitionId: "r1", code: "A", date: "d", target: 20, projected: 8, recommended: [] }, { requisitionId: "r2", code: "B", date: "d", target: 20, projected: 15, recommended: [] }];
      x.streams = [{ streamId: "s1", requisitionId: "r3", code: "C", sourceType: "he", cap: 15, remainingDays: 3, poolRemaining: 20 }];
      x.language.he = { hi: R(30, 3), other: R(60, 30) };
    });
    expect(evaluateInsights(f, t).map((i) => `${i.severity}:${i.id}`)).toEqual([
      "critical:under_target:all:r1:", "warn:stream_dry:he:r3:s1", "warn:under_target:all:r2:", "info:language:he:all:",
    ]);
  });
  it("is deterministic regardless of input order and ties break by id", () => {
    const rows = ["b", "a", "c"].map((id) => ({ requisitionId: id, code: id, date: "d", target: 20, projected: 8, recommended: [] }));
    const a = evaluateInsights(mod((x) => { x.tomorrow = rows; }), t), b = evaluateInsights(mod((x) => { x.tomorrow = [...rows].reverse(); }), t);
    expect(a.map((i) => i.id)).toEqual(["under_target:all:a:", "under_target:all:b:", "under_target:all:c:"]);
    expect(b).toEqual(a);
  });
  it("caps at 20 and never emits NaN", () => {
    const f = mod((x) => { x.tomorrow = Array.from({ length: 25 }, (_, i) => ({ requisitionId: `r${i}`, code: `R${i}`, date: "d", target: 20, projected: 8, recommended: [] })); });
    const r = evaluateInsights(f, t);
    expect(r).toHaveLength(20);
    noBad(r);
    expect(new Set(r.map((i) => i.id)).size).toBe(20);
  });
  it("contains no 10-digit numbers", () => {
    const f = mod((x) => { x.tomorrow = [{ requisitionId: "r1", code: "R-1", date: "2026-10-15", target: 20, projected: 8, recommended: [] }]; x.channel.he.waFailedByCode = { "132018": 12 }; });
    expect(JSON.stringify(evaluateInsights(f, t))).not.toMatch(/\d{10}/);
  });
  it("covers all three source types in SOURCE_TYPES", () => expect(SOURCE_TYPES).toHaveLength(3));
});

describe("loadInsightThresholds", () => {
  beforeEach(() => execute.mockReset());
  it("applies valid rows, keeps defaults for bad or unknown ones", async () => {
    execute.mockResolvedValue([[
      { param_key: "insight.min_sample", value: "30" }, { param_key: "insight.distance_band_km", value: "-4" }, { param_key: "insight.weak_stage_margin", value: "abc" },
      { param_key: "insight.distance_gap", value: "1001" }, { param_key: "insight.unknown", value: "5" }, { param_key: "insight.wa_fail_min", value: null }, { param_key: "insight.weekday_lift", value: "0.2" },
    ]]);
    const r = await loadInsightThresholds();
    expect(r).toEqual({ ...INSIGHT_DEFAULTS, "insight.min_sample": 30, "insight.weekday_lift": 0.2 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(String(execute.mock.calls[0][0])).toBe("SELECT param_key, value FROM he_model_param WHERE param_key LIKE 'insight.%'");
  });
  it("trims, and rejects empty strings and non-decimal formats before Number() (M5)", async () => {
    execute.mockResolvedValue([[
      { param_key: "insight.min_sample", value: " 30 " }, { param_key: "insight.weekday_lift", value: "   " }, { param_key: "insight.wa_fail_min", value: "0x10" },
      { param_key: "insight.distance_gap", value: "1e2" }, { param_key: "insight.language_gap", value: "0.25" }, { param_key: "insight.weak_stage_margin", value: "Infinity" },
      { param_key: "insight.empty_slot_share", value: "1_0" }, { param_key: "insight.overbook_margin", value: "+0.5" },
    ]]);
    expect(await loadInsightThresholds()).toEqual({ ...INSIGHT_DEFAULTS, "insight.min_sample": 30, "insight.language_gap": 0.25 });
  });
  it("defaults when the query rejects (missing table) and on empty rows", async () => {
    execute.mockRejectedValueOnce(Object.assign(new Error("secret driver text"), { code: "ER_NO_SUCH_TABLE" }));
    expect(await loadInsightThresholds()).toEqual({ ...INSIGHT_DEFAULTS });
    execute.mockResolvedValueOnce([[]]);
    expect(await loadInsightThresholds()).toEqual({ ...INSIGHT_DEFAULTS });
  });
});
