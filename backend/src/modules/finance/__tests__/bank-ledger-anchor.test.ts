import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { query, execute: vi.fn() } }));

let mod: typeof import("../bank-ledger-anchor.js");
beforeAll(async () => { mod = await import("../bank-ledger-anchor.js"); });
beforeEach(() => { query.mockReset(); });

const row = (entry_date: string, credit = 0, debit = 0) => ({ entry_date, credit: credit * 100, debit: debit * 100 });

describe("anchoredChain", () => {
  it("the last entry on/before the as-of date carries the opening balance; later entries build forward", () => {
    const rows = [row("2026-09-01", 1000), row("2026-09-20", 0, 300), row("2026-10-07", 50), row("2026-10-10", 0, 200), row("2026-10-12", 500)];
    const chain = mod.anchoredChain(rows, 1665947_00, "2026-10-07");
    expect(chain[2]).toBe(1665947_00);
    expect(chain[3]).toBe(1665747_00);
    expect(chain[4]).toBe(1666247_00);
    // history walks backwards: before the 2026-10-07 +50 entry the balance was 50 lower
    expect(chain[1]).toBe(1665897_00);
    expect(chain[0]).toBe(1666197_00);
  });
  it("no entry on/before the as-of date: everything builds forward from the opening balance", () => {
    expect(mod.anchoredChain([row("2026-10-08", 10), row("2026-10-09", 0, 4)], 100_00, "2026-10-07")).toEqual([110_00, 106_00]);
  });
  it("all history before the as-of date: the balance is exactly the opening balance", () => {
    const chain = mod.anchoredChain([row("2016-01-01", 0, 999999), row("2026-09-25", 0, 12345.67)], 361944_00, "2026-10-07");
    expect(chain.at(-1)).toBe(361944_00);
  });
  it("no as-of date: forward from the opening balance", () => {
    expect(mod.anchoredChain([row("2026-01-01", 5)], 10_00, null)).toEqual([15_00]);
  });
});

describe("rebaseRunningBalances", () => {
  it("writes only rows whose running balance changes, reports before/after", async () => {
    query
      .mockResolvedValueOnce([[{ opening_balance: "1000.00", as_of: "2026-10-07" }], []])
      .mockResolvedValueOnce([[
        { id: "a", entry_date: "2026-09-01", credit_amount: "0", debit_amount: "500.00", running_balance: "-500.00" },
        { id: "b", entry_date: "2026-10-07", credit_amount: "0", debit_amount: "0", running_balance: "1000.00" },
        { id: "c", entry_date: "2026-10-09", credit_amount: "0", debit_amount: "100.00", running_balance: "-600.00" },
      ], []])
      .mockResolvedValue([{}, []]);
    const r = await mod.rebaseRunningBalances("acct");
    expect(r).toMatchObject({ rows: 3, changed: 2, balanceBefore: -600, balanceAfter: 900, opening: 1000, asOf: "2026-10-07" });
    const upd = query.mock.calls[2];
    expect(String(upd[0])).toMatch(/UPDATE bank_account_ledger_entry SET running_balance = CASE id/);
    expect(upd[1]).toEqual(["a", 1000, "c", 900, "acct", "a", "c"]);
  });
  it("dry run writes nothing", async () => {
    query
      .mockResolvedValueOnce([[{ opening_balance: "10.00", as_of: null }], []])
      .mockResolvedValueOnce([[{ id: "a", entry_date: "2026-01-01", credit_amount: "5", debit_amount: "0", running_balance: "0" }], []]);
    const r = await mod.rebaseRunningBalances("acct", undefined, { dryRun: true });
    expect(r.changed).toBe(1);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
