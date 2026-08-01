/**
 * Dates and names on letters.
 *
 * MySQL DATE values arrive as Date objects; `toISOString().slice(0,10)` renders
 * them in UTC, which moves an Indian date back a day for anything stored at or
 * after 18:30 IST. Production has employee MAS60616 with date_of_joining
 * 2025-09-25T18:30:00Z — that is 26-09-2025 in India, and the printed
 * appointment letter says 26-09-2025. The old code printed 25-09-2025.
 *
 * A misdated appointment letter is a misdated legal instrument.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { istDate, istDisplayDate, istTimestamp, assertUsableName, isLikelyIncompleteName } from "../letterFormat.js";

describe("IST dates", () => {
  it("keeps MAS60616's joining date on 26-09, not 25-09", () => {
    const stored = new Date("2025-09-25T18:30:00.000Z");
    expect(stored.toISOString().slice(0, 10)).toBe("2025-09-25"); // the old bug
    expect(istDate(stored)).toBe("2025-09-26");                   // what the letter says
  });

  it("handles the whole 18:30 boundary correctly", () => {
    expect(istDate(new Date("2025-09-25T18:29:59.000Z"))).toBe("2025-09-25");
    expect(istDate(new Date("2025-09-25T18:30:00.000Z"))).toBe("2025-09-26");
  });

  it("passes through an already-plain date string unchanged", () => {
    expect(istDate("2025-09-26")).toBe("2025-09-26");
    expect(istDate("2025-09-26T00:00:00")).toBe("2025-09-26");
  });

  it("returns empty for absent values rather than 'Invalid Date'", () => {
    expect(istDate(null)).toBe("");
    expect(istDate(undefined)).toBe("");
    expect(istDate("")).toBe("");
    expect(istDate("not a date")).toBe("");
  });

  it("renders the display and timestamp forms in IST", () => {
    expect(istDisplayDate(new Date("2025-09-25T18:30:00.000Z"))).toBe("26 Sep 2025");
    expect(istTimestamp(new Date("2025-09-25T18:30:00.000Z"))).toContain("26 Sep 2025");
    expect(istTimestamp(new Date("2025-09-25T18:30:00.000Z"))).toContain("IST");
  });
});

describe("name guard", () => {
  it("refuses blank and too-short names", () => {
    for (const bad of ["", "  ", "A", null, undefined, "  X ", "A B"]) {
      expect(() => assertUsableName(bad)).toThrow();
    }
  });

  it("accepts and normalises a real name", () => {
    expect(assertUsableName("SHIVAM SHIV GIRI")).toBe("SHIVAM SHIV GIRI");
    expect(assertUsableName("  HARSH   TALWAR  ")).toBe("HARSH TALWAR");
  });

  it("does NOT hard-block a single-token name", () => {
    // A mononymous employee is normal in India; rejecting them outright would
    // block a real hire on a guess.
    expect(assertUsableName("HARSH ")).toBe("HARSH");
  });

  it("carries a machine-readable code so HR sees why issuance stopped", () => {
    try {
      assertUsableName("A");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("employee_name_incomplete");
      expect((e as { statusCode?: number }).statusCode).toBe(409);
    }
  });
});

describe("incomplete-name flag (advisory, not a hard block)", () => {
  it("flags the truncated name production actually holds", () => {
    // employees.full_name for MAS60616 is literally "HARSH " while the printed
    // letter reads "HARSH TALWAR".
    expect(isLikelyIncompleteName("HARSH ")).toBe(true);
  });

  it("flags any single-token name for HR confirmation", () => {
    expect(isLikelyIncompleteName("HARSH")).toBe(true);
    expect(isLikelyIncompleteName("")).toBe(true);
    expect(isLikelyIncompleteName(null)).toBe(true);
  });

  it("does not flag a normal multi-part name", () => {
    expect(isLikelyIncompleteName("HARSH TALWAR")).toBe(false);
    expect(isLikelyIncompleteName("SHIVAM SHIV GIRI")).toBe(false);
    expect(isLikelyIncompleteName("  HARSH   TALWAR  ")).toBe(false);
  });
});

describe("both letter callers use the resolver, not the dead columns", () => {
  const dir = path.resolve(__dirname, "..");
  for (const f of ["letters.service.ts", "letters.routes.ts"]) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

    it(`${f} no longer queries employee_salary_assignment`, () => {
      // That table has none of the 17 component columns, so every line rendered "0.00".
      expect(code).not.toContain("employee_salary_assignment");
      expect(code).not.toContain("basic_salary");
      expect(code).not.toContain("sal.");
    });

    it(`${f} renders salary from the resolver`, () => {
      expect(code).toContain("resolveAppointmentLetterSalary(");
      expect(code).toContain("...toLetterRows(salary),");
    });

    it(`${f} formats dates in IST and guards the name`, () => {
      expect(code).toContain("istDate(");
      expect(code).toContain("assertUsableName(");
      expect(code).not.toContain("toISOString().slice(0, 10)");
    });
  }
});
