import { describe, it, expect } from "vitest";
import { needsUanNudge } from "../ProfileSensitiveDetails";

describe("needsUanNudge", () => {
  it("is true when PF is deducted and no UAN is on file", () => {
    expect(needsUanNudge({ pf_eligible: 1, masked_uan: null })).toBe(true);
  });

  it("is false when PF is deducted but UAN is already on file", () => {
    expect(needsUanNudge({ pf_eligible: 1, masked_uan: "****5678" })).toBe(false);
  });

  it("is false when PF does not apply, regardless of UAN", () => {
    expect(needsUanNudge({ pf_eligible: 0, masked_uan: null })).toBe(false);
  });

  it("is false when statutory details are missing entirely", () => {
    expect(needsUanNudge(null)).toBe(false);
    expect(needsUanNudge(undefined)).toBe(false);
  });
});
