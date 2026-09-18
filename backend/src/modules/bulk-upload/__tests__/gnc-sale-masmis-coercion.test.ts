import { describe, it, expect } from "vitest";
import { parseGncDate, GNC_SALE_HEADERS } from "../gnc-sale-masmis-bulk.service.js";

describe("parseGncDate", () => {
  it("reads a real Excel serial (46235 = 2026-08-01)", () => {
    expect(parseGncDate(46235)).toBe("2026-08-01 00:00:00");
  });
  it("reads a real DD-Mon-YY sample", () => {
    expect(parseGncDate("01-Aug-26")).toBe("2026-08-01 00:00:00");
  });
  it("returns null for the sheet's own blank placeholders", () => {
    expect(parseGncDate("")).toBeNull();
    expect(parseGncDate("-")).toBeNull();
    expect(parseGncDate("0")).toBeNull();
  });
});

describe("headers", () => {
  it("names OrderID and Date, the row's required fields", () => {
    expect(GNC_SALE_HEADERS).toContain("OrderID");
    expect(GNC_SALE_HEADERS).toContain("Date");
  });
});
