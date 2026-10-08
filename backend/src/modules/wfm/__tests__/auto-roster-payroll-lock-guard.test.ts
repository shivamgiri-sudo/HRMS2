import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

/**
 * Area 3 gap-closing (2026-08-13): generateDraft() — the live engine's main
 * per-employee-per-slot assignment loop — was one of three write paths to
 * wfm_roster_assignment still missing the shared attendance/payroll-lock
 * check (roster-lock-guard.ts), already wired into manual assignment,
 * manager realignment, and shift-swap apply. Source-level assertions,
 * matching this suite's established style for a function embedded in a
 * large enclosing service rather than exported standalone (see
 * auto-roster-locked-assignment.test.ts).
 *
 * (This comment previously also listed "the PM post-publish correction
 * endpoint" as already covered — a same-day silent-failure sweep found no
 * such call actually existed in changePublishedAssignment(). See
 * auto-roster-published-change-lock-guard.test.ts for that fix's coverage,
 * and auto-roster-regenerate-delete-lock-guard.test.ts for a second,
 * related bug the same sweep found in this file's DELETE right before this
 * loop.)
 */

const SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../auto-roster-synced.service.ts"),
  "utf-8"
);

describe("generateDraft's per-employee attendance/payroll-lock guard (Area 3)", () => {
  it("imports the shared roster-lock-guard module rather than a private copy of the query", () => {
    expect(SOURCE).toMatch(/import \{ checkEmployeeDateNotLocked \} from "\.\.\/roster\/roster-lock-guard\.js";/);
  });

  it("checks the lock inside the per-employee assignment loop, before the row is added to assignedToday", () => {
    const loopStart = SOURCE.indexOf("for (const emp of selected) {");
    // Window sized with margin past assignedToday.add(...)'s actual offset (measured
    // 2026-08-13: ~3444 chars) rather than pinned tight to it — a comment edit shifting
    // this by a couple lines shouldn't make an unrelated ordering assertion fail.
    const loopBody = SOURCE.slice(loopStart, loopStart + 4000);
    const lockCheckIdx = loopBody.indexOf("checkEmployeeDateNotLocked(db, String(emp.id)");
    const assignedTodayIdx = loopBody.indexOf("assignedToday.add(String(emp.id))");
    expect(lockCheckIdx).toBeGreaterThan(-1);
    expect(assignedTodayIdx).toBeGreaterThan(-1);
    expect(lockCheckIdx).toBeLessThan(assignedTodayIdx);
  });

  it("records a conflict and skips the employee rather than throwing (automated path degrades to understaffed, not a hard failure)", () => {
    const loopStart = SOURCE.indexOf("for (const emp of selected) {");
    const loopBody = SOURCE.slice(loopStart, loopStart + 4000);
    expect(loopBody).toMatch(/conflict_type: "attendance_payroll_locked"/);
    expect(loopBody).toMatch(/continue; \/\/ not assigned to this slot; the date is off-limits to ordinary regeneration/);
  });
});
