import { describe, it, expect } from "vitest";
import { normalizeMaritalStatus, MARITAL_STATUSES } from "../maritalStatus.util.js";

describe("normalizeMaritalStatus", () => {
  it("passes the four canonical statuses through unchanged", () => {
    for (const s of MARITAL_STATUSES) expect(normalizeMaritalStatus(s)).toBe(s);
  });

  it("is case-insensitive on the values that already match the enum", () => {
    expect(normalizeMaritalStatus("Single")).toBe("single");
    expect(normalizeMaritalStatus("MARRIED")).toBe("married");
  });

  it("repairs the shortened/legacy shapes actually present in production", () => {
    // candidate_onboarding_profile held 'WIDOW' and 'DIVORCE' -- neither matches the
    // employees enum ('widowed' / 'divorced') as an exact word, so these used to throw
    // ER_TRUNCATED_WRONG_VALUE_FOR_FIELD and crash the offer approval.
    expect(normalizeMaritalStatus("WIDOW")).toBe("widowed");
    expect(normalizeMaritalStatus("widow")).toBe("widowed");
    expect(normalizeMaritalStatus("DIVORCE")).toBe("divorced");
    expect(normalizeMaritalStatus("divorce")).toBe("divorced");
    expect(normalizeMaritalStatus("Unmarried")).toBe("single");
  });

  it("returns null for 'Separated' -- no matching enum member to map it to", () => {
    // ref 0ca287e1, candidate POONAM SHARMA, 2026-09-10: silently forcing this to
    // 'single' or 'divorced' would misrecord someone's marital status, so it is
    // dropped to NULL like any other unrecognised value rather than guessed.
    expect(normalizeMaritalStatus("Separated")).toBeNull();
  });

  it("returns null for junk and for empty input", () => {
    expect(normalizeMaritalStatus("")).toBeNull();
    expect(normalizeMaritalStatus("   ")).toBeNull();
    expect(normalizeMaritalStatus(null)).toBeNull();
    expect(normalizeMaritalStatus(undefined)).toBeNull();
    expect(normalizeMaritalStatus("NA")).toBeNull();
  });
});
