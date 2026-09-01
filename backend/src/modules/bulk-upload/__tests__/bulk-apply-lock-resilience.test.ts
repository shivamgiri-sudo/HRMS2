/**
 * End-to-end behaviour of a bulk apply when the database fights back.
 *
 * `lock-retry.test.ts` pins the retry helper in isolation. This file pins the thing that
 * actually matters to a branch head: that a real apply path — `applyDeductionBatch`, with
 * its own `mapWithConcurrency` and `withBulkLockRetry` wiring, not a stand-in — survives the
 * lock errors the live database was throwing, and that it stops running rows one at a time.
 *
 * The failure being guarded against is not hypothetical. Live `upload_batch_row` rows show
 * `Lock wait timeout exceeded; try restarting transaction` (errno 1205) recorded as
 * permanent row failures, because every retry helper in this module matched only errno 1213.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const BATCH = {
  id: "batch-1",
  upload_batch_no: "BATCH-9",
  upload_type_code: "DEDUCTION_BULK",
  batch_status: "approving",
  approval_status: "pending_branch_head",
  branch_id: "branch-1",
  uploaded_by: "uploader-1",
  total_rows: 6,
  imported_rows: 6,
  valid_rows: 6,
} as never;

const { execute, query } = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query } }));

const { logSensitiveAction } = vi.hoisted(() => ({
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

const { markRowFailed, lockEntity } = vi.hoisted(() => ({
  markRowFailed: vi.fn().mockResolvedValue(undefined),
  lockEntity: vi.fn().mockResolvedValue(undefined),
}));

// Only the two helpers the apply path touches are stubbed; the rest are present because an
// ESM named import fails to link if the mock omits an export the module imports.
vi.mock("../bulk-approval.service.js", () => ({
  markRowFailed,
  lockEntity,
  lockEntities: vi.fn().mockResolvedValue(undefined),
  loadStagedRows: vi.fn(),
  resolveEmployees: vi.fn(),
  resolveSingleBranch: vi.fn(),
  linkRowToEntity: vi.fn(),
  markPendingApproval: vi.fn(),
  normalizeMonth: (v: string) => v,
  BulkUploadError: class extends Error {},
}));

const { applyDeductionBatch } = await import("../deduction-bulk.service.js");
const { BULK_ROW_CONCURRENCY } = await import("../batch-job.js");

function mysqlError(code: string, errno: number) {
  return Object.assign(new Error(code), { code, errno });
}

/** Rows as `linkedRows` would return them. */
function linkedRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `row-${i + 1}`,
    row_no: i + 1,
    created_entity_id: `ded-${i + 1}`,
  }));
}

/**
 * Wire db.execute: the first SELECT returns the linked rows, and every UPDATE is handed to
 * `onUpdate` so a test can decide what that particular row's write does.
 */
function wireDb(rows: ReturnType<typeof linkedRows>, onUpdate: (entityId: string) => Promise<unknown>) {
  execute.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/SELECT[\s\S]*upload_batch_row/i.test(sql)) return [rows, []];
    if (/UPDATE\s+employee_deduction_entries/i.test(sql)) {
      return onUpdate(String(params[0]));
    }
    return [{ affectedRows: 1 }, []];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  markRowFailed.mockResolvedValue(undefined);
  lockEntity.mockResolvedValue(undefined);
});

