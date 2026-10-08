import { describe, it, expect } from "vitest";
import {
  parseNullableFlag,
  parseDate,
  parseCallDate,
  CLOVIA_FEEDBACK_HEADERS,
} from "../clovia-feedback-bulk.service.js";

describe("parseNullableFlag", () => {
  it("reads the real sample's Satisfied flag (1)", () => {
    expect(parseNullableFlag(1)).toBe(1);
  });
  it("reads the real sample's Not Satisfied flag (0)", () => {
    expect(parseNullableFlag(0)).toBe(0);
  });
  it("returns null for blank", () => {
    expect(parseNullableFlag("")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads the real plain Date Excel serial from the sample (46266 = 2026-09-01)", () => {
    expect(parseDate(46266)).toBe("2026-09-01");
  });
});

/** Call Date is a FRACTIONAL Excel serial (date + time-of-day). */
describe("parseCallDate", () => {
  it("reads the real fractional Call Date serial from the sample (46266.403645833336 = 2026-09-01 09:41:15)", () => {
    expect(parseCallDate(46266.403645833336)).toBe("2026-09-01 09:41:15");
  });
  it("returns null for blank", () => {
    expect(parseCallDate("")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(CLOVIA_FEEDBACK_HEADERS).toContain("Unique");
    // 65a8537f0 corrected the column names to the real export's: the rating column is
    // printed "C-SAT/D-SAT", not the "CSAT_DSAT" the first draft guessed.
    expect(CLOVIA_FEEDBACK_HEADERS).toContain("C-SAT/D-SAT");
    expect(CLOVIA_FEEDBACK_HEADERS).not.toContain("CSAT_DSAT");
    expect([...CLOVIA_FEEDBACK_HEADERS]).toEqual([
      "Unique", "Call Date", "Date", "Advisor Id", "Phone Number", "Language", "Option", "C-SAT/D-SAT",
    ]);
  });
});
