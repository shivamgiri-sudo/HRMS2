import { describe, it, expect } from "vitest";
import {
  parseFtrFlag, parseDate, CLOVIA_CRM_DISPOSITION_HEADERS,
} from "../clovia-crm-disposition-bulk.service.js";

describe("parseFtrFlag", () => {
  it("reads the two real values found in the live sheet", () => {
    expect(parseFtrFlag("1")).toBe(1);
    expect(parseFtrFlag("0")).toBe(0);
    expect(parseFtrFlag(0)).toBe(0);
  });
  it("treats a blank as unknown, not a failure", () => {
    expect(parseFtrFlag("")).toBeNull();
    expect(parseFtrFlag(null)).toBeNull();
  });
});

/**
 * The live source's Date column is a fractional Excel serial (date + time of
 * day) -- Math.floor, not Math.round, or an afternoon timestamp rolls into
 * the next day.
 */
describe("parseDate", () => {
  it("floors a fractional serial rather than rounding it into the next day", () => {
    // 46266.399... is 2026-09-01 morning; rounding would give 46266 too, but
    // a later-in-day fraction (46266.9) must still floor to the same day.
    expect(parseDate(46266.39959490741)).toBe("2026-09-01");
    expect(parseDate(46266.9)).toBe("2026-09-01");
  });
  it("also accepts a bare numeric string", () => {
    expect(parseDate("46266.4")).toBe("2026-09-01");
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
  it("names EMP Name, not the CRM's own Agent Name column", () => {
    expect(CLOVIA_CRM_DISPOSITION_HEADERS).toContain("EMP Name");
    // Agent Name in the live sheet is a Purple Panda login email, not a MAS
    // agent identity -- deliberately never accepted here.
    expect(CLOVIA_CRM_DISPOSITION_HEADERS as readonly string[]).not.toContain("Agent Name");
  });
});
