import { describe, it, expect } from "vitest";
import {
  parseDate, parseDateTime, parseSecondsFlexible, parsePctFraction, parseNullableInt, cleanText,
  DALMIA_APR_UTILIZATION_HEADERS,
} from "../dalmia-apr-utilization-bulk.service.js";

describe("parseDate", () => {
  it("reads the real Date sample", () => {
    expect(parseDate("2026-07-01")).toBe("2026-07-01");
  });
});

describe("parseSecondsFlexible", () => {
  it("parses the real Login Time sample (09:07:15 = 32835 seconds)", () => {
    expect(parseSecondsFlexible("09:07:15")).toBe(32835);
  });
  it("cutoff is 1, not 3 -- a real 3-second value is not '3 days'", () => {
    expect(parseSecondsFlexible(3)).toBe(3);
  });
});

describe("parsePctFraction", () => {
  it("converts the real Utilization sample (0.4132866622912565 = 41.33%)", () => {
    expect(parsePctFraction(0.4132866622912565)).toBeCloseTo(41.328666, 5);
  });
});

describe("parseDateTime / parseNullableInt / cleanText", () => {
  it("parses Login/Logout timestamps", () => {
    expect(parseDateTime("2026-07-01 09:56:11")).toBe("2026-07-01 09:56:11");
  });
  it("parses No. of Calls/Chat", () => {
    expect(parseNullableInt(12)).toBe(12);
  });
  it("trims and nulls blank NOIID", () => {
    expect(cleanText(" MAS62624 ")).toBe("MAS62624");
  });
});

describe("headers", () => {
  it("names Unique ID and NOIID (the emp code column)", () => {
    expect(DALMIA_APR_UTILIZATION_HEADERS).toContain("Unique ID");
    expect(DALMIA_APR_UTILIZATION_HEADERS).toContain("NOIID");
  });
});
