import { describe, expect, it } from "vitest";
import { buildCalendar, datesBetween, weekdayOf } from "../fc.calendar.js";
import { MIN_HISTORY_DAYS, forecastKpi, linearFit, monthDays, mulberry32, percentile, type DailyPoint, type ForecastInput, type KpiSpec } from "../fc.engine.js";

const PATTERN: Record<number, number> = { 1: 100, 2: 120, 3: 110, 4: 90, 5: 80 }; // Mon..Fri
const workdays = (from: string, to: string, days = [1, 2, 3, 4, 5]) => datesBetween(from, to).filter((d) => days.includes(weekdayOf(d)));
const add = (key = "sales_count", target: number | null = null, direction: "higher" | "lower" = "higher"): KpiSpec => ({ key, label: key, unit: "count", direction, kind: "additive", target });
const rate = (key = "utilization", target: number | null = null, direction: "higher" | "lower" = "higher", unit = "percent"): KpiSpec => ({ key, label: key, unit, direction, kind: "rate", target });

function mk(o: { month?: string; cutoff: string; spec: KpiSpec; from?: string; value?: (d: string) => number | null; holidays?: string[]; mtdValue?: number | null; partial?: ForecastInput["partial"]; days?: number[]; withPath?: boolean }): ForecastInput {
  const month = o.month ?? o.cutoff.slice(0, 7);
  const first = `${month}-01`; const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).toISOString().slice(0, 10);
  const from = o.from ?? "2026-07-01";
  const dates = workdays(from, o.cutoff, o.days);
  const cal = buildCalendar({ cutoff: o.cutoff, workedDates: new Set(dates), holidays: o.holidays ?? [] });
  const value = o.value ?? ((d: string) => PATTERN[weekdayOf(d)] ?? 60);
  const daily: DailyPoint[] = dates.map((d) => ({ date: d, value: value(d) }));
  return { month, monthFirst: first, monthLast: last, cutoff: o.cutoff, calendar: cal, spec: o.spec, daily, mtdValue: o.mtdValue, partial: o.partial, withPath: o.withPath };
}

describe("numeric helpers", () => {
  it("percentile interpolates", () => { expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3); expect(percentile([0, 10], 0.25)).toBe(2.5); });
  it("linearFit recovers a line", () => { const f = linearFit([1, 3, 5, 7])!; expect(f.a).toBeCloseTo(1); expect(f.b).toBeCloseTo(2); expect(linearFit([4])).toBeNull(); });
  it("mulberry32 is deterministic and in [0,1)", () => { const a = mulberry32(7), b = mulberry32(7); for (let i = 0; i < 20; i++) { const x = a(); expect(x).toBe(b()); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); } });
});

describe("additive: weekday seasonality", () => {
  // 2026-09-16 is a Wednesday; September 2026 starts on a Tuesday.
  const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: add() }));
  it("mtd is the sum of the completed working days (Tue..Wed)", () => { expect(r.mtd).toBe(1230); expect(r.daysElapsed).toBe(12); });
  it("projects each remaining day at its own weekday mean, not a flat run rate", () => {
    expect(r.daysRemaining).toBe(10);
    expect(r.projected).toBe(2230); // 1230 + 90+80 + 500 + 330
    expect(r.method).toBe("weekday-seasonal-run-rate");
    const flat = (1230 / 12) * 22; expect(r.projected).not.toBeCloseTo(flat, 0);
  });
  it("zero-variance history gives a zero-width band", () => { expect(r.band).toEqual({ low: 2230, high: 2230, level: 0.8 }); });
  it("no target: status no_target, projection still present, no required rate", () => {
    expect(r.status).toBe("no_target"); expect(r.target).toBeNull(); expect(r.pacingPct).toBeNull(); expect(r.requiredDailyRate).toBeNull();
  });
  it("is deterministic", () => { expect(forecastKpi(mk({ cutoff: "2026-09-16", spec: add(), value: (d) => 100 + (d.charCodeAt(9) % 7) * 10 }))).toEqual(forecastKpi(mk({ cutoff: "2026-09-16", spec: add(), value: (d) => 100 + (d.charCodeAt(9) % 7) * 10 }))); });
  it("uses only the most recent 8 same-weekday observations", () => {
    // Mondays before 2026-07-27 were 1000, recent 8 Mondays 100 -> window of 8 weeks from 2026-07-22 means older ones are simply absent; emulate with a long history.
    const r2 = forecastKpi(mk({ cutoff: "2026-09-16", from: "2026-04-01", spec: add(), value: (d) => (weekdayOf(d) === 1 ? (d < "2026-07-20" ? 1000 : 100) : PATTERN[weekdayOf(d)]) }));
    expect(r2.expectedDaily).toBeLessThan(200);
    expect(r2.projected).toBe(r2.mtd! + 90 + 80 + 500 + 330);
  });
});

