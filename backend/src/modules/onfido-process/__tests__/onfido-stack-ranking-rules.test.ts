import { describe, expect, it } from "vitest";
import { isNotAm, NOT_AM_NAMES, stackRankingAttritionPct, stackRankingShrinkagePct } from "../onfido-process-dashboard.service.js";

describe("stack ranking attrition / shrinkage", () => {
  it("computes attrition on mean daily on-floor HC", () => {
    expect(stackRankingAttritionPct(3, 3000, 30)).toBe(3); // 3 / 100 HC
  });
  it("is blank without an on-floor denominator (Training bucket)", () => {
    expect(stackRankingAttritionPct(5, 0, 0)).toBeNull();
    expect(stackRankingAttritionPct(5, 10, 0)).toBeNull();
  });
  it("is blank rather than an impossible percentage (537%)", () => {
    expect(stackRankingAttritionPct(537, 100, 100)).toBeNull();
  });
  it("shrinkage is blank when nothing is scheduled or the ratio exceeds 100%", () => {
    expect(stackRankingShrinkagePct(5, 0)).toBeNull();
    expect(stackRankingShrinkagePct(4280, 100)).toBeNull();
    expect(stackRankingShrinkagePct(10, 200)).toBe(5);
  });
});

describe("AM exclusion", () => {
  it("treats Vicky Kumar as a TL, not an AM, case-insensitively", () => {
    expect(NOT_AM_NAMES).toContain("Vicky Kumar");
    expect(isNotAm(" vicky kumar ")).toBe(true);
    expect(isNotAm("Someone Else")).toBe(false);
  });
});
