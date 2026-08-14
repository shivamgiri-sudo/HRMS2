import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

/**
 * Silent-failure sweep, 2026-08-13 (later same day than Area 3): generateDraft()'s
 * pre-regeneration DELETE of non-published assignments (a plan's stale draft rows,
 * cleared before regenerating) only checked wfm_roster_assignment_control's
 * change_lock_status — never attendance_daily_record.is_locked, the actual
 * payroll-lock signal roster-lock-guard.ts exists to enforce. The per-employee
 * checkEmployeeDateNotLocked call a few lines later (covered by
 * auto-roster-payroll-lock-guard.test.ts) only refuses to RE-INSERT a locked
 * employee/date — it does nothing to protect that same row from being deleted a
 * moment earlier by this statement, since the DELETE runs before the loop ever
 * reaches that employee. A stale draft regenerated after its date range had
 * attendance locked for payroll independently could silently destroy an existing,
 * payroll-locked assignment row with no write ever individually authorized to
 * touch it — the conflict log would only show "regeneration skipped this
 * employee", not "an existing locked record was deleted".
 */

const SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../auto-roster-synced.service.ts"),
  "utf-8"
);

describe("generateDraft's pre-regeneration DELETE respects the payroll lock", () => {
  it("the DELETE excludes rows whose attendance is locked for payroll, not just change_lock_status", () => {
    const deleteIdx = SOURCE.indexOf("DELETE wra FROM wfm_roster_assignment wra");
    expect(deleteIdx).toBeGreaterThan(-1);
    const deleteStatement = SOURCE.slice(deleteIdx, deleteIdx + 700);
    expect(deleteStatement).toMatch(/change_lock_status/); // original guard, still present
    expect(deleteStatement).toMatch(/NOT EXISTS/);
    expect(deleteStatement).toMatch(/attendance_daily_record adr/);
    expect(deleteStatement).toMatch(/adr\.is_locked\s*=\s*1/);
    expect(deleteStatement).toMatch(/adr\.employee_id\s*=\s*wra\.employee_id/);
    expect(deleteStatement).toMatch(/adr\.record_date\s*=\s*wra\.roster_date/);
  });

  it("the NOT EXISTS lock check is inside the same DELETE statement, before the later per-employee assignment loop", () => {
    const deleteIdx = SOURCE.indexOf("DELETE wra FROM wfm_roster_assignment wra");
    const notExistsIdx = SOURCE.indexOf("NOT EXISTS", deleteIdx);
    const loopIdx = SOURCE.indexOf("for (const emp of selected) {");
    expect(notExistsIdx).toBeGreaterThan(deleteIdx);
    expect(notExistsIdx).toBeLessThan(loopIdx);
  });
});
