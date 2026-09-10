import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, getConnection, logSensitiveAction, recordFinanceApprovalEvent, dispatch } = vi.hoisted(() => ({
  execute: vi.fn(),
  getConnection: vi.fn(),
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
  recordFinanceApprovalEvent: vi.fn().mockResolvedValue(undefined),
  dispatch: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent,
  listFinanceApprovalEvents: vi.fn().mockResolvedValue([]),
}));
vi.mock("../vendor-payment-ledger.service.js", () => ({ vendorPaymentLedgerService: { dispatch } }));
vi.mock("../imprest-ledger.service.js", () => ({ imprestLedgerService: { post: vi.fn() } }));
vi.mock("../imprest.service.js", () => ({ imprestService: {} }));

import { paymentVoucherService } from "../payment-voucher.service.js";

function mockConnection() {
  return {
    execute: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
}

const VOUCHER_ROW = {
  id: "pv-1", voucher_number: "PV/HQ/202609/0001", source_type: "vendor_grn",
  bank_account_id: "acct-1", payable_account_id: "pam-1", linked_vendor_payment_id: "vpt-1",
  amount: "5000.00", status: "ceo_approved", raised_by: "fh-1", ceo_approved_by: "ceo-1", released_by: null,
};

beforeEach(() => {
  execute.mockReset(); getConnection.mockReset(); logSensitiveAction.mockClear(); recordFinanceApprovalEvent.mockClear(); dispatch.mockReset();
  // this.get(id) post-commit reads (all methods) go through plain `db.execute` and just need
  // something non-throwing back; the specific voucher shape isn't asserted in these tests.
  execute.mockImplementation(async (sql: string) => {
    if (String(sql).includes("finance_action_audit_log")) return [[]];
    return [[VOUCHER_ROW]];
  });
});

describe("paymentVoucherService.release — vendor_grn branch", () => {
  it("calls vendorPaymentLedgerService.dispatch with the voucher amount and this transaction's connection, not updatePayment", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[VOUCHER_ROW]]) // SELECT voucher FOR UPDATE
      .mockResolvedValueOnce([[{ id: "acct-1", bank_id: "bank-5", branch_id: "b1", opening_balance: 100000, active_status: 1 }]]) // bank account
      .mockResolvedValueOnce([[{ running_balance: 100000 }]]) // last ledger entry
      .mockResolvedValueOnce([{}]) // INSERT bank_account_ledger_entry (cash movement)
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE payment_voucher SET status='released'
      .mockResolvedValueOnce([{}]); // writeVoucherAudit
    dispatch.mockResolvedValueOnce({
      payment: { grn_number: "GRN-1" },
      transactions: [{ tds_amount: 0 }],
    });

    await paymentVoucherService.release("pv-1", "ah-1", "accounts_head", { paymentMode: "NEFT", paymentDate: "2026-09-10", transactionRef: "UTR123" });

    expect(dispatch).toHaveBeenCalledWith(
      "vpt-1",
      expect.objectContaining({ paymentMode: "NEFT", paymentDate: "2026-09-10", paymentAmount: 5000, transactionId: "UTR123" }),
      "ah-1", "accounts_head", conn,
    );
  });

  it("books a TDS memo ledger entry sized to what dispatch() actually withheld for this installment", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[VOUCHER_ROW]])
      .mockResolvedValueOnce([[{ id: "acct-1", bank_id: "bank-5", branch_id: "b1", opening_balance: 100000, active_status: 1 }]])
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      .mockResolvedValueOnce([{}]) // cash movement entry
      .mockResolvedValueOnce([[{ id: "tds-account-id" }]]) // SELECT TDS Payable payable_account_master
      .mockResolvedValueOnce([{}]) // INSERT TDS memo entry
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);
    dispatch.mockResolvedValueOnce({
      payment: { grn_number: "GRN-1" },
      transactions: [{ tds_amount: 250 }],
    });

    await paymentVoucherService.release("pv-1", "ah-1", "accounts_head", { paymentMode: "NEFT", paymentDate: "2026-09-10", transactionRef: "UTR124" });

    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT id FROM payable_account_master WHERE account_name = 'TDS Payable'/),
    );
  });

  it("skips the TDS memo entry when dispatch() withheld nothing this time", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[VOUCHER_ROW]])
      .mockResolvedValueOnce([[{ id: "acct-1", bank_id: "bank-5", branch_id: "b1", opening_balance: 100000, active_status: 1 }]])
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      .mockResolvedValueOnce([{}]) // cash movement entry
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);
    dispatch.mockResolvedValueOnce({
      payment: { grn_number: "GRN-1" },
      transactions: [{ tds_amount: 0 }],
    });

    await paymentVoucherService.release("pv-1", "ah-1", "accounts_head", { paymentMode: "Cash", paymentDate: "2026-09-10" });

    const tdsLookupCalls = conn.execute.mock.calls.filter((c) => String(c[0]).includes("TDS Payable"));
    expect(tdsLookupCalls).toHaveLength(0);
  });
});