describe("additive: variance band", () => {
  const noisy = (d: string) => (PATTERN[weekdayOf(d)] ?? 0) + ((d.charCodeAt(9) * 7 + d.charCodeAt(8)) % 21) - 10;
  const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: add(), value: noisy }));
  it("band brackets the projection and is non-degenerate", () => { expect(r.band!.low).toBeLessThan(r.projected!); expect(r.band!.high).toBeGreaterThan(r.projected!); expect(r.band!.low).toBeGreaterThanOrEqual(r.mtd!); });
  it("more noise gives a wider band", () => {
    const wide = forecastKpi(mk({ cutoff: "2026-09-16", spec: add(), value: (d) => noisy(d) * (d.charCodeAt(9) % 2 ? 3 : 0.2) }));
    expect(wide.band!.high - wide.band!.low).toBeGreaterThan(r.band!.high - r.band!.low);
  });
  it("band never dips below month-to-date even when residuals are huge", () => {
    const w = forecastKpi(mk({ cutoff: "2026-09-16", spec: add(), value: (d) => (d.charCodeAt(9) % 2 ? 1000 : 0) }));
    expect(w.band!.low).toBeGreaterThanOrEqual(w.mtd!);
  });
});

describe("additive: month boundaries", () => {
  it("cutoff on the last day: projection equals the actual, nothing remaining", () => {
    const r = forecastKpi(mk({ cutoff: "2026-09-30", spec: add("sales_count", 1800) }));
    expect(r.daysRemaining).toBe(0); expect(r.projected).toBe(r.mtd); expect(r.method).toBe("actual"); expect(r.band).toEqual({ low: r.mtd, high: r.mtd, level: 0.8 });
    expect(r.requiredDailyRate).toBeNull();
  });
  it("closed month vs target: on_track or off_track only", () => {
    const hit = forecastKpi(mk({ cutoff: "2026-09-30", spec: add("sales_count", 1000) }));
    const miss = forecastKpi(mk({ cutoff: "2026-09-30", spec: add("sales_count", 999999) }));
    expect(hit.status).toBe("on_track"); expect(miss.status).toBe("off_track");
  });
  it("first day of the month (cutoff = last day of previous month): mtd 0 is real, projection comes from the prior month's pattern", () => {
    const r = forecastKpi(mk({ month: "2026-10", cutoff: "2026-09-30", spec: add() }));
    expect(r.mtd).toBe(0); expect(r.daysElapsed).toBe(0); expect(r.daysRemaining).toBe(22); // Oct 2026: 22 weekdays
    expect(r.projected).toBeGreaterThan(0); expect(r.status).toBe("no_target");
  });
  it("year boundary: December cutoff, January month", () => {
    const r = forecastKpi(mk({ month: "2027-01", cutoff: "2026-12-31", from: "2026-11-01", spec: add() }));
    expect(r.daysElapsed).toBe(0); expect(r.daysRemaining).toBe(21);
  });
  it("leap February: 29 days counted, Feb 29 2028 (Tuesday) is a working day", () => {
    const days = monthDays({ monthFirst: "2028-02-01", monthLast: "2028-02-29", cutoff: "2028-02-10", calendar: mk({ cutoff: "2028-02-10", from: "2027-12-20", spec: add() }).calendar });
    expect(days.elapsed).toHaveLength(8); expect(days.remaining).toHaveLength(13); expect(days.remaining).toContain("2028-02-29");
    const nonLeap = monthDays({ monthFirst: "2026-02-01", monthLast: "2026-02-28", cutoff: "2026-02-10", calendar: mk({ cutoff: "2026-02-10", from: "2025-12-20", spec: add() }).calendar });
    expect(nonLeap.elapsed.length + nonLeap.remaining.length).toBe(20);
  });
  it("a holiday among the remaining days removes it from the projection", () => {
    const base = forecastKpi(mk({ cutoff: "2026-09-16", spec: add() }));
    const hol = forecastKpi(mk({ cutoff: "2026-09-16", spec: add(), holidays: ["2026-09-21"] })); // a Monday
    expect(hol.daysRemaining).toBe(base.daysRemaining - 1); expect(hol.projected).toBe(base.projected! - 100);
  });
  it("a Mon-Sat process projects Saturdays", () => {
    const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: add(), days: [1, 2, 3, 4, 5, 6], value: (d) => PATTERN[weekdayOf(d)] ?? 40 }));
    expect(r.daysRemaining).toBe(12); // 10 weekdays + Sat 19 + Sat 26
    expect(r.projected).toBe(r.mtd! + 90 + 80 + 40 + 500 + 40 + 330);
  });
});

