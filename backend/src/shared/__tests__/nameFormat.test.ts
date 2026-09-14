import { describe, it, expect } from "vitest";
import { toStoredName, toStoredNameRequired } from "../nameFormat.js";

describe("toStoredName", () => {
  it("uppercases a well-formed name", () => {
    expect(toStoredName("Ramesh Kumar")).toBe("RAMESH KUMAR");
  });

  it("trims and collapses internal whitespace", () => {
    expect(toStoredName("  Ramesh   Kumar ")).toBe("RAMESH KUMAR");
  });

  it("turns empty and whitespace-only input into null, not an empty string", () => {
    expect(toStoredName("")).toBeNull();
    expect(toStoredName("   ")).toBeNull();
  });

  it("passes null/undefined through as null", () => {
    expect(toStoredName(null)).toBeNull();
    expect(toStoredName(undefined)).toBeNull();
  });

  it("accepts non-string input defensively (loosely-typed callers)", () => {
    // Several call sites read from `Record<string, unknown>` request bodies.
    expect(toStoredName(123 as unknown as string)).toBe("123");
  });

  it("is idempotent — re-applying to an already-uppercase name is a no-op", () => {
    expect(toStoredName(toStoredName("Priya Sharma"))).toBe("PRIYA SHARMA");
  });
});

describe("toStoredNameRequired", () => {
  it("returns the uppercased value for real input", () => {
    expect(toStoredNameRequired("sultan ahmed")).toBe("SULTAN AHMED");
  });

  it("returns an empty string, not null, for blank/missing input", () => {
    expect(toStoredNameRequired("")).toBe("");
    expect(toStoredNameRequired(null)).toBe("");
    expect(toStoredNameRequired(undefined)).toBe("");
  });
});
