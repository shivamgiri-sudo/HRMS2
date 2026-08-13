import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * getWorkforceDashboard's hand-rolled productiveEquivalent (which shrinkage_pct is
 * derived from) counted only attendance_status = 'present', omitting
 * 'week_off_worked' — reintroducing, in this one local calculation, the exact bug
 * shared/attendanceStatus.ts's PRESENT_STATUSES exists to prevent elsewhere in the
 * same file. On a day with week_off_worked rows, this understated productiveEquivalent
 * and therefore overstated shrinkage_pct, next to a correctly-computed Attendance Rate
 * tile on the same CEO dashboard row.
 */
describe("getWorkforceDashboard productiveEquivalent counts week_off_worked as present", () => {
  const source = readFileSync(
    resolve(__dirname, "../management.service.ts"),
    "utf-8",
  );

  it("imports the shared PRESENT_STATUSES vocabulary", () => {
    expect(source).toMatch(/PRESENT_STATUSES/);
  });

  it("derives productiveEquivalent from PRESENT_STATUSES, not attendanceByStatus.present alone", () => {
    const start = source.indexOf("const productiveEquivalent");
    expect(start, "productiveEquivalent computation not found").toBeGreaterThan(-1);
    const slice = source.slice(start, start + 300);
    expect(slice).toMatch(/PRESENT_STATUSES\.reduce/);
    expect(slice).not.toMatch(/numberValue\(attendanceByStatus\.present\)\s*\n\s*\+/);
  });

  it("derives the expected-to-work exclusion list from the shared vocabulary, not a hand-maintained copy", () => {
    const start = source.indexOf("const nonWorkingCount");
    expect(start, "nonWorkingCount computation not found").toBeGreaterThan(-1);
    const slice = source.slice(start, start + 200);
    expect(slice).toMatch(/EXPECTED_TO_WORK_EXCLUSIONS\.reduce/);
  });
});
