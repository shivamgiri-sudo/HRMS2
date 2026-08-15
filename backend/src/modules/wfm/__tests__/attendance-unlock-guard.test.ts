/**
 * POST /api/wfm/attendance-engine/:employeeId/:date/unlock set is_locked = 0 with one
 * actor, no reason, no payroll-closure check, and no durable audit — its only record was
 * a console.log, which is not queryable, not retained, and invisible to the screens that
 * read sensitive_action_log.
 *
 * That made it the single call that defeats the entire Part A.3 lock-guard family.
 * roster-lock-guard.ts (isRosterDateLocked / checkAssignmentDateNotLocked /
 * checkEmployeeDateNotLocked) refuses roster writes whenever
 * attendance_daily_record.is_locked = 1, telling the caller to "use the payroll
 * correction/reopen workflow instead". This endpoint clears that exact flag — so
 * unlocking a day inside a finalised run re-opened every ordinary write path against a
 * month already paid and filed.
 *
 * The guards added here deliberately mirror the shape already signed off for the A.3
 * manager-override endpoints on 2026-08-13 (locked -> 409, reason-required -> 400,
 * additive only). What is NOT implemented here, because it needs a role-hierarchy ruling:
 * a second approver, a time-boxed reopen, and automatic re-lock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CLOSED_RUN_STATUSES } from "../../payroll/run-status.js";

const SOURCE_PATH = "src/modules/wfm/attendance-engine.routes.ts";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(resolve(process.cwd(), SOURCE_PATH), "utf8");

// The unlock handler's body, isolated so assertions cannot accidentally match
// another endpoint in this large router file.
const UNLOCK_BLOCK = SOURCE.slice(
  SOURCE.indexOf("'/:employeeId/:date/unlock'"),
  SOURCE.indexOf("'/:employeeId/:date/unlock'") + 8000,
);

describe("attendance unlock refuses a day belonging to a closed payroll run", () => {
  it("consults salary_prep_run before clearing the lock", () => {
    expect(UNLOCK_BLOCK).toMatch(/FROM salary_prep_run/);
  });

  it("uses the canonical closed-status set rather than a private list", () => {
    expect(UNLOCK_BLOCK).toMatch(/CLOSED_RUN_STATUSES_SQL/);
  });

  it("compares run_month as a string — it is VARCHAR, and a DATE comparison matches zero rows", () => {
    expect(UNLOCK_BLOCK).toMatch(/run_month\s*=\s*DATE_FORMAT\(\?,\s*'%Y-%m'\)/);
  });

  it("answers 409, matching the locked->409 shape the A.3 override endpoints already use", () => {
    expect(UNLOCK_BLOCK).toMatch(/status\(409\)/);
  });

  it("treats finalized, locked and disbursed as closed", () => {
    expect(CLOSED_RUN_STATUSES.has("finalized")).toBe(true);
    expect(CLOSED_RUN_STATUSES.has("locked")).toBe(true);
    expect(CLOSED_RUN_STATUSES.has("disbursed")).toBe(true);
  });
});

describe("attendance unlock requires a recorded justification", () => {
  it("rejects a missing or too-short reason with 400", () => {
    expect(UNLOCK_BLOCK).toMatch(/reason/);
    expect(UNLOCK_BLOCK).toMatch(/status\(400\)/);
  });

  it("checks the reason BEFORE performing the UPDATE", () => {
    const reasonAt = UNLOCK_BLOCK.indexOf("reason.length < 10");
    const updateAt = UNLOCK_BLOCK.indexOf("SET is_locked = 0");
    expect(reasonAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(-1);
    expect(reasonAt).toBeLessThan(updateAt);
  });

  it("checks payroll closure BEFORE performing the UPDATE", () => {
    const closureAt = UNLOCK_BLOCK.indexOf("FROM salary_prep_run");
    const updateAt = UNLOCK_BLOCK.indexOf("SET is_locked = 0");
    expect(closureAt).toBeLessThan(updateAt);
  });
});

describe("attendance unlock leaves a durable audit record", () => {
  it("writes to sensitive_action_log via logSensitiveAction, not just console.log", () => {
    expect(UNLOCK_BLOCK).toMatch(/logSensitiveAction/);
    expect(UNLOCK_BLOCK).toMatch(/ATTENDANCE_RECORD_UNLOCKED/);
  });

  it("records the actor, the employee and the reason", () => {
    expect(UNLOCK_BLOCK).toMatch(/actor_user_id/);
    expect(UNLOCK_BLOCK).toMatch(/employee_id/);
    expect(UNLOCK_BLOCK).toMatch(/reason,/);
  });

  it("records the before and after lock state", () => {
    expect(UNLOCK_BLOCK).toMatch(/old_value_json/);
    expect(UNLOCK_BLOCK).toMatch(/new_value_json/);
  });

  it("awaits the audit write rather than firing and forgetting it", () => {
    expect(UNLOCK_BLOCK).toMatch(/await logSensitiveAction/);
  });
});
