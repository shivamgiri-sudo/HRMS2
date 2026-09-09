import { describe, it, expect } from "vitest";
import {
  parseNullableInt, parseDate, parseDateTime, CLOVIA_OUTBOUND_CDR_HEADERS,
} from "../clovia-outbound-cdr-bulk.service.js";

describe("parseNullableInt", () => {
  it("reads the real row-identity Count value", () => {
    expect(parseNullableInt("1")).toBe(1);
  });
  it("reads a real Length_Sec value", () => {
    expect(parseNullableInt("24")).toBe(24);
  });
});

describe("parseDate", () => {
  it("reads the real plain Call_Date Excel serial from the sample (46266 = 2026-09-01)", () => {
    expect(parseDate(46266)).toBe("2026-09-01");
  });
});

/** Start_Time/End_Time are FRACTIONAL Excel serials (date + time-of-day). */
describe("parseDateTime", () => {
  it("reads the real fractional Start_Time serial from the sample (46266.440254629626 = 2026-09-01 10:33:58)", () => {
    expect(parseDateTime(46266.440254629626)).toBe("2026-09-01 10:33:58");
  });
  it("reads the real fractional End_Time serial from the sample (46266.44053240741 = 2026-09-01 10:34:22)", () => {
    expect(parseDateTime(46266.44053240741)).toBe("2026-09-01 10:34:22");
  });
  it("returns null for blank", () => {
    expect(parseDateTime("")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(CLOVIA_OUTBOUND_CDR_HEADERS).toContain("UAN");
    expect(CLOVIA_OUTBOUND_CDR_HEADERS).toContain("Length_Sec");
  });
});
