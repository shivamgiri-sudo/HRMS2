import { describe, expect, it } from "vitest";
import { fillTargetMet, joinTarget, joinsLeft, joinsOpenSql, selectionsStillNeeded } from "../requisition-fill.js";

describe("requisition fill rule (130% of seats, by joined count)", () => {
  it("target is the seats plus 30%, rounded up", () => {
    expect(joinTarget(25)).toBe(33);
    expect(joinTarget(20)).toBe(26);
    expect(joinTarget(1)).toBe(2);
    expect(joinTarget(0)).toBe(0);
    expect(joinTarget(null)).toBe(0);
  });
  it("filled only when the joined count reaches the target (not on selections)", () => {
    expect(fillTargetMet(25, 32)).toBe(false);
    expect(fillTargetMet(25, 33)).toBe(true);
    expect(fillTargetMet(25, 40)).toBe(true);
    expect(fillTargetMet(0, 5)).toBe(false);
  });
  it("joins left and selections still needed", () => {
    expect(joinsLeft(25, 10)).toBe(23);
    expect(joinsLeft(25, 99)).toBe(0);
    expect(selectionsStillNeeded(25, 25, 10)).toBe(8);
    expect(selectionsStillNeeded(25, 10, 30)).toBe(3);
    expect(selectionsStillNeeded(25, 25, 33)).toBe(0);
  });
  it("exposes the SQL predicate with the alias", () => {
    expect(joinsOpenSql("j")).toBe("j.joined_headcount < CEIL(j.requested_headcount * 1.3)");
  });
});
