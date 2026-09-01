import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Imprest Adjustment screen (imprestService.postAdjustment).
 *
 * A manual correcting entry with no bank transfer, no vendor and no GRN behind it — the fix for
 * the audit finding that a float can show negative because a historical db_bill top-up payment
 * was never matched to a manager and silently dropped during migration, while the matching spend
 * WAS migrated and attached to whichever manager holds the branch today. The remediation script
 * for that finding (fix-imprest-rebalance.ts) told Finance to "post correcting credits via the
 * Imprest Adjustment entry in the UI (Finance -> GRN -> Imprest -> Adjust)" — a screen that did
 * not exist. This is that screen's backend.
 *
 * Posts through imprestLedgerService.post() with entryType "adjustment" (the same primitive
 * getPeriodSummary()'s reporting already reserves an "adjustments" bucket for), never through
 * createAllocation() — a real allocation implies a real bank-funded top-up, which this is not.
 */

const { execute, recordFinanceApprovalEvent } = vi.hoisted(() => ({
  execute: vi.fn(),
  recordFinanceApprovalEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent,
}));
vi.mock("../../process-pnl/finance-period-lock.js", () => ({
  isPeriodLocked: vi.fn().mockResolvedValue(false),
}));

/** credits/debits are the scripted starting balance; the fake connection answers every query
 *  imprestService.postAdjustment and imprestLedgerService.post issue against it. */
function makeConnection(opts: { credits: number; debits: number; managerExists?: boolean }) {
  const inserted: Record<string, unknown>[] = [];
  const conn = {
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
    inserted,
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = String(sql).replace(/\s+/g, " ").trim();

      if (/FROM imprest_manager/.test(s)) {
        if (opts.managerExists === false) return [[], []];
        return [[{ id: "mgr-1", branch_id: "branch-1" }], []];
      }
      // My own single-column balance read (postAdjustment's "before" query).
      if (/AS balance\s+FROM imprest_transaction_ledger/.test(s)) {
        return [[{ balance: opts.credits - opts.debits }], []];
      }
      // imprestLedgerService.post()'s own two-column credits/debits read.
      if (/AS credits.*AS debits/.test(s) || (/credits/.test(s) && /debits/.test(s))) {
        return [[{ credits: opts.credits, debits: opts.debits }], []];
      }
      if (/^INSERT INTO imprest_transaction_ledger/.test(s)) {
        inserted.push({ sql: s, params });
        return [{ insertId: 0, affectedRows: 1 }, []];
      }
      // My own "SELECT balance_after WHERE id = ?" read-back, after the insert above.
      if (/SELECT balance_after FROM imprest_transaction_ledger/.test(s)) {
        const last = inserted.at(-1);
        const insertParams = (last?.params ?? []) as unknown[];
        // post()'s INSERT column order: id, imprest_manager_id, branch_id, entry_type, direction,
        // amount, balance_after, ... — balance_after is the 7th bound value (index 6).
        return [[{ balance_after: insertParams[6] }], []];
      }
      throw new Error(`Unhandled SQL in fake connection: ${s.slice(0, 160)}`);
    }),
  };
  return conn;
}

beforeEach(() => {
  execute.mockReset();
  recordFinanceApprovalEvent.mockClear();
});

async function loadService(connection: ReturnType<typeof makeConnection>) {
  vi.resetModules();
  vi.doMock("../../../db/mysql.js", () => ({
    db: { execute, query: execute, getConnection: async () => connection },
  }));
  const { imprestService } = await import("../imprest.service.js");
  return imprestService;
}

