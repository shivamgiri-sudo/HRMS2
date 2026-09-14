/**
 * Regression: /quality-dashboard died with "r.toFixed is not a function".
 *
 * GET /api/quality-dashboard/summary computes the fail rates as
 * `ROUND(100 - (AVG(tinyint_col) * 100), 1)`. MySQL's AVG over a TINYINT returns a
 * DECIMAL, and mysql2 (with no `decimalNumbers` option on the Shivamgiri pool) hands
 * DECIMALs back as **strings** — verified live: `fail_rate_call_open` arrives as "36.5".
 *
 * QDSummary types these fields as `number`, so `s[key].toFixed(1)` type-checked but threw
 * at runtime, and because FailRatesBars renders unconditionally the whole page blanked.
 * Every other v2 panel already funnels API numbers through safeNum(); this one did not.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FailRatesBars } from "@/components/quality-dashboard/v2/FailRatesBars";
import type { QDSummary } from "@/components/quality-dashboard/v2/types";

// Exactly what the API sends: DECIMAL columns as strings, COUNT()s as numbers.
const apiSummary = {
  total_calls: 12937,
  audited_calls: 12937,
  avg_quality_score: "73.45",
  calls_above_80: 6000,
  calls_below_50: 900,
  unique_agents: 240,
  unique_clients: 18,
  fraud_flags: "12",
  fail_rate_call_open: "36.5",
  fail_rate_professionalism: "12.3",
  fail_rate_active_listening: "25.0",
  fail_rate_call_closure: "8.7",
  fail_rate_accuracy: "31.2",
} as unknown as QDSummary;

describe("FailRatesBars with a real API payload", () => {
  it("renders string DECIMAL fail rates without throwing", () => {
    const html = renderToStaticMarkup(<FailRatesBars summary={apiSummary} loading={false} />);
    expect(html).toContain("36.5%");
    expect(html).toContain("8.7%");
  });

  it("colours and sizes the bar from the numeric value, not the string", () => {
    const html = renderToStaticMarkup(<FailRatesBars summary={apiSummary} loading={false} />);
    // 36.5 > 30 → red; 8.7 → yellow. String comparison would still work here, but
    // the bar width must be a number-derived percentage, not "36.5" concatenated.
    expect(html).toContain("bg-red-400");
    expect(html).toContain("width:36.5%");
  });

  it("falls back to 0.0% when the API omits a rate", () => {
    const partial = { ...apiSummary, fail_rate_accuracy: null } as unknown as QDSummary;
    const html = renderToStaticMarkup(<FailRatesBars summary={partial} loading={false} />);
    expect(html).toContain("0.0%");
  });
});
