import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A bulk-imported employee must land with a process, or not land at all.
 *
 * On 2026-08-19 one batch created 60 active employees with no process_id. By 2026-08-26 that
 * was 61 of the 128 people who joined that month — 48%, against 0 for every month from
 * January to June. 62 of the 63 were OPERATIONS staff, i.e. client-facing. An employee with
 * no process joins to no client, so they are missing from process/client headcount, from P&L
 * allocation by process, and from the client portal's own headcount and attrition.
 *
 * Two silent paths produced it, and this suite pins both:
 *   - process_code absent      -> process_id NULL
 *   - process_code unresolved  -> `processIds.get(code) ?? null` threw the value away, so a
 *                                 typo imported "successfully" with the process dropped
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { provisionLmsIdentityForEmployee } = vi.hoisted(() => ({
  provisionLmsIdentityForEmployee: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../lms/lms-provisioning.service.js", () => ({ provisionLmsIdentityForEmployee }));

import { importEmployeeMasterBatch } from "../employee-master-bulk.service.js";

const row = (id: string, row_no: number, data: Record<string, unknown>) =>
  ({ id, row_no, normalized_data: JSON.stringify(data) });

/** Dispatches on SQL content — the six lookups fan out via Promise.all, so order is not fixed. */
function mockBySql(rowsFetch: unknown[], lookups: Record<string, unknown[]> = {}) {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT id, row_no, normalized_data")) return [rowsFetch, []];
    if (sql.includes("FROM branch_master")) return [lookups.branch ?? [], []];
    if (sql.includes("FROM department_master")) return [lookups.department ?? [], []];
    if (sql.includes("FROM designation_master")) return [lookups.designation ?? [], []];
    if (sql.includes("FROM cost_centre_master")) return [lookups.costCentre ?? [], []];
    if (sql.includes("FROM process_master")) return [lookups.process ?? [], []];
    if (sql.includes("FROM lob_master")) return [lookups.lob ?? [], []];
    return [{}, []];
  });
}
const inserts = () =>
  execute.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO employees"));

beforeEach(() => { execute.mockReset(); provisionLmsIdentityForEmployee.mockClear(); });

describe("employee bulk import — process is mandatory", () => {
  it("rejects a row with no process_code instead of importing a NULL process", async () => {
    mockBySql([row("r1", 1, { employee_code: "MAS63359", first_name: "AADITY", last_name: "K", date_of_joining: "2026-01-01" })]);

    const res = await importEmployeeMasterBatch("b1", "u1");

    expect(res.importedRows).toBe(0);
    expect(res.errorRows).toBe(1);
    expect(res.errors[0]).toContain("process_code is required");
    expect(inserts(), "nothing may be written for a rejected row").toHaveLength(0);
  });

  it("rejects a process_code that matches nothing, rather than silently dropping it", async () => {
    // The old code did `processIds.get(code) ?? null` — a typo imported clean, minus the process.
    mockBySql(
      [row("r1", 1, { employee_code: "MAS1", first_name: "A", last_name: "N", date_of_joining: "2026-01-01", process_code: "ONFIDO_TYPO" })],
      { process: [{ id: "p-1", code: "ONFIDO" }] },
    );

    const res = await importEmployeeMasterBatch("b1", "u1");

    expect(res.importedRows).toBe(0);
    expect(res.errors[0]).toContain('process_code "ONFIDO_TYPO"');
    expect(inserts()).toHaveLength(0);
  });

  it("imports the row when the process resolves", async () => {
    mockBySql(
      [row("r1", 1, {
        employee_code: "MAS1", first_name: "A", last_name: "N", date_of_joining: "2026-01-01",
        process_code: "ONFIDO", designation_code: "EXECUTIVE",
      })],
      { process: [{ id: "p-1", code: "ONFIDO" }], designation: [{ id: "d-1", code: "EXECUTIVE" }] },
    );

    const res = await importEmployeeMasterBatch("b1", "u1");

    expect(res.importedRows).toBe(1);
    expect(res.errorRows).toBe(0);
    expect(inserts()).toHaveLength(1);
  });

  it("keeps the good rows and rejects only the bad ones", async () => {
    // Batch isolation: one unusable row must not cost the rest of the upload.
    mockBySql(
      [
        row("r1", 1, { employee_code: "MAS1", first_name: "A", last_name: "N", date_of_joining: "2026-01-01", process_code: "ONFIDO", designation_code: "EXECUTIVE" }),
        row("r2", 2, { employee_code: "MAS2", first_name: "B", last_name: "N", date_of_joining: "2026-01-01" }),
        row("r3", 3, { employee_code: "MAS3", first_name: "C", last_name: "N", date_of_joining: "2026-01-01", process_code: "ONFIDO", designation_code: "EXECUTIVE" }),
      ],
      { process: [{ id: "p-1", code: "ONFIDO" }], designation: [{ id: "d-1", code: "EXECUTIVE" }] },
    );

    const res = await importEmployeeMasterBatch("b1", "u1");

    expect(res.importedRows).toBe(2);
    expect(res.errorRows).toBe(1);
    expect(res.errors.join()).toContain("Row 2");
  });

  it("reports a supplied branch/cost-centre code that resolves to nothing", async () => {
    // Same silent-drop shape as process. A blank stays allowed; a wrong value does not.
    mockBySql(
      [row("r1", 1, {
        employee_code: "MAS1", first_name: "A", last_name: "N", date_of_joining: "2026-01-01", process_code: "ONFIDO",
        branch_code: "NOWHERE", cost_centre_code: "CC_GONE",
      })],
      { process: [{ id: "p-1", code: "ONFIDO" }] },
    );

    const res = await importEmployeeMasterBatch("b1", "u1");

    expect(res.importedRows).toBe(0);
    expect(res.errors[0]).toContain('branch_code "NOWHERE"');
    expect(res.errors[0]).toContain('cost_centre_code "CC_GONE"');
  });

  it("still allows the optional codes to be blank", async () => {
    // branch/department/cost_centre/lob stay optional. process and designation do not.
    mockBySql(
      [row("r1", 1, {
        employee_code: "MAS1", first_name: "A", last_name: "N", date_of_joining: "2026-01-01",
        process_code: "ONFIDO", designation_code: "EXECUTIVE",
      })],
      { process: [{ id: "p-1", code: "ONFIDO" }], designation: [{ id: "d-1", code: "EXECUTIVE" }] },
    );

    const res = await importEmployeeMasterBatch("b1", "u1");
    expect(res.importedRows).toBe(1);
  });

  it("rejects a row with no designation_code instead of importing a NULL designation", async () => {
    // 157 active employees reached the live database with designation_id NULL, all of them
    // created through this path in July and August 2026. Nothing can back-fill them: none
    // appear in db_bill under their employee code, name+DOJ, PAN or mobile number.
    mockBySql(
      [row("r1", 1, { employee_code: "MAS63359", first_name: "AADITY", last_name: "K", date_of_joining: "2026-01-01", process_code: "ONFIDO" })],
      { process: [{ id: "p-1", code: "ONFIDO" }] },
    );

    const res = await importEmployeeMasterBatch("b1", "u1");

    expect(res.importedRows).toBe(0);
    expect(res.errorRows).toBe(1);
    expect(res.errors[0]).toContain("designation_code is required");
    expect(inserts(), "nothing may be written for a rejected row").toHaveLength(0);
  });

  it("rejects a designation_code that matches nothing, rather than silently dropping it", async () => {
    mockBySql(
      [row("r1", 1, {
        employee_code: "MAS1", first_name: "A", last_name: "N", date_of_joining: "2026-01-01",
        process_code: "ONFIDO", designation_code: "EXEC_TYPO",
      })],
      { process: [{ id: "p-1", code: "ONFIDO" }], designation: [{ id: "d-1", code: "EXECUTIVE" }] },
    );

    const res = await importEmployeeMasterBatch("b1", "u1");

    expect(res.importedRows).toBe(0);
    expect(res.errors[0]).toContain('designation_code "EXEC_TYPO"');
    expect(inserts()).toHaveLength(0);
  });
});
