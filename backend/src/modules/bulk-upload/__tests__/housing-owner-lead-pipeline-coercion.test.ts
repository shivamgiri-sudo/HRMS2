import { describe, it, expect } from "vitest";
import {
  parseDate, parseDateTime, parseDurationSeconds, parseBoolFlag, cleanText,
  HOUSING_OWNER_LEAD_PIPELINE_HEADERS,
} from "../housing-owner-lead-pipeline-bulk.service.js";

describe("parseDate", () => {
  it("reads the real Date Excel serial from the sample (46204 = 2026-07-01)", () => {
    expect(parseDate(46204)).toBe("2026-07-01");
  });
});

describe("parseDateTime", () => {
  it("reads the real fractional createdAt serial from the sample (46204.75386574074 = 2026-07-01 18:05:34)", () => {
    expect(parseDateTime(46204.75386574074)).toBe("2026-07-01 18:05:34");
  });
  it("returns null for blank", () => {
    expect(parseDateTime("")).toBeNull();
  });
});

/** A call never lasts a whole day, so talkTime's fraction-of-a-day is unambiguous by construction. */
describe("parseDurationSeconds", () => {
  it("converts the real talkTime sample (0.0007638888888887863 = 66 seconds)", () => {
    expect(parseDurationSeconds(0.0007638888888887863)).toBe(66);
  });
  it("returns null for blank", () => {
    expect(parseDurationSeconds("")).toBeNull();
  });
});

/** wrapupTime is not a real duration -- it is always exactly 1.0 when present. */
describe("parseBoolFlag", () => {
  it("reads the real constant wrapupTime sample as a boolean, not a duration", () => {
    expect(parseBoolFlag(1.0)).toBe(1);
  });
  it("returns null for blank", () => {
    expect(parseBoolFlag("")).toBeNull();
  });
});

describe("cleanText", () => {
  it("trims and nulls blank", () => {
    expect(cleanText(" DISCOVERY ")).toBe("DISCOVERY");
    expect(cleanText(null)).toBeNull();
  });
});

describe("headers", () => {
  it("names caseId and Date, together part of this row's identity", () => {
    expect(HOUSING_OWNER_LEAD_PIPELINE_HEADERS).toContain("caseId");
    expect(HOUSING_OWNER_LEAD_PIPELINE_HEADERS).toContain("Date");
  });
});
