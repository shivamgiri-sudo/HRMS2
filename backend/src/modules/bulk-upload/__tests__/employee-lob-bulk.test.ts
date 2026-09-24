import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Employee LOB Mapping bulk upload. DB is mocked by SQL shape (not call order) so the tests
 * pin behaviour: per-row rejection reasons, batched lookups, valid rows still committed on
 * partial failure, and no UPDATE for a row whose LOB is already set.
 */

const conn = vi.hoisted(() => ({
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
}));
const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

const { writeAuditLog } = vi.hoisted(() => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog }));

vi.mock("../../../shared/roleResolver.js", () => ({
  getUserRoleContext: vi.fn().mockResolvedValue({ roleKeys: ["wfm"], primaryRole: "wfm", isSuperAdmin: false, isHO: false }),
}));

const { resolveCallerScope } = vi.hoisted(() => ({ resolveCallerScope: vi.fn() }));
vi.mock("../../wfm/process-lob-map.service.js", () => {
  class LobServiceError extends Error {
    constructor(public statusCode: number, message: string, public code = "LOB_ERROR") {
      super(message);
    }
  }
  return { LOB_MODULE_KEY: "wfm_process_lob", LobServiceError, resolveCallerScope };
});

import { importEmployeeLobBatch } from "../employee-lob-bulk.service.js";
import { LobServiceError } from "../../wfm/process-lob-map.service.js";

const LOB_KYC = { id: "lob-kyc", lob_code: "ONF_KYC", active_status: 1 };
const LOB_OLD = { id: "lob-old", lob_code: "OLD", active_status: 0 };
const LOB_OTHER = { id: "lob-other", lob_code: "OTHER", active_status: 1 };

const emp = (code: string, over: Record<string, unknown> = {}) => ({
  id: `id-${code}`, employee_code: code, process_id: "p1", process_name: "Onfido", lob_id: null,
  active_status: 1, in_scope: 1, ...over,
});

function staged(rows: Array<Record<string, unknown>>) {
  return rows.map((data, i) => ({ id: `row-${i + 1}`, row_no: i + 1, normalized_data: JSON.stringify(data) }));
}

interface World {
  rows: Array<Record<string, unknown>>;
  employees?: Array<Record<string, unknown>>;
  lobs?: Array<Record<string, unknown>>;
  mappings?: Array<{ process_id: string; lob_id: string }>;
}

function setup(w: World) {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM upload_batch_row")) return [staged(w.rows), []];
    if (sql.includes("FROM employees e")) return [w.employees ?? [], []];
    if (sql.includes("FROM lob_master")) return [w.lobs ?? [LOB_KYC, LOB_OLD, LOB_OTHER], []];
    if (sql.includes("FROM process_lob_map")) return [w.mappings ?? [{ process_id: "p1", lob_id: "lob-kyc" }], []];
    throw new Error(`unexpected pool query: ${sql}`);
  });
}

const writes = (needle: string) => conn.execute.mock.calls.filter((c) => String(c[0]).includes(needle));

beforeEach(() => {
  execute.mockReset();
  conn.execute.mockReset().mockResolvedValue([{}, []]);
  conn.beginTransaction.mockReset();
  conn.commit.mockReset();
  conn.rollback.mockReset();
  conn.release.mockReset();
  getConnection.mockReset().mockResolvedValue(conn);
  writeAuditLog.mockClear();
  resolveCallerScope.mockReset().mockResolvedValue({ sql: "pm.branch_id IN (?)", params: ["b1"] });
});

