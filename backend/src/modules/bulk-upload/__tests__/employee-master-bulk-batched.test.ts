import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * importEmployeeMasterBatch used to do up to six SELECTs per row (branch,
 * department, designation, cost_centre, process, lob) plus one INSERT — now
 * six bulk lookups (run concurrently via Promise.all, and skipped entirely
 * when a code column is absent from the whole file) plus a chunked multi-row
 * INSERT with a per-row fallback so a single bad row in a chunk doesn't take
 * the rest of the chunk down with it.
 *
 * The six lookups fire concurrently and some are skipped when their code set
 * is empty, so their relative execute() call order is data-dependent — these
 * tests dispatch on SQL content instead of a fixed positional queue.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { provisionLmsIdentityForEmployee } = vi.hoisted(() => ({
  provisionLmsIdentityForEmployee: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../lms/lms-provisioning.service.js", () => ({ provisionLmsIdentityForEmployee }));

import { importEmployeeMasterBatch } from "../employee-master-bulk.service.js";

function row(id: string, row_no: number, data: Record<string, unknown>) {
  return { id, row_no, normalized_data: JSON.stringify(data) };
}

/**
 * Dispatches on SQL content so the six-way Promise.all lookup fan-out (whose
 * relative call order depends on which code sets are non-empty) doesn't need
 * a fragile positional mock queue.
 */
function mockBySql(rowsFetch: unknown[], lookups: Record<string, unknown[]>, writeResult: unknown = {}) {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT id, row_no, normalized_data")) return [rowsFetch, []];
    if (sql.includes("FROM branch_master")) return [lookups.branch ?? [], []];
    if (sql.includes("FROM department_master")) return [lookups.department ?? [], []];
    if (sql.includes("FROM designation_master")) return [lookups.designation ?? [], []];
    if (sql.includes("FROM cost_centre_master")) return [lookups.costCentre ?? [], []];
    if (sql.includes("FROM process_master")) return [lookups.process ?? [], []];
    if (sql.includes("FROM lob_master")) return [lookups.lob ?? [], []];
    return [writeResult, []];
  });
}

beforeEach(() => {
  execute.mockReset();
  provisionLmsIdentityForEmployee.mockClear().mockResolvedValue({});
});

describe("importEmployeeMasterBatch — batched rewrite", () => {
  it("rejects IDC-prefixed codes and missing required fields before any DB lookup", async () => {
    mockBySql([
      row("row-1", 1, { employee_code: "IDC001", first_name: "A" }),
      row("row-2", 2, { first_name: "B" }), // missing employee_code
    ], {});

    const result = await importEmployeeMasterBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(0);
    expect(result.errorRows).toBe(2);
    expect(result.errors[0]).toMatch(/IDC employees are not allowed/);
    expect(result.errors[1]).toMatch(/employee_code and first_name are required/);
    // Never even reached the six bulk lookups — no code set was populated.
    expect(execute.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("_master"))).toBe(false);
  });

  it("resolves org codes via bulk lookups and inserts in one chunked statement", async () => {
    mockBySql(
      [row("row-1", 1, { employee_code: "MAS001", first_name: "Amit", branch_code: "OKAYA", process_code: "ONF_KYC" })],
      { branch: [{ id: "branch-1", code: "OKAYA" }], process: [{ id: "process-1", code: "ONF_KYC" }] },
    );

    const result = await importEmployeeMasterBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(1);
    expect(result.errorRows).toBe(0);
    const insertCall = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO employees"));
    expect(insertCall![1]).toContain("branch-1");
    expect(insertCall![1]).toContain("process-1");
    expect(provisionLmsIdentityForEmployee).toHaveBeenCalledWith({ employeeCode: "MAS001", createdBy: "user-1" });
  });

  it("does not resolve an org code against an INACTIVE process/lob/cost-centre record", async () => {
    // The bulk lookup query itself filters WHERE active_status = 1 — an inactive
    // record simply never appears in the SELECT result, so the map lookup misses
    // and the column is left NULL rather than attaching to a closed process.
    mockBySql(
      [row("row-1", 1, { employee_code: "MAS001", first_name: "Amit", process_code: "CLOSED_PROC" })],
      { process: [] }, // inactive/nonexistent process_code never comes back from the filtered lookup
    );

    const result = await importEmployeeMasterBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(1);
    const insertCall = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO employees"));
    // buildParams order: employee_code, first_name, last_name, mobile, email, gender, doj,
    // branch_id, department_id, designation_id, cost_centre_id, process_id(11), lob_id, ...
    expect(insertCall![1][11]).toBeNull();
  });

  it("isolates one bad row when the chunked INSERT fails, without losing the rest of the chunk", async () => {
    let insertCalls = 0;
    execute.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("SELECT id, row_no, normalized_data")) {
        return [[
          row("row-1", 1, { employee_code: "MAS001", first_name: "Amit" }),
          row("row-2", 2, { employee_code: "MAS002", first_name: "Priya" }),
        ], []];
      }
      if (sql.includes("_master")) return [[], []];
      if (sql.includes("INSERT INTO employees")) {
        insertCalls++;
        if (insertCalls === 1) throw new Error("chunk failed: Data too long for column at row 2"); // the chunked attempt
        // Fallback path: one call per row (employee_code is untransformed, unlike
        // first_name, which toStoredNameRequired() uppercases before this point).
        if ((params as unknown[]).includes("MAS002")) throw new Error("Data too long for column 'first_name'");
        return [{}, []];
      }
      return [{}, []];
    });

    const result = await importEmployeeMasterBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(1);
    expect(result.errorRows).toBe(1);
    expect(result.errors[0]).toMatch(/Row 2:.*Data too long/);
    // Only the row that actually succeeded gets provisioned.
    expect(provisionLmsIdentityForEmployee).toHaveBeenCalledTimes(1);
    expect(provisionLmsIdentityForEmployee).toHaveBeenCalledWith({ employeeCode: "MAS001", createdBy: "user-1" });
  });

  it("does not fail the row when LMS provisioning throws — it's best-effort", async () => {
    mockBySql([row("row-1", 1, { employee_code: "MAS001", first_name: "Amit" })], {});
    provisionLmsIdentityForEmployee.mockRejectedValue(new Error("LMS unreachable"));

    const result = await importEmployeeMasterBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(1);
    expect(result.errorRows).toBe(0);
  });
});
