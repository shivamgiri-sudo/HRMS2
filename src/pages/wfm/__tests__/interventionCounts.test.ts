import { describe, expect, it } from "vitest";
import { countByTier } from "@/pages/wfm/roster-command-center/interventionCounts";

describe("countByTier", () => {
  it("counts each row exactly once across tiers", () => {
    const rows = [{ riskTier: "CRITICAL" }, { riskTier: "HIGH" }, { riskTier: "critical" }];
    expect(countByTier(rows)).toEqual({ CRITICAL: 2, HIGH: 1, MEDIUM: 0, LOW: 0 });
  });
  it("ignores unknown tiers and handles empty input", () => {
    expect(countByTier([{ riskTier: "WEIRD" }, {}])).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 });
    expect(countByTier([])).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 });
  });
});
