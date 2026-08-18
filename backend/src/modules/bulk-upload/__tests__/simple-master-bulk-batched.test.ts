import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * department/asset/branch/lob/designation-master-bulk.service.ts were each
 * hand-rewritten from a per-row INSERT ... ON DUPLICATE KEY UPDATE loop to a
 * chunked multi-row upsert with per-chunk fallback (same pattern as
 * process-master-bulk, covered in its own dedicated test file). They're
 * separate files, not a shared helper, so this pins the same two guarantees
 * across all five by construction rather than by copy-pasted trust: every
 * valid row lands in ONE bulk statement, and a single bad row in a chunk
 * falls back to per-row processing instead of taking the whole chunk down.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

function row(id: string, row_no: number, data: Record<string, unknown>) {
  return { id, row_no, normalized_data: JSON.stringify(data) };
}

beforeEach(() => {
  execute.mockReset();
});

const CASES = [
  {
    name: "department", modulePath: "../department-master-bulk.service.js", exportName: "importDepartmentMasterBatch",
    table: "department_master", requiredMsg: /dept_code and dept_name are required/,
    validRow: { dept_code: "OPS", dept_name: "Operations" },
    invalidRow: { dept_code: "", dept_name: "Missing code" },
    dupeCode: "OPS",
  },
  {
    name: "asset", modulePath: "../asset-master-bulk.service.js", exportName: "importAssetMasterBatch",
    table: "asset_master", requiredMsg: /asset_code and asset_name are required/,
    validRow: { asset_code: "AST001", asset_name: "Dell Laptop" },
    invalidRow: { asset_code: "", asset_name: "Missing code" },
    dupeCode: "AST001",
  },
  {
    name: "branch", modulePath: "../branch-master-bulk.service.js", exportName: "importBranchMasterBatch",
    table: "branch_master", requiredMsg: /branch_code and branch_name are required/,
    validRow: { branch_code: "OKAYA", branch_name: "Okaya" },
    invalidRow: { branch_code: "", branch_name: "Missing code" },
    dupeCode: "OKAYA",
  },
  {
    name: "lob", modulePath: "../lob-master-bulk.service.js", exportName: "importLobMasterBatch",
    table: "lob_master", requiredMsg: /lob_code and lob_name are required/,
    validRow: { lob_code: "KYC", lob_name: "KYC" },
    invalidRow: { lob_code: "", lob_name: "Missing code" },
    dupeCode: "KYC",
  },
  {
    name: "designation", modulePath: "../designation-master-bulk.service.js", exportName: "importDesignationMasterBatch",
    table: "designation_master", requiredMsg: /designation_code and designation_name are required/,
    validRow: { designation_code: "EXEC", designation_name: "Executive" },
    invalidRow: { designation_code: "", designation_name: "Missing code" },
    dupeCode: "EXEC",
  },
];

describe.each(CASES)("$name master bulk import — batched rewrite", ({ modulePath, exportName, table, requiredMsg, validRow, invalidRow, dupeCode }) => {
  it("upserts a valid row in one chunked statement and error-isolates a pre-validation failure", async () => {
    const importFn = (await import(modulePath))[exportName] as (batchId: string, userId: string) => Promise<{ importedRows: number; errorRows: number; errors: string[] }>;

    execute.mockResolvedValueOnce([
      [row("row-1", 1, validRow), row("row-2", 2, invalidRow)],
      [],
    ]);
    execute.mockResolvedValue([{}, []]);

    const result = await importFn("batch-1", "user-1");

    expect(result.importedRows).toBe(1);
    expect(result.errorRows).toBe(1);
    expect(result.errors[0]).toMatch(requiredMsg);
    expect(execute.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes(`INSERT INTO ${table}`))).toBe(true);
  });

  it("isolates one bad row when the chunk's multi-row statement fails", async () => {
    const importFn = (await import(modulePath))[exportName] as (batchId: string, userId: string) => Promise<{ importedRows: number; errorRows: number; errors: string[] }>;

    execute.mockReset();
    execute.mockResolvedValueOnce([[row("row-1", 1, validRow)], []]);

    let chunkAttempted = false;
    execute.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes(`INSERT INTO ${table}`)) {
        if (!chunkAttempted) {
          chunkAttempted = true;
          throw new Error(`Duplicate entry '${dupeCode}'`); // the whole (one-row) chunk fails
        }
        throw new Error(`Duplicate entry '${dupeCode}'`); // fallback retry fails too — genuinely a bad row
      }
      return [{}, []];
    });

    const result = await importFn("batch-1", "user-1");

    expect(result.importedRows).toBe(0);
    expect(result.errorRows).toBe(1);
    expect(result.errors[0]).toMatch(/Duplicate entry/);
  });
});
