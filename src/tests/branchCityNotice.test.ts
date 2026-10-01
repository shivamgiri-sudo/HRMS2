import { describe, it, expect } from "vitest";
import { isDifferentCity } from "@/components/onboarding-full/BranchCityNotice";

describe("isDifferentCity", () => {
  it("flags a clearly different city", () => {
    expect(isDifferentCity("Noida", "Lucknow")).toBe(true);
  });
  it("treats the same city as matching regardless of case and punctuation", () => {
    expect(isDifferentCity("NOIDA", "noida ")).toBe(false);
  });
  it("treats known aliases and neighbours as the same place", () => {
    expect(isDifferentCity("Gurugram", "Gurgaon")).toBe(false);
    expect(isDifferentCity("Bengaluru", "Bangalore")).toBe(false);
    expect(isDifferentCity("Noida", "Greater Noida")).toBe(false);
    expect(isDifferentCity("Delhi", "New Delhi")).toBe(false);
  });
  it("never warns when either side is unknown", () => {
    expect(isDifferentCity("", "Lucknow")).toBe(false);
    expect(isDifferentCity("Noida", null)).toBe(false);
    expect(isDifferentCity(undefined, undefined)).toBe(false);
  });
});
