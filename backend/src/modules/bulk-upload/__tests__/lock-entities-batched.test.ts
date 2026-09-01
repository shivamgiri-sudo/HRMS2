/**
 * `lockEntities` writes the immutability registry for a whole approved batch.
 *
 * It replaced a per-row `lockEntity` INSERT in the incentive apply path, where a 1,000-row
 * batch paid 1,000 sequential round trips for what is one write. Batching is only worth
 * doing if it is exactly equivalent, so these tests pin the parts that could silently
 * diverge: the parameter order across a multi-row VALUES list, the chunk boundary, and the
 * ON DUPLICATE KEY clause that makes a re-approval a no-op.
 *
 * The SQL itself was verified against the live schema on 2026-09-02 — MySQL answered
 * "Statement prepared" for the 8-column multi-row form, and `uq_bule_entity` is a UNIQUE
 * index on (entity_type, entity_id), which is what the ON DUPLICATE KEY clause relies on.
 * Without that index the clause would never fire, because `id` is a fresh UUID every call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, query } = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query } }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: vi.fn(),
  hasScopedAccess: vi.fn(),
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../communication/email.service.js", () => ({ emailService: {} }));

const { lockEntities } = await import("../bulk-approval.service.js");

const COLUMNS = 8;

function entries(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    entityType: "incentive_upload_line",
    entityId: `ent-${i + 1}`,
    batchId: "batch-1",
    batchNo: "BATCH-9",
    employeeId: null,
    lockedBy: "approver-1",
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue([{ affectedRows: 1 }, []]);
});

describe("lockEntities", () => {
  it("writes one statement for many rows instead of one per row", async () => {
    await lockEntities(entries(50));

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO bulk_upload_locked_entity/);
    // 50 tuples in the VALUES list, 8 parameters each.
    expect(sql.match(/\(\?, \?, \?, \?, \?, \?, \?, \?\)/g)).toHaveLength(50);
    expect(params).toHaveLength(50 * COLUMNS);
  });

  it("keeps the ON DUPLICATE KEY no-op that makes re-approval idempotent", async () => {
    // uq_bule_entity (entity_type, entity_id) is UNIQUE on live, so a second approval of
    // the same batch must update nothing rather than fail or re-stamp locked_at.
    await lockEntities(entries(2));

    expect(query.mock.calls[0][0]).toMatch(/ON DUPLICATE KEY UPDATE locked_at = locked_at/);
  });

  it("keeps each row's parameters in column order", async () => {
    // A multi-row VALUES list is where an off-by-one in parameter order hides: every row
    // still inserts, just with fields transposed. Checking the second row catches a bug
    // that a single-row test would not.
    await lockEntities(entries(2));

    const params = query.mock.calls[0][1] as unknown[];
    const second = params.slice(COLUMNS, COLUMNS * 2);
    expect(second[0]).toMatch(/^[0-9a-f-]{36}$/); // generated id
    expect(second.slice(1)).toEqual([
      "incentive_upload_line",
      "ent-2",
      "batch-1",
      "BATCH-9",
      null,
      "approver-1",
      "Created by an approved bulk upload",
    ]);
  });

  it("gives every row its own id rather than reusing one", async () => {
    // id is the PRIMARY key. Reusing a generated UUID across the VALUES list would make
    // the statement collide with itself and lock only the first row of the batch.
    await lockEntities(entries(10));

    const params = query.mock.calls[0][1] as unknown[];
    const ids = Array.from({ length: 10 }, (_, i) => params[i * COLUMNS]);
    expect(new Set(ids).size).toBe(10);
  });

  it("chunks past 500 rows rather than sending one unbounded statement", async () => {
    // Bounded so a very large batch cannot exceed max_allowed_packet or hold one lock long
    // enough to stall other writers.
    await lockEntities(entries(1200));

    expect(query).toHaveBeenCalledTimes(3);
    const sizes = query.mock.calls.map((c) => (c[1] as unknown[]).length / COLUMNS);
    expect(sizes).toEqual([500, 500, 200]);
  });

  it("respects a caller-supplied reason and defaults it otherwise", async () => {
    await lockEntities([{ ...entries(1)[0], reason: "Reinstated after review" }]);

    expect((query.mock.calls[0][1] as unknown[])[COLUMNS - 1]).toBe("Reinstated after review");
  });

  it("touches the database not at all for an empty batch", async () => {
    // A rejected batch locks nothing. Sending `VALUES ` with no tuples would be a syntax
    // error, so the early return is load-bearing, not a micro-optimisation.
    await lockEntities([]);

    expect(query).not.toHaveBeenCalled();
  });
});
