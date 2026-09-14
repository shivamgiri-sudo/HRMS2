import { describe, it, expect } from "vitest";
import {
  isErrorCode, cleanText, parseNullableDecimal, parseNullableInt, parseShopifyDateTime,
} from "../bla-bli-blu-shopify-sales-bulk.service.js";

describe("isErrorCode / cleanText", () => {
  it("detects the real Excel error byte codes seen in this file's corrupted VLOOKUP columns", () => {
    expect(isErrorCode("0x2a")).toBe(true);
    expect(cleanText("0x2a")).toBeNull();
  });
  it("keeps a real value", () => {
    expect(cleanText("BBB2559261")).toBe("BBB2559261");
  });
  it("treats 'None' (Python's null-as-string) as blank", () => {
    expect(cleanText("None")).toBeNull();
  });
});

describe("parseNullableDecimal / parseNullableInt", () => {
  it("parses real Total/Lineitem quantity samples", () => {
    expect(parseNullableDecimal(1041)).toBe(1041);
    expect(parseNullableInt(1)).toBe(1);
  });
  it("returns null for a corrupted cell, not a guessed number", () => {
    expect(parseNullableDecimal("0x2a")).toBeNull();
  });
});

describe("parseShopifyDateTime", () => {
  it("reads the real 'Created at' sample", () => {
    expect(parseShopifyDateTime("2026-09-09 01:07:11 +0530")).toBe("2026-09-09 01:07:11");
  });
  it("returns null for blank", () => {
    expect(parseShopifyDateTime("")).toBeNull();
  });
});
