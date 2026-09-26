import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Employee Process / Cost Centre / LOB Mapping bulk upload. DB is mocked by SQL shape (not
 * call order) so the tests pin behaviour: a row is applied only when every master check
 * passes, per-row rejection reasons, batched lookups, valid rows still committed on partial
 * failure, and no UPDATE for a row that already holds the same values.
 */

const conn = vi.hoisted(() => ({
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
}));
const { execute, getConnection } = vi.hoisted(() => ({
  execute: vi.fn(),
  getConnection: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

const { writeAuditLog } = vi.hoisted(() => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog }));

vi.mock("../../../shared/roleResolver.js", () => ({
  getUserRoleContext: vi.fn().mockResolvedValue({
    roleKeys: ["wfm"],
    primaryRole: "wfm",
    isSuperAdmin: false,
    isHO: false,
  }),
}));

const { resolveWfmScope, processScopeSql } = vi.hoisted(() => ({
  resolveWfmScope: vi.fn(),
  processScopeSql: vi.fn(),
}));
vi.mock("../../wfm/wfm-scope-fallback.js", () => ({ resolveWfmScope }));
vi.mock("../../wfm/process-lob-map.service.js", () => ({
  LOB_MODULE_KEY: "wfm_process_lob",
  processScopeSql,
}));

import { importEmployeeLobBatch } from "../employee-lob-bulk.service.js";
import { DashboardScopeConfigurationError } from "../../../shared/dashboardScope.js";

const MAS = "Mas Callnet India Pvt Ltd";

const PROC = {
  id: "p1",
  process_code: "ONFIDO",
  process_name: "Onfido KYC",
  branch_id: "b1",
  active_status: 1,
  in_scope: 1,
};
const LOB_POA = {
  id: "lob-poa",
  lob_code: "POA",
  lob_name: "POA Verification",
  active_status: 1,
};
const CC = {
  id: "cc1",
  cost_centre_code: "BSS/BO/NOIDA-2/576",
  cost_centre_name: "Onfido Noida 2",
  branch_id: "b1",
  company_name: MAS,
  active_status: 1,
  status: "active",
};

const emp = (code: string, over: Record<string, unknown> = {}) => ({
  id: `id-${code}`,
  employee_code: code,
  branch_id: "b1",
  process_id: null,
  lob_id: null,
  cost_centre_id: null,
  active_status: 1,
  in_scope: 1,
  ...over,
});

const sheetRow = (over: Record<string, unknown> = {}) => ({
  employee_code: "MAS001",
  cost_centre_code: "BSS/BO/NOIDA-2/576",
  process_code: "ONFIDO",
  lob_code: "POA",
  ...over,
});

function staged(rows: Array<Record<string, unknown>>) {
  return rows.map((data, i) => ({
    id: `row-${i + 1}`,
    row_no: i + 1,
    normalized_data: JSON.stringify(data),
  }));
}

interface World {
  rows: Array<Record<string, unknown>>;
  employees?: Array<Record<string, unknown>>;
  processes?: Array<Record<string, unknown>>;
  costCentres?: Array<Record<string, unknown>>;
  lobs?: Array<Record<string, unknown>>;
  mappings?: Array<{ process_id: string; lob_id: string }>;
}

function setup(w: World) {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM upload_batch_row")) return [staged(w.rows), []];
    if (sql.includes("FROM employees e")) return [w.employees ?? [], []];
    if (sql.includes("FROM process_master pm"))
      return [w.processes ?? [PROC], []];
    if (sql.includes("FROM cost_centre_master"))
      return [w.costCentres ?? [CC], []];
    if (sql.includes("FROM lob_master")) return [w.lobs ?? [LOB_POA], []];
    if (sql.includes("FROM process_lob_map"))
      return [w.mappings ?? [{ process_id: "p1", lob_id: "lob-poa" }], []];
    throw new Error(`unexpected pool query: ${sql}`);
  });
}

const writes = (needle: string) =>
  conn.execute.mock.calls.filter((c) => String(c[0]).includes(needle));

async function run(w: World) {
  setup(w);
  return importEmployeeLobBatch("batch-1", "user-1");
}

beforeEach(() => {
  execute.mockReset();
  conn.execute.mockReset().mockResolvedValue([{}, []]);
  conn.beginTransaction.mockReset();
  conn.commit.mockReset();
  conn.rollback.mockReset();
  conn.release.mockReset();
  getConnection.mockReset().mockResolvedValue(conn);
  writeAuditLog.mockClear();
  resolveWfmScope.mockReset().mockResolvedValue({
    level: "BRANCH_ALL",
    branchIds: ["b1"],
    processIds: [],
    employeeIds: [],
  });
  processScopeSql
    .mockReset()
    .mockReturnValue({ sql: "pm.branch_id IN (?)", params: ["b1"] });
});

