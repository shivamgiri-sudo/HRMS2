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
const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection } }));

const { logRosterChange } = vi.hoisted(() => ({ logRosterChange: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../roster/roster-change-log.js", () => ({ logRosterChange }));

import { importRosterAssignmentBatch } from "../roster-assignment-bulk.service.js";

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
    getConnection.mockResolvedValue(conn);
    conn.execute.mockReset();
    conn.beginTransaction.mockReset();
    conn.commit.mockReset();
    conn.rollback.mockReset();
    conn.release.mockReset();
    logRosterChange.mockClear();
  });

  it("begins and commits a transaction on a clean run, and always releases the connection", async () => {
    // 1: SELECT upload_batch_row -> one valid row
    // 2: SELECT employees (resolve employee_code)
    // 3: SELECT wfm_shift_template (resolve shift_code)
    // 4: SELECT existing wfm_roster_assignment (before-value lookup)
    // 5: INSERT wfm_roster_assignment
    // 6: UPDATE upload_batch_row
    // 7: UPDATE upload_batch
    queueRows(
      [{ id: "row-1", row_no: 1, normalized_data: JSON.stringify({
        cycle_id: "cycle-1", employee_code: "MAS001", roster_date: "2026-08-17",
        shift_code: "GEN", is_week_off: "0", notes: null,
      }) }],
      [{ id: "emp-1" }],
      [{ id: "shift-1" }],
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
