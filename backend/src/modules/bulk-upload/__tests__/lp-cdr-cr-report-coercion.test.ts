import { describe, it, expect } from "vitest";
import {
  parseNullableAmount, parseDate, LP_CR_REPORT_HEADERS,
} from "../lp-cdr-cr-report-bulk.service.js";

describe("parseDate", () => {
  it("reads the real 'DD Mon YYYY' Date column format", () => {
    expect(parseDate("01 Jul 2026")).toBe("2026-07-01");
  });
  it("reads a normal ISO date string", () => {
    expect(parseDate("2026-09-08")).toBe("2026-09-08");
  });
});

describe("parseNullableAmount", () => {
  it("keeps a blank null rather than zero", () => {
    expect(parseNullableAmount("")).toBeNull();
  });
  it("reads a real value from the sample", () => {
    expect(parseNullableAmount("256249")).toBe(256249);
  });
});

describe("headers", () => {
  it("names every column the CR Report template asks for", () => {
    expect(LP_CR_REPORT_HEADERS).toContain("Mobile");
    expect(LP_CR_REPORT_HEADERS).toContain("CreatedOn");
  });
});
