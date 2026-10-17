import { describe, expect, it } from "vitest";
import { assess, assessDocuments, assessLocation, describeDistance, referencePrecisionFor } from "../address-verification-assessment.js";

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

describe("centroid reference is approximate (WFM: own/rented houses shown as 1-2 km away)", () => {
  it("a declared 6-digit pincode means the reference is the pincode centre", () => {
    expect(referencePrecisionFor(declared)).toBe("pincode_centre");
    expect(referencePrecisionFor({ ...declared, pincode: null })).toBe("city_centre");
    expect(referencePrecisionFor({ line: "x", city: null, state: null, pincode: "12" })).toBe("address");
  });
  it("1-2 km from a pincode centre is reported as inside the pincode area, never as a distance from the home", () => {
    const a = assess({ distanceM: 1400, accuracyM: 20, declared, govt: [] });
    expect(a.referencePrecision).toBe("pincode_centre");
    expect(a.reasons[0]).toMatch(/^Inside the declared pincode area/);
    expect(a.reasons[0]).toMatch(/not a distance from the home/);
    expect(a.reasons.join(" ")).not.toMatch(/from the declared address area/);
  });
  it("beyond the pincode area the distance is labelled approximate and from the centre", () => {
    expect(describeDistance(8000, "pincode_centre")).toBe(
      "About 8.0 km from the centre of the declared pincode (approximate: the reference is the pincode centre, not the house)",
    );
    expect(describeDistance(1500, "city_centre")).toMatch(/^About 1\.5 km from the centre of the declared city/);
  });
  it("only a full-address reference keeps the plain distance wording", () => {
    expect(describeDistance(816, "address")).toBe("816 m from the declared address area");
    expect(describeDistance(null, "pincode_centre")).toBe("No GPS captured");
  });
  it("tiers are unchanged by the wording", () => {
    expect(assess({ distanceM: 1400, accuracyM: 20, declared, govt: [govtMatch] }).tier).toBe("verified");
    expect(assess({ distanceM: 1400, accuracyM: 20, declared, govt: [] }).tier).toBe("needs_hr");
  });
});
