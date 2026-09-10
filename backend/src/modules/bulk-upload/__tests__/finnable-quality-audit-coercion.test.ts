import { describe, it, expect } from "vitest";
import {
  parseNullableInt, parseNullableFlag, cleanText, parseCallDate, FINNABLE_QUALITY_AUDIT_HEADERS,
} from "../finnable-quality-audit-bulk.service.js";

describe("parseNullableInt", () => {
  it("reads the real sample's audit id", () => {
    expect(parseNullableInt(461220)).toBe(461220);
  });
  it("treats the real sample's literal 'None' as null, not zero", () => {
    expect(parseNullableInt("None")).toBeNull();
  });
});

describe("parseNullableFlag", () => {
  it("treats the real sample's literal 'None' as null -- not yet assessed, not 'no sale'", () => {
    expect(parseNullableFlag("None")).toBeNull();
  });
  it("reads a real 0/1 flag", () => {
    expect(parseNullableFlag(0)).toBe(0);
    expect(parseNullableFlag(1)).toBe(1);
  });
});

describe("cleanText", () => {
  it("treats the real sample's literal 'None' as null", () => {
    expect(cleanText("None", 100)).toBeNull();
  });
  it("keeps a real value", () => {
    expect(cleanText("No Meaningful Interaction", 100)).toBe("No Meaningful Interaction");
  });
});

/** CallDate arrives as "22-05-2026 17:00" (DD-MM-YYYY HH:MM) -- a new format for this session. */
describe("parseCallDate", () => {
  it("reads the real sample's DD-MM-YYYY HH:MM format (22-05-2026 17:00 = 2026-05-22 17:00:00)", () => {
    expect(parseCallDate("22-05-2026 17:00")).toBe("2026-05-22 17:00:00");
  });
  it("still reads an ISO date+time defensively", () => {
    expect(parseCallDate("2026-05-22 17:00")).toBe("2026-05-22 17:00:00");
  });
  it("refuses garbage rather than inventing a date", () => {
    expect(parseCallDate("")).toBeNull();
    expect(parseCallDate("None")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(FINNABLE_QUALITY_AUDIT_HEADERS).toContain("id");
    expect(FINNABLE_QUALITY_AUDIT_HEADERS).toContain("CallDate");
  });
});
