import { describe, expect, it } from "vitest";
import { buildSourceUserMaps, classifySourceUser } from "../attendance-reconciliation-mapping.js";

/**
 * employees.employment_status is stored in mixed case. Measured on mas_hrms 2026-08-11:
 * 'Resigned' 28,200 vs 'resigned' 2,118; 'Active' 273 vs 'active' 1,039.
 *
 * MySQL's collation is case-insensitive so SQL filters behave, but this module is the
 * JavaScript side and `===` is not. `employment_status === "resigned"` missed 28,200
 * rows. It was harmless only because every capitalised row also had active_status = 0,
 * which the preceding condition catches — a coincidence, not a guarantee, and 122
 * ex-employees were still registering punches that day.
 */
const row = (over: Record<string, unknown> = {}) => ({
  employee_id: "e1",
  employee_code: "MAS1",
  cosec_user_id: "MAS1",
  active_status: 1,
  employment_status: "active",
  ...over,
});

describe("employment_status classification is case-insensitive", () => {
  for (const status of ["resigned", "Resigned", "RESIGNED", " Resigned "]) {
    it(`treats ${JSON.stringify(status)} as inactive even with active_status = 1`, () => {
      const maps = buildSourceUserMaps([row({ employment_status: status })], []);
      expect(classifySourceUser("MAS1", maps).kind).toBe("inactive");
    });
  }

  for (const status of ["terminated", "Terminated"]) {
    it(`treats ${JSON.stringify(status)} as inactive`, () => {
      const maps = buildSourceUserMaps([row({ employment_status: status })], []);
      expect(classifySourceUser("MAS1", maps).kind).toBe("inactive");
    });
  }

  for (const status of ["active", "Active"]) {
    it(`still treats ${JSON.stringify(status)} as active`, () => {
      const maps = buildSourceUserMaps([row({ employment_status: status })], []);
      expect(classifySourceUser("MAS1", maps).kind).toBe("active");
    });
  }

  it("keeps active_status = 0 authoritative regardless of employment_status", () => {
    const maps = buildSourceUserMaps([row({ active_status: 0, employment_status: "Active" })], []);
    expect(classifySourceUser("MAS1", maps).kind).toBe("inactive");
  });

  it("does not reclassify 'inactive' — that is a separate semantic change", () => {
    const maps = buildSourceUserMaps([row({ employment_status: "inactive" })], []);
    expect(classifySourceUser("MAS1", maps).kind).toBe("active");
  });
});
