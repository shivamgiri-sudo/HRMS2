import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mas/{branch_seq}/{yy}/{n} — the legacy GRN number.
 *
 * A separate, ongoing db_bill -> grn_request sync process inserts rows in this exact shape
 * using db_bill's own, much-further-ahead counter, entirely bypassing finance_grn_sequence.
 * Confirmed live: one branch+year sat at finance_grn_sequence.next_sequence=30 while 341
 * db_bill-synced grn_request rows for the same branch+year already occupied sequence up to 334.
 * allocateGrnNumber must self-heal against that on every allocation (the sync keeps advancing,
 * so a one-time reseed does not hold), taking the greater of the stored counter and the actual
 * max sequence found in grn_request.
 */

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

let svc: typeof import("../grn-number.service.js");
beforeAll(async () => {
  svc = await import("../grn-number.service.js");
}, 120_000);

/**
 * A stub PoolConnection that records every statement in order and returns canned rows keyed by
 * regex on the SQL text, mirroring grn-number-monthly.test.ts's convention.
 */
function makeConnection(opts: { branchSeq?: number | null; storedNextSequence?: number; maxSeq?: number | null } = {}) {
  const { branchSeq = 7, storedNextSequence = 1, maxSeq = null } = opts;
  const statements: string[] = [];
  const conn = {
    statements,
    execute: vi.fn(async (sql: string) => {
      statements.push(String(sql).replace(/\s+/g, " ").trim());
      if (/FROM branch_master/.test(sql)) {
        return branchSeq === null ? [[], []] : [[{ branch_seq: branchSeq }], []];
      }
      if (/SELECT next_sequence/.test(sql)) return [[{ next_sequence: storedNextSequence }], []];
      if (/MAX\(CAST\(SUBSTRING_INDEX/.test(sql)) return [[{ max_seq: maxSeq }], []];
      return [[], []];
    }),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
  };
  return conn;
}

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
});

describe("allocateGrnNumber — normal case", () => {
  it("uses the stored next_sequence when it is already ahead of any grn_request max", async () => {
    const conn = makeConnection({ branchSeq: 7, storedNextSequence: 30, maxSeq: 9 });
    getConnection.mockResolvedValue(conn);

    const result = await svc.allocateGrnNumber("branch-1", "2026-27");

    expect(result).toBe("Mas/7/26/30");
    const updateStmt = conn.statements.find((s) => /UPDATE finance_grn_sequence/.test(s));
    expect(updateStmt).toBeDefined();
    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE finance_grn_sequence"),
      [31, "branch-1", "2026-27"],
    );
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe("allocateGrnNumber — self-heal (the bug this fixes)", () => {
  it("uses the actual grn_request max + 1 when the stored counter has fallen behind db_bill's sync", async () => {
    // Confirmed live scenario: branch febd8777-6583-11f1-adb1-00155d0ab410, FY 2026-27 —
    // stored next_sequence=30, but db_bill-synced grn_request rows already reach 334.
    const conn = makeConnection({ branchSeq: 3, storedNextSequence: 30, maxSeq: 334 });
    getConnection.mockResolvedValue(conn);

    const result = await svc.allocateGrnNumber("febd8777-6583-11f1-adb1-00155d0ab410", "2026-27");

    expect(result).toBe("Mas/3/26/335");
    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE finance_grn_sequence"),
      [336, "febd8777-6583-11f1-adb1-00155d0ab410", "2026-27"],
    );
    expect(conn.commit).toHaveBeenCalled();
  });

  it("still queries grn_request after taking the FOR UPDATE lock, on the same connection", async () => {
    const conn = makeConnection({ branchSeq: 3, storedNextSequence: 30, maxSeq: 334 });
    getConnection.mockResolvedValue(conn);
    await svc.allocateGrnNumber("branch-1", "2026-27");

    const lockAt = conn.statements.findIndex((s) => /SELECT next_sequence.*FOR UPDATE/.test(s));
    const maxAt = conn.statements.findIndex((s) => /MAX\(CAST\(SUBSTRING_INDEX/.test(s));
    const updateAt = conn.statements.findIndex((s) => /UPDATE finance_grn_sequence/.test(s));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(maxAt).toBeGreaterThan(lockAt);
    expect(updateAt).toBeGreaterThan(maxAt);
    expect(getConnection).toHaveBeenCalledTimes(1);
  });
});

describe("allocateGrnNumber — fresh branch/year", () => {
  it("behaves exactly as today when there are no existing grn_request rows at all", async () => {
    const conn = makeConnection({ branchSeq: 5, storedNextSequence: 1, maxSeq: null });
    getConnection.mockResolvedValue(conn);

    const result = await svc.allocateGrnNumber("branch-2", "2026-27");

    expect(result).toBe("Mas/5/26/1");
    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE finance_grn_sequence"),
      [2, "branch-2", "2026-27"],
    );
  });
});

describe("allocateGrnNumber — branch not found", () => {
  it("throws the existing error message unchanged", async () => {
    const conn = makeConnection({ branchSeq: null });
    getConnection.mockResolvedValue(conn);

    await expect(svc.allocateGrnNumber("missing-branch", "2026-27")).rejects.toThrow(
      "Selected branch was not found",
    );
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});

describe("source contract", () => {
  it("keeps the self-heal query and the literal-bound UPDATE that makes it stick", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../grn-number.service.ts", import.meta.url), "utf8");
    expect(src).toContain("ON DUPLICATE KEY UPDATE next_sequence = next_sequence");
    expect(src).toContain("FOR UPDATE");
    expect(src).toContain("MAX(CAST(SUBSTRING_INDEX(grn_number, '/', -1) AS UNSIGNED))");
    expect(src, "next_sequence + 1 would drift back downward against the healed value").not.toMatch(
      /SET next_sequence = next_sequence \+ 1/,
    );
  });
});
