import { describe, expect, it } from "vitest";
import { assembleForecast, forecastWindow, kindOf } from "../fc.assemble.js";
import { datesBetween, weekdayOf } from "../fc.calendar.js";
import type { NormRow, QaBucket } from "../../pd.metrics.js";

const row = (date: string, agent: string, tl: string | null, o: Partial<NormRow> = {}): NormRow => ({
  date, agent_code: agent, agent_name: null, tl_name: tl, lob: null, hour: null, calls: 100, login_sec: 28800, talk_sec: 6000, wait_sec: 9000, dispo_sec: 2000,
  break_sec: null, connected: null, ptp: null, sales_count: 10, amount: null, handled: null, offered: null, abandoned: null, ...o,
});
const weekdays = (from: string, to: string) => datesBetween(from, to).filter((d) => { const w = weekdayOf(d); return w >= 1 && w <= 5; });
const KPIS = ["calls", "sales_count", "utilization", "qa_score"];
const avail = { calls: true, sales_count: true, utilization: true, qa_score: true };
function data(to: string, agents: Array<[string, string]> = [["A1", "Asha"], ["A2", "Bina"]]): NormRow[] {
  return weekdays("2026-07-20", to).flatMap((d) => agents.map(([a, tl]) => row(d, a, tl)));
}
const base = { today: "2026-09-17", latestDate: "2026-09-16", holidays: [] as string[], kpiKeys: KPIS, available: avail, targets: { utilization: 80 } as Record<string, number>, rankMetric: "sales_count", filters: {} };