describe("importEmployeeLobBatch — applying a row", () => {
  it("sets process, LOB, cost centre and legacy cost-centre code in one UPDATE, marks the row, audits once", async () => {
    const r = await run({ rows: [sheetRow()], employees: [emp("MAS001")] });

    expect(r).toMatchObject({
      importedRows: 1,
      errorRows: 0,
      updatedRows: 1,
      unchangedRows: 0,
      errors: [],
    });
    const upd = writes("UPDATE employees");
    expect(upd).toHaveLength(1);
    expect(upd[0][1]).toEqual([
      "id-MAS001",
      "p1", // process_id
      "id-MAS001",
      "lob-poa", // lob_id
      "id-MAS001",
      "cc1", // cost_centre_id
      "id-MAS001",
      "BSS/BO/NOIDA-2/576", // cost_center_code
      "id-MAS001", // WHERE id IN
    ]);
    expect(writes("row_status = 'imported'")).toHaveLength(1);
    expect(writes("UPDATE upload_batch SET")[0][1]).toEqual([
      "imported",
      1,
      0,
      "batch-1",
    ]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "employee.org_mapping.bulk_upload",
        entity_id: "batch-1",
        metadata: expect.objectContaining({
          updated: 1,
          unchanged: 0,
          rejected: 0,
          employee_ids_sample: ["id-MAS001"],
        }),
      }),
    );
  });

  it("matches codes trimmed and case-insensitively", async () => {
    const r = await run({
      rows: [
        sheetRow({
          employee_code: "  mas001 ",
          cost_centre_code: " bss/bo/noida-2/576 ",
          process_code: " onfido ",
          lob_code: " Poa ",
        }),
      ],
      employees: [emp("MAS001")],
    });
    expect(r.importedRows).toBe(1);
    expect(r.errorRows).toBe(0);
  });

  it("accepts a unique master NAME in place of the code", async () => {
    const r = await run({
      rows: [
        sheetRow({
          cost_centre_code: "Onfido Noida 2",
          process_code: "Onfido KYC",
          lob_code: "POA Verification",
        }),
      ],
      employees: [emp("MAS001")],
    });
    expect(r.errors).toEqual([]);
    expect(r.updatedRows).toBe(1);
  });

  it("does not UPDATE a row that already holds the same process, LOB and cost centre", async () => {
    const r = await run({
      rows: [sheetRow()],
      employees: [
        emp("MAS001", {
          process_id: "p1",
          lob_id: "lob-poa",
          cost_centre_id: "cc1",
        }),
      ],
    });
    expect(r).toMatchObject({
      importedRows: 1,
      updatedRows: 0,
      unchangedRows: 1,
    });
    expect(writes("UPDATE employees")).toHaveLength(0);
  });

  it("applies the valid rows and rejects the bad ones in the same file", async () => {
    const r = await run({
      rows: [
        sheetRow({ employee_code: "MAS001" }),
        sheetRow({ employee_code: "MAS002", lob_code: "GHOST" }),
      ],
      employees: [emp("MAS001"), emp("MAS002")],
    });
    expect(r.importedRows).toBe(1);
    expect(r.errorRows).toBe(1);
    expect(writes("UPDATE upload_batch SET")[0][1][0]).toBe(
      "imported_with_errors",
    );
    expect(writes("UPDATE employees")).toHaveLength(1);
    expect(writes("UPDATE employees")[0][1]).toContain("id-MAS001");
    expect(writes("UPDATE employees")[0][1]).not.toContain("id-MAS002");
  });
});

