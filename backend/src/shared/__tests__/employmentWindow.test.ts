import { describe, expect, it } from "vitest";
import { employmentWindows, isWithinWindows } from "../employmentWindow.js";

describe("employment window for attendance (salary start date .. exit date)", () => {
  it("allows only salary start date through exit date for a single stint", () => {
    const w = employmentWindows({ salaryStartDate: "2026-04-16", dateOfJoining: "2026-04-10", endDate: "2026-09-14", stints: [] });
    expect(isWithinWindows("2026-04-15", w)).toBe(false); // before salary start
    expect(isWithinWindows("2026-04-16", w)).toBe(true);
    expect(isWithinWindows("2026-09-14", w)).toBe(true);  // last working day
    expect(isWithinWindows("2026-09-15", w)).toBe(false); // the nightly job used to write absents here
  });

  it("falls back to joining date and stays open-ended without an exit", () => {
    const w = employmentWindows({ salaryStartDate: null, dateOfJoining: "2026-09-26", endDate: null, stints: [] });
    expect(isWithinWindows("2026-09-25", w)).toBe(false);
    expect(isWithinWindows("2027-01-01", w)).toBe(true);
  });

  it("blocks the gap between exit and rejoin, and ends the open stint at a new exit", () => {
    const w = employmentWindows({
      salaryStartDate: "2025-01-10", dateOfJoining: "2025-01-10", endDate: "2026-12-31",
      stints: [{ start: "2025-01-10", end: "2026-05-31" }, { start: "2026-08-01", end: null }],
    });
    expect(isWithinWindows("2026-05-31", w)).toBe(true);
    expect(isWithinWindows("2026-06-15", w)).toBe(false); // between stints
    expect(isWithinWindows("2026-08-01", w)).toBe(true);
    expect(isWithinWindows("2027-01-01", w)).toBe(false); // after the new resignation
  });
});
