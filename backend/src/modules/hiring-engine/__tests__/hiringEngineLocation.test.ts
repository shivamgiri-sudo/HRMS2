import { describe, expect, it } from "vitest";
import { branchLocationTokens, locationRegex } from "../he-location-match.js";

describe("drive location tokens", () => {
  it("Ahmedabad branch -> Ahmedabad region only", () => {
    const t = branchLocationTokens("AHMEDABAD-JALDARSHAN", "Ahmedabad");
    expect(t).toContain("ahmedabad"); expect(t).toContain("gandhinagar"); expect(t).not.toContain("noida");
  });
  it("Noida branch -> NCR", () => {
    const t = branchLocationTokens("NOIDA-2", null);
    expect(t).toEqual(expect.arrayContaining(["noida", "delhi", "ghaziabad", "gurgaon"]));
  });
  it("regex matches addresses, not substrings of other words", () => {
    const re = new RegExp(locationRegex(branchLocationTokens("AHMEDABAD-JALDARSHAN", "Ahmedabad"))!);
    expect(re.test("b-12 vastral, ahmedabad 382418")).toBe(true);
    expect(re.test("sector 62 noida")).toBe(false);
    const ncr = new RegExp(locationRegex(branchLocationTokens("NOIDA", "Noida"))!);
    expect(ncr.test("greater noida west")).toBe(true);
    expect(ncr.test("new delhi")).toBe(true);
    expect(ncr.test("ahmedabad")).toBe(false);
  });
  it("no usable tokens -> null", () => expect(locationRegex([])).toBeNull());
});
