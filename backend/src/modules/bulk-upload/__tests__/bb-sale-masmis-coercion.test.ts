import { describe, it, expect } from "vitest";
import { parseBellavitaDateOnly, parseBellavitaDateTime, BB_SALE_HEADERS } from "../bb-sale-masmis-bulk.service.js";

describe("parseBellavitaDateOnly", () => {
  it("reads a real Excel serial", () => {
    expect(parseBellavitaDateOnly(46200)).toBe("2026-06-27");
  });
  it("reads a real DD-Mon-YY sample", () => {
    expect(parseBellavitaDateOnly("29-Jun-26")).toBe("2026-06-29");
  });
  it("returns null for the sheet's own blank placeholders", () => {
    expect(parseBellavitaDateOnly("")).toBeNull();
    expect(parseBellavitaDateOnly("-")).toBeNull();
    expect(parseBellavitaDateOnly("0")).toBeNull();
  });
});

describe("parseBellavitaDateTime", () => {
  it("reads a real Excel serial with time component", () => {
    expect(parseBellavitaDateTime(46200.5)).toBe("2026-06-27 12:00:00");
  });
});

describe("headers", () => {
  it("names Bella Vita Order ID and Date, the row's required fields", () => {
    expect(BB_SALE_HEADERS).toContain("Bella Vita Order ID");
    expect(BB_SALE_HEADERS).toContain("Date");
  });
});
