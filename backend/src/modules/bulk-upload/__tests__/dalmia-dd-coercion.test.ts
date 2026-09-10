import { describe, it, expect } from "vitest";
import { parseDateTime, parseNullableInt, cleanText, DALMIA_DD_HEADERS } from "../dalmia-dd-bulk.service.js";

describe("parseDateTime", () => {
  it("reads the real CallDate sample", () => {
    expect(parseDateTime("2026-07-01 10:12:47")).toBe("2026-07-01 10:12:47");
  });
  it("falls back to midnight for a date-only string", () => {
    expect(parseDateTime("2026-07-01")).toBe("2026-07-01 00:00:00");
  });
});

describe("parseNullableInt", () => {
  it("parses the real Call Id sample", () => {
    expect(parseNullableInt(158792)).toBe(158792);
  });
  it("returns null for blank, not zero", () => {
    expect(parseNullableInt("")).toBeNull();
  });
});

describe("cleanText", () => {
  it("trims and nulls blank", () => {
    expect(cleanText(" Closed ")).toBe("Closed");
    expect(cleanText(null)).toBeNull();
  });
});

describe("headers", () => {
  it("names Call Id, this row's identity column", () => {
    expect(DALMIA_DD_HEADERS).toContain("Call Id");
  });
});
