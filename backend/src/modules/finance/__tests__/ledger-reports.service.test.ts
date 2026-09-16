import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { ledgerReportsService } from "../ledger-reports.service.js";

beforeEach(() => { execute.mockReset(); });

describe("ledgerReportsService.trialBalance", () => {
  it("reports balanced=true and matching totals when debits equal credits across all accounts", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/GROUP BY jel.account_type/.test(sql)) {
        return [[
          { account_type: "expense_sub_head", account_id: "sh-1", total_debit: "10000.00", total_credit: "0.00" },
          { account_type: "vendor", account_id: "v-1", total_debit: "0.00", total_credit: "9500.00" },
          { account_type: "payable_account", account_id: "pam-tds", total_debit: "0.00", total_credit: "500.00" },
        ]];
      }
      if (/finance_expense_sub_head_master/.test(sql)) return [[{ id: "sh-1", head_name: "Repairs", sub_head_name: "AC Servicing" }]];
      if (/vendor_master/.test(sql)) return [[{ id: "v-1", vendor_name: "Acme Traders" }]];
      if (/payable_account_master/.test(sql)) return [[{ id: "pam-tds", account_name: "TDS Payable" }]];
      return [[]];
    });

    const result = await ledgerReportsService.trialBalance();
    expect(result.balanced).toBe(true);
    expect(result.totalDebit).toBe(10000);
    expect(result.totalCredit).toBe(10000);
    expect(result.rows).toHaveLength(3);
    const vendorRow = result.rows.find((r) => r.accountType === "vendor")!;
    expect(vendorRow.accountName).toBe("Acme Traders (Sundry Creditor)");
    expect(vendorRow.netBalance).toBe(-9500);
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
    await ledgerReportsService.trialBalance();
    expect(execute.mock.calls[0][0]).toMatch(/je\.reversed_by_entry_id IS NULL/);
  });
});

describe("ledgerReportsService.vendorLedger", () => {
  it("computes a running balance in chronological order — positive means the vendor is owed money", async () => {
    execute.mockResolvedValueOnce([[
      { entry_date: "2026-09-01", narration: "GRN #1", source_type: "grn", source_id: "grn-1", debit_amount: "0.00", credit_amount: "5000.00", line_narration: null },
      { entry_date: "2026-09-10", narration: "PV released", source_type: "payment_voucher", source_id: "pv-1", debit_amount: "5000.00", credit_amount: "0.00", line_narration: null },
    ]]);

    const result = await ledgerReportsService.vendorLedger("vendor-acme");
    expect(result.entries[0].runningBalance).toBe(-5000); // owed to vendor
    expect(result.entries[1].runningBalance).toBe(0); // paid in full
    expect(result.closingBalance).toBe(0);
  });

  it("scopes the query to the requested vendor and only 'vendor' account_type lines", async () => {
    execute.mockResolvedValue([[]]);
    await ledgerReportsService.vendorLedger("vendor-acme", "2026-09-01", "2026-09-30");
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/jel\.account_type = 'vendor'/);
    expect(params).toEqual(["vendor-acme", "2026-09-01", "2026-09-30"]);
  });
});

describe("ledgerReportsService.headSubHeadLedger", () => {
  it("sums spend per head/subhead and resolves display names", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/GROUP BY jel.account_id/.test(sql)) {
        return [[{ account_id: "sh-1", total_spent: "12345.67", grn_count: "3" }]];
      }
      if (/finance_expense_sub_head_master/.test(sql)) {
        return [[{ id: "sh-1", head_name: "Repairs & Maintenance", sub_head_name: "AC Servicing" }]];
      }
      return [[]];
    });

    const result = await ledgerReportsService.headSubHeadLedger();
    expect(result).toEqual([
      { accountId: "sh-1", headSubHead: "Repairs & Maintenance / AC Servicing", totalSpent: 12345.67, grnCount: 3 },
    ]);
  });
});