describe("importEmployeeLobBatch — employee rules", () => {
  it("rejects an unknown employee", async () => {
    const r = await run({
      rows: [sheetRow({ employee_code: "NOPE" })],
      employees: [],
    });
    expect(r.errors).toEqual([
      'Row 1: Employee "NOPE" not found or outside your scope',
    ]);
    expect(writes("UPDATE employees")).toHaveLength(0);
  });

  it("rejects an employee outside scope with the same non-leaking reason", async () => {
    const r = await run({
      rows: [sheetRow()],
      employees: [emp("MAS001", { in_scope: 0 })],
    });
    expect(r.errors).toEqual([
      'Row 1: Employee "MAS001" not found or outside your scope',
    ]);
  });

  it("rejects every row with the scope error when the account has no WFM scope configured", async () => {
    resolveWfmScope.mockRejectedValue(
      new DashboardScopeConfigurationError("none"),
    );
    const r = await run({
      rows: [sheetRow()],
      employees: [emp("MAS001", { in_scope: 0 })],
    });
    expect(r.errors[0]).toContain("no branch/process scope configured");
    expect(r.importedRows).toBe(0);
  });

  it("rejects an inactive employee and an employee with no branch", async () => {
    const r = await run({
      rows: [
        sheetRow({ employee_code: "MAS001" }),
        sheetRow({ employee_code: "MAS002" }),
      ],
      employees: [
        emp("MAS001", { active_status: 0 }),
        emp("MAS002", { branch_id: null }),
      ],
    });
    expect(r.errors).toEqual([
      'Row 1: Employee "MAS001" is inactive',
      'Row 2: Employee "MAS002" has no branch assigned — assign a branch first',
    ]);
  });

  it("lets a caller who holds the branch reach an employee who has no process yet", async () => {
    await run({ rows: [sheetRow()], employees: [emp("MAS001")] });
    const call = execute.mock.calls.find((c) =>
      String(c[0]).includes("FROM employees e"),
    )!;
    expect(String(call[0])).toContain(
      "e.process_id IS NULL AND e.branch_id IN (?)",
    );
    expect(String(call[0])).not.toMatch(/COLLATE/i);
    expect(call[1].slice(0, 2)).toEqual(["b1", "b1"]);
  });

  it("does not widen scope for an org-wide caller", async () => {
    resolveWfmScope.mockResolvedValue({
      level: "ORG_ALL",
      branchIds: [],
      processIds: [],
      employeeIds: [],
    });
    processScopeSql.mockReturnValue({ sql: "1=1", params: [] });
    await run({ rows: [sheetRow()], employees: [emp("MAS001")] });
    const call = execute.mock.calls.find((c) =>
      String(c[0]).includes("FROM employees e"),
    )!;
    expect(String(call[0])).not.toContain("e.process_id IS NULL");
  });
});

describe("importEmployeeLobBatch — process rules", () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    [
      "an unknown process",
      { process_code: "GHOST" },
      'Row 1: Process "GHOST" not found in Process Master',
    ],
  ];
  it.each(cases)("rejects %s", async (_n, over, message) => {
    const r = await run({ rows: [sheetRow(over)], employees: [emp("MAS001")] });
    expect(r.errors).toEqual([message]);
    expect(writes("UPDATE employees")).toHaveLength(0);
  });

  it("rejects an inactive process", async () => {
    const r = await run({
      rows: [sheetRow()],
      employees: [emp("MAS001")],
      processes: [{ ...PROC, active_status: 0 }],
    });
    expect(r.errors).toEqual(["Row 1: Process ONFIDO is inactive"]);
  });

  it("rejects a process outside the caller's scope", async () => {
    const r = await run({
      rows: [sheetRow()],
      employees: [emp("MAS001")],
      processes: [{ ...PROC, in_scope: 0 }],
    });
    expect(r.errors).toEqual(["Row 1: Process ONFIDO is outside your scope"]);
  });

  it("rejects a process that belongs to another branch, but allows a shared (no-branch) process", async () => {
    const other = await run({
      rows: [sheetRow()],
      employees: [emp("MAS001")],
      processes: [{ ...PROC, branch_id: "b2" }],
    });
    expect(other.errors).toEqual([
      'Row 1: Process ONFIDO belongs to a different branch than employee "MAS001"',
    ]);
    execute.mockReset();
    conn.execute.mockClear();
    const shared = await run({
      rows: [sheetRow()],
      employees: [emp("MAS001")],
      processes: [{ ...PROC, branch_id: null }],
    });
    expect(shared.errors).toEqual([]);
  });

  it("rejects a process name shared by two processes and asks for the code", async () => {
    const r = await run({
      rows: [sheetRow({ process_code: "Onfido KYC" })],
      employees: [emp("MAS001")],
      processes: [PROC, { ...PROC, id: "p2", process_code: "ONFIDO2" }],
    });
    expect(r.errors).toEqual([
      'Row 1: Process "Onfido KYC" matches 2 processes — use the process code',
    ]);
  });
});

