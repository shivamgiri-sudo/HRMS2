import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * incentive-bulk.service.ts importIncentiveBatch — batched staging (2026-09-05).
 *
 * The staging loop used to run one row at a time: duplicate-check SELECT, then INSERT,
 * fully sequential — N rows meant ~3N database round trips. It now does the same work
 * in a small, roughly constant number of round trips: one batched duplicate check
 * covering every row, and chunked multi-row INSERT + UPDATE statements (500/chunk)
 * instead of one statement per row. This file proves:
 *  1. Behavior is unchanged (same validation errors, same staged/failed counts).
 *  2. It's actually batched, not just correct — a multi-row file drives a small
 *     constant number of `db.execute` calls, not one per row.
 *  3. The race a naive "just make it concurrent" fix would introduce is closed: two
 *     rows in the same file for the same employee+incentive+month must never both
 *     reach the INSERT, even though nothing serializes them against each other.
 *  4. A chunk-level failure (one bad row's INSERT throws) falls back to per-row
 *     retry for that chunk only, so a single bad row doesn't sacrifice the rest of
 *     its chunk — the same guarantee employee-master-bulk.service.ts relies on.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

vi.mock("../shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn(async () => {}),
}));

const { markRowFailed, markPendingApproval, linkRowToEntity, loadStagedRows } = vi.hoisted(() => ({
  markRowFailed: vi.fn(async () => {}),
  markPendingApproval: vi.fn(async () => {}),
  linkRowToEntity: vi.fn(async () => {}),
  loadStagedRows: vi.fn(),
}));

vi.mock("../modules/bulk-upload/bulk-approval.service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../modules/bulk-upload/bulk-approval.service.js")>();
  return {
    ...original, // keep the real, pure helpers: normalizeMonth, BulkUploadError, resolveSingleBranch
    loadStagedRows,
    resolveEmployees: vi.fn(async (codes: string[]) => {
      const map = new Map<string, { id: string; employee_code: string; branch_id: string | null }>();
      for (const code of codes) {
        const upper = code.trim().toUpperCase();
        if (["E001", "E002", "E003"].includes(upper)) {
          map.set(upper, { id: `emp-${upper}`, employee_code: upper, branch_id: "b-1" });
        }
      }
      return map;
    }),
    linkRowToEntity,
    markRowFailed,
    markPendingApproval,
  };
});

import { importIncentiveBatch } from "../modules/bulk-upload/incentive-bulk.service.js";

const MASTER_PERF = { id: "inc-perf", incentive_code: "PERF", incentive_name: "Performance Bonus" };

function row(rowId: string, rowNo: number, data: Record<string, string>) {
  return { rowId, rowNo, data };
}