describe("additive: partial (today) data", () => {
  const cutoff = "2026-09-16";
  const base = forecastKpi(mk({ cutoff, spec: add() }));
  it("today's partial value never changes month-to-date", () => {
    const r = forecastKpi(mk({ cutoff, spec: add(), partial: { date: "2026-09-17", value: 30 } }));
    expect(r.mtd).toBe(base.mtd); expect(r.partial).toEqual({ date: "2026-09-17", value: 30 });
  });
  it("a partial below today's expectation is ignored (the day is projected in full, not extrapolated)", () => {
    expect(forecastKpi(mk({ cutoff, spec: add(), partial: { date: "2026-09-17", value: 30 } })).projected).toBe(base.projected);
  });
  it("a partial already above expectation is a floor for that day", () => {
    const r = forecastKpi(mk({ cutoff, spec: add(), partial: { date: "2026-09-17", value: 150 } })); // Thursday expectation is 90
    expect(r.projected).toBe(base.projected! + 60);
  });
  it("a null partial is ignored", () => { expect(forecastKpi(mk({ cutoff, spec: add(), partial: { date: "2026-09-17", value: null } })).projected).toBe(base.projected); });
});

describe("additive: no data rather than a guess", () => {
  it(`fewer than ${MIN_HISTORY_DAYS} worked days of history`, () => {
    const r = forecastKpi(mk({ cutoff: "2026-09-16", from: "2026-09-10", spec: add("sales_count", 500) }));
    expect(r.status).toBe("nodata"); expect(r.projected).toBeNull(); expect(r.band).toBeNull(); expect(r.reason).toMatch(/history/); expect(r.method).toBe("insufficient-history");
    expect(r.requiredDailyRate).not.toBeNull(); // a pure arithmetic fact, not a forecast
  });
  it("all-zero history", () => {
    const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: add(), value: () => 0 }));
    expect(r.status).toBe("nodata"); expect(r.projected).toBeNull(); expect(r.reason).toMatch(/zero/);
  });
  it("all-null history (field never populated)", () => {
    const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: add(), value: () => null }));
    expect(r.status).toBe("nodata"); expect(r.mtd).toBeNull(); expect(r.projected).toBeNull();
  });
  it("no rows at all in a closed month", () => {
    const r = forecastKpi(mk({ month: "2026-05", cutoff: "2026-05-31", from: "2026-06-01", spec: add() }));
    expect(r.status).toBe("nodata"); expect(r.projected).toBeNull();
  });
});

