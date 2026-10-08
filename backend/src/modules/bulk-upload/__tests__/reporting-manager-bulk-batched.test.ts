import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * importReportingManagerBatch used to do two SELECTs per row (employee, then
 * manager) plus a per-row UPDATE — for BATCH-1787063088604's 818 rows that was
 * 1,600+ sequential round trips before a single employees UPDATE even ran, easily
 * enough to blow past the frontend's 30s request timeout even though the import
 * went on to finish successfully in the background a couple of minutes later.
 *
 * Now: one bulk SELECT for every employee_code/manager_code in the file, one
 * CASE-based UPDATE for every employees row that changes, and one CASE-based
 * UPDATE for every upload_batch_row that flips to 'imported' or 'error'. This
 * pins that the batched rewrite produces the exact same per-row outcomes as the
 * original sequential loop — using the real error shapes seen in production
 * (self-manager conflict, manager not found, employee not found, missing field).
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { logSensitiveAction } = vi.hoisted(() => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

import { importReportingManagerBatch } from "../reporting-manager-bulk.service.js";

function row(id: string, row_no: number, data: Record<string, unknown>) {
  return { id, row_no, normalized_data: JSON.stringify(data) };
}

beforeEach(() => {
  execute.mockReset();
  logSensitiveAction.mockClear();
});

describe("importReportingManagerBatch — batched rewrite", () => {
  it("imports a valid row, errors a self-managed row, a not-found manager, and a missing field — in one bulk pass", async () => {
    execute.mockResolvedValueOnce([
      [
        row("row-1", 1, { employee_code: "MAS001", manager_code: "MAS100" }), // valid
        row("row-2", 2, { employee_code: "MAS002", manager_code: "MAS002" }), // self-managed
        row("row-3", 3, { employee_code: "MAS003", manager_code: "MAS999" }), // manager not found
        row("row-4", 4, { employee_code: "", manager_code: "MAS100" }),       // missing employee_code
      ],
      [],
    ]); // 1: SELECT upload_batch_row

    execute.mockResolvedValueOnce([
      [
        { id: "emp-1", employee_code: "MAS001", reporting_manager_id: null, mgr_name: null },
        { id: "emp-2", employee_code: "MAS002", reporting_manager_id: null, mgr_name: null },
        { id: "emp-3", employee_code: "MAS003", reporting_manager_id: null, mgr_name: null },
        { id: "mgr-100", employee_code: "MAS100", reporting_manager_id: null, mgr_name: "Priya Shah" },
      ],
      [],
    ]); // 2: bulk SELECT employees for every referenced code

    execute.mockResolvedValueOnce([{}, []]); // 3: CASE UPDATE employees (row-1 only)
    execute.mockResolvedValueOnce([{}, []]); // 4: CASE UPDATE upload_batch_row -> imported (row-1)
    execute.mockResolvedValueOnce([{}, []]); // 5: CASE UPDATE upload_batch_row -> error (row-2,3,4)
    execute.mockResolvedValueOnce([{}, []]); // 6: UPDATE upload_batch summary

    const result = await importReportingManagerBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(1);
    expect(result.errorRows).toBe(3);
    expect(result.errors).toEqual([
      "Row 4: employee_code is required",
      "Row 2: Employee and manager cannot be the same (MAS002)",
      "Row 3: Manager \"MAS999\" not found or inactive",
    ]);

    // Only the one valid row ever touches employees or gets an audit entry.
    expect(logSensitiveAction).toHaveBeenCalledTimes(1);
    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({
      entity_id: "emp-1",
      change_summary: expect.objectContaining({
        employee_code: "MAS001", new_manager_id: "mgr-100", new_manager_name: "Priya Shah",
      }),
    }));

    const employeesUpdate = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.startsWith("UPDATE employees"));
    expect(employeesUpdate![0]).toMatch(/CASE id WHEN \? THEN \? END/);
    expect(employeesUpdate![1]).toEqual(["emp-1", "mgr-100", "emp-1"]);

    // Total DB round trips: 2 bulk SELECTs + 1 employees UPDATE + 2 row-status
    // UPDATEs + 1 summary UPDATE = 6, plus ONE probe for the manager-history table
    // (information_schema, cached module-wide after the first call) = 7.
    //
    // The property this guards is "batched, not per-row", so it is asserted as a bound
    // rather than pinned to a literal: recordManagerChange short-circuits on the cached
    // probe when employee_manager_history does not exist, and when it DOES exist it writes
    // history per changed employee — which is correct and must not be mistaken for the
    // per-row round-trip explosion this test was written to prevent.
    expect(execute.mock.calls.length).toBeLessThanOrEqual(8);

    const employeesUpdates = execute.mock.calls.filter(
      ([sql]) => typeof sql === "string" && sql.startsWith("UPDATE employees"),
    );
    // The real guarantee: ONE employees UPDATE for the whole batch, whatever the row count.
    expect(employeesUpdates).toHaveLength(1);

    const summaryUpdate = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.startsWith("UPDATE upload_batch\n") || (typeof sql === "string" && sql.includes("SET batch_status = ?")));
    expect(summaryUpdate![1]).toEqual(["imported_with_errors", 1, 3, "batch-1"]);
  });

  it("collapses a duplicate employee_code to the LAST row's manager, matching the original sequential-overwrite behavior", async () => {
    execute.mockResolvedValueOnce([
      [
        row("row-1", 1, { employee_code: "MAS001", manager_code: "MAS100" }),
        row("row-2", 2, { employee_code: "MAS001", manager_code: "MAS200" }), // same employee, later row
      ],
      [],
    ]);
    execute.mockResolvedValueOnce([
      [
        { id: "emp-1", employee_code: "MAS001", reporting_manager_id: null, mgr_name: null },
        { id: "mgr-100", employee_code: "MAS100", reporting_manager_id: null, mgr_name: "A" },
        { id: "mgr-200", employee_code: "MAS200", reporting_manager_id: null, mgr_name: "B" },
      ],
      [],
    ]);
    execute.mockResolvedValueOnce([{}, []]); // employees UPDATE
    execute.mockResolvedValueOnce([{}, []]); // row-status UPDATE (imported)
    execute.mockResolvedValueOnce([{}, []]); // summary UPDATE

    const result = await importReportingManagerBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(2); // both rows are still recorded as imported...
    const employeesUpdate = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.startsWith("UPDATE employees"));
    // ...but the employees table only takes ONE effective assignment, and it's row-2's (the last one).
    expect(employeesUpdate![1]).toEqual(["emp-1", "mgr-200", "emp-1"]);
  });

  it("returns immediately with no queries beyond the row fetch when there is nothing to import", async () => {
    execute.mockResolvedValueOnce([[], []]);

    const result = await importReportingManagerBatch("batch-1", "user-1");

    expect(result).toEqual({ importedRows: 0, errorRows: 0, errors: [] });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
