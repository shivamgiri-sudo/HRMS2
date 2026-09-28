import { describe, expect, it } from "vitest";
import { isGenuineRewalkin, buildRewalkinWhere } from "../rewalkin.service.js";

const prior = (o: Partial<Parameters<typeof isGenuineRewalkin>[0]> = {}) => ({
  priorWalkInDate: null,
  priorStage: null,
  priorStatus: null,
  priorDecision: null,
  hasQueueToken: false,
  ...o,
});

describe("isGenuineRewalkin", () => {
  it("counts a candidate who walked in on an earlier day", () => {
    expect(isGenuineRewalkin(prior({ priorWalkInDate: "2026-09-18" }), "2026-09-25")).toBe(true);
  });
  it("ignores a same-day resubmission", () => {
    expect(isGenuineRewalkin(prior({ priorWalkInDate: "2026-09-25" }), "2026-09-25")).toBe(false);
  });
  it("ignores a calling lead that never walked in", () => {
    expect(isGenuineRewalkin(prior(), "2026-09-25")).toBe(false);
  });
  it("counts a candidate with a queue token but no walk-in date", () => {
    expect(isGenuineRewalkin(prior({ hasQueueToken: true }), "2026-09-25")).toBe(true);
  });
});

describe("buildRewalkinWhere", () => {
  it("defaults to a 30-day window and applies branch and scope params in order", () => {
    const { where, params } = buildRewalkinWhere({
      branch: "NOIDA-2",
      scope: { sql: "c.applied_for_branch = ?", params: ["NOIDA-2"] },
    });
    expect(where).toContain("CURDATE() - INTERVAL 30 DAY");
    expect(params).toEqual(["NOIDA-2", "NOIDA-2"]);
  });
  it("ignores malformed dates", () => {
    const { params } = buildRewalkinWhere({ from: "x", to: "y", scope: { sql: "1=1", params: [] } });
    expect(params).toEqual([]);
  });
});
