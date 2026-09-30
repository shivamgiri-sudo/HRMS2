import { describe, expect, it } from "vitest";
import { compare, dedupeKey, evaluateAnomalyCount, evaluateSeries, inCooldown, simulateFirings, type DayValue } from "../alerts.evaluator.js";

const s = (...v: Array<[string, number | null]>): DayValue[] => v.map(([date, value]) => ({ date, value }));

describe("compare", () => {
  it("applies each comparator strictly or inclusively", () => {
    expect(compare(5, "gt", 5)).toBe(false); expect(compare(5, "gte", 5)).toBe(true);
    expect(compare(5, "lt", 5)).toBe(false); expect(compare(5, "lte", 5)).toBe(true);
    expect(compare(0, "lt", 1)).toBe(true);
  });
  it("null / undefined / NaN never satisfy anything", () => {
    for (const cmp of ["gt", "gte", "lt", "lte"] as const) for (const v of [null, undefined, NaN, Infinity]) expect(compare(v as number, cmp, 0)).toBe(false);
    expect(compare(1, "gt", NaN)).toBe(false);
  });
});

describe("evaluateSeries", () => {
  it("fires when the as-of day breaches a single-day rule", () => {
    const e = evaluateSeries(s(["2026-09-01", 80], ["2026-09-02", 60]), "2026-09-02", "lt", 70);
    expect(e).toMatchObject({ fired: true, value: 60, streak: 1, reason: "fired" });
  });
  it("does not fire when the threshold is not met", () => {
    expect(evaluateSeries(s(["2026-09-02", 75]), "2026-09-02", "lt", 70)).toMatchObject({ fired: false, reason: "not_met", streak: 0, value: 75 });
  });
  it("requires ALL consecutive days", () => {
    const series = s(["2026-09-01", 60], ["2026-09-02", 90], ["2026-09-03", 60], ["2026-09-04", 55]);
    expect(evaluateSeries(series, "2026-09-04", "lt", 70, 2)).toMatchObject({ fired: true, streak: 2, dates: ["2026-09-03", "2026-09-04"] });
    expect(evaluateSeries(series, "2026-09-04", "lt", 70, 3)).toMatchObject({ fired: false, reason: "streak_too_short", streak: 2 });
  });
  it("a missing calendar day breaks the streak (gaps are not skipped)", () => {
    const series = s(["2026-09-01", 50], ["2026-09-03", 50]);
    expect(evaluateSeries(series, "2026-09-03", "lt", 70, 2)).toMatchObject({ fired: false, streak: 1 });
  });
  it("null / no-data as-of day never fires, even when earlier days breach", () => {
    expect(evaluateSeries(s(["2026-09-01", 10], ["2026-09-02", null]), "2026-09-02", "lt", 70)).toMatchObject({ fired: false, reason: "no_data", value: null });
    expect(evaluateSeries([], "2026-09-02", "lt", 70)).toMatchObject({ fired: false, reason: "no_data" });
  });
  it("a null day inside the streak breaks it rather than counting as 0", () => {
    const series = s(["2026-09-01", 10], ["2026-09-02", null], ["2026-09-03", 10]);
    expect(evaluateSeries(series, "2026-09-03", "lt", 70, 3).fired).toBe(false);
    expect(evaluateSeries(series, "2026-09-03", "lt", 70, 1).fired).toBe(true);
  });
  it("treats consecutiveDays < 1 as 1", () => {
    expect(evaluateSeries(s(["2026-09-02", 1]), "2026-09-02", "lt", 5, 0).fired).toBe(true);
  });
});

describe("evaluateAnomalyCount", () => {
  it("fires at or above the minimum, never on null", () => {
    expect(evaluateAnomalyCount(3, 2)).toMatchObject({ fired: true, value: 3 });
    expect(evaluateAnomalyCount(1, 2)).toMatchObject({ fired: false, reason: "not_met" });
    expect(evaluateAnomalyCount(0, 0).fired).toBe(false); // min is floored at 1: zero anomalies is not an alert
    expect(evaluateAnomalyCount(null, 1)).toMatchObject({ fired: false, reason: "no_data" });
  });
});

describe("cooldown", () => {
  const t0 = new Date("2026-09-10T10:00:00Z");
  it("suppresses inside the window, allows at and after its end", () => {
    expect(inCooldown(t0, new Date("2026-09-10T10:59:00Z"), 60)).toBe(true);
    expect(inCooldown(t0, new Date("2026-09-10T11:00:00Z"), 60)).toBe(false);
  });
  it("never-fired rules and zero cooldown are never suppressed", () => {
    expect(inCooldown(null, t0, 1440)).toBe(false);
    expect(inCooldown(t0, t0, 0)).toBe(false);
  });
});

describe("simulateFirings (backtest shares the worker's cooldown rule)", () => {
  const dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
  const always = (d: string) => evaluateSeries(dates.map((x) => ({ date: x, value: 1 })), d, "lt", 5);
  it("daily cooldown lets every consecutive daily breach fire", () => {
    expect(simulateFirings(dates, always, 1440).fired).toBe(5);
  });
  it("a 3-day cooldown fires on day 1 and day 4 only, marking the rest as suppressed", () => {
    const r = simulateFirings(dates, always, 3 * 1440);
    expect(r.fired).toBe(2);
    expect(r.days.map((d) => d.fired)).toEqual([true, false, false, true, false]);
    expect(r.days[1].suppressedByCooldown).toBe(true);
  });
  it("days without data are never counted", () => {
    const r = simulateFirings(dates, (d) => evaluateSeries([{ date: "2026-09-03", value: 1 }], d, "lt", 5), 0);
    expect(r.fired).toBe(1);
  });
});

describe("dedupe", () => {
  it("is one key per rule and data date", () => {
    expect(dedupeKey("r1", "2026-09-01")).toBe(dedupeKey("r1", "2026-09-01"));
    expect(dedupeKey("r1", "2026-09-01")).not.toBe(dedupeKey("r1", "2026-09-02"));
    expect(dedupeKey("r1", "2026-09-01")).not.toBe(dedupeKey("r2", "2026-09-01"));
  });
});
