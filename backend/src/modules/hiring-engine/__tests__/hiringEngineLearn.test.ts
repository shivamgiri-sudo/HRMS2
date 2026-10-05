import { describe, expect, it } from "vitest";
import { learnedBonus, learnLifts, type OutcomeRow } from "../he-learn.js";

const rows: OutcomeRow[] = [];
for (let i = 0; i < 60; i++) rows.push({ process: "Sales", edu: 5, expYears: 1, source: "Referral", selected: i % 2 === 0 });   // 50%
for (let i = 0; i < 60; i++) rows.push({ process: "Sales", edu: 3, expYears: 0, source: "Meta", selected: i % 10 === 0 });      // 10%
describe("outcome learning", () => {
  it("rewards buckets selected more than average, penalises the rest, bounded", () => {
    const l = learnLifts(rows);
    expect(l["match.sales.edu.5"].bonus).toBeGreaterThan(0);
    expect(l["match.sales.edu.3"].bonus).toBeLessThan(0);
    expect(Math.abs(l["match.sales.src.referral"].bonus)).toBeLessThanOrEqual(10);
  });
  it("needs enough walk-ins", () => expect(learnLifts(rows.slice(0, 30))).toEqual({}));
  it("applies to a lead with reasons", () => {
    const params = Object.fromEntries(Object.entries(learnLifts(rows)).map(([k, v]) => [k, v.bonus]));
    const good = learnedBonus(params, "SALES", { edu: 5, expYears: 1, source: "Referral" });
    const weak = learnedBonus(params, "Sales", { edu: 3, expYears: 0, source: "Meta" });
    expect(good.bonus).toBeGreaterThan(0); expect(weak.bonus).toBeLessThan(0);
    expect(good.reasons.length).toBeGreaterThan(0);
    expect(learnedBonus(params, "Other", { edu: 5, expYears: 1, source: "Referral" }).bonus).toBe(0);
  });
});
