import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every db.execute() call in this service used to autocommit independently — a crash
 * or dropped connection partway through the row loop left an arbitrary prefix of rows
 * imported into wfm_roster_assignment with no rollback, while upload_batch itself
 * never got marked imported. Now wrapped in one transaction on a dedicated connection.
 */

const conn = {
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
// Separate from `conn`: in real production, withEmployeeRosterLock's
// GET_LOCK/RELEASE_LOCK run on their OWN connection (getConnection() pulls a
// distinct one from the pool each call) — not the batch's own transaction
// connection. If this test returned the SAME object for both, the lock's own
// release() calls (one per row) would inflate conn.release()'s count and
// break the "released exactly once" assertions below, which is not a real
// production behavior, only an artifact of a shared test double.
const lockConn = { query: vi.fn(), release: vi.fn() };
const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection } }));

const { logRosterChange } = vi.hoisted(() => ({ logRosterChange: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../roster/roster-change-log.js", () => ({ logRosterChange }));

import { importRosterAssignmentBatch } from "../roster-assignment-bulk.service.js";
import { __resetSchemaCachesForTests } from "../../wfm/shift-scheduling.util.js";
import { __resetSchemaProbeCachesForTests } from "../../wfm/schema-probe.util.js";

function queueRows(...batches: unknown[][]) {
  let call = 0;
  conn.execute.mockImplementation(async () => {
    const rows = batches[call] ?? [];
    call += 1;
    return [rows, []];
  });
}

describe("importRosterAssignmentBatch transaction handling", () => {
  beforeEach(() => {
    // First getConnection() call (the batch's own transaction) returns conn;
    // every call after that (one per row, inside withEmployeeRosterLock) gets
    // lockConn instead — mirrors the pool handing out a distinct connection
    // each time in real production.
    getConnection.mockReset();
    getConnection.mockImplementationOnce(async () => conn);
    getConnection.mockImplementation(async () => lockConn);
    conn.execute.mockReset();
    conn.beginTransaction.mockReset();
    conn.commit.mockReset();
    conn.rollback.mockReset();
    conn.release.mockReset();
    lockConn.query.mockReset();
    lockConn.query.mockImplementation(async (sql: string) => (sql.includes("GET_LOCK") ? [[{ acquired: 1 }], []] : [[], []]));
    lockConn.release.mockReset();
    logRosterChange.mockClear();
    // Schema-probe caching is module-scope and would otherwise leak the first
    // test's result (even an empty Set is a cached hit) into every test after it.
    // Two separate cache stores now: shift-versioning columns (Area 4) and the
    // generic table-existence probe rest-policy.service.ts uses (Area 2).
    __resetSchemaCachesForTests();
    __resetSchemaProbeCachesForTests();
  });

  it("begins and commits a transaction on a clean run, and always releases the connection", async () => {
    // 1: SELECT upload_batch_row -> one valid row
    // 2: SELECT employees (resolve employee_code; also pulls process_id/branch_id
    //    for Area 2's rest-policy scope resolution)
    // 3: SELECT wfm_shift_template (resolve shift_code)
    // 4: SELECT attendance_daily_record (closure #2: checkEmployeeDateNotLocked)
    //    -> not locked
    // 5: SELECT INFORMATION_SCHEMA.TABLES (Area 2: isRestPolicyFeatureActive ->
    //    wfm_rest_policy doesn't exist yet) -> feature inactive, so the rest-gap
    //    check below is skipped entirely -- no further Area 2 queries this row
    // 6: SELECT existing wfm_roster_assignment (before-value lookup)
    // 7: SELECT INFORMATION_SCHEMA.COLUMNS (Area 4: shift-versioning schema probe)
    //    -> no versioning columns yet, so the INSERT below falls back to the
    //    pre-migration column set
    // 8: INSERT wfm_roster_assignment
    // 9: UPDATE upload_batch_row
    // 10: UPDATE upload_batch
    queueRows(
      [{ id: "row-1", row_no: 1, normalized_data: JSON.stringify({
        cycle_id: "cycle-1", employee_code: "MAS001", roster_date: "2026-08-17",
        shift_code: "GEN", is_week_off: "0", notes: null,
      }) }],
      [{ id: "emp-1", process_id: "process-1", branch_id: "branch-1" }],
      [{ id: "shift-1" }],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
    );

    const result = await importRosterAssignmentBatch("batch-1", "user-1");

    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(result.imported).toBe(1);
  });

  it("rolls back and releases the connection, and re-throws, when a query fails unexpectedly", async () => {
    conn.execute.mockImplementation(async () => {
      throw new Error("connection lost");
    });

    await expect(importRosterAssignmentBatch("batch-1", "user-1")).rejects.toThrow("connection lost");

    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("blocks a row on insufficient rest (Area 2) once wfm_rest_policy is active, with no override path in bulk upload", async () => {
    // 1: upload_batch_row  2: employees  3: wfm_shift_template
    // 4: attendance_daily_record (closure #2: checkEmployeeDateNotLocked) -> not locked
    // 5: INFORMATION_SCHEMA.TABLES -> wfm_rest_policy EXISTS this time
    // 6: wfm_rest_policy (employee scope) -> none
    // 7: wfm_rest_policy (process scope) -> none
    // 8: wfm_rest_policy (branch scope) -> none
    // 9: wfm_rest_policy (organization scope) -> a policy, 600min minimum, no override
    // 10: findAdjacentShifts previous -> ends 22:00 the day before (only 6h gap to 04:00 start)
    // 11: findAdjacentShifts next -> none
    // 12: UPDATE upload_batch_row (error)   13: UPDATE upload_batch
    queueRows(
      [{ id: "row-1", row_no: 1, normalized_data: JSON.stringify({
        cycle_id: "cycle-1", employee_code: "MAS001", roster_date: "2026-08-17",
        shift_code: "NGT", is_week_off: "0", notes: null,
      }) }],
      [{ id: "emp-1", process_id: "process-1", branch_id: "branch-1" }],
      [{ id: "shift-1", start_time: "04:00:00", end_time: "13:00:00" }],
      [],
      [{ TABLE_NAME: "wfm_rest_policy" }],
      [],
      [],
      [],
      [{ id: "policy-1", scope_type: "organization", scope_id: null, minimum_rest_minutes: 600, allows_emergency_override: 0 }],
      // start_time/end_time are the query's aliases now that findAdjacentShifts
      // COALESCEs the assignment snapshot with the shift template's own times.
      [{ roster_date: "2026-08-16", start_time: "13:00:00", end_time: "22:00:00" }],
      [],
      [],
      [],
    );

    const result = await importRosterAssignmentBatch("batch-1", "user-1");

    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatch(/only 360min rest/);
    expect(result.errors[0]).toMatch(/does not support emergency override/);
    const insertCall = conn.execute.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.startsWith("INSERT INTO wfm_roster_assignment"),
    );
    expect(insertCall, "a row blocked on insufficient rest must never be inserted").toBeUndefined();
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it("allows a row through in WARN mode, recording a REST_GAP_WARNING instead of refusing it", async () => {
    // Same shortfall as the BLOCK test above, but the organization policy's
    // enforcement_mode is 'warn'. Regression guard for the gap where this file
    // hard-blocked on any shortfall regardless of enforcementMode, unlike its
    // sibling shift-roster-bulk.service.ts, which already honored WARN.
    //
    // 1: upload_batch_row  2: employees  3: wfm_shift_template
    // 4: attendance_daily_record -> not locked
    // 5: INFORMATION_SCHEMA.TABLES -> wfm_rest_policy EXISTS
    // 6-8: wfm_rest_policy (employee/process/branch scope) -> none
    // 9: wfm_rest_policy (organization scope) -> WARN mode, 600min minimum
    // 10: findAdjacentShifts previous -> only 6h gap    11: findAdjacentShifts next -> none
    // 12: INSERT wfm_roster_conflict_log (recordRestGapWarning, inside applyRestDecision)
    // 13: SELECT existing wfm_roster_assignment (before-value lookup)
    // 14: INFORMATION_SCHEMA.COLUMNS (shift-versioning probe)
    // 15: INSERT wfm_roster_assignment    16: UPDATE upload_batch_row (imported)
    // 17: UPDATE upload_batch
    queueRows(
      [{ id: "row-1", row_no: 1, normalized_data: JSON.stringify({
        cycle_id: "cycle-1", employee_code: "MAS001", roster_date: "2026-08-17",
        shift_code: "NGT", is_week_off: "0", notes: null,
      }) }],
      [{ id: "emp-1", process_id: "process-1", branch_id: "branch-1" }],
      [{ id: "shift-1", start_time: "04:00:00", end_time: "13:00:00" }],
      [],
      [{ TABLE_NAME: "wfm_rest_policy" }],
      [],
      [],
      [],
      [{ id: "policy-1", scope_type: "organization", scope_id: null, minimum_rest_minutes: 600, allows_emergency_override: 0, enforcement_mode: "warn" }],
      [{ roster_date: "2026-08-16", start_time: "13:00:00", end_time: "22:00:00" }],
      [],
      [], // recordRestGapWarning's INSERT into wfm_roster_conflict_log
      [], // existing wfm_roster_assignment (before-value lookup) -> none
      [], // shift-versioning column probe -> none
      [], // INSERT wfm_roster_assignment
      [], // UPDATE upload_batch_row (imported)
      [], // UPDATE upload_batch
    );

    const result = await importRosterAssignmentBatch("batch-1", "user-1");

    expect(result.errors).toHaveLength(0);
    expect(result.skipped).toBe(0);
    expect(result.imported).toBe(1);
    const warningInsert = conn.execute.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("wfm_roster_conflict_log") && sql.includes("REST_GAP_WARNING"),
    );
    expect(warningInsert, "a WARN-mode shortfall must persist a REST_GAP_WARNING, not disappear silently").toBeDefined();
    const insertCall = conn.execute.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.startsWith("INSERT INTO wfm_roster_assignment"),
    );
    expect(insertCall, "WARN mode must let the row through, not refuse it").toBeDefined();
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it("blocks a row whose date is already locked for payroll (closure #2), before ever reaching the rest-policy check", async () => {
    // 1: upload_batch_row  2: employees  3: wfm_shift_template
    // 4: attendance_daily_record -> is_locked=1
    // 5: UPDATE upload_batch_row (error)   6: UPDATE upload_batch
    queueRows(
      [{ id: "row-1", row_no: 1, normalized_data: JSON.stringify({
        cycle_id: "cycle-1", employee_code: "MAS001", roster_date: "2026-08-17",
        shift_code: "GEN", is_week_off: "0", notes: null,
      }) }],
      [{ id: "emp-1", process_id: "process-1", branch_id: "branch-1" }],
      [{ id: "shift-1" }],
      [{ is_locked: 1 }],
      [],
      [],
    );

    const result = await importRosterAssignmentBatch("batch-1", "user-1");

    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatch(/already locked for payroll/);
    const insertCall = conn.execute.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.startsWith("INSERT INTO wfm_roster_assignment"),
    );
    expect(insertCall, "a row blocked on a locked date must never be inserted").toBeUndefined();
    // Never reached the rest-policy feature-active probe either -- the lock check short-circuits first.
    const restProbeCall = conn.execute.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("INFORMATION_SCHEMA.TABLES"),
    );
    expect(restProbeCall).toBeUndefined();
  });

  it("truncates the resolved shift's HH:MM:SS time to HH:MM before the INSERT", async () => {
    // wfm_roster_assignment.shift_start_time/shift_end_time are varchar(5) ("HH:MM"),
    // but wfm_shift_template.start_time/end_time come back from mysql2 as the full
    // "HH:MM:SS" TIME string (8 chars) — exactly what this test's shift row returns.
    // Before the fix, shiftStartTime/shiftEndTime carried that 8-char value straight
    // into the INSERT and every row with a resolved shift died with "Data too long
    // for column 'shift_start_time'" (ER_DATA_TOO_LONG) — live-reproduced by calling
    // importRosterAssignmentBatch directly against the real DB, 0 successful imports
    // with a shift assigned.
    queueRows(
      [{ id: "row-1", row_no: 1, normalized_data: JSON.stringify({
        cycle_id: "cycle-1", employee_code: "MAS001", roster_date: "2026-08-17",
        shift_code: "GEN", is_week_off: "0", notes: null,
      }) }],
      [{ id: "emp-1", process_id: "process-1", branch_id: "branch-1" }],
      [{ id: "shift-1", start_time: "10:00:00", end_time: "19:00:00" }],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
    );

    const result = await importRosterAssignmentBatch("batch-1", "user-1");
    expect(result.imported).toBe(1);

    const insertCall = conn.execute.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.startsWith("INSERT INTO wfm_roster_assignment"),
    );
    expect(insertCall).toBeDefined();
    const [, params] = insertCall as [string, unknown[]];
    expect(params).toContain("10:00");
    expect(params).toContain("19:00");
    expect(params).not.toContain("10:00:00");
    expect(params).not.toContain("19:00:00");
  });

  it("still collects a row-level validation failure without rolling back the transaction", async () => {
    // Row is missing employee_code — a validation failure, not an unexpected error.
    queueRows(
      [{ id: "row-1", row_no: 1, normalized_data: JSON.stringify({
        cycle_id: "cycle-1", employee_code: "", roster_date: "2026-08-17",
      }) }],
      [], // UPDATE upload_batch_row (error)
      [], // UPDATE upload_batch
    );

    const result = await importRosterAssignmentBatch("batch-1", "user-1");

    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatch(/missing cycle_id, employee_code or roster_date/);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });
});