describe("additive: target pacing", () => {
  const at = (target: number, extra: Partial<Parameters<typeof mk>[0]> = {}) => forecastKpi(mk({ cutoff: "2026-09-16", spec: add("sales_count", target), ...extra }));
  it("on_track when the projection meets the target", () => { const r = at(2000); expect(r.status).toBe("on_track"); expect(r.pacingPct).toBe(111.5); expect(r.requiredDailyRate).toBe(77); });
  it("requiredDailyRate is (target - mtd) / remaining days", () => { expect(at(2230).requiredDailyRate).toBe(100); expect(at(1000).requiredDailyRate).toBe(0); });
  it("at_risk when only the upper band reaches the target", () => {
    const noisy = (d: string) => (PATTERN[weekdayOf(d)] ?? 0) + ((d.charCodeAt(9) * 7 + d.charCodeAt(8)) % 41) - 20;
    const probe = at(1, { value: noisy });
    const target = Math.round((probe.projected! + probe.band!.high) / 2);
    expect(at(target, { value: noisy }).status).toBe("at_risk");
  });
  it("off_track when even the upper band falls short", () => { const r = at(3000); expect(r.status).toBe("off_track"); expect(r.pacingPct).toBe(74.3); });
  it("lower-is-better additive: mirrored", () => {
    const low = forecastKpi(mk({ cutoff: "2026-09-16", spec: add("abandoned", 3000, "lower") })); // projected 2230 <= 3000
    const high = forecastKpi(mk({ cutoff: "2026-09-16", spec: add("abandoned", 1500, "lower") }));
    expect(low.status).toBe("on_track"); expect(high.status).toBe("off_track");
  });
  it("a zero target gives no pacing percentage, never Infinity", () => { expect(at(0).pacingPct).toBeNull(); });
  it("a target with no history stays nodata but keeps the arithmetic required rate", () => { const r = at(1000, { from: "2026-09-12" }); expect(r.status).toBe("nodata"); });
});

describe("additive: path", () => {
  const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: add(), withPath: true }));
  it("actuals are cumulative, projection continues from the last actual and lands on the projected total", () => {
    const p = r.path!; expect(r.pathKind).toBe("cumulative");
    const last = p.filter((x) => x.actual !== null).pop()!; expect(last.actual).toBe(1230); expect(last.projected).toBe(1230);
    expect(p[p.length - 1].projected).toBe(r.projected); expect(p[p.length - 1].date).toBe("2026-09-30");
    expect(p.filter((x) => x.actual !== null)).toHaveLength(12); expect(p.filter((x) => x.actual === null)).toHaveLength(10);
  });
});

