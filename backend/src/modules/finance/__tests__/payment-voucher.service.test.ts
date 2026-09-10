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
vi.mock("../../inbox/inbox.service.js", () => ({
  inboxService: { createItem: vi.fn().mockResolvedValue(undefined), resolveItems: vi.fn().mockResolvedValue(0) },
}));
vi.mock("../../../shared/recipient-resolver.js", () => ({
  resolveRoleHolderUserIds: vi.fn().mockResolvedValue(["accounts-head-1"]),
}));

import { paymentVoucherService } from "../payment-voucher.service.js";
import { inboxService } from "../../inbox/inbox.service.js";

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
      .mockResolvedValueOnce([[]]) // SELECT payment_voucher_grn_allocation — none, falls back to linked_vendor_payment_id
      .mockResolvedValueOnce([{}]) // INSERT bank_account_ledger_entry (cash movement)
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE payment_voucher SET status='released'
      .mockResolvedValueOnce([{}]); // writeVoucherAudit
    dispatch.mockResolvedValueOnce({
      payment: { grn_number: "GRN-1" },
      transactions: [{ tds_amount: 0 }],
    });

    await paymentVoucherService.release("pv-1", "fh-1", "finance_head", { paymentMode: "NEFT", paymentDate: "2026-09-10", transactionRef: "UTR123" });

    expect(dispatch).toHaveBeenCalledWith(
      "vpt-1",
      expect.objectContaining({ paymentMode: "NEFT", paymentDate: "2026-09-10", paymentAmount: 5000, transactionId: "UTR123" }),
      "fh-1", "finance_head", conn,
      // 6th arg: this voucher's own id, so dispatch()'s active-voucher guard skips the voucher
      // currently being released (still 'ceo_approved' at this point) instead of blocking it.
      "pv-1",
    );
  });

  it("books a TDS memo ledger entry sized to what dispatch() actually withheld for this installment", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[VOUCHER_ROW]])
      .mockResolvedValueOnce([[{ id: "acct-1", bank_id: "bank-5", branch_id: "b1", opening_balance: 100000, active_status: 1 }]])
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      .mockResolvedValueOnce([[]]) // SELECT payment_voucher_grn_allocation — none
      .mockResolvedValueOnce([{}]) // cash movement entry
      .mockResolvedValueOnce([[{ id: "tds-account-id" }]]) // SELECT TDS Payable payable_account_master
      .mockResolvedValueOnce([{}]) // INSERT TDS memo entry
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);
    dispatch.mockResolvedValueOnce({
      payment: { grn_number: "GRN-1" },
      transactions: [{ tds_amount: 250 }],
    });

    await paymentVoucherService.release("pv-1", "fh-1", "finance_head", { paymentMode: "NEFT", paymentDate: "2026-09-10", transactionRef: "UTR124" });

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
      .mockResolvedValueOnce([[]]) // SELECT payment_voucher_grn_allocation — none
      .mockResolvedValueOnce([{}]) // cash movement entry
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);
    dispatch.mockResolvedValueOnce({
      payment: { grn_number: "GRN-1" },
      transactions: [{ tds_amount: 0 }],
    });

    await paymentVoucherService.release("pv-1", "fh-1", "finance_head", { paymentMode: "Cash", paymentDate: "2026-09-10" });

    const tdsLookupCalls = conn.execute.mock.calls.filter((c) => String(c[0]).includes("TDS Payable"));
    expect(tdsLookupCalls).toHaveLength(0);
  });

  it("loops dispatch() once per allocated GRN when a voucher covers multiple GRNs of the same vendor", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[VOUCHER_ROW]])
      .mockResolvedValueOnce([[{ id: "acct-1", bank_id: "bank-5", branch_id: "b1", opening_balance: 100000, active_status: 1 }]])
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      .mockResolvedValueOnce([[ // two allocations for this voucher
        { vendor_payment_tracking_id: "vpt-1", allocated_amount: "3000.00" },
        { vendor_payment_tracking_id: "vpt-2", allocated_amount: "2000.00" },
      ]])
      .mockResolvedValueOnce([{}]) // ledger entry for allocation 1
      .mockResolvedValueOnce([{}]) // ledger entry for allocation 2
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);
    dispatch
      .mockResolvedValueOnce({ payment: { grn_number: "GRN-1" }, transactions: [{ tds_amount: 0 }] })
      .mockResolvedValueOnce({ payment: { grn_number: "GRN-2" }, transactions: [{ tds_amount: 0 }] });

    await paymentVoucherService.release("pv-1", "fh-1", "finance_head", { paymentMode: "NEFT", paymentDate: "2026-09-10", transactionRef: "UTR125" });

    expect(dispatch).toHaveBeenNthCalledWith(1, "vpt-1", expect.objectContaining({ paymentAmount: 3000, allowSharedReference: true }), "fh-1", "finance_head", conn, "pv-1");
    expect(dispatch).toHaveBeenNthCalledWith(2, "vpt-2", expect.objectContaining({ paymentAmount: 2000, allowSharedReference: true }), "fh-1", "finance_head", conn, "pv-1");
  });

  it("does not set allowSharedReference for a single-GRN release", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[VOUCHER_ROW]])
      .mockResolvedValueOnce([[{ id: "acct-1", bank_id: "bank-5", branch_id: "b1", opening_balance: 100000, active_status: 1 }]])
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      .mockResolvedValueOnce([[]]) // no allocation rows -> single fallback
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);
    dispatch.mockResolvedValueOnce({ payment: { grn_number: "GRN-1" }, transactions: [{ tds_amount: 0 }] });

    await paymentVoucherService.release("pv-1", "fh-1", "finance_head", { paymentMode: "NEFT", paymentDate: "2026-09-10", transactionRef: "UTR128" });

    expect(dispatch).toHaveBeenCalledWith("vpt-1", expect.objectContaining({ allowSharedReference: false }), "fh-1", "finance_head", conn, "pv-1");
  });
});

