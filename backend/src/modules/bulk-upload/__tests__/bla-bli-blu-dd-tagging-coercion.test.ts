import { describe, it, expect } from "vitest";
import {
  parseDateTime, parseNullableDecimal, parseNullableSeconds, parseAgentCode, cleanText,
  BLA_BLI_BLU_DD_TAGGING_HEADERS,
} from "../bla-bli-blu-dd-tagging-bulk.service.js";

/** This is an HTML-table export off the DialDesk website, not a real Excel
 * workbook -- every value arrives as plain text, never an Excel serial. */
describe("parseDateTime", () => {
  it("reads the real plain-text CallDate sample", () => {
    expect(parseDateTime("2026-09-08 10:14:53")).toBe("2026-09-08 10:14:53");
  });
  it("defaults a date-only value to midnight", () => {
    expect(parseDateTime("2026-09-08")).toBe("2026-09-08 00:00:00");
  });
  it("returns null for blank", () => {
    expect(parseDateTime("")).toBeNull();
  });
});

describe("parseNullableDecimal", () => {
  it("parses a real Sale Amt with GST value", () => {
    expect(parseNullableDecimal("1074")).toBe(1074);
  });
  it("returns null for blank, not zero", () => {
    expect(parseNullableDecimal("")).toBeNull();
  });
});

describe("parseNullableSeconds", () => {
  it("parses the real Closer Time sample (plain integer text, not a fraction-of-a-day)", () => {
    expect(parseNullableSeconds("0")).toBe(0);
    expect(parseNullableSeconds("125")).toBe(125);
  });
  it("returns null for blank", () => {
    expect(parseNullableSeconds("")).toBeNull();
  });
});

describe("parseAgentCode", () => {
  it("extracts the real MAS code out of the real Call Created sample", () => {
    expect(parseAgentCode("DialDesk - MAS60037")).toBe("MAS60037");
  });
  it("returns null when no MAS code is present", () => {
    expect(parseAgentCode("System")).toBeNull();
    expect(parseAgentCode("")).toBeNull();
  });
});

describe("cleanText", () => {
  it("trims and returns null for blank", () => {
    expect(cleanText("  Complaint  ")).toBe("Complaint");
    expect(cleanText("")).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });
});

describe("headers", () => {
  it("names Call Id, the row's identity column", () => {
    expect(BLA_BLI_BLU_DD_TAGGING_HEADERS).toContain("Call Id");
    expect(BLA_BLI_BLU_DD_TAGGING_HEADERS).toContain("CallDate");
  });
});
