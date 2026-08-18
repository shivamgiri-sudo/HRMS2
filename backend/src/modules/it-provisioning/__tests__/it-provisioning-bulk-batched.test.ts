import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * importOfficialEmailBatch used to do one SELECT + one UPDATE + one audit
 * INSERT per row. Now: one bulk employee lookup, one CASE-based UPDATE for
 * every employee whose email changes, and one CASE-based UPDATE for every
 * upload_batch_row that flips to 'imported' or 'error'. Same shape as the
 * reporting-manager rewrite this mirrors.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { logSensitiveAction } = vi.hoisted(() => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

import { importOfficialEmailBatch } from "../it-provisioning.bulk.service.js";

function row(id: string, row_no: number, data: Record<string, unknown>) {
  return { id, row_no, normalized_data: JSON.stringify(data) };
}

beforeEach(() => {
  execute.mockReset();
  logSensitiveAction.mockClear();
});

describe("importOfficialEmailBatch — batched rewrite", () => {
  it("imports a valid row and errors an invalid-domain row and a not-found employee, in one bulk pass", async () => {
    execute.mockResolvedValueOnce([
      [
        row("row-1", 1, { employee_code: "MAS001", official_email: "amit.kumar@teammas.in" }), // valid
        row("row-2", 2, { employee_code: "MAS002", official_email: "amit@gmail.com" }),          // wrong domain
        row("row-3", 3, { employee_code: "MAS999", official_email: "ghost@teammas.in" }),        // not found
      ],
      [],
    ]); // 1: SELECT upload_batch_row

    execute.mockResolvedValueOnce([
      [{ id: "emp-1", employee_code: "MAS001", official_email: "old@teammas.in" }],
      [],
    ]); // 2: bulk SELECT employees — only MAS001 and MAS999 have well-formed rows to look up, and MAS999 doesn't exist

    execute.mockResolvedValueOnce([{}, []]); // 3: CASE UPDATE employees
    execute.mockResolvedValueOnce([{}, []]); // 4: CASE UPDATE upload_batch_row -> imported
    execute.mockResolvedValueOnce([{}, []]); // 5: CASE UPDATE upload_batch_row -> error
    execute.mockResolvedValueOnce([{}, []]); // 6: UPDATE upload_batch summary

    const result = await importOfficialEmailBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(1);
    expect(result.errorRows).toBe(2);
    expect(result.errors).toEqual([
      "Row 2: official_email \"amit@gmail.com\" must be @teammas.in or @teammas.co.in",
      "Row 3: Employee with code \"MAS999\" not found or inactive",
    ]);

    expect(logSensitiveAction).toHaveBeenCalledTimes(1);
    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({
      entity_id: "emp-1",
      change_summary: expect.objectContaining({
        employee_code: "MAS001", previous_email: "old@teammas.in", new_email: "amit.kumar@teammas.in",
      }),
    }));

    const employeesUpdate = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.startsWith("UPDATE employees"));
    expect(employeesUpdate![0]).toMatch(/CASE id WHEN \? THEN \? END/);
    expect(employeesUpdate![1]).toEqual(["emp-1", "amit.kumar@teammas.in", "emp-1"]);
  });

  it("returns immediately with no queries beyond the row fetch when there is nothing to import", async () => {
    execute.mockResolvedValueOnce([[], []]);

    const result = await importOfficialEmailBatch("batch-1", "user-1");

    expect(result).toEqual({ importedRows: 0, errorRows: 0, errors: [] });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