describe("paymentVoucherService.ceoApprove — request_changes", () => {
  it("requires a note", async () => {
    await expect(
      paymentVoucherService.ceoApprove("pv-1", "ceo-1", "ceo", "request_changes", ""),
    ).rejects.toThrow(/note/i);
  });

  it("sets status='changes_requested' and records who/when/why", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "raised", ceo_approved_by: null }]]) // SELECT FOR UPDATE
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
      .mockResolvedValueOnce([{}]); // writeVoucherAudit

    await paymentVoucherService.ceoApprove("pv-1", "ceo-1", "ceo", "request_changes", "Please use the HDFC account instead");

    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringMatching(/SET status = \?, changes_requested_by = \?, changes_requested_at = NOW\(\), changes_requested_note = \?/),
      expect.arrayContaining(["changes_requested", "ceo-1", "Please use the HDFC account instead", "pv-1"]),
    );
  });

  it("notifies the person who raised the voucher", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "raised", ceo_approved_by: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    await paymentVoucherService.ceoApprove("pv-1", "ceo-1", "ceo", "request_changes", "Use a different account");

    expect(inboxService.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "fh-1", type: "payment_voucher_changes_requested", entity_type: "payment_voucher", entity_id: "pv-1" }),
    );
  });
});

describe("paymentVoucherService.ceoApprove — approve, notifies the Finance Head who raised it", () => {
  it("creates a payment_voucher_ready_for_release inbox item for raised_by, not a role-wide broadcast", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "raised" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    await paymentVoucherService.ceoApprove("pv-1", "ceo-1", "ceo", "approve");

    // VOUCHER_ROW.raised_by === "fh-1"; execute.mockImplementation's catch-all resolves
    // this.get(id)'s post-commit re-read to VOUCHER_ROW.
    expect(inboxService.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "fh-1", type: "payment_voucher_ready_for_release", entity_type: "payment_voucher", entity_id: "pv-1" }),
    );
  });
});

describe("paymentVoucherService.release — Finance Head releases their own raised voucher", () => {
  it("no longer rejects release when released_by === raised_by", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[VOUCHER_ROW]]) // raised_by: "fh-1"
      .mockResolvedValueOnce([[{ id: "acct-1", bank_id: "bank-5", branch_id: "b1", opening_balance: 100000, active_status: 1 }]])
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);
    dispatch.mockResolvedValueOnce({ payment: { grn_number: "GRN-1" }, transactions: [{ tds_amount: 0 }] });

    // actorUserId "fh-1" matches VOUCHER_ROW.raised_by — must succeed, not throw.
    await expect(
      paymentVoucherService.release("pv-1", "fh-1", "finance_head", { paymentMode: "NEFT", paymentDate: "2026-09-10", transactionRef: "UTR126" }),
    ).resolves.toBeDefined();
  });

  it("still rejects release by the CEO who approved it", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute.mockResolvedValueOnce([[VOUCHER_ROW]]); // ceo_approved_by: "ceo-1"

    await expect(
      paymentVoucherService.release("pv-1", "ceo-1", "ceo", { paymentMode: "NEFT", paymentDate: "2026-09-10", transactionRef: "UTR127" }),
    ).rejects.toThrow(/other than the CEO/i);
  });
});

describe("paymentVoucherService.reviewRelease", () => {
  it("records the Accounts Head review without changing status", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "released" }]]) // SELECT status FOR UPDATE
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE accounts_reviewed_*
      .mockResolvedValueOnce([{}]); // writeVoucherAudit

    await paymentVoucherService.reviewRelease("pv-1", "ah-1", "accounts_head", "Checked against the bank statement");

    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringMatching(/SET accounts_reviewed_by = \?, accounts_reviewed_at = NOW\(\), review_note = \?/),
      expect.arrayContaining(["ah-1", "Checked against the bank statement", "pv-1"]),
    );
  });

  it("refuses to review a voucher that has not been released yet", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute.mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "ceo_approved" }]]);

    await expect(
      paymentVoucherService.reviewRelease("pv-1", "ah-1", "accounts_head", null),
    ).rejects.toThrow(/only a released voucher/i);
  });
});

describe("paymentVoucherService.resubmit", () => {
  it("only the original raiser may resubmit", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute.mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "changes_requested", raised_by: "fh-1" }]]);

    await expect(
      paymentVoucherService.resubmit("pv-1", "someone-else", "finance_head", {}),
    ).rejects.toThrow(/may resubmit/i);
  });

  it("moves the voucher back to 'raised' and clears the CEO decision fields", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "changes_requested", raised_by: "fh-1", bank_account_id: "acct-1" }]])
      .mockResolvedValueOnce([[{ id: "acct-2", active_status: 1 }]]) // new bank account check
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
      .mockResolvedValueOnce([{}]); // writeVoucherAudit

    await paymentVoucherService.resubmit("pv-1", "fh-1", "finance_head", { bankAccountId: "acct-2" });

    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringMatching(/SET status = 'raised'.*ceo_approved_by = NULL.*changes_requested_by = NULL/s),
      expect.anything(),
    );
  });
});
