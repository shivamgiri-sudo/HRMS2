import { describe, it, expect } from "vitest";
import {
  parseNullableDecimal, parseDate, CLOVIA_QUALITY_AUDIT_HEADERS,
} from "../clovia-quality-audit-bulk.service.js";

describe("parseNullableDecimal", () => {
  it("reads a real audit score from the sample", () => {
    expect(parseNullableDecimal("17")).toBe(17);
  });
  it("reads the real CQ Score", () => {
    expect(parseNullableDecimal("1")).toBe(1);
  });
  it("returns null for blank", () => {
    expect(parseNullableDecimal("")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads the real plain Excel serial from the sample (46266 = 2026-09-01)", () => {
    expect(parseDate(46266)).toBe("2026-09-01");
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(CLOVIA_QUALITY_AUDIT_HEADERS).toContain("Unique");
    expect(CLOVIA_QUALITY_AUDIT_HEADERS).toContain("Chat_ID");
    expect(CLOVIA_QUALITY_AUDIT_HEADERS).toContain("CQ_Score");
  });
});
