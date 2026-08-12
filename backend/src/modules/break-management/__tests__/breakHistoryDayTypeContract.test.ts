/**
 * Break History must classify W/O and Leave from the DERIVED attendance status, not from the
 * roster's publication state.
 *
 * getDailySummaryReport built its attendance_status column with:
 *
 *   WHEN bds.roster_status IN ('W/O', 'Leave') THEN bds.roster_status
 *
 * break_daily_summary.roster_status never holds either value. Measured live 2026-08-11 it
 * holds only 'published' or NULL — it is a roster PUBLICATION state, not a day type — so that
 * branch has never once fired, and a week-off or an approved leave was reported as 'Absent'
 * whenever there was no punch.
 *
 * bds.attendance_status is not the answer either: it carries live-board states ('On Duty',
 * 'Shift Completed', 'No Punch Found'). The derived, payroll-facing day type lives in
 * attendance_daily_record.attendance_status — week_off (116), week_off_worked (54),
 * leave_approved (14), holiday (9).
 *
 * The join is safe: (employee_id, record_date) has 0 duplicates in attendance_daily_record,
 * verified live, so it cannot fan out and inflate this report's row count.
 *
 * ⚠️ week_off_worked must NOT render as W/O. Those are days the employee actually worked their
 * week off — they punched in and took breaks, which is precisely what this report exists to
 * show. Collapsing them to 'W/O' would hide real worked time behind a day-type label.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = path.resolve(__dirname, "..", "break-management.service.ts");
const source = fs.readFileSync(SERVICE, "utf8");

/** The getDailySummaryReport query — the one that feeds Break History. */
function historyQuery(): string {
  const at = source.indexOf("FROM break_daily_summary bds");
  expect(at, "Break History query not found").toBeGreaterThan(-1);
  const start = source.lastIndexOf("`SELECT", at);
  return source.slice(start, source.indexOf("LIMIT ?", at));
}

describe("Break History classifies the day from the derived attendance status", () => {
  it("joins attendance_daily_record on employee and date", () => {
    const q = historyQuery();
    expect(q).toMatch(/JOIN\s+attendance_daily_record\s+adr/i);
    expect(q).toMatch(/adr\.employee_id\s*=\s*bds\.employee_id/);
    expect(q).toMatch(/adr\.record_date\s*=\s*bds\.shift_date/);
  });

  it("no longer reads the roster publication state as a day type", () => {
    // The exact defect: roster_status only ever holds 'published' or NULL.
    expect(historyQuery()).not.toMatch(/bds\.roster_status\s+IN\s*\(\s*'W\/O'/i);
  });

  it("maps week_off to W/O and leave_approved to Leave", () => {
    const q = historyQuery();
    expect(q).toMatch(/adr\.attendance_status\s*=\s*'week_off'[\s\S]{0,40}'W\/O'/);
    expect(q).toMatch(/adr\.attendance_status\s*=\s*'leave_approved'[\s\S]{0,40}'Leave'/);
  });

  it("does NOT collapse week_off_worked into W/O — that day was worked", () => {
    const q = historyQuery();
    const woBranch = q.slice(q.indexOf("'week_off'"), q.indexOf("'week_off'") + 120);
    expect(woBranch).not.toContain("week_off_worked");
  });

  it("keeps the punch-based classification intact for ordinary days", () => {
    const q = historyQuery();
    for (const label of ["'Absent'", "'Present'", "'Half Day'", "'Punch Missing'"]) {
      expect(q).toContain(label);
    }
  });
});
