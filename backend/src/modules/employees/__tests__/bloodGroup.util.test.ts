import { describe, it, expect } from "vitest";
import { normalizeBloodGroup, BLOOD_GROUPS } from "../bloodGroup.util.js";

describe("normalizeBloodGroup", () => {
  it("passes the eight canonical groups through unchanged", () => {
    for (const g of BLOOD_GROUPS) expect(normalizeBloodGroup(g)).toBe(g);
  });

  it("rejects 'NA', the legacy import's placeholder for 'not recorded'", () => {
    // 28,502 employees carry this literal string; it must never reach the ID card.
    expect(normalizeBloodGroup("NA")).toBeNull();
    expect(normalizeBloodGroup("N/A")).toBeNull();
    expect(normalizeBloodGroup("na")).toBeNull();
  });

  it("repairs the malformed values actually present in production", () => {
    expect(normalizeBloodGroup("B+ve")).toBe("B+");
    expect(normalizeBloodGroup("O +")).toBe("O+");
    expect(normalizeBloodGroup("ab-")).toBe("AB-");
    expect(normalizeBloodGroup("O POSITIVE")).toBe("O+");
    expect(normalizeBloodGroup("A Negative")).toBe("A-");
  });

  it("returns null for a value with no sign — the sign cannot be guessed", () => {
    expect(normalizeBloodGroup("A")).toBeNull();
    expect(normalizeBloodGroup("O")).toBeNull();
  });

  it("returns null for junk and for empty input", () => {
    expect(normalizeBloodGroup("SAMBHLI")).toBeNull();
    expect(normalizeBloodGroup("")).toBeNull();
    expect(normalizeBloodGroup("   ")).toBeNull();
    expect(normalizeBloodGroup(null)).toBeNull();
    expect(normalizeBloodGroup(undefined)).toBeNull();
    expect(normalizeBloodGroup("C+")).toBeNull();
  });
});
