import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, getConnection, logSensitiveAction, recordFinanceApprovalEvent } = vi.hoisted(() => ({
  execute: vi.fn(),
  getConnection: vi.fn(),
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
  recordFinanceApprovalEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent,
  listFinanceApprovalEvents: vi.fn().mockResolvedValue([]),
}));
vi.mock("../vendor-payment-ledger.service.js", () => ({ vendorPaymentLedgerService: { dispatch: vi.fn() } }));
vi.mock("../imprest-ledger.service.js", () => ({ imprestLedgerService: { post: vi.fn() } }));
vi.mock("../imprest.service.js", () => ({ imprestService: {} }));
vi.mock("../../inbox/inbox.service.js", () => ({
  inboxService: { createItem: vi.fn().mockResolvedValue(undefined), resolveItems: vi.fn().mockResolvedValue(0) },
}));
vi.mock("../../../shared/recipient-resolver.js", () => ({
  resolveRoleHolderUserIds: vi.fn().mockResolvedValue(["ceo-1"]),
}));
vi.mock("../grn-journal-posting.service.js", () => ({ journalService: { post: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../vendor-expense-mapping.service.js", () => ({
  vendorExpenseMappingService: { activeOptionsForVendor: vi.fn().mockResolvedValue([]) },
}));

import { paymentVoucherService } from "../payment-voucher.service.js";

function mockConn() {
  return {
    execute: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
}

describe("receipt voucher — raise()", () => {
  beforeEach(() => {
    execute.mockReset();
    getConnection.mockReset();
  });

  it("raises a sales_receipt voucher without throwing", async () => {
    const conn = mockConn();
    getConnection.mockResolvedValueOnce(conn);
    // bank account check
    conn.execute.mockResolvedValueOnce([[{ id: "acct-1", active_status: 1 }]]);
    // payable account check
    conn.execute.mockResolvedValueOnce([[{ id: "pam-r1", active_status: 1 }]]);
    // nextVoucherNumber: branch lookup
    conn.execute.mockResolvedValueOnce([[{ branch_code: "HQ" }]]);
    // nextVoucherNumber: count
    conn.execute.mockResolvedValueOnce([[{ n: 0 }]]);
    // INSERT payment_voucher
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    // INSERT finance_action_audit_log
    conn.execute.mockResolvedValueOnce([{}]);
    // post-commit get()
    execute.mockResolvedValueOnce([[{ id: "pv-r1", voucher_number: "RV/HQ/202609/0001", source_type: "sales_receipt", voucher_type: "receipt", status: "raised" }]]);
    execute.mockResolvedValueOnce([[]]); // grn_allocations
    execute.mockResolvedValueOnce([[]]); // approval events
    execute.mockResolvedValueOnce([[]]); // imprest

    const result = await paymentVoucherService.raise(
      { sourceType: "sales_receipt", bankAccountId: "acct-1", payableAccountId: "pam-r1", clientName: "Vodafone India", amount: 50000 },
      "fh-user-1",
    );
    expect(result).toBeDefined();
    const insertCall = conn.execute.mock.calls.find((c: any[]) => String(c[0]).includes("INSERT INTO payment_voucher"));
    expect(insertCall).toBeDefined();
    // voucher_number starts with RV/
    const insertArgs: any[] = insertCall![1] as any[];
    expect(String(insertArgs[1])).toMatch(/^RV\//);
    // voucher_type is 'receipt'
    expect(insertArgs[2]).toBe("receipt");
    // source_type is 'sales_receipt'
    expect(insertArgs[3]).toBe("sales_receipt");
  });

  it("blocks raise() with the old error for non-receipt source types it never knew", async () => {
    await expect(
      paymentVoucherService.raise({ sourceType: "unknown_type" as any, bankAccountId: "x", payableAccountId: "y", amount: 100 }, "u"),
    ).rejects.toThrow("Invalid source type");
  });
});

describe("receipt voucher — release()", () => {
  const RECEIPT_VOUCHER_ROW = {
    id: "pv-r1", voucher_number: "RV/HQ/202609/0001", source_type: "sales_receipt",
    voucher_type: "receipt", bank_account_id: "acct-1", payable_account_id: "pam-r1",
    linked_vendor_payment_id: null, amount: "50000.00", status: "ceo_approved",
    raised_by: "fh-1", ceo_approved_by: "ceo-1", released_by: null,
    particulars: "Vodafone India",
  };

  it("posts credit_amount to bank_account_ledger_entry and increases running balance", async () => {
    const conn = mockConn();
    getConnection.mockResolvedValueOnce(conn);
    // FOR UPDATE voucher lock
    conn.execute.mockResolvedValueOnce([[RECEIPT_VOUCHER_ROW]]);
    // bank account FOR UPDATE
    conn.execute.mockResolvedValueOnce([[{ id: "acct-1", bank_id: "b1", branch_id: "br1", opening_balance: "0.00", active_status: 1 }]]);
    // assertNotInClosedPeriod query — empty = no closed period found
    conn.execute.mockResolvedValueOnce([[]]);
    // last bank_account_ledger_entry (prior balance = 100000)
    conn.execute.mockResolvedValueOnce([[{ running_balance: "100000.00" }]]);
    // INSERT bank_account_ledger_entry
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    // UPDATE payment_voucher status
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    // recordFinanceApprovalEvent INSERT
    conn.execute.mockResolvedValueOnce([{}]);
    // writeVoucherAudit INSERT
    conn.execute.mockResolvedValueOnce([{}]);
    // post-commit get(): main voucher, audit log, GRN allocs, last ledger entry, bank opening balance, resolveActorNames
    execute.mockResolvedValueOnce([[{ ...RECEIPT_VOUCHER_ROW, status: "released" }]]);
    execute.mockResolvedValueOnce([[]]); // audit log
    execute.mockResolvedValueOnce([[]]); // GRN allocations
    execute.mockResolvedValueOnce([[]]); // last ledger entry (bank_account_id = "acct-1")
    execute.mockResolvedValueOnce([[]]); // bank opening balance
    execute.mockResolvedValueOnce([[]]); // resolveActorNames

    await paymentVoucherService.release("pv-r1", "fh-1", "finance_head", { paymentMode: "RTGS", paymentDate: "2026-09-20", transactionRef: "UTR1234" });

    const insertCall = conn.execute.mock.calls.find((c: any[]) =>
      String(c[0]).includes("INSERT INTO bank_account_ledger_entry"),
    );
    expect(insertCall).toBeDefined();
    const args: any[] = insertCall![1] as any[];
    // credit_amount = 50000, debit_amount = 0
    expect(args[4]).toBe(0);       // debit_amount position
    expect(args[5]).toBe(50000);   // credit_amount position
    // running_balance = 100000 + 50000 = 150000
    expect(args[9]).toBe(150000);
  });
});