describe("rate KPIs", () => {
  const flat = (v: number) => () => v;
  it("flat history: projection stays at that level and the required average is exact", () => {
    const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("utilization", 80), value: flat(70), mtdValue: 70 }));
    expect(r.projected).toBe(70); expect(r.method).toBe("linear-trend"); expect(r.mtd).toBe(70);
    // (80*22 - 70*12) / 10 = 92
    expect(r.requiredDailyRate).toBe(92); expect(r.daysElapsed).toBe(12); expect(r.daysRemaining).toBe(10);
  });
  it("rising trend projects above month-to-date, clamped to the recent best day and to 100%", () => {
    const up = (d: string) => 60 + Math.floor((Date.parse(d) - Date.parse("2026-07-01")) / 86400000) * 0.5;
    const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("utilization", null), value: (d) => Math.min(99, up(d)), mtdValue: 88 }));
    expect(r.projected!).toBeGreaterThan(88); expect(r.projected!).toBeLessThanOrEqual(100);
    expect(r.status).toBe("no_target");
  });
  it("falling trend cannot forecast a day below the worst recent day", () => {
    const vals = workdays("2026-07-01", "2026-09-16");
    const down = (d: string) => 90 - vals.indexOf(d) * 0.8;
    const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("utilization", null), value: down, mtdValue: 50, withPath: true }));
    const floor = Math.min(...vals.slice(-14).map(down));
    for (const p of r.path!.filter((x) => x.actual === null)) { expect(p.projected!).toBeGreaterThanOrEqual(Math.floor(floor * 100) / 100); expect(p.low!).toBeGreaterThanOrEqual(0); }
  });
  it("on_track when the projected month-end meets the target", () => {
    expect(forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("utilization", 65), value: flat(70), mtdValue: 70 })).status).toBe("on_track");
  });
  it("at_risk when the required average is reachable (within the best decile of recent days)", () => {
    const v = (d: string) => 60 + (d.charCodeAt(9) % 5) * 5; // 60..80
    const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("utilization", 73), value: v, mtdValue: 68 }));
    expect(r.projected!).toBeLessThan(73); expect(r.requiredDailyRate!).toBeLessThanOrEqual(80); expect(r.status).toBe("at_risk");
  });
  it("off_track when the required average is beyond anything recently achieved", () => {
    const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("utilization", 90), value: flat(70), mtdValue: 70 }));
    expect(r.status).toBe("off_track"); expect(r.requiredDailyRate).toBeGreaterThan(100);
  });
  it("lower-is-better (AHT): required average is an upper bound; meeting it is on_track", () => {
    const ok = forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("aht", 320, "lower", "seconds"), value: flat(300), mtdValue: 300 }));
    const bad = forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("aht", 250, "lower", "seconds"), value: flat(300), mtdValue: 300 }));
    expect(ok.status).toBe("on_track"); expect(bad.status).toBe("off_track"); expect(bad.requiredDailyRate).toBe(190);
  });
  it("required average: 0 when already secured (higher), null when unreachable (lower)", () => {
    expect(forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("utilization", 10), value: flat(70), mtdValue: 70 })).requiredDailyRate).toBe(0);
    expect(forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("aht", 100, "lower", "seconds"), value: flat(600), mtdValue: 600 })).requiredDailyRate).toBeNull();
  });
  it("closed month: final value versus target", () => {
    expect(forecastKpi(mk({ cutoff: "2026-09-30", spec: rate("utilization", 70), value: flat(75), mtdValue: 75 })).status).toBe("on_track");
    expect(forecastKpi(mk({ cutoff: "2026-09-30", spec: rate("utilization", 80), value: flat(75), mtdValue: 75 })).status).toBe("off_track");
  });
  it("too few days with a value (sparse QA) is nodata", () => {
    const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("qa_score", 90), value: (d) => (d.endsWith("05") || d.endsWith("12") ? 88 : null), mtdValue: 88 }));
    expect(r.status).toBe("nodata"); expect(r.projected).toBeNull();
  });
  it("7-9 valued days project a flat mean (no line is fitted to so few points); 10+ fit a trend", () => {
    const few = forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("utilization", null), value: (d) => (d >= "2026-09-07" ? 70 : null), mtdValue: 70 }));
    expect(few.method).toBe("flat-mean"); expect(few.projected).toBe(70);
    expect(forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("utilization", null), value: flat(70), mtdValue: 70 })).method).toBe("linear-trend");
  });
  it("zero-variance rate history gives a zero-width band", () => {
    const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("utilization", 60), value: flat(70), mtdValue: 70 }));
    expect(r.band).toEqual({ low: 70, high: 70, level: 0.8 });
  });
  it("path is per-day with actuals then projection and a band", () => {
    const r = forecastKpi(mk({ cutoff: "2026-09-16", spec: rate("utilization", 60), value: (d) => 70 + (d.charCodeAt(9) % 5), mtdValue: 72, withPath: true }));
    expect(r.pathKind).toBe("daily"); const p = r.path!;
    expect(p.filter((x) => x.actual !== null).length).toBeGreaterThan(0);
    const fut = p.filter((x) => x.actual === null); expect(fut).toHaveLength(10); expect(fut.every((x) => x.low! <= x.projected! && x.projected! <= x.high!)).toBe(true);
  });
});