describe("assembleForecast", () => {
  const out = assembleForecast({ ...base, month: "2026-09", rows: data("2026-09-16"), qa: [] });
  const k = (key: string) => out.kpis.find((x) => x.key === key)!;
  it("classifies additive vs rate by unit", () => { expect(kindOf("count")).toBe("additive"); expect(kindOf("currency")).toBe("additive"); expect(kindOf("percent")).toBe("rate"); expect(kindOf("seconds")).toBe("rate"); });
  it("projects additive KPIs from complete days: 2 agents x 10 sales x 22 working days", () => {
    expect(out.asOf).toBe("2026-09-16"); expect(out.calendar.workingDays).toEqual({ elapsed: 12, remaining: 10, total: 22 });
    expect(k("sales_count").mtd).toBe(240); expect(k("sales_count").projected).toBe(440); expect(k("sales_count").status).toBe("no_target");
    expect(k("calls").projected).toBe(4400);
  });
  it("utilization uses the configured target only; other KPIs have none", () => {
    expect(k("utilization").target).toBe(80); expect(k("utilization").status).toBe("off_track"); // 62.5% vs 80 needs > 100
    expect(k("calls").target).toBeNull();
  });
  it("qa_score with no audits is nodata, not zero", () => { expect(k("qa_score").status).toBe("nodata"); expect(k("qa_score").projected).toBeNull(); });
  it("an unmapped KPI is nodata with a reason", () => {
    const o = assembleForecast({ ...base, month: "2026-09", rows: data("2026-09-16"), qa: [], available: { ...avail, calls: false } });
    expect(o.kpis.find((x) => x.key === "calls")!).toMatchObject({ status: "nodata", reason: "Source field not mapped", projected: null });
  });
  it("breaks down by team leader; per-TL projections sum to the scope's", () => {
    const o = assembleForecast({ ...base, month: "2026-09", rows: data("2026-09-16", [["A1", "Asha"], ["A2", "Bina"], ["A3", "Bina"]]), qa: [] });
    expect(o.byTl.map((t) => t.tl)).toEqual(["Bina", "Asha"]); // ranked by rank metric mtd
    const sum = o.byTl.reduce((a, t) => a + (t.kpis.find((x) => x.key === "sales_count")!.projected as number), 0);
    expect(sum).toBe(o.kpis.find((x) => x.key === "sales_count")!.projected);
  });
  it("tl filter scopes the whole payload", () => {
    const o = assembleForecast({ ...base, month: "2026-09", rows: data("2026-09-16"), qa: [], filters: { tl: "asha" } });
    expect(o.kpis.find((x) => x.key === "sales_count")!.projected).toBe(220); expect(o.byTl.map((t) => t.tl)).toEqual(["Asha"]);
  });
  it("TL absent on worked days counts as zero for additive KPIs (from its first day)", () => {
    const rows = [...data("2026-09-16"), ...weekdays("2026-07-20", "2026-09-16").filter((d) => weekdayOf(d) !== 3).map((d) => row(d, "A9", "Cara"))];
    const cara = assembleForecast({ ...base, month: "2026-09", rows, qa: [] }).byTl.find((t) => t.tl === "Cara")!.kpis.find((x) => x.key === "sales_count")!;
    // Cara works Mon,Tue,Thu,Fri only: Wednesdays count as 0 in her weekday means, so 3 of 12 elapsed days were 0
    expect(cara.mtd).toBe(90); expect(cara.projected).toBe(90 + 10 * 8); // 8 of the 10 remaining days are not Wednesdays
  });
  it("today's partial rows are reported but excluded from month-to-date", () => {
    const rows = [...data("2026-09-16"), row("2026-09-17", "A1", "Asha", { sales_count: 500 })];
    const o = assembleForecast({ ...base, month: "2026-09", latestDate: "2026-09-17", rows, qa: [] });
    const s = o.kpis.find((x) => x.key === "sales_count")!;
    expect(o.partialDay).toBe("2026-09-17"); expect(o.asOf).toBe("2026-09-16"); expect(s.mtd).toBe(240);
    expect(s.partial).toEqual({ date: "2026-09-17", value: 500 }); expect(s.projected).toBe(440 + (500 - 20)); // partial above expectation acts as a floor for today
    expect(o.warnings.join(" ")).toMatch(/Today's data/);
  });
  it("a lagging feed is flagged stale and its missing working days are projected, not skipped", () => {
    const o = assembleForecast({ ...base, month: "2026-09", today: "2026-09-18", latestDate: "2026-09-16", rows: data("2026-09-16"), qa: [] });
    expect(o.stale).toBe(true); expect(o.calendar.workingDays.remaining).toBe(10);
    expect(assembleForecast({ ...base, month: "2026-09", today: "2026-09-21", latestDate: "2026-09-18", rows: data("2026-09-18"), qa: [] }).stale).toBe(false); // Sat/Sun have no rows: not a lag
  });
  it("a finished month projects to its actual", () => {
    const o = assembleForecast({ ...base, month: "2026-08", rows: data("2026-09-16"), qa: [] });
    const s = o.kpis.find((x) => x.key === "sales_count")!;
    expect(o.asOf).toBe("2026-08-31"); expect(s.daysRemaining).toBe(0); expect(s.projected).toBe(s.mtd); expect(s.mtd).toBe(2 * 10 * 21);
  });
  it("no rows anywhere: every KPI nodata and a warning", () => {
    const o = assembleForecast({ ...base, month: "2026-09", latestDate: null, rows: [], qa: [] });
    expect(o.kpis.every((x) => x.status === "nodata" && x.projected === null)).toBe(true); expect(o.warnings.join(" ")).toMatch(/nothing to project/); expect(o.calendar.basis).toBe("weekday-only");
  });
  it("QA buckets feed qa_score mtd and history", () => {
    const qa: QaBucket[] = weekdays("2026-07-20", "2026-09-16").map((d) => ({ agentCode: "A1", date: d, n: 1, sum: 90, fatal: 0 }));
    const o = assembleForecast({ ...base, month: "2026-09", rows: data("2026-09-16"), qa, targets: { qa_score: 85 } });
    expect(o.kpis.find((x) => x.key === "qa_score")).toMatchObject({ mtd: 90, projected: 90, status: "on_track" });
  });
  it("holidays inside the month are listed and removed from remaining days", () => {
    const o = assembleForecast({ ...base, month: "2026-09", rows: data("2026-09-16"), qa: [], holidays: ["2026-09-21"] });
    expect(o.calendar.holidays).toEqual(["2026-09-21"]); expect(o.calendar.workingDays.remaining).toBe(9);
  });
  it("leap February elapsed/remaining", () => {
    const rows = weekdays("2027-12-20", "2028-02-10").map((d) => row(d, "A1", "T"));
    const o = assembleForecast({ ...base, month: "2028-02", today: "2028-02-11", latestDate: "2028-02-10", rows, qa: [] });
    expect(o.calendar.workingDays).toEqual({ elapsed: 8, remaining: 13, total: 21 });
  });
});

describe("forecastWindow", () => {
  it("normal day: cutoff is the newest complete data day, window is 56 days back, load runs to today", () => {
    expect(forecastWindow("2026-09", "2026-09-17", "2026-09-16")).toMatchObject({ cutoff: "2026-09-16", winStart: "2026-07-23", loadFrom: "2026-07-23", loadTo: "2026-09-17", partialToday: false });
  });
  it("today's feed present: yesterday is the cutoff and today is partial", () => {
    expect(forecastWindow("2026-09", "2026-09-17", "2026-09-17")).toMatchObject({ cutoff: "2026-09-16", partialToday: true });
  });
  it("a lagging feed keeps its full lookback measured from the cutoff, not from today (regression: history was truncated)", () => {
    const w = forecastWindow("2026-09", "2026-09-30", "2026-09-16");
    expect(w.cutoff).toBe("2026-09-16"); expect(w.loadFrom).toBe("2026-07-23"); expect(w.loadTo).toBe("2026-09-30");
  });
  it("a finished month caps at its last day", () => {
    expect(forecastWindow("2026-08", "2026-09-30", "2026-09-29")).toMatchObject({ cutoff: "2026-08-31", loadTo: "2026-08-31", partialToday: false });
  });
  it("no data at all: cutoff is yesterday", () => expect(forecastWindow("2026-09", "2026-09-17", null).cutoff).toBe("2026-09-16"));
});
