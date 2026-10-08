import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { ledgerReportsService } from "../ledger-reports.service.js";

beforeEach(() => {
  execute.mockReset();
});

describe("ledgerReportsService.trialBalance", () => {
  it("vendors come from bills and payments, and two balancing rows keep the report adding up", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/reversed_by_entry_id IS NOT NULL/.test(sql)) return [[]]; // no reversed entries
      if (/GROUP BY (jel\.)?account_type/.test(sql)) {
        // The journal: GRN of 10,000 -> Dr expense 10,000, Cr vendor 9,500, Cr TDS 500. Its vendor row is ignored.
        return [[
          { account_type: "expense_sub_head", account_id: "sh-1", total_debit: "10000.00", total_credit: "0.00" },
          { account_type: "vendor", account_id: "v-1", total_debit: "0.00", total_credit: "9500.00" },
          { account_type: "payable_account", account_id: "pam-tds", total_debit: "0.00", total_credit: "500.00" },
        ]];
      }
      if (/GROUP BY vpt\.vendor_id/.test(sql)) {
        // bills 10,500 (1,000 of it never posted to a head), 4,000 paid
        return [[{ vendor_id: "v-1", bills: "10500", unposted: "1000", tx_paid: "4000", gap_paid: "0", adj: "0" }]];
      }
      if (/GROUP BY g\.vendor_id/.test(sql)) return [[]];
      if (/finance_expense_sub_head_master/.test(sql)) return [[{ id: "sh-1", head_name: "Repairs", sub_head_name: "AC Servicing" }]];
      if (/vendor_master/.test(sql)) return [[{ id: "v-1", vendor_name: "Acme Traders" }]];
      if (/payable_account_master/.test(sql)) return [[{ id: "pam-tds", account_name: "TDS Payable" }]];
      return [[]];
    });

    const result = await ledgerReportsService.trialBalance();
    const vendorRow = result.rows.find((r) => r.accountType === "vendor")!;
    expect(vendorRow.accountName).toBe("Acme Traders (Sundry Creditor)");
    expect(vendorRow.totalCredit).toBe(10500);
    expect(vendorRow.totalDebit).toBe(4000);
    expect(vendorRow.netBalance).toBe(-6500); // what is still owed, not the whole history
    expect(result.rows.find((r) => r.accountName === "Payments made to vendors (bank / cash)")!.totalCredit).toBe(4000);
    expect(result.rows.find((r) => r.accountName === "Purchases not yet posted to an expense head")!.totalDebit).toBe(1000);
    expect(result.totalDebit).toBe(result.totalCredit);
    expect(result.balanced).toBe(true);
  });

  it("filters to entries on or before asOfDate when supplied", async () => {
    execute.mockResolvedValue([[]]);
    await ledgerReportsService.trialBalance("2026-08-31");
    const call = execute.mock.calls[0];
    expect(call[0]).toMatch(/je\.entry_date <= \?/);
    expect(call[1]).toEqual(["2026-08-31"]);
  });

  it("excludes reversed entries via the WHERE clause", async () => {
    execute.mockResolvedValue([[]]);
    await ledgerReportsService.trialBalance("2026-08-31");
    expect(execute.mock.calls[0][0]).toMatch(/je\.reversed_by_entry_id IS NULL/);
  });
});

