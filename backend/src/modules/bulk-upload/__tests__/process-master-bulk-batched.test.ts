import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * importProcessMasterBatch (and its five near-identical siblings — department,
 * asset, branch, lob, designation master) used to run one INSERT ... ON
 * DUPLICATE KEY UPDATE per row. Now: bulk lookups for branch_code/lob_code,
 * and the upsert itself runs as one chunked multi-row INSERT. If a chunk's
 * statement fails (any one row violates a constraint), the WHOLE multi-row
 * statement fails atomically — so the rewrite retries that one chunk row by
 * row, to keep the original per-row error isolation (one bad row must not
 * take down every other row that would otherwise have succeeded).
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { importProcessMasterBatch } from "../process-master-bulk.service.js";

function row(id: string, row_no: number, data: Record<string, unknown>) {
  return { id, row_no, normalized_data: JSON.stringify(data) };
}

beforeEach(() => {
  execute.mockReset();
});

describe("importProcessMasterBatch — batched rewrite", () => {
  it("upserts every valid row in one chunked statement, resolving branch codes via a bulk lookup", async () => {
    // business_lob is process_master's real column — a free-text field, not a
    // foreign key. The old fixture used `lob_code` and expected it resolved
    // through lob_master; process_master has no such relationship (no lob_id
    // column exists), and the template's real optional column is `business_lob`.
    execute.mockResolvedValueOnce([
      [
        row("row-1", 1, {
          process_code: "ONF_KYC", process_name: "Onfido KYC", branch_code: "OKAYA",
          business_lob: "KYC", client_name: "Onfido", workload_type: "backoffice",
        }),
        row("row-2", 2, { process_code: "", process_name: "Missing code" }), // pre-validation error
      ],
      [],
    ]);
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM branch_master")) return [[{ id: "branch-1", branch_code: "OKAYA" }], []];
      return [{}, []];
    });

    const result = await importProcessMasterBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(1);
    expect(result.errorRows).toBe(1);
    expect(result.errors[0]).toMatch(/process_code and process_name are required/);

    const insertCall = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO process_master"));
    expect(insertCall![1]).toEqual(["ONF_KYC", "Onfido KYC", "branch-1", "KYC", "Onfido", "backoffice", 1]);
  });

  it("isolates one bad row when the chunk's multi-row statement fails, so the rest of the chunk still lands", async () => {
    execute.mockImplementationOnce(async () => [[
      row("row-1", 1, { process_code: "P1", process_name: "Process 1" }),
      row("row-2", 2, { process_code: "P2", process_name: "Process 2" }),
      row("row-3", 3, { process_code: "P3", process_name: "Process 3" }),
    ], []]);

    let chunkAttempted = false;
    let fallbackCalls = 0;
    execute.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("FROM branch_master") || sql.includes("FROM lob_master")) return [[], []];
      if (sql.includes("INSERT INTO process_master")) {
        if (!chunkAttempted) {
          chunkAttempted = true;
          throw new Error("Duplicate entry 'P2' for key 'process_code'"); // the whole chunk fails
        }
        fallbackCalls++;
        if ((params as unknown[])[0] === "P2") throw new Error("Duplicate entry 'P2' for key 'process_code'");
        return [{}, []];
      }
      return [{}, []];
    });

    const result = await importProcessMasterBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(2); // P1 and P3
    expect(result.errorRows).toBe(1); // P2
    expect(result.errors[0]).toMatch(/Row 2:.*Duplicate entry 'P2'/);
    expect(fallbackCalls).toBe(3); // the chunk was retried one row at a time
  });
});
