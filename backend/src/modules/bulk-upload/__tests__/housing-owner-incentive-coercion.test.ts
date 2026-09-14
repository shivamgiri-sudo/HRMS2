import { describe, it, expect } from "vitest";
import {
  isErrorCode, parseNullableDecimal, parseNullablePctFraction, cleanText, isValidPeriod,
  HOUSING_OWNER_INCENTIVE_HEADERS,
} from "../housing-owner-incentive-bulk.service.js";

/** The source stores broken-formula cells as literal Excel error byte codes. */
describe("isErrorCode", () => {
  it("recognises the two real error codes found live (#REF!/#N/A)", () => {
    expect(isErrorCode("0x17")).toBe(true);
    expect(isErrorCode("0x2a")).toBe(true);
    expect(isErrorCode("0X2A")).toBe(true);
  });
  it("does not flag a real value", () => {
    expect(isErrorCode("Band B")).toBe(false);
    expect(isErrorCode(160000)).toBe(false);
  });
});

describe("parseNullableDecimal", () => {
  it("parses a real value from the sample", () => {
    expect(parseNullableDecimal(160000)).toBe(160000);
  });
  it("drops an error-code cell to null, not a guessed number", () => {
    expect(parseNullableDecimal("0x17")).toBeNull();
  });
  it("keeps a blank null, not zero", () => {
    expect(parseNullableDecimal("")).toBeNull();
  });
});

describe("parseNullablePctFraction", () => {
  it("converts a real Achievement % fraction sample", () => {
    expect(parseNullablePctFraction(0.5)).toBe(50);
  });
  it("drops an error-code cell to null", () => {
    expect(parseNullablePctFraction("0x2a")).toBeNull();
  });
});

describe("cleanText", () => {
  it("trims a real value and drops an error code", () => {
    expect(cleanText(" Vivek Ojha TL ")).toBe("Vivek Ojha TL");
    expect(cleanText("0x2a")).toBeNull();
    expect(cleanText("")).toBeNull();
  });
});

describe("isValidPeriod", () => {
  it("accepts the real YYYY-MM period", () => {
    expect(isValidPeriod("2026-07")).toBe(true);
  });
  it("rejects the source's own unreliable in-sheet month label", () => {
    expect(isValidPeriod("Mar")).toBe(false);
  });
});

describe("headers", () => {
  it("names Agent Name and Report_Period, this row's identity", () => {
    expect(HOUSING_OWNER_INCENTIVE_HEADERS).toContain("Agent Name");
    expect(HOUSING_OWNER_INCENTIVE_HEADERS).toContain("Report_Period");
  });
});