describe("ledgerReportsService.vendorLedger", () => {
  it("computes a running balance in chronological order — positive means the vendor is owed money", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM vendor_payment_transaction/.test(sql)) return [[]];
      return [[
        { entry_date: "2026-09-01", narration: "GRN #1", source_type: "grn", source_id: "grn-1", debit_amount: "0.00", credit_amount: "5000.00", line_narration: null },
        { entry_date: "2026-09-10", narration: "PV released", source_type: "payment_voucher", source_id: "pv-1", debit_amount: "5000.00", credit_amount: "0.00", line_narration: null },
      ]];
    });

    const result = await ledgerReportsService.vendorLedger("vendor-acme");
    expect(result.entries[0].runningBalance).toBe(-5000); // owed to vendor
    expect(result.entries[1].runningBalance).toBe(0); // paid in full
    expect(result.closingBalance).toBe(0);
  });

  it("shows payments made through Vendor Payment Dispatch as debits, merged by date", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM vendor_payment_transaction/.test(sql)) {
        return [[{ journal_entry_id: "vpt:t1", entry_date: "2026-09-05", narration: "Payment NEFT ref UTR1", source_type: "vendor_payment", source_id: "t1", debit_amount: "3000.00", credit_amount: 0, line_narration: null }]];
      }
      return [[
        { entry_date: "2026-09-01", narration: "GRN #1", source_type: "grn", source_id: "grn-1", debit_amount: "0.00", credit_amount: "5000.00", line_narration: null },
      ]];
    });
    const result = await ledgerReportsService.vendorLedger("vendor-acme");
    expect(result.entries.map((e) => e.sourceType)).toEqual(["grn", "vendor_payment"]);
    expect(result.entries[1].debitAmount).toBe(3000);
    expect(result.closingBalance).toBe(-2000); // still owed 2,000 after the 3,000 payment
  });

  it("does not look for dispatch payments on non-vendor account ledgers", async () => {
    execute.mockResolvedValue([[]]);
    await ledgerReportsService.accountLedger("payable_account", "pa-1");
    expect(execute.mock.calls.some(([sql]) => /vendor_payment_transaction/.test(sql))).toBe(false);
  });

  it("scopes the query to the requested vendor and only 'vendor' account_type lines", async () => {
    execute.mockResolvedValue([[]]);
    await ledgerReportsService.vendorLedger(
      "vendor-acme",
      "2026-09-01",
      "2026-09-30",
    );
    const [sql, params] = execute.mock.calls[0];
    // vendorLedger() is now a thin wrapper over the generalized accountLedger("vendor", ...) —
    // account_type is parameterized, not a literal, so both report drill-downs share one query.
    expect(sql).toMatch(/jel\.account_type = \?/);
    expect(params).toEqual([
      "vendor",
      "vendor-acme",
      "2026-09-01",
      "2026-09-30",
    ]);
  });
});

describe("ledgerReportsService.headSubHeadLedger", () => {
  it("sums spend per head/subhead and resolves display names", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM grn_request g/.test(sql)) return [[]]; // no unposted purchases
      if (/GROUP BY jel.account_id/.test(sql)) {
        return [
          [{ account_id: "sh-1", total_spent: "12345.67", grn_count: "3" }],
        ];
      }
      if (/finance_expense_sub_head_master/.test(sql)) {
        return [
          [
            {
              id: "sh-1",
              head_name: "Repairs & Maintenance",
              sub_head_name: "AC Servicing",
            },
          ],
        ];
      }
      return [[]];
    });

    const result = await ledgerReportsService.headSubHeadLedger();
    expect(result).toEqual([
      {
        accountId: "sh-1",
        headSubHead: "Repairs & Maintenance / AC Servicing",
        totalSpent: 12345.67,
        grnCount: 3,
      },
    ]);
  });
});

