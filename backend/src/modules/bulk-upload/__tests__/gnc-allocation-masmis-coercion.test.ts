import { describe, it, expect } from "vitest";
import { parseGncAllocationDate } from "../gnc-allocation-masmis-bulk.service.js";

describe("parseGncAllocationDate", () => {
  it("reads a real Excel serial", () => {
    expect(parseGncAllocationDate(46199)).toBe("2026-06-26");
  });
  it("reads a real ISO text sample", () => {
    expect(parseGncAllocationDate("2026-05-29")).toBe("2026-05-29");
  });
  it("returns null for the sheet's own blank placeholders", () => {
    expect(parseGncAllocationDate("")).toBeNull();
    expect(parseGncAllocationDate("-")).toBeNull();
  });
});
