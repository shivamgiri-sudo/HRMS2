import { describe, expect, it } from "vitest";
import { pickBranchHeadVariant } from "../branchHeadVariant";

describe("pickBranchHeadVariant", () => {
  const base = { fallback: "hr" as const };
  it("loading while the pilot answer is pending for a branch_head resolution", () => {
    expect(pickBranchHeadVariant({ ...base, resolved: "branch_head", enabled: false, isLoading: true })).toBe("loading");
  });
  it("falls back to the previous variant when not enabled", () => {
    expect(pickBranchHeadVariant({ ...base, resolved: "branch_head", enabled: false, isLoading: false })).toBe("hr");
  });
  it("keeps branch_head when enabled", () => {
    expect(pickBranchHeadVariant({ ...base, resolved: "branch_head", enabled: true, isLoading: false })).toBe("branch_head");
  });
  it("never touches other variants, even while loading", () => {
    expect(pickBranchHeadVariant({ ...base, resolved: "ceo", enabled: false, isLoading: true })).toBe("ceo");
  });
});
