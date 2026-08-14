import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

/**
 * Silent-failure sweep, 2026-08-13 (later same day than Area 3): a comment inside
 * generateDraft() (see auto-roster-payroll-lock-guard.test.ts's own docstring)
 * claimed roster-lock-guard.ts was "already wired into ... the PM post-publish
 * correction endpoint" — changePublishedAssignment(), reachable via
 * PATCH /api/wfm/auto-roster/assignments/:id/published-change (admin/process_manager,
 * see auto-roster-synced.routes.ts). No such call actually existed anywhere in the
 * function: it validated change_reason length, plan approval_status, and (as of a
 * concurrent same-day fix) minimum-rest — but never attendance_daily_record.is_locked.
 * A payroll-locked, already-published assignment's shift/times could be silently
 * rewritten through this single, directly reachable, role-gated endpoint, with the
 * change fully queued as a normal sanctioned notification — the exact write the lock
 * exists to make untouchable through an ordinary path.
 */

const SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../auto-roster-synced.service.ts"),
  "utf-8"
);

function changePublishedAssignmentBody(): string {
  const start = SOURCE.indexOf("async changePublishedAssignment(input: {");
  expect(start).toBeGreaterThan(-1);
  // Function runs well past 2000 chars (change_reason validation, lock check, rest-policy
  // check, the UPDATE, the change-request INSERT, notification queueing, event logging) —
  // generous window, bounded by the next top-level method on the exported service object.
  const nextMethodIdx = SOURCE.indexOf("\n  async ", start + 50);
  return SOURCE.slice(start, nextMethodIdx > -1 ? nextMethodIdx : start + 6000);
}

describe("changePublishedAssignment's attendance/payroll-lock guard", () => {
  it("imports and calls checkEmployeeDateNotLocked", () => {
    expect(SOURCE).toMatch(/import \{ checkEmployeeDateNotLocked \} from "\.\.\/roster\/roster-lock-guard\.js";/);
    const body = changePublishedAssignmentBody();
    expect(body).toMatch(/checkEmployeeDateNotLocked\(db, String\(old\.employee_id\), String\(old\.roster_date\)\.slice\(0, 10\)\)/);
  });

  it("checks the lock before the UPDATE that rewrites shift_id/shift_start_time/shift_end_time", () => {
    const body = changePublishedAssignmentBody();
    const lockCheckIdx = body.indexOf("checkEmployeeDateNotLocked(db,");
    const updateIdx = body.indexOf("UPDATE wfm_roster_assignment");
    expect(lockCheckIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(lockCheckIdx).toBeLessThan(updateIdx);
  });

  it("throws (does not silently continue) when the date is locked", () => {
    const body = changePublishedAssignmentBody();
    const lockCheckIdx = body.indexOf("checkEmployeeDateNotLocked(db,");
    const nearby = body.slice(lockCheckIdx, lockCheckIdx + 300);
    expect(nearby).toMatch(/if \(dateLockResult\.blocked\)/);
    expect(nearby).toMatch(/throw Object\.assign/);
    expect(nearby).toMatch(/statusCode:\s*409/);
    expect(nearby).toMatch(/code:\s*"ROSTER_DATE_LOCKED"/);
  });

  it("checks the lock before the approval_status gate is bypassed and before any downstream rest-policy work", () => {
    const body = changePublishedAssignmentBody();
    const approvalGateIdx = body.indexOf('control.approval_status !== "published"');
    const lockCheckIdx = body.indexOf("checkEmployeeDateNotLocked(db,");
    const restCheckIdx = body.indexOf("validateMinimumRest(");
    expect(approvalGateIdx).toBeGreaterThan(-1);
    expect(lockCheckIdx).toBeGreaterThan(approvalGateIdx);
    expect(lockCheckIdx).toBeLessThan(restCheckIdx);
  });
});
