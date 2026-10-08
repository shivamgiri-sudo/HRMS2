import { describe, it, expect } from "vitest";
import { parseCoverageDate, COVERAGE_SOURCES } from "../upload-coverage.service.js";

describe("parseCoverageDate", () => {
  it("reads every spelling the tables actually hold", () => {
    expect(parseCoverageDate("22-Aug-26")).toBe("2026-08-22");
    expect(parseCoverageDate("1-Sep-2026")).toBe("2026-09-01");
    expect(parseCoverageDate("2026-09-10")).toBe("2026-09-10");
    expect(parseCoverageDate("2026-09-10 12:30:00")).toBe("2026-09-10");
    expect(parseCoverageDate("15/09/2026 19:37:05", "dmy")).toBe("2026-09-15");
    expect(parseCoverageDate("9/15/26", "mdy")).toBe("2026-09-15");
    expect(parseCoverageDate("9/18/26 18:25", "mdy")).toBe("2026-09-18");
    expect(parseCoverageDate("46215")).toBe("2026-07-12");
  });
  it("uses the day-first reading when a slash date is unambiguous or unhinted", () => {
    expect(parseCoverageDate("25/09/2026")).toBe("2026-09-25");
    expect(parseCoverageDate("9/25/2026")).toBe("2026-09-25");
    expect(parseCoverageDate("03/04/2026")).toBe("2026-04-03");
  });
  it("rejects junk", () => {
    expect(parseCoverageDate("")).toBeNull();
    expect(parseCoverageDate(null)).toBeNull();
    expect(parseCoverageDate("31-Feb-26")).toBeNull();
    expect(parseCoverageDate("hello")).toBeNull();
    expect(parseCoverageDate("12345")).toBeNull();
  });
  it("covers every TPZ upload type", async () => {
    const { TPZ_UPLOAD_TYPES } = await import("../../tpz-access/tpz-access.catalog.js");
    for (const code of TPZ_UPLOAD_TYPES.keys()) expect(code in COVERAGE_SOURCES).toBe(true);
  });
});
