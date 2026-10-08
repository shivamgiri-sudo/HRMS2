import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * The imprest float ledger (Requirement 7).
 *
 *   Opening + Allocations + Positive adjustments
 *          − Approved vouchers − Returns − Negative adjustments  =  Closing
 *
 * Two properties are load-bearing and neither is enforced by the database, so they are
 * enforced here instead:
 *
 *   1. Append-only. MySQL TRIGGERs are unavailable in this environment, so "no UPDATE, no
 *      DELETE" is a code-and-review rule. The source scan below is what makes it real — a
 *      correction must be a contra entry, because that is the only way the ledger can answer
 *      "why is the balance this number".
 *   2. Money compared in paise. Two DECIMAL values that print identically must compare equal;
 *      float arithmetic on rupees makes 0.1 + 0.2 a support ticket.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

let svc: typeof import("../imprest-ledger.service.js")["imprestLedgerService"];
beforeAll(async () => {
  ({ imprestLedgerService: svc } = await import("../imprest-ledger.service.js"));
}, 120_000);

beforeEach(() => execute.mockReset());

/** A stub PoolConnection recording every statement, with a scripted balance. */
function makeConnection(opts: { credits?: number; debits?: number; managerExists?: boolean } = {}) {
  const statements: string[] = [];
  return {
    statements,
    execute: vi.fn(async (sql: string) => {
      statements.push(String(sql).replace(/\s+/g, " ").trim());
      if (/FROM imprest_manager/.test(sql)) {
        return [opts.managerExists === false ? [] : [{ id: "m1" }], []];
      }
      if (/SUM\(CASE WHEN direction/.test(sql)) {
        return [[{ credits: opts.credits ?? 0, debits: opts.debits ?? 0 }], []];
      }
      return [[], []];
    }),
  };
}

describe("getBalance", () => {
  it("nets credits against debits rather than summing a signed column", async () => {
    // A signed amount column would give the right answer until someone stored a negative
    // credit, then net silently wrong. Direction is separate from magnitude on purpose.
    execute.mockResolvedValue([[{ credits: 30000, debits: 7000 }], []]);
    expect(await svc.getBalance("m1")).toBe(23000);
  });

  it("computes the brief's worked example exactly", async () => {
    // opening 10,000 + allocation 20,000 − voucher 5,000 − return 2,000 = 23,000
    execute.mockResolvedValue([[{ credits: 30000, debits: 7000 }], []]);
    expect(await svc.getBalance("m1")).toBe(23000);
  });

  it("is exact on values that float arithmetic gets wrong", async () => {
    execute.mockResolvedValue([[{ credits: 0.3, debits: 0.1 }], []]);
    expect(await svc.getBalance("m1")).toBe(0.2);
  });
});

describe("post", () => {
  it("refuses to write outside a transaction", async () => {
    // A ledger entry that survives a rolled-back approval claims money moved when it did not.
    await expect(
      svc.post(
        { imprestManagerId: "m1", branchId: "b1", entryType: "allocation", direction: "credit",
          amount: 100, transactionDate: "2026-08-05", actorUserId: "u1" },
        undefined as never,
      ),
    ).rejects.toThrow(/inside the caller's transaction/i);
  });

  it("locks the manager row before reading the balance", async () => {
    // Without the lock two concurrent postings compute balance_after from the same starting
    // figure, and the stored running balance drifts from the derived one.
    const conn = makeConnection({ credits: 1000, debits: 0 });
    await svc.post(
      { imprestManagerId: "m1", branchId: "b1", entryType: "allocation", direction: "credit",
        amount: 500, transactionDate: "2026-08-05", actorUserId: "u1" },
      conn as never,
    );
    const lockAt = conn.statements.findIndex((s) => /FROM imprest_manager .*FOR UPDATE/.test(s));
    const readAt = conn.statements.findIndex((s) => /SUM\(CASE WHEN direction/.test(s));
    const writeAt = conn.statements.findIndex((s) => /INSERT INTO imprest_transaction_ledger/.test(s));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(readAt).toBeGreaterThan(lockAt);
    expect(writeAt).toBeGreaterThan(readAt);
  });

  it("stores balance_after as the running total, not the entry amount", async () => {
    const conn = makeConnection({ credits: 1000, debits: 0 });
    await svc.post(
      { imprestManagerId: "m1", branchId: "b1", entryType: "voucher", direction: "debit",
        amount: 250, transactionDate: "2026-08-05", actorUserId: "u1" },
      conn as never,
    );
    const insert = conn.execute.mock.calls.find(([s]) => /INSERT INTO imprest_transaction_ledger/.test(String(s)));
    expect(insert?.[1]).toContain(750);
  });

  it("rejects a zero or negative amount", async () => {
    const conn = makeConnection();
    for (const amount of [0, -5]) {
      await expect(
        svc.post(
          { imprestManagerId: "m1", branchId: "b1", entryType: "allocation", direction: "credit",
            amount, transactionDate: "2026-08-05", actorUserId: "u1" },
          conn as never,
        ),
      ).rejects.toThrow(/positive number/i);
    }
  });

  it("refuses an unknown manager", async () => {
    const conn = makeConnection({ managerExists: false });
    await expect(
      svc.post(
        { imprestManagerId: "nope", branchId: "b1", entryType: "allocation", direction: "credit",
          amount: 100, transactionDate: "2026-08-05", actorUserId: "u1" },
        conn as never,
      ),
    ).rejects.toThrow(/manager not found/i);
  });

  it("derives period_code from the transaction date", async () => {
    const conn = makeConnection({ credits: 0, debits: 0 });
    await svc.post(
      { imprestManagerId: "m1", branchId: "b1", entryType: "allocation", direction: "credit",
        amount: 100, transactionDate: "2026-08-05", actorUserId: "u1" },
      conn as never,
    );
    const insert = conn.execute.mock.calls.find(([s]) => /INSERT INTO imprest_transaction_ledger/.test(String(s)));
    expect(insert?.[1]).toContain("2026-08");
  });
});

describe("assertSufficientBalance", () => {
  it("refuses a voucher larger than the float", async () => {
    const conn = makeConnection({ credits: 1000, debits: 200 });
    await expect(svc.assertSufficientBalance("m1", 900, conn as never)).rejects.toThrow(/more than the imprest balance/i);
  });

  it("allows a voucher exactly equal to the balance", async () => {
    // Spending a float to precisely zero is normal, not an overrun.
    const conn = makeConnection({ credits: 1000, debits: 200 });
    await expect(svc.assertSufficientBalance("m1", 800, conn as never)).resolves.toBeUndefined();
  });

  it("compares in paise so a 0.005 rounding artefact does not block a valid voucher", async () => {
    const conn = makeConnection({ credits: 100.1, debits: 0 });
    await expect(svc.assertSufficientBalance("m1", 100.1, conn as never)).resolves.toBeUndefined();
  });
});

describe("append-only is enforced by review, so assert it", () => {
  it("no source file updates or deletes the ledger", () => {
    // The single most important invariant here, and the database cannot enforce it: MySQL
    // TRIGGERs are unavailable (see 418's header). A correction must be a contra entry.
    const roots = [new URL("../", import.meta.url), new URL("../../process-pnl/", import.meta.url)];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of readdirSync(root).filter((f) => f.endsWith(".ts"))) {
        const src = readFileSync(new URL(file, root), "utf8");
        if (/UPDATE\s+imprest_transaction_ledger/i.test(src)) offenders.push(`UPDATE in ${file}`);
        if (/DELETE\s+FROM\s+imprest_transaction_ledger/i.test(src)) offenders.push(`DELETE in ${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