describe("importEmployeeLobBatch — cost centre rules", () => {
  it("rejects an unknown cost centre", async () => {
    const r = await run({
      rows: [sheetRow({ cost_centre_code: "NOPE/1" })],
      employees: [emp("MAS001")],
    });
    expect(r.errors).toEqual([
      'Row 1: Cost centre "NOPE/1" not found in Cost Centre Master',
    ]);
  });

  it("rejects a cost centre of another company", async () => {
    const r = await run({
      rows: [sheetRow()],
      employees: [emp("MAS001")],
      costCentres: [{ ...CC, company_name: "IDC Services" }],
    });
    expect(r.errors[0]).toContain(
      "is not a Mas Callnet India Pvt Ltd cost centre",
    );
  });

  it("rejects a closed or inactive cost centre", async () => {
    const closed = await run({
      rows: [sheetRow()],
      employees: [emp("MAS001")],
      costCentres: [{ ...CC, status: "closed" }],
    });
    expect(closed.errors).toEqual([
      "Row 1: Cost centre BSS/BO/NOIDA-2/576 is closed or inactive",
    ]);
    execute.mockReset();
    conn.execute.mockClear();
    const inactive = await run({
      rows: [sheetRow()],
      employees: [emp("MAS001")],
      costCentres: [{ ...CC, active_status: 0 }],
    });
    expect(inactive.errors[0]).toContain("is closed or inactive");
  });

  it("rejects a cost centre in another branch, but allows one with no branch", async () => {
    const other = await run({
      rows: [sheetRow()],
      employees: [emp("MAS001")],
      costCentres: [{ ...CC, branch_id: "b2" }],
    });
    expect(other.errors).toEqual([
      'Row 1: Cost centre BSS/BO/NOIDA-2/576 belongs to a different branch than employee "MAS001"',
    ]);
    execute.mockReset();
    conn.execute.mockClear();
    const none = await run({
      rows: [sheetRow()],
      employees: [emp("MAS001")],
      costCentres: [{ ...CC, branch_id: null }],
    });
    expect(none.errors).toEqual([]);
  });
});

describe("importEmployeeLobBatch — LOB rules", () => {
  it("rejects an unknown and an inactive LOB", async () => {
    const r = await run({
      rows: [
        sheetRow({ employee_code: "MAS001", lob_code: "GHOST" }),
        sheetRow({ employee_code: "MAS002", lob_code: "OLD" }),
      ],
      employees: [emp("MAS001"), emp("MAS002")],
      lobs: [
        LOB_POA,
        { id: "lob-old", lob_code: "OLD", lob_name: "Old", active_status: 0 },
      ],
    });
    expect(r.errors).toEqual([
      'Row 1: LOB "GHOST" not found in LOB master',
      "Row 2: LOB OLD is inactive",
    ]);
  });

  it("rejects a LOB that is not mapped to the row's process, naming both", async () => {
    const r = await run({
      rows: [sheetRow({ lob_code: "OTHER" })],
      employees: [emp("MAS001")],
      lobs: [
        LOB_POA,
        {
          id: "lob-other",
          lob_code: "OTHER",
          lob_name: "Other",
          active_status: 1,
        },
      ],
    });
    expect(r.errors).toEqual([
      "Row 1: LOB OTHER is not mapped to process ONFIDO — add it in Process LOB Mapping first",
    ]);
    expect(writes("UPDATE employees")).toHaveLength(0);
  });

  it("checks the mapping against the NEW process, not the employee's current one", async () => {
    const r = await run({
      rows: [sheetRow()],
      employees: [emp("MAS001", { process_id: "p-old" })],
      mappings: [{ process_id: "p-old", lob_id: "lob-poa" }],
    });
    expect(r.errors[0]).toContain("is not mapped to process ONFIDO");
  });
});

describe("importEmployeeLobBatch — sheet rules", () => {
  it("rejects a row with any blank cell", async () => {
    const r = await run({
      rows: [
        sheetRow({ cost_centre_code: " " }),
        sheetRow({ employee_code: "MAS002", process_code: "" }),
      ],
      employees: [emp("MAS001"), emp("MAS002")],
    });
    expect(r.importedRows).toBe(0);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toContain("are all required");
    expect(writes("UPDATE upload_batch SET")[0][1][0]).toBe(
      "validation_failed",
    );
  });

  it("processes only the first row of a repeated employee_code", async () => {
    const r = await run({
      rows: [sheetRow(), sheetRow({ employee_code: "mas001" })],
      employees: [emp("MAS001")],
    });
    expect(r.importedRows).toBe(1);
    expect(r.errors).toEqual([
      'Row 2: Duplicate employee_code "mas001" — already on row 1; only the first occurrence is processed',
    ]);
  });

  it("rolls back and rethrows when the transaction fails, leaving nothing half-applied", async () => {
    setup({ rows: [sheetRow()], employees: [emp("MAS001")] });
    conn.execute.mockRejectedValueOnce(new Error("lock wait timeout"));
    await expect(importEmployeeLobBatch("batch-1", "user-1")).rejects.toThrow(
      "lock wait timeout",
    );
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("does no lookups and no writes for an empty batch", async () => {
    setup({ rows: [] });
    const r = await importEmployeeLobBatch("batch-1", "user-1");
    expect(r.importedRows).toBe(0);
    expect(getConnection).not.toHaveBeenCalled();
  });
});