describe("applyDeductionBatch — resilience to database lock errors", () => {
  it("applies a row whose write first hits a lock wait timeout", async () => {
    // The exact live failure: errno 1205. Before the fix this row was recorded as a
    // permanent failure after blocking for innodb_lock_wait_timeout (60s on live).
    const rows = linkedRows(1);
    let attempts = 0;
    wireDb(rows, async () => {
      attempts++;
      if (attempts === 1) throw mysqlError("ER_LOCK_WAIT_TIMEOUT", 1205);
      return [{ affectedRows: 1 }, []];
    });

    const outcome = await applyDeductionBatch(BATCH, "approver-1", null);

    expect(attempts).toBe(2);
    expect(outcome).toMatchObject({ applied: 1, failed: 0 });
    expect(outcome.errors).toEqual([]);
    // The decisive assertion: the row is NOT written off.
    expect(markRowFailed).not.toHaveBeenCalled();
  });

  it("applies a row whose write first deadlocks", async () => {
    const rows = linkedRows(1);
    let attempts = 0;
    wireDb(rows, async () => {
      attempts++;
      if (attempts <= 2) throw mysqlError("ER_LOCK_DEADLOCK", 1213);
      return [{ affectedRows: 1 }, []];
    });

    const outcome = await applyDeductionBatch(BATCH, "approver-1", null);

    expect(outcome).toMatchObject({ applied: 1, failed: 0 });
    expect(markRowFailed).not.toHaveBeenCalled();
  });

  it("runs rows concurrently, bounded by the pool-derived limit", async () => {
    // Serially, six rows that each take 20ms cost 120ms and nothing overlaps. The point of
    // the bound is that work overlaps without one batch claiming the whole connection pool,
    // so this asserts both halves: more than one in flight, never more than the limit.
    const rows = linkedRows(6);
    let inFlight = 0;
    let maxInFlight = 0;
    wireDb(rows, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return [{ affectedRows: 1 }, []];
    });

    const outcome = await applyDeductionBatch(BATCH, "approver-1", null);

    expect(outcome).toMatchObject({ applied: 6, failed: 0 });
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(BULK_ROW_CONCURRENCY);
  });

  it("still fails a row on a non-lock error, without burning retries on it", async () => {
    // A genuine data problem must surface as itself and immediately — retrying it would
    // only delay the error the uploader has to act on.
    const rows = linkedRows(1);
    let attempts = 0;
    wireDb(rows, async () => {
      attempts++;
      throw new Error("Unknown column 'foo'");
    });

    const outcome = await applyDeductionBatch(BATCH, "approver-1", null);

    expect(attempts).toBe(1);
    expect(outcome).toMatchObject({ applied: 0, failed: 1 });
    expect(outcome.errors[0]).toContain("Unknown column");
    expect(markRowFailed).toHaveBeenCalledWith("row-1", expect.stringContaining("Unknown column"));
  });

  it("does not resurrect a row that is no longer pending approval", async () => {
    // The status guard is the safety property of this path: a replayed approval must not
    // reactivate a deduction some later action deactivated. Parallelising must not weaken it.
    const rows = linkedRows(1);
    wireDb(rows, async () => [{ affectedRows: 0 }, []]);

    const outcome = await applyDeductionBatch(BATCH, "approver-1", null);

    expect(outcome).toMatchObject({ applied: 0, failed: 1 });
    expect(outcome.errors[0]).toContain("no longer pending approval");
    expect(lockEntity).not.toHaveBeenCalled();
  });

  it("reports errors in row order even though rows finish out of order", async () => {
    // Concurrency must not make the error list arrive in completion order — an approver
    // reading "Row 5 … Row 2" cannot match it against the spreadsheet.
    const rows = linkedRows(4);
    wireDb(rows, async (entityId) => {
      // Later rows finish sooner, so completion order is the reverse of row order.
      const n = Number(entityId.split("-")[1]);
      await new Promise((r) => setTimeout(r, (5 - n) * 10));
      throw new Error(`boom-${n}`);
    });

    const outcome = await applyDeductionBatch(BATCH, "approver-1", null);

    expect(outcome).toMatchObject({ applied: 0, failed: 4 });
    expect(outcome.errors.map((e) => e.split(":")[0])).toEqual([
      "Row 1", "Row 2", "Row 3", "Row 4",
    ]);
  });

  it("keeps applying the rest of the batch when one row is unrecoverable", async () => {
    // A partial apply is the designed outcome — the route reports partially_applied and
    // emails the uploader. One bad row must not abandon the other five.
    const rows = linkedRows(6);
    wireDb(rows, async (entityId) => {
      if (entityId === "ded-3") throw new Error("bad row");
      return [{ affectedRows: 1 }, []];
    });

    const outcome = await applyDeductionBatch(BATCH, "approver-1", null);

    expect(outcome).toMatchObject({ applied: 5, failed: 1 });
    expect(lockEntity).toHaveBeenCalledTimes(5);
  });
});
