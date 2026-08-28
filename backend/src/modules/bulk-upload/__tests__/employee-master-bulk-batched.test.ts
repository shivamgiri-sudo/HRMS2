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
      row("row-1", 1, { employee_code: "IDC001", first_name: "A", last_name: "N", date_of_joining: "2026-01-01" }),
      row("row-2", 2, { first_name: "B" }), // missing employee_code, last_name, date_of_joining
    ], {});

    const result = await importEmployeeMasterBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(0);
    expect(result.errorRows).toBe(2);
    expect(result.errors[0]).toMatch(/IDC employees are not allowed/);
    expect(result.errors[1]).toMatch(/employee_code, first_name, last_name and date_of_joining are required/);
    // Never even reached the six bulk lookups — no code set was populated.
    expect(execute.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("_master"))).toBe(false);
  });

  it("resolves org codes via bulk lookups and inserts in one chunked statement", async () => {
    mockBySql(
      [row("row-1", 1, {
        employee_code: "MAS001", first_name: "Amit", last_name: "Kumar", date_of_joining: "2026-01-01",
        branch_code: "OKAYA", process_code: "ONF_KYC", designation_code: "EXECUTIVE",
      })],
      {
        branch: [{ id: "branch-1", code: "OKAYA" }],
        process: [{ id: "process-1", code: "ONF_KYC" }],
        designation: [{ id: "desig-1", code: "EXECUTIVE" }],
      },
    );

    const result = await importEmployeeMasterBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(1);
    expect(result.errorRows).toBe(0);
    const insertCall = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO employees"));
    expect(insertCall![1]).toContain("branch-1");
    expect(insertCall![1]).toContain("process-1");
    expect(provisionLmsIdentityForEmployee).toHaveBeenCalledWith({ employeeCode: "MAS001", createdBy: "user-1" });
  });

  it("refuses an org code that resolves against no ACTIVE process/lob/cost-centre record", async () => {
    // The bulk lookup filters WHERE active_status = 1, so an inactive or unknown record never
    // comes back and the map lookup misses. This must never attach the employee to a closed
    // process — that part is unchanged.
    //
    // What changed (2026-08-26) is the disposition on a miss. It used to import the row with
    // process_id NULL. That silent NULL is how one batch on 2026-08-19 created 60 active
    // employees with no process at all — 61 of the 128 August joiners, 48%, against 0 for
    // every month Jan-Jun, and 62 of the 63 were client-facing OPERATIONS staff. An employee
    // with no process joins to no client and is missing from process/client headcount, P&L
    // allocation by process, and the client portal's headcount and attrition.
    //
    // So a miss is now a reported error naming the row and the offending code, and nothing is
    // written. The value the uploader supplied is no longer thrown away in silence.
    mockBySql(
      [row("row-1", 1, { employee_code: "MAS001", first_name: "Amit", last_name: "Kumar", date_of_joining: "2026-01-01", process_code: "CLOSED_PROC" })],
      { process: [] }, // inactive/nonexistent process_code never comes back from the filtered lookup
    );

    const result = await importEmployeeMasterBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(0);
    expect(result.errorRows).toBe(1);
    expect(result.errors[0]).toContain('process_code "CLOSED_PROC"');
    const insertCall = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO employees"));
    expect(insertCall, "a row that resolves nothing must not be written at all").toBeUndefined();
  });

  it("isolates one bad row when the chunked INSERT fails, without losing the rest of the chunk", async () => {
    let insertCalls = 0;
    execute.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("SELECT id, row_no, normalized_data")) {
        return [[
          // process_code (2026-08-26) and designation_code (2026-08-27) are both required, so
          // these fixtures carry them — this test is about chunk-failure isolation, not about
          // master resolution.
          row("row-1", 1, { employee_code: "MAS001", first_name: "Amit", last_name: "Kumar", date_of_joining: "2026-01-01", process_code: "P1", designation_code: "D1" }),
          row("row-2", 2, { employee_code: "MAS002", first_name: "Priya", last_name: "Singh", date_of_joining: "2026-01-01", process_code: "P1", designation_code: "D1" }),
        ], []];
      }
      if (sql.includes("FROM process_master")) return [[{ id: "p-1", code: "P1" }], []];
      if (sql.includes("FROM designation_master")) return [[{ id: "d-1", code: "D1" }], []];
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

  it("normalizes a DD-MM-YYYY date_of_joining to ISO before the INSERT, and passes through date_of_birth", async () => {
    // The template's own guide says "date_of_joining and date_of_birth must be
    // DD-MM-YYYY", but this used to just String(...).slice(0, 10) the raw cell for
    // date_of_joining — no conversion at all — and never read date_of_birth in the
    // first place. A date entered exactly as instructed (e.g. "23-08-2026") reached
    // the INSERT unchanged and MySQL rejected it: "Incorrect date value" — every
    // fixture in this file up to now used an already-ISO date_of_joining and so
    // never exercised this path at all. date_of_birth silently vanished on every
    // upload regardless of format, live-reproduced by calling
    // importEmployeeMasterBatch directly against the real DB.
    mockBySql(
      [row("row-1", 1, {
        employee_code: "MAS001", first_name: "Amit", last_name: "Kumar",
        date_of_joining: "23-08-2026", date_of_birth: "15-06-1995",
        process_code: "P1", designation_code: "D1",
      })],
      { process: [{ id: "p-1", code: "P1" }], designation: [{ id: "d-1", code: "D1" }] },
    );

    const result = await importEmployeeMasterBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(1);
    expect(result.errorRows).toBe(0);
    const insertCall = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO employees"));
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall as [string, unknown[]];
    expect(sql).toMatch(/\bdate_of_birth\b/);
    expect(params).toContain("2026-08-23");
    expect(params).toContain("1995-06-15");
    expect(params).not.toContain("23-08-2026");
  });

  it("rejects an unparseable date_of_joining before any DB write, naming the row", async () => {
    mockBySql(
      [row("row-1", 1, {
        employee_code: "MAS001", first_name: "Amit", last_name: "Kumar",
        date_of_joining: "not-a-date",
      })],
      {},
    );

    const result = await importEmployeeMasterBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(0);
    expect(result.errorRows).toBe(1);
    expect(result.errors[0]).toMatch(/date_of_joining "not-a-date" is not a valid date/);
    const insertCall = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO employees"));
    expect(insertCall).toBeUndefined();
  });

  it("does not fail the row when LMS provisioning throws — it's best-effort", async () => {
    // process_code and designation_code are required; this test is about LMS being best-effort.
    mockBySql(
      [row("row-1", 1, {
        employee_code: "MAS001", first_name: "Amit", last_name: "Kumar", date_of_joining: "2026-01-01",
        process_code: "P1", designation_code: "D1",
      })],
      { process: [{ id: "p-1", code: "P1" }], designation: [{ id: "d-1", code: "D1" }] },
    );
    provisionLmsIdentityForEmployee.mockRejectedValue(new Error("LMS unreachable"));

    const result = await importEmployeeMasterBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(1);
    expect(result.errorRows).toBe(0);
  });
});
