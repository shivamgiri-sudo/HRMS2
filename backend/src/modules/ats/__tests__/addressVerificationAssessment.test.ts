import { describe, expect, it } from "vitest";
import { assess, assessDocuments, assessLocation } from "../address-verification-assessment.js";

const declared = { line: "Flat 12 Shiv Apartments Rajouri Garden", city: "New Delhi", state: "Delhi", pincode: "110027" };
const govtMatch = { line: "12 Shiv Apartments, Rajouri Garden", locality: "Rajouri Garden", district: "West Delhi", state: "Delhi", pincode: "110027" };

describe("assessLocation", () => {
  it("classifies distance bands and refuses coarse GPS", () => {
    expect(assessLocation(30, 20)).toBe("exact");
    expect(assessLocation(3000, 25)).toBe("same_area");
    expect(assessLocation(3000, 400)).toBe("poor_accuracy");
    expect(assessLocation(3000, null)).toBe("poor_accuracy");
    expect(assessLocation(20000, 20)).toBe("different_area");
    expect(assessLocation(160000, 20)).toBe("different_city");
    expect(assessLocation(null, null)).toBe("no_gps");
  });
});

describe("assessDocuments", () => {
  it("matches on pincode plus locality tokens", () => {
    expect(assessDocuments(declared, [null, govtMatch])).toBe("match");
  });
  it("pincode only when locality differs", () => {
    expect(assessDocuments(declared, [{ ...govtMatch, line: "Plot 9 Other Place", locality: "Other", district: "X" }])).toBe("pincode_only");
  });
  it("mismatch on a different pincode, no_data without any", () => {
    expect(assessDocuments(declared, [{ ...govtMatch, pincode: "201301" }])).toBe("mismatch");
    expect(assessDocuments(declared, [])).toBe("no_data");
    expect(assessDocuments(declared, [null, null])).toBe("no_data");
  });
});

describe("assess tiers", () => {
  it("verifies on two agreeing signals", () => {
    const a = assess({ distanceM: 3000, accuracyM: 20, declared, govt: [govtMatch] });
    expect(a.tier).toBe("verified");
  });
  it("one weak signal needs HR, never auto-fails", () => {
    expect(assess({ distanceM: 3000, accuracyM: 20, declared, govt: [] }).tier).toBe("needs_hr");
    expect(assess({ distanceM: 3000, accuracyM: 20, declared, govt: [{ ...govtMatch, pincode: "201301" }] }).tier).toBe("needs_hr");
    expect(assess({ distanceM: null, accuracyM: null, declared, govt: [govtMatch] }).tier).toBe("needs_hr");
  });
  it("different city is a conflict even when the documents agree", () => {
    expect(assess({ distanceM: 160000, accuracyM: 20, declared, govt: [govtMatch] }).tier).toBe("conflict");
  });
  it("exact GPS verifies on its own", () => {
    expect(assess({ distanceM: 20, accuracyM: 10, declared, govt: [] }).tier).toBe("verified");
  });
});
