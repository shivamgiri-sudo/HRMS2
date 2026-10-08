import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Manual attendance override must only read columns attendance_daily_record has.
 *
 * THE DEFECT THIS PINS
 * getCurrentAttendance() selected shift_id. attendance_daily_record has no such
 * column — and no shift column of any kind. Verified live 2026-08-15 across all 45
 * of its columns.
 *
 * That helper is on BOTH paths: creating an override and approving one. So the
 * whole feature raised ER_BAD_FIELD_ERROR on first contact and nothing could ever
 * be overridden. attendance_manual_override holds 0 rows against 128,963
 * attendance records, which is what "never once completed" looks like.
 *
 * This is not a cosmetic path. Manual override is how payroll corrects a person's
 * attendance, gated to super_admin / admin / payroll_head / payroll_admin, and it
 * carries payroll_month locking and higher-approval logic. All of that machinery
 * sat behind a SELECT that could not run.
 *
 * old_shift_id on the override table is nullable and now stays NULL, which is the
 * truthful value: the attendance record has no shift to capture. Sourcing one from
 * the roster would be a feature decision, not a column rename.
 */
const SRC = readFileSync(resolve(__dirname, "../attendance.manual-override.routes.ts"), "utf8");

/** attendance_daily_record, as it exists in production on 2026-08-15. */
const ADR_COLUMNS = new Set([
  "id", "employee_id", "record_date", "clock_in_time", "clock_out_time", "work_mode",
  "clock_in_lat", "clock_in_lng", "clock_in_location", "clock_out_lat", "clock_out_lng",
  "clock_out_location", "process_id", "branch_id", "attendance_source", "source_system",
  "source_record_date", "source_reference", "dialler_minutes", "biometric_minutes",
  "biometric_status", "apr_status", "mismatch_flag", "mismatch_resolved_at",
  "mismatch_resolved_by", "mismatch_resolution_reason", "raw_minutes", "attendance_status",
  "lwp_value", "late_mark", "late_by_minutes", "rule_config_id", "regularization_id",
  "override_by", "override_reason", "is_locked", "processed_at", "created_by", "created_at",
  "updated_at", "old_attendance_status", "old_lwp_value", "status_change_reason",
  "status_changed_by", "status_changed_at",
]);

/** Columns named in any `SELECT ... FROM attendance_daily_record` in this file. */
function selectedFromAdr(src: string): string[] {
  const out = new Set<string>();
  const re = /SELECT\s+([\s\S]*?)\s+FROM\s+attendance_daily_record/gi;
  for (const m of src.matchAll(re)) {
    for (const raw of m[1].split(",")) {
      const token = raw.trim().split(/\s+AS\s+/i)[0].trim().replace(/^[a-z_]+\./i, "");
      if (/^[a-z_][a-z0-9_]*$/i.test(token)) out.add(token.toLowerCase());
    }
  }
  return [...out];
}

describe("manual override reads only real attendance_daily_record columns", () => {
  it("finds the SELECT (guards against a broken matcher)", () => {
    expect(selectedFromAdr(SRC).length).toBeGreaterThan(0);
  });

  it("selects no column the table does not have", () => {
    const unknown = selectedFromAdr(SRC).filter((c) => !ADR_COLUMNS.has(c));
    expect(
      unknown,
      unknown.length === 0
        ? ""
        : `\nattendance_daily_record has no such column(s): ${unknown.join(", ")}\n`,
    ).toEqual([]);
  });

  it("specifically no longer reads shift_id", () => {
    expect(SRC).not.toMatch(/shift_id,\s*is_locked/);
    expect(SRC).not.toMatch(/current\.shift_id/);
  });

  it("still captures the state it can legitimately capture", () => {
    // The fix must not have gutted the before-image the override audit depends on.
    expect(SRC).toMatch(/SELECT id, attendance_status, lwp_value, is_locked/);
    expect(SRC).toMatch(/current\.attendance_status/);
    expect(SRC).toMatch(/current\.lwp_value/);
  });

  it("keeps old_shift_id in the insert, written as NULL", () => {
    // The column stays in the override record — the value is simply unavailable.
    expect(SRC).toMatch(/old_shift_id/);
    expect(SRC).toMatch(/null,\s*\/\/ old_shift_id/);
  });
});