describe("postAdjustment", () => {
  it("refuses a non-positive amount", async () => {
    const svc = await loadService(makeConnection({ credits: 1000, debits: 0 }));
    await expect(
      svc.postAdjustment(
        { imprestManagerId: "mgr-1", direction: "credit", amount: 0, transactionDate: "2026-08-05", reason: "Migration gap correction" },
        "u1", "finance_head",
      ),
    ).rejects.toThrow(/greater than zero/);
  });

  it("refuses a reason shorter than 10 characters — the entry has no invoice to fall back on", async () => {
    const svc = await loadService(makeConnection({ credits: 1000, debits: 0 }));
    await expect(
      svc.postAdjustment(
        { imprestManagerId: "mgr-1", direction: "credit", amount: 500, transactionDate: "2026-08-05", reason: "fix" },
        "u1", "finance_head",
      ),
    ).rejects.toThrow(/reason of at least 10 characters/);
  });

  it("refuses when the manager does not exist or is inactive", async () => {
    const svc = await loadService(makeConnection({ credits: 0, debits: 0, managerExists: false }));
    await expect(
      svc.postAdjustment(
        { imprestManagerId: "mgr-x", direction: "credit", amount: 500, transactionDate: "2026-08-05", reason: "Migration gap correction" },
        "u1", "finance_head",
      ),
    ).rejects.toThrow(/not found or inactive/);
  });

  it("posts a credit adjustment — the missing-top-up case — and returns before/after balance", async () => {
    const conn = makeConnection({ credits: 10_000, debits: 3_000 }); // balance 7,000
    const svc = await loadService(conn);
    const result = await svc.postAdjustment(
      {
        imprestManagerId: "mgr-1", direction: "credit", amount: 5_000,
        transactionDate: "2026-08-05",
        reason: "db_bill migration: top-up payment dated 2026-03-12 never matched to a manager",
      },
      "u1", "finance_head",
    );
    expect(result.balanceBefore).toBe(7_000);
    expect(result.balanceAfter).toBe(12_000);

    const insert = conn.inserted.at(-1)!;
    expect(insert.params).toContain("adjustment"); // entry_type
    expect(insert.params).toContain("credit"); // direction
    expect(insert.params).toContain("manual"); // reference_type
    expect(insert.params).toContain(
      "db_bill migration: top-up payment dated 2026-03-12 never matched to a manager",
    ); // narration = the reason

    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it("posts a debit adjustment for an over-credit correction", async () => {
    const conn = makeConnection({ credits: 10_000, debits: 0 }); // balance 10,000
    const svc = await loadService(conn);
    const result = await svc.postAdjustment(
      {
        imprestManagerId: "mgr-1", direction: "debit", amount: 2_000,
        transactionDate: "2026-08-05",
        reason: "Reversing a duplicate migration credit found during reconciliation",
      },
      "u1", "finance_head",
    );
    expect(result.balanceBefore).toBe(10_000);
    expect(result.balanceAfter).toBe(8_000);
    expect(conn.inserted.at(-1)!.params).toContain("debit");
  });

  it("records a workflow-history event with the reason and the direction/amount", async () => {
    const conn = makeConnection({ credits: 10_000, debits: 3_000 });
    const svc = await loadService(conn);
    await svc.postAdjustment(
      { imprestManagerId: "mgr-1", direction: "credit", amount: 5_000, transactionDate: "2026-08-05", reason: "Migration gap correction, verified" },
      "u1", "finance_head",
    );
    expect(recordFinanceApprovalEvent).toHaveBeenCalledTimes(1);
    const [event] = recordFinanceApprovalEvent.mock.calls[0]!;
    expect(event.entityType).toBe("imprest_manager");
    expect(event.entityId).toBe("mgr-1");
    expect(event.action).toBe("adjustment");
    expect(event.remarks).toBe("Migration gap correction, verified");
    expect(event.details).toMatchObject({ direction: "credit", amount: 5_000 });
  });

  it("rolls back and records nothing if the posting fails", async () => {
    const conn = makeConnection({ credits: 1000, debits: 0 });
    conn.execute.mockImplementationOnce(async () => [[{ id: "mgr-1", branch_id: "branch-1" }], []]) // manager lookup ok
    ;
    // Force the "before balance" read to blow up.
    const original = conn.execute;
    let call = 0;
    conn.execute = vi.fn(async (sql: string, params: unknown[] = []) => {
      call++;
      if (call === 2) throw new Error("connection lost");
      return original(sql, params);
    });
    const svc = await loadService(conn);
    await expect(
      svc.postAdjustment(
        { imprestManagerId: "mgr-1", direction: "credit", amount: 500, transactionDate: "2026-08-05", reason: "Migration gap correction" },
        "u1", "finance_head",
      ),
    ).rejects.toThrow(/connection lost/);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(recordFinanceApprovalEvent).not.toHaveBeenCalled();
  });
});