function stubDb() {
  execute.mockReset();
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/FROM incentive_master/.test(sql)) {
      return [[MASTER_PERF], []];
    }
    if (/SELECT upload_batch_no FROM upload_batch/.test(sql)) {
      return [[{ upload_batch_no: "BATCH-1" }], []];
    }
    if (/INSERT INTO incentive_upload_batch/.test(sql)) {
      return [{ affectedRows: 1 }, []];
    }
    if (/FROM incentive_upload_line iul\s+JOIN incentive_upload_batch iub/.test(sql)) {
      return [[], []]; // no pre-existing duplicate in any other batch
    }
    if (/INSERT INTO incentive_upload_line/.test(sql)) {
      return [{ affectedRows: 1 }, []];
    }
    if (/UPDATE upload_batch_row/.test(sql)) {
      return [{ affectedRows: 1 }, []];
    }
    if (/UPDATE incentive_upload_batch ib/.test(sql)) {
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unstubbed query in test: ${sql}`);
  });
}

beforeEach(() => {
  stubDb();
  markRowFailed.mockClear();
  markPendingApproval.mockClear();
  linkRowToEntity.mockClear();
  loadStagedRows.mockReset();
});

describe("importIncentiveBatch — parallel staging", () => {
  it("stages every row of a multi-employee file in ONE batched INSERT, not one per row", async () => {
    loadStagedRows.mockResolvedValue([
      row("r1", 1, { employee_code: "E001", incentive_code: "PERF", amount: "500", pay_month: "2026-09" }),
      row("r2", 2, { employee_code: "E002", incentive_code: "PERF", amount: "750", pay_month: "2026-09" }),
      row("r3", 3, { employee_code: "E003", incentive_code: "PERF", amount: "600", pay_month: "2026-09" }),
    ]);

    const outcome = await importIncentiveBatch("batch-1", "user-1");

    expect(outcome.staged).toBe(3);
    expect(outcome.failed).toBe(0);
    expect(markRowFailed).not.toHaveBeenCalled();

    // Batched, not per-row: one INSERT carrying all 3 rows' values...
    const lineInserts = execute.mock.calls.filter(([sql]) => /INSERT INTO incentive_upload_line/.test(sql));
    expect(lineInserts).toHaveLength(1);
    expect(lineInserts[0][1]).toHaveLength(3 * 8); // 8 params/row × 3 rows in one VALUES clause

    // ...and one duplicate-check SELECT covering all 3 employees, not 3 SELECTs.
    const dupChecks = execute.mock.calls.filter(([sql]) => /FROM incentive_upload_line iul\s+JOIN incentive_upload_batch iub/.test(sql));
    expect(dupChecks).toHaveLength(1);

    // ...and one UPDATE linking all 3 rows back to their lines, not linkRowToEntity per row.
    const linkUpdates = execute.mock.calls.filter(([sql]) => /UPDATE upload_batch_row/.test(sql));
    expect(linkUpdates).toHaveLength(1);
    expect(linkRowToEntity).not.toHaveBeenCalled();
  });

  it("falls back to per-row retry when a chunk's batched INSERT fails, isolating only the bad row", async () => {
    loadStagedRows.mockResolvedValue([
      row("r1", 1, { employee_code: "E001", incentive_code: "PERF", amount: "500", pay_month: "2026-09" }),
      row("r2", 2, { employee_code: "E002", incentive_code: "PERF", amount: "999999", pay_month: "2026-09" }), // poison row
      row("r3", 3, { employee_code: "E003", incentive_code: "PERF", amount: "600", pay_month: "2026-09" }),
    ]);

    let batchInsertAttempted = false;
    execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (/FROM incentive_master/.test(sql)) return [[MASTER_PERF], []];
      if (/SELECT upload_batch_no FROM upload_batch/.test(sql)) return [[{ upload_batch_no: "BATCH-1" }], []];
      if (/INSERT INTO incentive_upload_batch/.test(sql)) return [{ affectedRows: 1 }, []];
      if (/FROM incentive_upload_line iul\s+JOIN incentive_upload_batch iub/.test(sql)) return [[], []];
      if (/INSERT INTO incentive_upload_line/.test(sql)) {
        const tupleCount = (sql.match(/\(\?, \?, \?, \?, \?, \?, \?, 'ok', \?\)/g) ?? []).length;
        if (tupleCount > 1) {
          // The whole-chunk INSERT — force it to fail exactly once, like a real
          // constraint violation on one row would, to trigger the per-row fallback.
          batchInsertAttempted = true;
          throw new Error("simulated constraint violation somewhere in the chunk");
        }
        // Fallback path: single-row INSERT. Amount is params[5] in lineParams' order.
        if (Number(params[5]) === 999999) throw new Error("simulated bad row constraint violation");
        return [{ affectedRows: 1 }, []];
      }
      if (/UPDATE upload_batch_row/.test(sql)) return [{ affectedRows: 1 }, []];
      if (/UPDATE incentive_upload_batch ib/.test(sql)) return [{ affectedRows: 1 }, []];
      throw new Error(`Unstubbed query in test: ${sql}`);
    });

    const outcome = await importIncentiveBatch("batch-1", "user-1");

    expect(batchInsertAttempted).toBe(true);
    expect(outcome.staged).toBe(2);
    expect(outcome.failed).toBe(1);
    expect(outcome.errors[0]).toMatch(/simulated bad row constraint violation/);
    expect(markRowFailed).toHaveBeenCalledTimes(1);
    expect(markRowFailed.mock.calls[0][0]).toBe("r2");
    // The two good rows still went through the (fallback) per-row path successfully.
    expect(linkRowToEntity).toHaveBeenCalledTimes(2);
  });

  it("rejects a same-file duplicate (same employee+incentive+month) without a second INSERT", async () => {
    loadStagedRows.mockResolvedValue([
      row("r1", 1, { employee_code: "E001", incentive_code: "PERF", amount: "500", pay_month: "2026-09" }),
      row("r2", 2, { employee_code: "E001", incentive_code: "PERF", amount: "500", pay_month: "2026-09" }),
    ]);

    const outcome = await importIncentiveBatch("batch-1", "user-1");

    expect(outcome.staged).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.errors[0]).toMatch(/appears more than once in this file/);
    const lineInserts = execute.mock.calls.filter(([sql]) => /INSERT INTO incentive_upload_line/.test(sql));
    expect(lineInserts).toHaveLength(1);
    expect(markRowFailed).toHaveBeenCalledTimes(1);
    expect(markRowFailed.mock.calls[0][0]).toBe("r2");
  });

  it("still fails rows with the same validation errors as before (unknown employee, bad amount)", async () => {
    loadStagedRows.mockResolvedValue([
      row("r1", 1, { employee_code: "E999", incentive_code: "PERF", amount: "500", pay_month: "2026-09" }),
      row("r2", 2, { employee_code: "E002", incentive_code: "PERF", amount: "0", pay_month: "2026-09" }),
      row("r3", 3, { employee_code: "E003", incentive_code: "PERF", amount: "600", pay_month: "2026-09" }),
    ]);

    const outcome = await importIncentiveBatch("batch-1", "user-1");

    expect(outcome.staged).toBe(1);
    expect(outcome.failed).toBe(2);
    expect(outcome.errors.some((e) => /not in the employee master/.test(e))).toBe(true);
    expect(outcome.errors.some((e) => /amount must be a number greater than 0/.test(e))).toBe(true);
  });
});
