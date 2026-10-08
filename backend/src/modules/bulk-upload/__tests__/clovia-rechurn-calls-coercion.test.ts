import { describe, it, expect } from "vitest";
import {
  parseDate, parseDateTime, CLOVIA_RECHURN_CALLS_HEADERS,
} from "../clovia-rechurn-calls-bulk.service.js";

describe("parseDate", () => {
  it("reads the real plain Date Excel serial from the sample (46266 = 2026-09-01)", () => {
    expect(parseDate(46266)).toBe("2026-09-01");
  });
});

/** Call Date/Abandoned Date are FRACTIONAL Excel serials (date + time-of-day). */
describe("parseDateTime", () => {
  it("reads the real fractional Call Date serial from the sample (46266.49591435185 = 2026-09-01 11:54:07)", () => {
    expect(parseDateTime(46266.49591435185)).toBe("2026-09-01 11:54:07");
  });
  it("reads the real fractional Abandoned Date serial from the sample (46266.48795138889 = 2026-09-01 11:42:39)", () => {
    expect(parseDateTime(46266.48795138889)).toBe("2026-09-01 11:42:39");
  });
  it("returns null for blank", () => {
    expect(parseDateTime("")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(CLOVIA_RECHURN_CALLS_HEADERS).toContain("Phone_Number");
    expect(CLOVIA_RECHURN_CALLS_HEADERS).toContain("Abandoned_Date");
  });
});
