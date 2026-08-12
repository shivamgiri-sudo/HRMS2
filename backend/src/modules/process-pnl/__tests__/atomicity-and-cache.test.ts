import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

/**
 * Three robustness defects, none of which produce a wrong answer — they produce a wrong SYSTEM
 * STATE that a later, correct operation then reads.
 */

const pnlDir = path.resolve(__dirname, "..");
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf8");

describe("saveReading is atomic", () => {
  it("rolls the reconciliation back when the status update fails", async () => {
    vi.resetModules();
    const rollback = vi.fn(async () => {});
    const commit = vi.fn(async () => {});
    let seenReconciliationInsert = false;

    const connection = {
      execute: vi.fn(async (sql: string) => {
        const flat = String(sql).replace(/\s+/g, " ");
        if (/FROM finance_meter_master/i.test(flat)) return [[{ id: "m1", fixed_rate: 8 }], []];
        if (/FROM finance_meter_reading/i.test(flat)) {
          // The saved actual, then the pending estimate it must reconcile against.
          return [[{
            id: "r1", meter_id: "m1", period_code: "2026-08", opening_reading: 0,
            closing_reading: 100, rate: 8, amount: 800, consumption: 100,
            reading_type: "actual", reconciliation_status: "pending", entered_at: null,
          }], []];
        }
        if (/INSERT INTO finance_meter_reconciliation/i.test(flat)) {
          seenReconciliationInsert = true;
          return [{ affectedRows: 1 }, []];
        }
        // The write that used to fail on its own, leaving the estimate pending forever.
        if (/UPDATE finance_meter_reading SET reconciliation_status/i.test(flat)) {
          throw Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK" });
        }
        return [{ affectedRows: 1 }, []];
      }),
      beginTransaction: vi.fn(async () => {}),
      commit,
      rollback,
      release: vi.fn(() => {}),
    };
    vi.doMock("../../../db/mysql.js", () => ({
      db: { execute: vi.fn(), query: vi.fn(), getConnection: vi.fn(async () => connection) },
    }));

    const { saveReading } = await import("../meter.service.js");
    await expect(
      saveReading("m1", "2026-08", {
        openingReading: 0, closingReading: 100, readingType: "actual",
      } as never, "u1")
    ).rejects.toThrow(/Deadlock found/);

    expect(seenReconciliationInsert, "the reconciliation row was written before the failure").toBe(true);
    expect(rollback, "so it must be rolled back, or the next actual reading reconciles twice")
      .toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    vi.doUnmock("../../../db/mysql.js");
  });

  it("still lets a caller own the transaction by passing an executor", () => {
    const source = read(pnlDir, "meter.service.ts");
    expect(source).toContain("if (executor) return saveReadingWith(");
  });
});

describe("setBillingCycleStatus is atomic", () => {
  it("writes the status and its history row in one transaction", () => {
    const service = read(path.resolve(pnlDir, "../finance"), "grn.service.ts");
    const fn = service.slice(service.indexOf("async setBillingCycleStatus"));
    const body = fn.slice(0, fn.indexOf("\n  },"));
    // recordFinanceApprovalEvent throws by design, so recording it after the commit returned
    // "Unable to set billing status" while the status had already changed.
    expect(body).toContain("await connection.beginTransaction()");
    expect(body).toContain("connection,\n      );");
    expect(body).toContain("await connection.rollback()");
    expect(body).not.toMatch(/await db\.execute\(\s*`UPDATE grn_request SET billing_cycle_status/);
  });
});

describe("a failed column lookup is not cached forever", () => {
  it("evicts the rejected promise, as the other two copies do", () => {
    for (const file of ["process-lob.service.ts", "bpo-pnl.service.ts", "process-pnl.service.ts"]) {
      const source = read(pnlDir, file);
      // Bounded by the next top-level declaration rather than a character count, so a longer
      // comment inside the function cannot push the assertion out of its own window.
      const start = source.indexOf("async function listColumns");
      const next = source.indexOf("\nasync function ", start + 1);
      const fn = source.slice(start, next > -1 ? next : start + 2000);
      // Matched on the eviction, not on the cache's variable name: the three copies call theirs
      // columnCache and columnListCache, and pinning the name flags a correct implementation.
      expect(fn, `${file} must evict its cache entry on failure`)
        .toMatch(/\.delete\(tableName\);\s*\n\s*throw error;/);
    }
  });
});
