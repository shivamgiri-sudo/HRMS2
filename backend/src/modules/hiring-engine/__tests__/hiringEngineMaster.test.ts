import { describe, expect, it } from "vitest";
import { classifyOutcome, conversionType, deriveFinalStatus, effortTier, type EffortInput } from "../he-master.js";

const base: EffortInput = { status: "new", finalStatus: "none", isEmployee: false, lastOutcome: null, attemptCount: 0, walkinCount: 0, hasFutureSlot: false };

describe("master rules", () => {
  it("classifies recruiter remarks", () => {
    expect(classifyOutcome("Not Interested")).toBe("not_interested");
    expect(classifyOutcome("Wrong Number")).toBe("wrong_number");
    expect(classifyOutcome("If Interested")).toBe("interested");
    expect(classifyOutcome("Not Reachable")).toBe("no_answer");
    expect(classifyOutcome("")).toBe("other");
  });
  it("matches the sheet's conversion types", () => {
    expect(conversionType("2026-03-02", null)).toBe("No Walk-in Yet");
    expect(conversionType("2026-03-02", "2026-03-30")).toBe("Fresh / Same Month");
    expect(conversionType("2026-02-20", "2026-03-02")).toBe("Previous Month Lead Converted");
    expect(conversionType("2025-12-20", "2026-03-02")).toBe("Dormant Lead Reactivated");
    expect(conversionType(null, "2026-03-02")).toBe("Walk-in Matched");
  });
  it("joined beats selected beats rejected", () => {
    expect(deriveFinalStatus(true, true, true)).toBe("joined");
    expect(deriveFinalStatus(true, true, false)).toBe("selected");
    expect(deriveFinalStatus(true, false, false)).toBe("rejected");
    expect(deriveFinalStatus(false, false, false)).toBe("none");
  });
  it("effort tiers", () => {
    expect(effortTier({ ...base, status: "opted_out", hasFutureSlot: true }).tier).toBe("skip");
    expect(effortTier({ ...base, isEmployee: true }).reason).toBe("current_employee");
    expect(effortTier({ ...base, lastOutcome: "wrong_number" }).tier).toBe("skip");
    expect(effortTier({ ...base, hasFutureSlot: true }).tier).toBe("high");
    expect(effortTier({ ...base, lastOutcome: "interested" }).tier).toBe("high");
    expect(effortTier({ ...base, finalStatus: "selected" }).tier).toBe("high");
    expect(effortTier({ ...base, finalStatus: "rejected", walkinCount: 1 }).tier).toBe("low");
    expect(effortTier({ ...base, lastOutcome: "not_interested" }).tier).toBe("low");
    expect(effortTier({ ...base, attemptCount: 6 }).reason).toBe("many_attempts_no_walkin");
    expect(effortTier({ ...base, walkinCount: 2 }).reason).toBe("walked_in_before");
    expect(effortTier(base).tier).toBe("standard");
  });
});

import { prefixLike } from "../he-master.service.js";
describe("prefix patterns", () => {
  it("prefix -> LIKE pattern, full number -> exact, junk refused", () => {
    expect(prefixLike("99")).toBe("99%");
    expect(prefixLike("9876543210")).toBe("9876543210");
    expect(() => prefixLike("9'%")).toThrow();
  });
});
