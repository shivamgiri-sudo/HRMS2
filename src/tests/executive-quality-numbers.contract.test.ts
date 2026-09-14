/**
 * Companion to quality-fail-rates.contract.test.tsx — same defect, second page.
 *
 * quality-executive.service.ts declares ExecutiveSummaryResponse with `number` fields but
 * passes several of them straight out of MySQL:
 *
 *   top_performers[].quality_score      ROUND(AVG(cqa.quality_percentage), 2)
 *   bottom_performers[].quality_score   ROUND(AVG(cqa.quality_percentage), 2)
 *   process_performance[].avg_quality   ROUND(AVG(cqa.quality_percentage), 2)
 *   org_benchmarks.avg_quality          ROUND(AVG(...), 2)
 *   org_benchmarks.std_deviation        ROUND(STDDEV(...), 2)
 *
 * mysql2 returns DECIMAL as a string, so all five arrive as "73.45". React renders a string
 * happily, which is why this stayed invisible — until /quality/executive formats them with
 * `.toFixed(1)`, which throws "toFixed is not a function" and blanks the page.
 *
 * The fields the service computes in JS (metrics.*, median_quality) really are numbers, and
 * must survive normalisation unchanged.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeExecutiveSummary,
  type ExecutiveSummaryResponse,
} from "@/hooks/useExecutiveQuality";

// Shaped exactly as the API sends it: DECIMALs as strings, JS-computed values as numbers.
const apiResponse = {
  metrics: {
    overall_quality_score: 73.45,
    target_quality_score: 85,
    gap_pct: 11.55,
    status: "At Risk",
    trend_7day: { direction: "↗", change_pct: 1.2 },
    trend_30day: { direction: "↘", change_pct: -0.4 },
  },
  top_performers: [
    { rank: 1, agent_code: "A1", agent_name: "Top One", quality_score: "94.20", calls_handled: "31", process: "Inbound" },
  ],
  bottom_performers: [
    { rank: 1, agent_code: "A9", agent_name: "Low One", quality_score: "41.00", calls_handled: "12", process: "Inbound" },
  ],
  process_performance: [
    { process: "Inbound", avg_quality: "68.30", agent_count: "40", calls_handled: "900", status: "At Risk" },
  ],
  risk_summary: { critical_agents_count: 3, at_risk_agents_count: 7, coaching_priority_count: 11 },
  org_benchmarks: { avg_quality: "73.45", median_quality: 74.1, std_deviation: "12.80" },
} as unknown as ExecutiveSummaryResponse;

describe("normalizeExecutiveSummary", () => {
  it("turns every string DECIMAL into a real number", () => {
    const out = normalizeExecutiveSummary(apiResponse);

    expect(out.top_performers[0].quality_score).toBe(94.2);
    expect(out.bottom_performers[0].quality_score).toBe(41);
    expect(out.process_performance[0].avg_quality).toBe(68.3);
    expect(out.org_benchmarks.avg_quality).toBe(73.45);
    expect(out.org_benchmarks.std_deviation).toBe(12.8);
  });

  it("makes every field the page formats survive .toFixed", () => {
    const out = normalizeExecutiveSummary(apiResponse);

    // These are the exact call sites in ExecutiveQualityDashboard.tsx that threw.
    expect(() => out.top_performers[0].quality_score.toFixed(1)).not.toThrow();
    expect(() => out.bottom_performers[0].quality_score.toFixed(1)).not.toThrow();
    expect(() => (out.process_performance[0].avg_quality ?? 0).toFixed(1)).not.toThrow();
    expect(() => (out.org_benchmarks.std_deviation ?? 0).toFixed(2)).not.toThrow();
    expect(out.top_performers[0].quality_score.toFixed(1)).toBe("94.2");
  });

  it("leaves the genuinely-numeric fields alone", () => {
    const out = normalizeExecutiveSummary(apiResponse);

    expect(out.metrics).toEqual(apiResponse.metrics);
    expect(out.org_benchmarks.median_quality).toBe(74.1);
    expect(out.risk_summary).toEqual(apiResponse.risk_summary);
    expect(out.top_performers[0].agent_name).toBe("Top One");
    expect(out.process_performance[0].status).toBe("At Risk");
  });

  it("survives an empty or partial payload rather than throwing", () => {
    const empty = { org_benchmarks: {} } as unknown as ExecutiveSummaryResponse;
    const out = normalizeExecutiveSummary(empty);

    expect(out.top_performers).toEqual([]);
    expect(out.bottom_performers).toEqual([]);
    expect(out.process_performance).toEqual([]);
    expect(out.org_benchmarks.avg_quality).toBe(0);
  });
});
