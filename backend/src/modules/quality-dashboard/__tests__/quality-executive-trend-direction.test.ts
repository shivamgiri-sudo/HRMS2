import { describe, expect, it, vi } from "vitest";
import { QualityExecutiveService } from "../quality-executive.service.js";

/**
 * trend_7day/trend_30day.direction compared two MySQL DECIMAL values with `>` / `<`.
 * mysql2 returns DECIMAL as a string ("9.50", not 9.50), and relational comparison between
 * two strings is lexical, not numeric: "9.50" > "73.45" is true — '9' sorts after '7' — so a
 * genuine decline from 73.45% to 9.50% rendered as '↗' (improving).
 *
 * It went unnoticed because the bug only surfaces when one side's value drops below 10 —
 * everywhere in this dataset's normal operating range (roughly 60-90%), lexical and numeric
 * comparison happen to agree, which is exactly the range anyone glancing at the dashboard
 * would consider unremarkable. The arrow was wrong exactly when it mattered.
 *
 * change_pct (built with `-`) and status (built with `>=` against a numeric literal) were
 * never affected: unlike `>`/`<` between two strings, `-` and a numeric-literal-comparison
 * both coerce their string operand to a number per the JS relational-comparison spec. Only
 * the direction ternary's string-vs-string `>`/`<` was lexical.
 */

function fakeConn(rows: unknown[][]) {
  let call = 0;
  return {
    execute: vi.fn(async () => {
      const result = rows[call] ?? [];
      call++;
      return [result];
    }),
    release: vi.fn(),
  };
}

// Eight conn.execute calls happen in this order inside getExecutiveSummary: current metrics,
// 7-day avg, 30-day avg, top performers, bottom performers, process metrics, per-agent scores,
// org benchmarks. Every test below fills only the first three (what direction depends on) and
// leaves the rest empty — a real empty result set, not an omission that could silently pass.
function summaryFixture(currentQuality: string, sevenDay: string, thirtyDay: string) {
  return [
    [{ current_quality: currentQuality, total_calls: 100, unique_agents: 5 }],
    [{ avg_quality: sevenDay }],
    [{ avg_quality: thirtyDay }],
    [], // top performers
    [], // bottom performers
    [], // process metrics
    [], // per-agent quality scores
    [{ avg_quality: null, std_dev: null }], // org benchmarks
  ];
}

describe("QualityExecutiveService trend direction — real DECIMAL-as-string inputs", () => {
  it("reports a decline as '↘', not '↗', when the drop crosses below 10%", async () => {
    // The exact shape that broke: current 73.45%, 7-day average collapsed to 9.50%.
    const conn = fakeConn(summaryFixture("73.45", "9.50", "9.50"));
    const service = new QualityExecutiveService({ getConnection: async () => conn as any });

    const result = await service.getExecutiveSummary(30);

    expect(result.metrics.trend_7day.direction).toBe("↘");
    expect(result.metrics.trend_30day.direction).toBe("↘");
  });

  it("reports a genuine improvement as '↗'", async () => {
    const conn = fakeConn(summaryFixture("40.00", "65.00", "65.00"));
    const service = new QualityExecutiveService({ getConnection: async () => conn as any });

    const result = await service.getExecutiveSummary(30);

    expect(result.metrics.trend_7day.direction).toBe("↗");
    expect(result.metrics.trend_30day.direction).toBe("↗");
  });

  it("reports no change as '→' when both periods are equal strings", async () => {
    const conn = fakeConn(summaryFixture("73.45", "73.45", "73.45"));
    const service = new QualityExecutiveService({ getConnection: async () => conn as any });

    const result = await service.getExecutiveSummary(30);

    expect(result.metrics.trend_7day.direction).toBe("→");
    expect(result.metrics.trend_30day.direction).toBe("→");
  });

  it("computes change_pct numerically, not by string concatenation", async () => {
    const conn = fakeConn(summaryFixture("73.45", "9.50", "9.50"));
    const service = new QualityExecutiveService({ getConnection: async () => conn as any });

    const result = await service.getExecutiveSummary(30);

    // 9.50 - 73.45 = -63.95. A string bug here would produce "9.50" + "73.45"-shaped
    // nonsense or NaN, not a signed numeric delta.
    expect(result.metrics.trend_7day.change_pct).toBeCloseTo(-63.95, 2);
  });
});
