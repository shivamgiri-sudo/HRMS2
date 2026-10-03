import { describe, it, expect, vi } from "vitest";
import { achievementPct, loadKpiSection } from "../dossier.kpi.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[]>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      return [key ? map[key] : [], []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 3);

describe("achievementPct", () => {
  it("higher is better: caps at 100", () => {
    expect(achievementPct(120, 100, "higher_is_better")).toBe(100);
    expect(achievementPct(50, 100, "higher_is_better")).toBe(50);
  });
  it("defaults to higher is better when direction is missing", () => {
    expect(achievementPct(80, 100, null)).toBe(80);
  });
  it("lower is better inverts", () => {
    expect(achievementPct(50, 100, "lower_is_better")).toBe(100);
    expect(achievementPct(200, 100, "lower_is_better")).toBe(50);
  });
  it("lower is better with zero actual is a perfect score", () => {
    expect(achievementPct(0, 100, "lower_is_better")).toBe(100);
  });
  it("returns null when there is no usable target", () => {
    expect(achievementPct(80, null, "higher_is_better")).toBeNull();
    expect(achievementPct(80, 0, "higher_is_better")).toBeNull();
  });
});

describe("loadKpiSection", () => {
  const scoreRows = [
    { period: "2026-07", metric_id: "m1", actual_value: "100", metric_name: "AHT", direction: "higher_is_better", target_value: "100", effective_from: "2026-01-01" },
    { period: "2026-07", metric_id: "m1", actual_value: "100", metric_name: "AHT", direction: "higher_is_better", target_value: "80", effective_from: "2025-01-01" }, // older config row, must be ignored
    { period: "2026-08", metric_id: "m1", actual_value: "60", metric_name: "AHT", direction: "higher_is_better", target_value: "100", effective_from: "2026-01-01" },
    { period: "2026-08", metric_id: "m2", actual_value: "100", metric_name: "QA", direction: "higher_is_better", target_value: "100", effective_from: "2026-01-01" },
    { period: "2026-09", metric_id: "m3", actual_value: "5", metric_name: "Cost", direction: "higher_is_better", target_value: null, effective_from: null },
  ];

  it("averages achievement per month and flags at-target months", async () => {
    const ex = executor({ "FROM kpi_score ks": scoreRows, "FROM kpi_score_summary": [] });
    const s = await loadKpiSection(ex as never, w);
    const jul = s.months.find((m) => m.period === "2026-07")!;
    const aug = s.months.find((m) => m.period === "2026-08")!;
    expect(jul).toMatchObject({ avgAchievementPct: 100, metricsMeasured: 1, atTarget: true });
    expect(aug).toMatchObject({ avgAchievementPct: 80, metricsMeasured: 2, atTarget: false });
  });

  it("a month with only target-less metrics has no data, not zero", async () => {
    const ex = executor({ "FROM kpi_score ks": scoreRows, "FROM kpi_score_summary": [] });
    const s = await loadKpiSection(ex as never, w);
    const sep = s.months.find((m) => m.period === "2026-09")!;
    expect(sep.avgAchievementPct).toBeNull();
    expect(sep.atTarget).toBeNull();
  });

  it("summarises months with data, months at target, share, best and worst", async () => {
    const ex = executor({ "FROM kpi_score ks": scoreRows, "FROM kpi_score_summary": [] });
    const s = await loadKpiSection(ex as never, w);
    expect(s.monthsWithData).toBe(2);
    expect(s.monthsAtTarget).toBe(1);
    expect(s.atTargetPct).toBe(50);
    expect(s.best).toEqual({ period: "2026-07", avgAchievementPct: 100 });
    expect(s.worst).toEqual({ period: "2026-08", avgAchievementPct: 80 });
  });

  it("attaches the final score and rating from the summary table when present", async () => {
    const ex = executor({
      "FROM kpi_score ks": scoreRows,
      "FROM kpi_score_summary": [{ period: "2026-07", final_score: "91.5", rating: "Exceeds", status: "locked" }],
    });
    const s = await loadKpiSection(ex as never, w);
    expect(s.months.find((m) => m.period === "2026-07")).toMatchObject({ finalScore: 91.5, rating: "Exceeds" });
  });

  it("an empty KPI history gives null percentages", async () => {
    const ex = executor({ "FROM kpi_score ks": [], "FROM kpi_score_summary": [] });
    const s = await loadKpiSection(ex as never, w);
    expect(s.monthsWithData).toBe(0);
    expect(s.atTargetPct).toBeNull();
    expect(s.best).toBeNull();
  });
});
