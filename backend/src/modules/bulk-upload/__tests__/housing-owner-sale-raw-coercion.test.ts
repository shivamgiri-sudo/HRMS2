import { describe, it, expect } from "vitest";
import {
  parseAmount, parseNullableAmount, parseCount, parseDate, HOUSING_OWNER_SALE_RAW_HEADERS,
} from "../housing-owner-sale-raw-bulk.service.js";

describe("parseAmount", () => {
  it("treats a blank as zero, because the column is NOT NULL with a 0 default", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount(null)).toBe(0);
  });
  it("reads Indian-formatted thousands", () => {
    expect(parseAmount("3,245")).toBe(3245);
  });
});

describe("parseNullableAmount", () => {
  it("keeps a blank null rather than treating it as zero", () => {
    expect(parseNullableAmount("")).toBeNull();
  });
  it("reads a real discount %", () => {
    expect(parseNullableAmount("49.99")).toBe(49.99);
  });
});

describe("parseCount", () => {
  it("falls back to the default (1) when blank", () => {
    expect(parseCount("", 1)).toBe(1);
  });
  it("reads a real count", () => {
    expect(parseCount("2", 1)).toBe(2);
  });
});

/** The real source is a plain .xlsx whose Date column reads as a native date. */
describe("parseDate", () => {
  it("reads a normal date string", () => {
    expect(parseDate("2026-09-01")).toBe("2026-09-01");
  });
  it("reads an Excel serial defensively (bulk-upload text pipeline)", () => {
    expect(parseDate(46266)).toBe("2026-09-01");
  });
  it("refuses garbage rather than inventing a date", () => {
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(HOUSING_OWNER_SALE_RAW_HEADERS).toContain("Opp_ID");
    expect(HOUSING_OWNER_SALE_RAW_HEADERS).toContain("Discount_Pct");
  });
});
