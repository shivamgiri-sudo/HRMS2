import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Same transaction rationale as roster-assignment-bulk.service.ts. This file also
 * previously built its multi-row INSERT via manual string concatenation with
 * single-quote-doubling escaping (a weak defense against injection through the
 * uploaded CSV's free-text notes field) instead of parameterized placeholders, and
 * never set upload_batch_row.target_record_id — breaking traceability from an
 * uploaded row back to the wfm_roster_assignment row(s) it created.
 */

const conn = {
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection } }));

const { logRosterChange } = vi.hoisted(() => ({ logRosterChange: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../roster/roster-change-log.js", () => ({ logRosterChange }));

import { importShiftRosterBatch } from "../shift-roster-bulk.service.js";
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

describe("importShiftRosterBatch transaction handling", () => {
  beforeEach(() => {
    getConnection.mockResolvedValue(conn);
    conn.execute.mockReset();
    conn.beginTransaction.mockReset();
    conn.commit.mockReset();
    conn.rollback.mockReset();
    conn.release.mockReset();
    logRosterChange.mockClear();
    // Schema-probe caching is module-scope and would otherwise leak the first
    // test's result (even an empty Set is a cached hit) into every test after it.
    __resetSchemaCachesForTests();
    __resetSchemaProbeCachesForTests();
  });

  it("begins, commits, and releases on a clean run; sets target_record_id on the imported row", async () => {
    queueRows(
      // SELECT upload_batch_row
      [{ id: "row-1", row_no: 1, normalized_data: JSON.stringify({
        employee_code: "MAS001", week_start_date: "2026-08-17",
        mon_shift: "09:00-18:00",
      }) }],
      // SELECT employees
      [{ id: "emp-1", process_id: "process-1", branch_id: "branch-1" }],
      // SELECT weekly_roster_cycle (none found)
      [],
      // INSERT weekly_roster_cycle
      [],
      // Area 2: SELECT INFORMATION_SCHEMA.TABLES (isRestPolicyFeatureActive,
      // once per row before the day loop) -> wfm_rest_policy doesn't exist yet,
      // so every day's rest-check below is skipped -- no further Area 2 queries
      [],
      // resolveShiftTemplate: SELECT wfm_shift_template by start/end time
      [{ id: "shift-1" }],
      // SELECT existing wfm_roster_assignment (before-value pre-fetch)
      [],
      // SELECT INFORMATION_SCHEMA.COLUMNS (shift-versioning schema probe) -> no
      // versioning columns yet, so the INSERT below falls back to the
      // pre-migration column set
      [],
      // INSERT wfm_roster_assignment (batch)
      [],
      // UPDATE upload_batch_row (target_record_id)
      [],
      // UPDATE upload_batch
      [],
    );

    const result = await importShiftRosterBatch("batch-1", "user-1");

    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(result.imported).toBe(1);

    // The row-status update must carry a non-null target_record_id now.
    const targetUpdateCall = conn.execute.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("row_status='imported', target_record_id=?"),
    );
    expect(targetUpdateCall, "target_record_id UPDATE not found").toBeDefined();
    expect(targetUpdateCall![1][0]).not.toBeNull();
  });

  it("uses parameterized placeholders for the batch INSERT, not string-concatenated values", async () => {
    queueRows(
      [{ id: "row-1", row_no: 1, normalized_data: JSON.stringify({
        employee_code: "MAS001", week_start_date: "2026-08-17",
        mon_shift: "09:00-18:00", notes: "o'brien's note",
      }) }],
      [{ id: "emp-1", process_id: "process-1", branch_id: "branch-1" }],
      [],
      [],
      [], // Area 2: isRestPolicyFeatureActive -> wfm_rest_policy doesn't exist yet
      [{ id: "shift-1" }],
      [],
      [], // schema probe -> no versioning columns
      [],
      [],
      [],
    );

    await importShiftRosterBatch("batch-1", "user-1");

    const insertCall = conn.execute.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("INSERT INTO wfm_roster_assignment"),
    );
    expect(insertCall, "batch INSERT not found").toBeDefined();
    const [sql, params] = insertCall!;
    expect(sql).not.toMatch(/o'brien/);
    // 8 columns (id..shift_end_time) as placeholders, then the 3 fixed literal
    // status/source columns, then system_decision_reason's placeholder — no
    // shift_version_id/scheduled_minutes since the schema probe found neither.
    expect(sql).toMatch(/VALUES \(\?,\?,\?,\?,\?,\?,\?,\?,'published','published','bulk_upload',\?\)/);
    expect(params).toContain("o'brien's note");
  });

  it("blocks a day on insufficient rest against an existing DB row (Area 2), with no override path in bulk upload", async () => {
    queueRows(
      // SELECT upload_batch_row -> only Monday has a shift, an overnight one
      [{ id: "row-1", row_no: 1, normalized_data: JSON.stringify({
        employee_code: "MAS001", week_start_date: "2026-08-17",
        mon_shift: "22:00-07:00",
      }) }],
      // SELECT employees
      [{ id: "emp-1", process_id: "process-1", branch_id: "branch-1" }],
      // SELECT weekly_roster_cycle (none found)
      [],
      // INSERT weekly_roster_cycle
      [],
      // Area 2: isRestPolicyFeatureActive -> wfm_rest_policy EXISTS this time
      [{ TABLE_NAME: "wfm_rest_policy" }],
      // resolveShiftTemplate: SELECT wfm_shift_template by start/end time
      [{ id: "shift-1" }],
      // resolveRestPolicy scopes: employee, process, branch, organization
      [], [], [],
      [{ id: "policy-1", scope_type: "organization", scope_id: null, minimum_rest_minutes: 600, allows_emergency_override: 0 }],
      // findAdjacentShifts: previous ends 18:00 the same day (only 4h before
      // the candidate's 22:00 start), next -> none
      [{ roster_date: "2026-08-17", shift_end_time: "18:00:00" }],
      [],
    );

    const result = await importShiftRosterBatch("batch-1", "user-1");

    expect(result.errors[0]).toMatch(/only \d+min rest/);
    expect(result.errors[0]).toMatch(/does not support emergency override/);
    const insertCall = conn.execute.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.startsWith("INSERT INTO wfm_roster_assignment"),
    );
    expect(insertCall, "a day blocked on insufficient rest must never be inserted").toBeUndefined();
  });

  it("rolls back and releases on an unexpected failure", async () => {
    conn.execute.mockImplementation(async () => {
      throw new Error("connection lost");
    });

    await expect(importShiftRosterBatch("batch-1", "user-1")).rejects.toThrow("connection lost");

    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });
});
