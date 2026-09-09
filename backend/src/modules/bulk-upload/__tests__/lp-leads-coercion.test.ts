import { describe, it, expect } from "vitest";
import {
  parseNullableAmount, parseNullableInt, parseDate, LP_LEADS_HEADERS,
} from "../lp-leads-bulk.service.js";

describe("parseNullableAmount", () => {
  it("keeps a blank null", () => {
    expect(parseNullableAmount("")).toBeNull();
  });
  it("reads a real PL amount", () => {
    expect(parseNullableAmount("650000")).toBe(650000);
  });
});

describe("parseNullableInt", () => {
  it("keeps a blank null", () => {
    expect(parseNullableInt("")).toBeNull();
  });
  it("reads a real attempt count", () => {
    expect(parseNullableInt("2")).toBe(2);
  });
});

/** The real sample's Date/AllocatedOn columns are "01 Jul 2026" text. */
describe("parseDate", () => {
  it("reads the real 'DD Mon YYYY' format from the sample", () => {
    expect(parseDate("01 Jul 2026")).toBe("2026-07-01");
  });
  it("reads a later sample date", () => {
    expect(parseDate("14 Jul 2026")).toBe("2026-07-14");
  });
  it("reads a normal ISO date string", () => {
    expect(parseDate("2026-09-08")).toBe("2026-09-08");
  });
  it("reads an Excel serial defensively", () => {
    expect(parseDate(46204)).toBe("2026-07-01");
  });
  it("refuses garbage rather than inventing a date", () => {
    expect(parseDate("whenever")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(LP_LEADS_HEADERS).toContain("Name");
    expect(LP_LEADS_HEADERS).toContain("AllocatedOn");
    expect(LP_LEADS_HEADERS).toContain("Disposition");
  });
});
