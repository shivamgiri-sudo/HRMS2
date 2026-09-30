import { describe, it, expect } from "vitest";
import { classify, normalizeNumber10, planReceived, type IncomingRow } from "../received-rules.js";

/** The rules of Today_Only_Data_Upload_Logic_Requirement, "Logic Examples" sheet, as executable cases. */
const row = (date: string, phone: string | null, extra: Partial<IncomingRow> = {}): IncomingRow => ({ date, phone, ...extra });

describe("normalizeNumber10", () => {
  it("keeps the last 10 digits and ignores formatting and country code", () => {
    expect(normalizeNumber10("9876543210")).toBe("9876543210");
    expect(normalizeNumber10("+91 98765-43210")).toBe("9876543210");
    expect(normalizeNumber10("09876543210")).toBe("9876543210");
    expect(normalizeNumber10(9876543210)).toBe("9876543210");
    expect(normalizeNumber10("9.87654321E9")).toBe("9876543210");
  });
  it("returns null when there is no usable number", () => {
    expect(normalizeNumber10("")).toBeNull();
    expect(normalizeNumber10(null)).toBeNull();
    expect(normalizeNumber10("12345")).toBeNull();
    expect(normalizeNumber10("n/a")).toBeNull();
  });
});

describe("planReceived: one row per date and number", () => {
  it("row 1: a first occurrence is inserted", () => {
    const p = planReceived([row("2026-09-30", "9876543210")], new Set());
    expect(p.insert).toHaveLength(1);
    expect(p.duplicateSameDay).toEqual([]);
  });
  it("row 2: the same number on the same date is a duplicate, whether already stored or repeated in the file", () => {
    const stored = planReceived([row("2026-09-30", "9876543210")], new Set(["2026-09-30|9876543210"]));
    expect(stored.insert).toHaveLength(0);
    expect(stored.duplicateSameDay).toEqual([0]);
    const inFile = planReceived([row("2026-09-30", "9876543210"), row("2026-09-30", "+91 9876543210")], new Set());
    expect(inFile.insert).toHaveLength(1);
    expect(inFile.duplicateSameDay).toEqual([1]);
  });
  it("rows 3-4: the same number on a later date is a valid new row", () => {
    const p = planReceived([row("2026-10-01", "9876543210"), row("2026-10-02", "9876543210")], new Set(["2026-09-30|9876543210"]));
    expect(p.insert.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-02"]);
  });
  it("rows without a date or a usable number are reported, not stored", () => {
    const p = planReceived([row("", "9876543210"), row("2026-09-30", "123"), row("2026-09-30", null)], new Set());
    expect(p.insert).toHaveLength(0);
    expect(p.noDate).toEqual([0]);
    expect(p.noNumber).toEqual([1, 2]);
  });
  it("stores the normalised number", () => {
    expect(planReceived([row("2026-09-30", "+91-98765 43210")], new Set()).insert[0].phone).toBe("9876543210");
  });
});

describe("classify: Fresh or NC from the previous 1-3 days", () => {
  it("row 1: no earlier record is Fresh", () => expect(classify("2026-09-30", [])).toBe("Fresh"));
  it("row 3: the previous day makes it NC", () => expect(classify("2026-10-01", ["2026-09-30"])).toBe("NC"));
  it("row 4 and the 28-Sep example: two and three days back still make it NC", () => {
    expect(classify("2026-10-02", ["2026-09-30"])).toBe("NC");
    expect(classify("2026-09-30", ["2026-09-27"])).toBe("NC");
  });
  it("row 5: nothing in the previous 3 days is Fresh again", () => {
    expect(classify("2026-10-05", ["2026-09-30", "2026-10-01"])).toBe("Fresh");
  });
  it("the same date and later dates do not count as history", () => {
    expect(classify("2026-09-30", ["2026-09-30", "2026-10-01"])).toBe("Fresh");
  });
  it("works across a month and a year boundary", () => {
    expect(classify("2026-03-01", ["2026-02-27"])).toBe("NC");
    expect(classify("2027-01-02", ["2026-12-30"])).toBe("NC");
    expect(classify("2027-01-04", ["2026-12-30"])).toBe("Fresh");
  });
});