describe("importEmployeeLobBatch", () => {
  it("applies a valid row: one employees UPDATE, row marked imported, batch summarised, one audit row", async () => {
    setup({ rows: [{ employee_code: "MAS001", lob_code: "onf_kyc" }], employees: [emp("MAS001")] });

    const r = await importEmployeeLobBatch("batch-1", "user-1");

    expect(r).toMatchObject({ importedRows: 1, errorRows: 0, updatedRows: 1, unchangedRows: 0, errors: [] });
    const upd = writes("UPDATE employees");
    expect(upd).toHaveLength(1);
    expect(upd[0][1]).toEqual(["id-MAS001", "lob-kyc", "id-MAS001"]);
    expect(writes("row_status = 'imported'")).toHaveLength(1);
    expect(writes("UPDATE upload_batch SET")[0][1]).toEqual(["imported", 1, 0, "batch-1"]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action_type: "employee.lob.bulk_upload", entity_type: "upload_batch", entity_id: "batch-1",
      metadata: expect.objectContaining({ updated: 1, unchanged: 0, rejected: 0, employee_ids_sample: ["id-MAS001"] }),
    }));
  });

  it("matches employee and LOB codes trimmed and case-insensitively", async () => {
    setup({ rows: [{ employee_code: "  mas001 ", lob_code: " Onf_Kyc " }], employees: [emp("MAS001")] });
    const r = await importEmployeeLobBatch("batch-1", "user-1");
    expect(r.importedRows).toBe(1);
    expect(r.errorRows).toBe(0);
  });

  it("rejects an unknown employee", async () => {
    setup({ rows: [{ employee_code: "NOPE", lob_code: "ONF_KYC" }], employees: [] });
    const r = await importEmployeeLobBatch("batch-1", "user-1");
    expect(r.errors).toEqual(['Row 1: Employee "NOPE" not found or outside your scope']);
    expect(writes("UPDATE employees")).toHaveLength(0);
  });

  it("rejects an employee outside the uploader's scope with the same non-leaking reason", async () => {
    setup({ rows: [{ employee_code: "MAS001", lob_code: "ONF_KYC" }], employees: [emp("MAS001", { in_scope: 0 })] });
    const r = await importEmployeeLobBatch("batch-1", "user-1");
    expect(r.errors).toEqual(['Row 1: Employee "MAS001" not found or outside your scope']);
    expect(writes("UPDATE employees")).toHaveLength(0);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ updated: 0, rejected: 1 }) }));
  });

  it("passes the resolved scope predicate into the employee lookup", async () => {
    setup({ rows: [{ employee_code: "MAS001", lob_code: "ONF_KYC" }], employees: [emp("MAS001")] });
    await importEmployeeLobBatch("batch-1", "user-1");
    const call = execute.mock.calls.find((c) => String(c[0]).includes("FROM employees e"))!;
    expect(String(call[0])).toContain("pm.branch_id IN (?)");
    expect(String(call[0])).not.toMatch(/COLLATE/i);
    expect(call[1][0]).toBe("b1");
  });

  it("rejects every row with the scope error when the account has no WFM scope configured", async () => {
    resolveCallerScope.mockRejectedValue(new LobServiceError(403, "Your account has no branch/process scope configured for WFM.", "SCOPE_NOT_CONFIGURED"));
    setup({ rows: [{ employee_code: "MAS001", lob_code: "ONF_KYC" }], employees: [emp("MAS001", { in_scope: 0 })] });
    const r = await importEmployeeLobBatch("batch-1", "user-1");
    expect(r.errors[0]).toContain("no branch/process scope configured");
    expect(r.importedRows).toBe(0);
  });

  it("rejects an unknown LOB code", async () => {
    setup({ rows: [{ employee_code: "MAS001", lob_code: "GHOST" }], employees: [emp("MAS001")] });
    const r = await importEmployeeLobBatch("batch-1", "user-1");
    expect(r.errors).toEqual(['Row 1: LOB "GHOST" not found in LOB master']);
  });

  it("rejects an inactive LOB", async () => {
    setup({ rows: [{ employee_code: "MAS001", lob_code: "OLD" }], employees: [emp("MAS001")] });
    const r = await importEmployeeLobBatch("batch-1", "user-1");
    expect(r.errors).toEqual(['Row 1: LOB "OLD" is inactive']);
  });

  it("rejects a LOB that is not mapped to the employee's process, naming both", async () => {
    setup({ rows: [{ employee_code: "MAS001", lob_code: "OTHER" }], employees: [emp("MAS001")] });
    const r = await importEmployeeLobBatch("batch-1", "user-1");
    expect(r.errors).toEqual(["Row 1: LOB OTHER is not mapped to process Onfido — add it in Process LOB Mapping first"]);
    expect(writes("UPDATE employees")).toHaveLength(0);
  });

  it("rejects an inactive employee and an employee with no process", async () => {
    setup({
      rows: [{ employee_code: "MAS001", lob_code: "ONF_KYC" }, { employee_code: "MAS002", lob_code: "ONF_KYC" }],
      employees: [emp("MAS001", { active_status: 0 }), emp("MAS002", { process_id: null, process_name: null })],
    });
    const r = await importEmployeeLobBatch("batch-1", "user-1");
    expect(r.errors[0]).toBe('Row 1: Employee "MAS001" is inactive');
    expect(r.errors[1]).toContain("has no process assigned");
  });

  it("rejects duplicate employee rows after the first, case-insensitively", async () => {
    setup({
      rows: [
        { employee_code: "MAS001", lob_code: "ONF_KYC" },
        { employee_code: "mas001", lob_code: "ONF_KYC" },
      ],
      employees: [emp("MAS001")],
    });
    const r = await importEmployeeLobBatch("batch-1", "user-1");
    expect(r).toMatchObject({ importedRows: 1, errorRows: 1, updatedRows: 1 });
    expect(r.errors[0]).toContain('Row 2: Duplicate employee_code "mas001" — already on row 1');
  });

  it("rejects blank cells (this upload never clears a LOB)", async () => {
    setup({
      rows: [{ employee_code: "MAS001", lob_code: "" }, { employee_code: "", lob_code: "ONF_KYC" }, { employee_code: "  ", lob_code: null }],
      employees: [emp("MAS001")],
    });
    const r = await importEmployeeLobBatch("batch-1", "user-1");
    expect(r.errorRows).toBe(3);
    expect(r.errors.every((e) => e.includes("both required"))).toBe(true);
    expect(writes("UPDATE employees")).toHaveLength(0);
    expect(writes("UPDATE upload_batch SET")[0][1]).toEqual(["validation_failed", 0, 3, "batch-1"]);
  });

  it("skips the UPDATE for a row whose LOB is already set, but still marks it processed", async () => {
    setup({
      rows: [{ employee_code: "MAS001", lob_code: "ONF_KYC" }],
      employees: [emp("MAS001", { lob_id: "lob-kyc" })],
    });
    const r = await importEmployeeLobBatch("batch-1", "user-1");
    expect(r).toMatchObject({ importedRows: 1, errorRows: 0, updatedRows: 0, unchangedRows: 1 });
    expect(writes("UPDATE employees")).toHaveLength(0);
    expect(writes("row_status = 'imported'")).toHaveLength(1);
  });

  it("partial failure: valid rows still commit, bad rows are marked error with their reason", async () => {
    setup({
      rows: [
        { employee_code: "MAS001", lob_code: "ONF_KYC" },
        { employee_code: "GHOST1", lob_code: "ONF_KYC" },
        { employee_code: "MAS003", lob_code: "OTHER" },
        { employee_code: "MAS004", lob_code: "ONF_KYC" },
      ],
      employees: [emp("MAS001"), emp("MAS003"), emp("MAS004")],
    });
    const r = await importEmployeeLobBatch("batch-1", "user-1");

    expect(r).toMatchObject({ importedRows: 2, errorRows: 2, updatedRows: 2 });
    const upd = writes("UPDATE employees");
    expect(upd).toHaveLength(1);
    expect(upd[0][1]).toEqual(["id-MAS001", "lob-kyc", "id-MAS004", "lob-kyc", "id-MAS001", "id-MAS004"]);
    const errWrite = writes("row_status = 'error'")[0];
    expect(errWrite[1]).toEqual([
      "row-2", JSON.stringify(['Employee "GHOST1" not found or outside your scope']),
      "row-3", JSON.stringify(["LOB OTHER is not mapped to process Onfido — add it in Process LOB Mapping first"]),
      "row-2", "row-3",
    ]);
    expect(writes("UPDATE upload_batch SET")[0][1]).toEqual(["imported_with_errors", 2, 2, "batch-1"]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("uses batched lookups: one employees, one lob_master and one mappings query for many rows", async () => {
    const codes = Array.from({ length: 1200 }, (_, i) => `MAS${i}`);
    setup({
      rows: codes.map((c) => ({ employee_code: c, lob_code: "ONF_KYC" })),
      employees: codes.map((c) => emp(c)),
    });
    await importEmployeeLobBatch("batch-1", "user-1");
    const count = (needle: string) => execute.mock.calls.filter((c) => String(c[0]).includes(needle)).length;
    // 1200 codes x2 variants (as-typed + upper) = 2400 -> 5 chunks of 500, never one query per row.
    expect(count("FROM employees e")).toBeLessThanOrEqual(5);
    expect(count("FROM lob_master")).toBe(1);
    expect(count("FROM process_lob_map")).toBe(1);
    // Writes are chunked at 500 rows per statement.
    expect(writes("UPDATE employees")).toHaveLength(3);
  });

  it("rolls back and rethrows when a write fails, leaving rows pending", async () => {
    setup({ rows: [{ employee_code: "MAS001", lob_code: "ONF_KYC" }], employees: [emp("MAS001")] });
    conn.execute.mockRejectedValueOnce(new Error("connection lost"));
    await expect(importEmployeeLobBatch("batch-1", "user-1")).rejects.toThrow("connection lost");
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns zeros without touching anything when no rows are staged", async () => {
    setup({ rows: [] });
    const r = await importEmployeeLobBatch("batch-1", "user-1");
    expect(r).toEqual({ importedRows: 0, errorRows: 0, errors: [], updatedRows: 0, unchangedRows: 0 });
    expect(getConnection).not.toHaveBeenCalled();
  });
});