describe("ledgerReportsService.vendorStatement (Tally-style)", () => {
  const mockDb = (bills: any[], tx: any[]) =>
    execute.mockImplementation(async (sql: string) => {
      if (/SELECT id, vendor_code, vendor_name FROM vendor_master/.test(sql)) return [[{ id: "v1", vendor_code: "V1", vendor_name: "Acme" }]];
      if (/SELECT id FROM vendor_master WHERE UPPER/.test(sql)) return [[{ id: "v1" }, { id: "v2" }]]; // same name, two ids
      if (/FROM vendor_payment_tracking vpt LEFT JOIN grn_request/.test(sql)) return [bills];
      if (/FROM vendor_payment_transaction/.test(sql)) return [tx];
      return [[]];
    });

  it("bills are credits, recorded payments are debits, closing = balance still owed", async () => {
    mockDb(
      [{ id: "b1", branch_id: null, due_amount: "5000", paid_amount: "3000", bill_day: "2026-05-01", grn_number: "GRN-1", invoice_number: "INV-1" }],
      [{ vendor_payment_id: "b1", payment_date: "2026-05-10", payment_mode: "NEFT", bank_name: "HDFC", transaction_id: "UTR1", amount: "3000", net_amount: "3000", tds_amount: "0", remarks: null }],
    );
    const st = await ledgerReportsService.vendorStatement("v1", "2026-04-01", "2026-09-30");
    expect(st!.rows.map((r) => [r.vchType, r.vchNo, r.debit, r.credit])).toEqual([["Purchase", "GRN-1", 0, 5000], ["Payment", "UTR1", 3000, 0]]);
    expect(st!.rows[1].particulars).toBe("To HDFC");
    expect(st!.totals).toEqual({ debit: 3000, credit: 5000 });
    expect(st!.closing).toEqual({ amount: 2000, side: "Cr" });
  });

  it("shows paid_amount that has no payment detail as one debit, so the balance matches the bill", async () => {
    mockDb(
      [{ id: "b1", branch_id: null, due_amount: "5000", paid_amount: "5000", payment_date: "2026-06-01", bill_day: "2026-05-01", grn_number: "GRN-2", invoice_number: null }],
      [],
    );
    const st = await ledgerReportsService.vendorStatement("v1");
    expect(st!.rows.map((r) => [r.vchType, r.debit, r.credit])).toEqual([["Purchase", 0, 5000], ["Payment", 5000, 0]]);
    expect(st!.closing).toEqual({ amount: 0, side: "Dr" });
  });

  it("opens with everything dated before `from`", async () => {
    mockDb(
      [{ id: "b1", branch_id: null, due_amount: "1000", paid_amount: "0", bill_day: "2026-03-01", grn_number: "OLD", invoice_number: null },
       { id: "b2", branch_id: null, due_amount: "400", paid_amount: "0", bill_day: "2026-05-01", grn_number: "NEW", invoice_number: null }],
      [],
    );
    const st = await ledgerReportsService.vendorStatement("v1", "2026-04-01", "2026-09-30");
    expect(st!.opening).toEqual({ amount: 1000, side: "Cr" });
    expect(st!.closing).toEqual({ amount: 1400, side: "Cr" });
  });

  it("looks up every vendor id that shares the vendor's name", async () => {
    mockDb([], []);
    await ledgerReportsService.vendorStatement("v1");
    const call = execute.mock.calls.find(([sql]) => /FROM vendor_payment_tracking vpt LEFT JOIN grn_request/.test(sql))!;
    expect(call[1]).toEqual(["v1", "v2"]);
  });

  it("adds vendor GRNs that never reached the journal, and shows an unmatched head as such", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM grn_request g/.test(sql)) {
        return [[
          { id: "g1", grn_number: "G1", head: "Repairs", sub_head: "AC Servicing", sub_head_id: "sh-1", amt: "1000" },
          { id: "g2", grn_number: "G2", head: "Misc", sub_head: "Odd", sub_head_id: null, amt: "500" },
        ]];
      }
      if (/GROUP BY jel.account_id/.test(sql)) return [[{ account_id: "sh-1", total_spent: "12000", grn_count: "3" }]];
      if (/finance_expense_sub_head_master/.test(sql)) return [[{ id: "sh-1", head_name: "Repairs", sub_head_name: "AC Servicing" }]];
      return [[]];
    });
    const result = await ledgerReportsService.headSubHeadLedger();
    expect(result.find((r) => r.accountId === "sh-1")).toMatchObject({ totalSpent: 13000, grnCount: 4 });
    expect(result.find((r) => r.accountId.startsWith("unmapped:"))).toMatchObject({ headSubHead: "(no matching ledger head) Misc / Odd", totalSpent: 500 });
  });
});
