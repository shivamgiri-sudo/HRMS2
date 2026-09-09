import { describe, it, expect } from "vitest";
import {
  parseAmount, parseNullableAmount, parseDate, HOUSING_PREMIUM_SALE_RAW_HEADERS,
} from "../housing-premium-sale-raw-bulk.service.js";

describe("parseAmount", () => {
  it("treats a blank as zero, because the column is NOT NULL with a 0 default", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount(null)).toBe(0);
  });
  it("reads Indian-formatted thousands", () => {
    expect(parseAmount("1,074")).toBe(1074);
  });
});

/** order_value/target are nullable: "not supplied" must not silently become zero. */
describe("parseNullableAmount", () => {
  it("keeps a blank null rather than treating it as zero", () => {
    expect(parseNullableAmount("")).toBeNull();
    expect(parseNullableAmount(null)).toBeNull();
  });
  it("reads a real value", () => {
    expect(parseNullableAmount("1528")).toBe(1528);
  });
});

/**
 * The live source's date columns are plain Excel serials with no time
 * component -- confirmed by reading the real workbook (unlike Clovia CRM
 * Disposition's fractional Date column).
 */
describe("parseDate", () => {
  it("reads the real Excel serial from the live workbook (46235 = 2026-08-01)", () => {
    expect(parseDate(46235)).toBe("2026-08-01");
  });
  it("reads Created_At's real serial too (46030 = 2026-01-08)", () => {
    expect(parseDate(46030)).toBe("2026-01-08");
  });
  it("still reads a normal date string, for a sheet already reformatted", () => {
    expect(parseDate("2026-09-08")).toBe("2026-09-08");
  });
  it("refuses anything else rather than inventing a date", () => {
    expect(parseDate("last Tuesday")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(HOUSING_PREMIUM_SALE_RAW_HEADERS).toContain("Order_ID");
    expect(HOUSING_PREMIUM_SALE_RAW_HEADERS).toContain("Created_At");
    expect(HOUSING_PREMIUM_SALE_RAW_HEADERS).toContain("Target");
  });
});
