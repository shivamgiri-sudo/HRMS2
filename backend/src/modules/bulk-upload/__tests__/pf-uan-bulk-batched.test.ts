import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * importPfUanBatch's employee and existing-UAN lookups are now bulk-prefetched
 * (2 queries instead of 2 per row). The actual statutory writes stay per-row.
 *
 * Pinned here specifically: pre-parse validation failures (missing
 * employee_code, malformed UAN) must be counted in errorRows/errors exactly
 * ONCE. The first version of this rewrite queued those rows into a deferred
 * batch UPDATE at the end AND still had the original inline errorRows++ /
 * errors.push from when they were first found — every malformed-UAN batch
 * would have reported double the actual error count.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { writeAuditLog } = vi.hoisted(() => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog }));

import { importPfUanBatch } from "../pf-uan-bulk.service.js";

function row(id: string, row_no: number, data: Record<string, unknown>) {
  return { id, row_no, normalized_data: JSON.stringify(data) };
}

beforeEach(() => {
  execute.mockReset();
  writeAuditLog.mockClear();
});

describe("importPfUanBatch — batched rewrite", () => {
  it("counts a pre-parse validation failure exactly once, not twice", async () => {
    execute.mockResolvedValueOnce([
      [
        row("row-1", 1, { employee_code: "", uan: "123456789012" }),        // missing employee_code
        row("row-2", 2, { employee_code: "MAS002", uan: "12345" }),          // malformed UAN
      ],
      [],
    ]); // 1: SELECT upload_batch_row
    // No employee_codes survived pre-parse, so the bulk employee lookup and the
    // bulk existing-UAN lookup are both skipped entirely (codes.size === 0).
    execute.mockResolvedValueOnce([{}, []]); // 2: bulk error UPDATE (both rows)
    execute.mockResolvedValueOnce([{}, []]); // 3: UPDATE upload_batch summary

    const result = await importPfUanBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(0);
    expect(result.errorRows).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/employee_code is required/);
    expect(result.errors[1]).toMatch(/UAN must be exactly 12 digits/);

    const summaryUpdate = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("SET batch_status = ?"));
    expect(summaryUpdate![1]).toEqual(["validation_failed", 0, 2, "batch-1"]);
  });

  it("assigns a UAN to an employee with none on file", async () => {
    execute.mockResolvedValueOnce([[row("row-1", 1, { employee_code: "MAS001", uan: "123456789012" })], []]);
    execute.mockResolvedValueOnce([[{ id: "emp-1", employee_code: "MAS001" }], []]); // bulk employee lookup
    execute.mockResolvedValueOnce([[], []]); // bulk existing-UAN lookup -> none on file
    execute.mockResolvedValueOnce([{}, []]); // INSERT employee_statutory_info
    execute.mockResolvedValueOnce([{}, []]); // INSERT employee_uan
    execute.mockResolvedValueOnce([{}, []]); // UPDATE employee_epf_compliance_profile
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch_row imported
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch summary

    const result = await importPfUanBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(1);
    expect(result.errorRows).toBe(0);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action_type: "BULK_UAN_ASSIGNED",
      change_summary: expect.objectContaining({ employee_code: "MAS001", uan_masked: "XXXXXXXX9012" }),
    }));
  });

  it("refuses to overwrite an employee who already holds a DIFFERENT UAN", async () => {
    execute.mockResolvedValueOnce([[row("row-1", 1, { employee_code: "MAS001", uan: "123456789012" })], []]);
    execute.mockResolvedValueOnce([[{ id: "emp-1", employee_code: "MAS001" }], []]);
    execute.mockResolvedValueOnce([[{ employee_id: "emp-1", uan_number: "999999999999" }], []]); // different existing UAN
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch_row error
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch summary

    const result = await importPfUanBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(0);
    expect(result.errorRows).toBe(1);
    expect(result.errors[0]).toMatch(/already holds UAN XXXXXXXX9999/);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("allows re-uploading the SAME UAN the employee already holds (harmless no-op)", async () => {
    execute.mockResolvedValueOnce([[row("row-1", 1, { employee_code: "MAS001", uan: "123456789012" })], []]);
    execute.mockResolvedValueOnce([[{ id: "emp-1", employee_code: "MAS001" }], []]);
    execute.mockResolvedValueOnce([[{ employee_id: "emp-1", uan_number: "123456789012" }], []]); // same UAN
    execute.mockResolvedValueOnce([{}, []]);
    execute.mockResolvedValueOnce([{}, []]);
    execute.mockResolvedValueOnce([{}, []]);
    execute.mockResolvedValueOnce([{}, []]);
    execute.mockResolvedValueOnce([{}, []]);

    const result = await importPfUanBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(1);
    expect(result.errorRows).toBe(0);
  });
});
