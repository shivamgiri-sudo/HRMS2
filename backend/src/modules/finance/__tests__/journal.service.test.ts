import { beforeEach, describe, expect, it } from "vitest";
import { journalService } from "../journal.service.js";

/**
 * journal.service.ts is the only writer of journal_entry / journal_entry_line (see its header).
 * These tests are the source-scan-test's counterpart for the half of that rule the source scan
 * can't check: that post() itself never lets an unbalanced set of lines reach the INSERTs.
 */

function mockConnection() {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  return {
    executed,
    execute: async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params });
      if (/SELECT id, entry_date/.test(sql)) {
        return [[{ id: "je-orig", entry_date: "2026-09-16", narration: "GRN #123", source_type: "grn", source_id: "grn-123", reversed_by_entry_id: null }]];
      }
      if (/SELECT account_type/.test(sql)) {
        return [[
          { account_type: "expense_sub_head", account_id: "sh-1", debit_amount: "1000.00", credit_amount: "0.00", narration: null },
          { account_type: "vendor", account_id: "vendor-1", debit_amount: "0.00", credit_amount: "1000.00", narration: null },
        ]];
      }
      return [[]];
    },
  } as any;
}

describe("journalService.post", () => {
  let conn: ReturnType<typeof mockConnection>;
  beforeEach(() => { conn = mockConnection(); });

  it("refuses an entry with fewer than two lines", async () => {
    await expect(
      journalService.post(conn, {
        entryDate: "2026-09-16",
        narration: "bad",
        sourceType: "manual",
        sourceId: "x",
        postedBy: "u1",
        lines: [{ accountType: "bank_account", accountId: "b1", debitAmount: 100 }],
      }),
    ).rejects.toThrow(/at least two lines/);
  });

  it("refuses a line carrying both a debit and a credit", async () => {
    await expect(
      journalService.post(conn, {
        entryDate: "2026-09-16",
        narration: "bad",
        sourceType: "manual",
        sourceId: "x",
        postedBy: "u1",
        lines: [
          { accountType: "bank_account", accountId: "b1", debitAmount: 100, creditAmount: 100 },
          { accountType: "vendor", accountId: "v1", creditAmount: 100 },
        ],
      }),
    ).rejects.toThrow(/both a debit and a credit/);
  });

  it("refuses an entry that does not balance", async () => {
    await expect(
      journalService.post(conn, {
        entryDate: "2026-09-16",
        narration: "GRN #124 — Dr Expense Cr Vendor",
        sourceType: "grn",
        sourceId: "grn-124",
        postedBy: "finance-head-1",
        lines: [
          { accountType: "expense_sub_head", accountId: "sh-1", debitAmount: 1000.0 },
          { accountType: "vendor", accountId: "vendor-1", creditAmount: 999.99 },
        ],
      }),
    ).rejects.toMatchObject({ code: "UNBALANCED_JOURNAL_ENTRY" });

    // The refusal must happen before any INSERT — a rejected entry must leave nothing behind,
    // matching the same all-or-nothing expectation as every other maker-checker refusal in
    // this codebase (payment-voucher.service.ts, grn.service.ts).
    expect(conn.executed.filter((e) => /INSERT INTO journal_entry/.test(e.sql))).toHaveLength(0);
  });

  it("posts a balanced GRN entry — Dr Expense Head:Subhead / Cr Vendor — with matching totals to the paisa", async () => {
    const { journalEntryId } = await journalService.post(conn, {
      entryDate: "2026-09-16",
      narration: "GRN #124 — Office Supplies vendor Acme Traders",
      sourceType: "grn",
      sourceId: "grn-124",
      postedBy: "finance-head-1",
      lines: [
        { accountType: "expense_sub_head", accountId: "sh-office-supplies", debitAmount: 2112.02 },
        { accountType: "vendor", accountId: "vendor-acme", creditAmount: 2112.02 },
      ],
    });

    expect(journalEntryId).toBeTruthy();
    const headerInsert = conn.executed.find((e) => /INSERT INTO journal_entry /.test(e.sql));
    expect(headerInsert?.params).toEqual(
      expect.arrayContaining(["2026-09-16", "GRN #124 — Office Supplies vendor Acme Traders", "grn", "grn-124", "finance-head-1"]),
    );

    const lineInserts = conn.executed.filter((e) => /INSERT INTO journal_entry_line/.test(e.sql));
    expect(lineInserts).toHaveLength(2);
    const debitLine = lineInserts.find((e) => e.params[5] === 2112.02)!;
    const creditLine = lineInserts.find((e) => e.params[6] === 2112.02)!;
    expect(debitLine.params[3]).toBe("expense_sub_head");
    expect(creditLine.params[3]).toBe("vendor");
  });

  it("posts a balanced payment-voucher release entry with a TDS line as a real third leg (not a zero-cash memo row)", async () => {
    await journalService.post(conn, {
      entryDate: "2026-09-16",
      narration: "PV/HQ/202609/0007 released to Acme Traders",
      sourceType: "payment_voucher",
      sourceId: "pv-7",
      postedBy: "accounts-head-1",
      lines: [
        { accountType: "vendor", accountId: "vendor-acme", debitAmount: 10000.0 },
        { accountType: "bank_account", accountId: "bank-hq", creditAmount: 9800.0 },
        { accountType: "payable_account", accountId: "pam-tds-payable", creditAmount: 200.0, narration: "TDS @2% withheld" },
      ],
    });

    const lineInserts = conn.executed.filter((e) => /INSERT INTO journal_entry_line/.test(e.sql));
    expect(lineInserts).toHaveLength(3);
    const totalDebit = lineInserts.reduce((sum, e) => sum + Number(e.params[5]), 0);
    const totalCredit = lineInserts.reduce((sum, e) => sum + Number(e.params[6]), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 2);
  });

  it("rounds to the paisa before comparing, so 0.005 drift does not silently pass", async () => {
    await expect(
      journalService.post(conn, {
        entryDate: "2026-09-16",
        narration: "rounding check",
        sourceType: "manual",
        sourceId: "x",
        postedBy: "u1",
        lines: [
          { accountType: "bank_account", accountId: "b1", debitAmount: 100.004 },
          { accountType: "vendor", accountId: "v1", creditAmount: 99.995 },
        ],
      }),
    ).rejects.toMatchObject({ code: "UNBALANCED_JOURNAL_ENTRY" });
  });
});

