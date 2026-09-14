import { describe, it, expect } from "vitest";
import {
  parseUnits, parseScore, parsePeriod, parseDate, PROCESS_DELIVERY_HEADERS,
} from "../process-delivery-bulk.service.js";

describe("parseUnits", () => {
  it("treats a blank as zero, because the column is NOT NULL with a 0 default", () => {
    expect(parseUnits("")).toBe(0);
    expect(parseUnits(null)).toBe(0);
  });
  it("reads Indian-formatted thousands", () => {
    expect(parseUnits("1,23,456")).toBe(123456);
    expect(parseUnits("450")).toBe(450);
  });
  it("does not let junk become a silent NaN in a NOT NULL column", () => {
    expect(parseUnits("n/a")).toBe(0);
  });
});

/** A score is nullable on purpose: "not measured" is not the same as scoring zero. */
describe("parseScore", () => {
  it("keeps a blank null rather than scoring it zero", () => {
    expect(parseScore("")).toBeNull();
    expect(parseScore("n/a")).toBeNull();
  });
  it("accepts a percentage with or without its sign", () => {
    expect(parseScore("87.5%")).toBe(87.5);
    expect(parseScore("87.5")).toBe(87.5);
  });
  it("rescales a fraction that would otherwise read as under one percent", () => {
    expect(parseScore("0.875")).toBe(87.5);
  });
});

describe("parsePeriod", () => {
  it("accepts the three shapes a monthly sheet actually uses", () => {
    expect(parsePeriod("2026-09", null)).toBe("2026-09");
    expect(parsePeriod("9-2026", null)).toBe("2026-09");
    expect(parsePeriod("Sep-2026", null)).toBe("2026-09");
  });
  it("falls back to the activity date rather than rejecting a daily sheet", () => {
    expect(parsePeriod("", "2026-09-08")).toBe("2026-09");
  });
  it("returns null when neither is usable, so the row errors instead of guessing", () => {
    expect(parsePeriod("", null)).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads the formats these sheets mix", () => {
    expect(parseDate("2026-09-08")).toBe("2026-09-08");
    expect(parseDate("8-Sep-2026")).toBe("2026-09-08");
    expect(parseDate("9/8/2026")).toBe("2026-09-08");
  });
  it("refuses anything else rather than inventing a date", () => {
    expect(parseDate("last Tuesday")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(PROCESS_DELIVERY_HEADERS).toHaveLength(15);
    expect(PROCESS_DELIVERY_HEADERS[0]).toBe("Process Code");
    expect(PROCESS_DELIVERY_HEADERS).toContain("Delivered Units");
    expect(PROCESS_DELIVERY_HEADERS).toContain("SLA Score");
  });
});