describe("journalService.reverse", () => {
  it("posts an equal-and-opposite contra entry and marks the original reversed", async () => {
    const conn = mockConnection();
    const { reversalEntryId } = await journalService.reverse(conn, "je-orig", "finance-head-1", "GRN cancelled after release");

    expect(reversalEntryId).toBeTruthy();
    const update = conn.executed.find((e) => /UPDATE journal_entry SET reversed_by_entry_id/.test(e.sql));
    expect(update?.params).toEqual([reversalEntryId, "je-orig"]);

    const lineInserts = conn.executed.filter((e) => /INSERT INTO journal_entry_line/.test(e.sql));
    expect(lineInserts).toHaveLength(2);
    // Original was Dr expense 1000 / Cr vendor 1000 — reversal must swap sides.
    const swappedToCredit = lineInserts.find((e) => e.params[3] === "expense_sub_head");
    const swappedToDebit = lineInserts.find((e) => e.params[3] === "vendor");
    expect(Number(swappedToCredit!.params[6])).toBe(1000);
    expect(Number(swappedToDebit!.params[5])).toBe(1000);
  });

  it("refuses to reverse an entry that was already reversed", async () => {
    const conn = mockConnection();
    conn.execute = async (sql: string) => {
      if (/SELECT id, entry_date/.test(sql)) {
        return [[{ id: "je-orig", reversed_by_entry_id: "je-already", source_type: "grn", source_id: "grn-1", entry_date: "2026-09-16", narration: "x" }]];
      }
      return [[]];
    };
    await expect(journalService.reverse(conn, "je-orig", "u1", "double reversal attempt")).rejects.toMatchObject({
      code: "JOURNAL_ENTRY_ALREADY_REVERSED",
    });
  });
});
