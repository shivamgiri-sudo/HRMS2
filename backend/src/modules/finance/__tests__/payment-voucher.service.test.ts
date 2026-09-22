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
      .mockResolvedValueOnce([[]]) // assertNotInClosedPeriod — no closed period covers this date
      .mockResolvedValueOnce([[{ running_balance: 100000 }]]) // last ledger entry
      .mockResolvedValueOnce([[]]) // SELECT payment_voucher_grn_allocation — none, falls back to linked_vendor_payment_id
      .mockResolvedValueOnce([{}]) // INSERT bank_account_ledger_entry (cash movement)
      .mockResolvedValueOnce([[{ vendor_id: "vendor-1" }]]) // Journal Task 3: SELECT vendor_id FROM vendor_payment_tracking
      .mockResolvedValueOnce([{}]) // Journal Task 3: INSERT journal_entry
      .mockResolvedValueOnce([{}]) // Journal Task 3: INSERT journal_entry_line (Dr vendor)
      .mockResolvedValueOnce([{}]) // Journal Task 3: INSERT journal_entry_line (Cr bank)
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
      .mockResolvedValueOnce([[]]) // assertNotInClosedPeriod — no closed period covers this date
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      .mockResolvedValueOnce([[]]) // SELECT payment_voucher_grn_allocation — none
      .mockResolvedValueOnce([{}]) // cash movement entry
      .mockResolvedValueOnce([[{ id: "tds-account-id" }]]) // SELECT TDS Payable payable_account_master
      .mockResolvedValueOnce([{}]) // INSERT TDS memo entry
      .mockResolvedValueOnce([[{ vendor_id: "vendor-1" }]]) // Journal Task 3: SELECT vendor_id FROM vendor_payment_tracking
      .mockResolvedValueOnce([[{ id: "tds-account-id-2" }]]) // Journal Task 3: resolveTdsPayableAccountId() — its own lookup, separate from the memo-row one above
      .mockResolvedValueOnce([{}]) // Journal Task 3: INSERT journal_entry
      .mockResolvedValueOnce([{}]) // Journal Task 3: INSERT journal_entry_line (Dr vendor, net+tds)
      .mockResolvedValueOnce([{}]) // Journal Task 3: INSERT journal_entry_line (Cr bank, net)
      .mockResolvedValueOnce([{}]) // Journal Task 3: INSERT journal_entry_line (Cr TDS Payable)
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
      .mockResolvedValueOnce([[]]) // assertNotInClosedPeriod — no closed period covers this date
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      .mockResolvedValueOnce([[]]) // SELECT payment_voucher_grn_allocation — none
      .mockResolvedValueOnce([{}]) // cash movement entry
      .mockResolvedValueOnce([[{ vendor_id: "vendor-1" }]]) // Journal Task 3: SELECT vendor_id FROM vendor_payment_tracking
      .mockResolvedValueOnce([{}]) // Journal Task 3: INSERT journal_entry
      .mockResolvedValueOnce([{}]) // Journal Task 3: INSERT journal_entry_line (Dr vendor)
      .mockResolvedValueOnce([{}]) // Journal Task 3: INSERT journal_entry_line (Cr bank)
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
      .mockResolvedValueOnce([[]]) // assertNotInClosedPeriod — no closed period covers this date
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      .mockResolvedValueOnce([[ // two allocations for this voucher
        { vendor_payment_tracking_id: "vpt-1", allocated_amount: "3000.00" },
        { vendor_payment_tracking_id: "vpt-2", allocated_amount: "2000.00" },
      ]])
      .mockResolvedValueOnce([{}]) // ledger entry for allocation 1
      .mockResolvedValueOnce([[{ vendor_id: "vendor-1" }]]) // Journal Task 3: vendor_id lookup, allocation 1
      .mockResolvedValueOnce([{}]) // ledger entry for allocation 2
      .mockResolvedValueOnce([[{ vendor_id: "vendor-1" }]]) // Journal Task 3: vendor_id lookup, allocation 2
      .mockResolvedValueOnce([{}]) // Journal Task 3: INSERT journal_entry (one entry for the whole voucher)
      .mockResolvedValueOnce([{}]) // line: alloc1 Dr vendor
      .mockResolvedValueOnce([{}]) // line: alloc1 Cr bank
      .mockResolvedValueOnce([{}]) // line: alloc2 Dr vendor
      .mockResolvedValueOnce([{}]) // line: alloc2 Cr bank
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
      .mockResolvedValueOnce([[]]) // assertNotInClosedPeriod — no closed period covers this date
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      .mockResolvedValueOnce([[]]) // no allocation rows -> single fallback
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([[{ vendor_id: "vendor-1" }]]) // Journal Task 3: vendor_id lookup
      .mockResolvedValueOnce([{}]) // Journal Task 3: INSERT journal_entry
      .mockResolvedValueOnce([{}]) // Journal Task 3: line Dr vendor
      .mockResolvedValueOnce([{}]) // Journal Task 3: line Cr bank
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
      .mockResolvedValueOnce([[]]) // assertNotInClosedPeriod — no closed period covers this date
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([[{ vendor_id: "vendor-1" }]]) // Journal Task 3: vendor_id lookup
      .mockResolvedValueOnce([{}]) // Journal Task 3: INSERT journal_entry
      .mockResolvedValueOnce([{}]) // Journal Task 3: line Dr vendor
      .mockResolvedValueOnce([{}]) // Journal Task 3: line Cr bank
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

/**
 * Vendor advance / on-account payments (Phase 2). Dispatches on SQL text rather than an ordered
 * chain -- these two lanes touch enough distinct queries (company_bank_account,
 * payable_account_master, vendor_payment_tracking, vendor_advance_ledger, vendor_master,
 * payment_voucher_grn_allocation) that an ordered chain would be as fragile as the one that
 * broke when assertNotInClosedPeriod was added earlier -- see that fix's own comment.
 */
function mockAdvanceConnection(opts: {
  advanceBalance?: number;
  vendorPaymentTrackingRows?: Record<string, { vendor_id: string; due_amount: number; tds_deducted_amount?: number; paid_amount?: number }>;
} = {}) {
  const execute = vi.fn(async (sql: string, params?: any[]) => {
    const text = String(sql);
    if (text.includes("branch_code")) {
      return [[{ branch_code: "HQ" }]]; // nextVoucherNumber's own lookup
    }
    if (text.includes("FROM company_bank_account") && text.includes("FOR UPDATE")) {
      return [[{ id: "acct-1", bank_id: "bank-5", branch_id: "b1", opening_balance: 100000, active_status: 1 }]];
    }
    if (text.includes("FROM payable_account_master")) {
      return [[{ id: "pam-1", active_status: 1 }]];
    }
    if (text.includes("FROM vendor_master") && text.includes("FOR UPDATE")) {
      return [[{ id: "vendor-1" }]];
    }
    if (text.includes("FROM vendor_payment_tracking") && text.includes("FOR UPDATE")) {
      const vptId = params?.[0];
      const row = opts.vendorPaymentTrackingRows?.[vptId] ?? { vendor_id: "vendor-1", due_amount: 3000, tds_deducted_amount: 0, paid_amount: 0 };
      return [[row]];
    }
    if (text.includes("FROM vendor_payment_tracking") && text.includes("cost_centre_id")) {
      // Depth-dimension lookup (branch/cost-centre/process) — vendorGrnLines/vendorAdvanceApplicationLines
      // callers narrow across allocations; returning nulls here means every existing test's
      // journalLines assertions stay unaffected (the depth fields aren't part of journalLines).
      return [[{ branch_id: null, cost_centre_id: null, process_id: null }]];
    }
    if (text.includes("FROM vendor_advance_ledger") && text.includes("balance_after")) {
      return [opts.advanceBalance != null ? [{ balance_after: opts.advanceBalance }] : []];
    }
    if (text.includes("FROM bank_reconciliation_period")) {
      return [[]]; // assertNotInClosedPeriod -- no closed period
    }
    if (text.includes("FROM bank_account_ledger_entry") && text.includes("running_balance")) {
      return [[{ running_balance: 100000 }]];
    }
    if (text.includes("COUNT(*) AS n FROM payment_voucher")) {
      return [[{ n: 0 }]];
    }
    if (text.includes("FROM payment_voucher_grn_allocation")) {
      return [[
        { vendor_payment_tracking_id: "vpt-1", allocated_amount: "1000.00" },
        { vendor_payment_tracking_id: "vpt-2", allocated_amount: "2000.00" },
      ]];
    }
    if (text.includes("SELECT * FROM payment_voucher WHERE id")) {
      return [[VOUCHER_ADVANCE_APPLICATION_ROW]];
    }
    return [{ affectedRows: 1 }];
  });
  return { execute, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
}

const VOUCHER_ADVANCE_ROW = {
  id: "pv-adv-1", voucher_number: "PV/HQ/202609/0002", source_type: "vendor_advance",
  bank_account_id: "acct-1", payable_account_id: "pam-1", linked_vendor_id: "vendor-1",
  amount: "5000.00", status: "ceo_approved", raised_by: "fh-1", ceo_approved_by: "ceo-1", released_by: null,
};
const VOUCHER_ADVANCE_APPLICATION_ROW = {
  id: "pv-adv-2", voucher_number: "PV/HQ/202609/0003", source_type: "vendor_advance_application",
  bank_account_id: "acct-1", payable_account_id: "pam-1", linked_vendor_id: "vendor-1",
  amount: "3000.00", status: "ceo_approved", raised_by: "fh-1", ceo_approved_by: "ceo-1", released_by: null,
};

describe("paymentVoucherService.raise — vendor_advance / vendor_advance_application", () => {
  it("requires a vendor for vendor_advance", async () => {
    getConnection.mockResolvedValueOnce(mockAdvanceConnection());
    await expect(
      paymentVoucherService.raise(
        { sourceType: "vendor_advance", bankAccountId: "acct-1", payableAccountId: "pam-1", amount: 5000 } as any,
        "fh-1", "finance_head",
      ),
    ).rejects.toThrow(/vendor must be selected/i);
  });

  it("raises a vendor_advance with no GRN allocation required", async () => {
    getConnection.mockResolvedValueOnce(mockAdvanceConnection());
    await expect(
      paymentVoucherService.raise(
        { sourceType: "vendor_advance", bankAccountId: "acct-1", payableAccountId: "pam-1", linkedVendorId: "vendor-1", amount: 5000 } as any,
        "fh-1", "finance_head",
      ),
    ).resolves.toBeDefined();
  });

  it("requires GRN allocations for vendor_advance_application", async () => {
    getConnection.mockResolvedValueOnce(mockAdvanceConnection({ advanceBalance: 5000 }));
    await expect(
      paymentVoucherService.raise(
        { sourceType: "vendor_advance_application", bankAccountId: "acct-1", payableAccountId: "pam-1", linkedVendorId: "vendor-1", amount: 3000 } as any,
        "fh-1", "finance_head",
      ),
    ).rejects.toThrow(/GRN due/i);
  });

  it("rejects an application whose GRN allocations belong to a different vendor", async () => {
    getConnection.mockResolvedValueOnce(mockAdvanceConnection({
      advanceBalance: 5000,
      vendorPaymentTrackingRows: { "vpt-1": { vendor_id: "some-other-vendor", due_amount: 3000 } },
    }));
    await expect(
      paymentVoucherService.raise(
        {
          sourceType: "vendor_advance_application", bankAccountId: "acct-1", payableAccountId: "pam-1",
          linkedVendorId: "vendor-1", amount: 3000, grnAllocations: [{ vendorPaymentTrackingId: "vpt-1", amount: 3000 }],
        } as any,
        "fh-1", "finance_head",
      ),
    ).rejects.toThrow(/do not belong to the chosen vendor/i);
  });

  it("rejects an application amount exceeding the vendor's available advance balance", async () => {
    getConnection.mockResolvedValueOnce(mockAdvanceConnection({
      advanceBalance: 1000,
      vendorPaymentTrackingRows: { "vpt-1": { vendor_id: "vendor-1", due_amount: 3000 } },
    }));
    await expect(
      paymentVoucherService.raise(
        {
          sourceType: "vendor_advance_application", bankAccountId: "acct-1", payableAccountId: "pam-1",
          linkedVendorId: "vendor-1", amount: 3000, grnAllocations: [{ vendorPaymentTrackingId: "vpt-1", amount: 3000 }],
        } as any,
        "fh-1", "finance_head",
      ),
    ).rejects.toThrow(/available advance balance/i);
  });

  it("accepts an application within the available advance balance", async () => {
    getConnection.mockResolvedValueOnce(mockAdvanceConnection({
      advanceBalance: 5000,
      vendorPaymentTrackingRows: { "vpt-1": { vendor_id: "vendor-1", due_amount: 3000 } },
    }));
    await expect(
      paymentVoucherService.raise(
        {
          sourceType: "vendor_advance_application", bankAccountId: "acct-1", payableAccountId: "pam-1",
          linkedVendorId: "vendor-1", amount: 3000, grnAllocations: [{ vendorPaymentTrackingId: "vpt-1", amount: 3000 }],
        } as any,
        "fh-1", "finance_head",
      ),
    ).resolves.toBeDefined();
  });
});

// ─── internal_transfer: moving funds between two of the company's own accounts ─

function mockInternalTransferConnection(opts: { destOpeningBalance?: number; destLastRunningBalance?: number } = {}) {
  const execute = vi.fn(async (sql: string, params?: any[]) => {
    const text = String(sql);
    if (text.includes("branch_code")) return [[{ branch_code: "HQ" }]]; // nextVoucherNumber
    if (text.includes("COUNT(*) AS n FROM payment_voucher")) return [[{ n: 0 }]]; // nextVoucherNumber sequence
    if (text.includes("FROM company_bank_account") && text.includes("FOR UPDATE")) {
      const id = params?.[0];
      if (id === "acct-2") {
        return [[{
          id: "acct-2", active_status: 1,
          opening_balance: opts.destOpeningBalance ?? 50000,
        }]];
      }
      return [[{ id: "acct-1", bank_id: "bank-5", branch_id: "b1", opening_balance: 100000, active_status: 1 }]];
    }
    if (text.includes("FROM payable_account_master")) {
      return [[{ id: "pam-transfer", active_status: 1 }]];
    }
    if (text.includes("FROM bank_reconciliation_period")) return [[]]; // assertNotInClosedPeriod
    if (text.includes("FROM bank_account_ledger_entry") && text.includes("running_balance")) {
      const id = params?.[0];
      if (id === "acct-2" && opts.destLastRunningBalance != null) {
        return [[{ running_balance: opts.destLastRunningBalance }]];
      }
      if (id === "acct-2") return [[]]; // no prior entry — falls back to opening_balance
      return [[{ running_balance: 100000 }]]; // source account's last entry
    }
    if (text.includes("SELECT * FROM payment_voucher WHERE id")) {
      return [[VOUCHER_INTERNAL_TRANSFER_ROW]];
    }
    return [{ affectedRows: 1 }];
  });
  return { execute, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
}

const VOUCHER_INTERNAL_TRANSFER_ROW = {
  id: "pv-xfer-1", voucher_number: "PV/HQ/202609/0004", source_type: "internal_transfer",
  bank_account_id: "acct-1", destination_bank_account_id: "acct-2", payable_account_id: "pam-transfer",
  amount: "5000.00", status: "ceo_approved", raised_by: "fh-1", ceo_approved_by: "ceo-1", released_by: null,
  voucher_type: "payment",
};

describe("paymentVoucherService.raise — internal_transfer", () => {
  it("requires a destination bank account", async () => {
    getConnection.mockResolvedValueOnce(mockInternalTransferConnection());
    await expect(
      paymentVoucherService.raise(
        { sourceType: "internal_transfer", bankAccountId: "acct-1", payableAccountId: "pam-transfer", amount: 5000 } as any,
        "fh-1", "finance_head",
      ),
    ).rejects.toThrow(/destination bank account is required/i);
  });

  it("rejects a destination account equal to the source account", async () => {
    getConnection.mockResolvedValueOnce(mockInternalTransferConnection());
    await expect(
      paymentVoucherService.raise(
        {
          sourceType: "internal_transfer", bankAccountId: "acct-1", destinationBankAccountId: "acct-1",
          payableAccountId: "pam-transfer", amount: 5000,
        } as any,
        "fh-1", "finance_head",
      ),
    ).rejects.toThrow(/destination.*same|same.*account/i);
  });

  it("raises a valid internal transfer", async () => {
    getConnection.mockResolvedValueOnce(mockInternalTransferConnection());
    await expect(
      paymentVoucherService.raise(
        {
          sourceType: "internal_transfer", bankAccountId: "acct-1", destinationBankAccountId: "acct-2",
          payableAccountId: "pam-transfer", amount: 5000,
        } as any,
        "fh-1", "finance_head",
      ),
    ).resolves.toBeDefined();
  });
});

describe("paymentVoucherService.release — internal_transfer lane", () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("finance_action_audit_log")) return [[]];
      return [[VOUCHER_INTERNAL_TRANSFER_ROW]];
    });
  });

  it("posts one debit row on the source account and one credit row on the destination account", async () => {
    const conn = mockInternalTransferConnection();
    getConnection.mockResolvedValueOnce(conn);

    await paymentVoucherService.release("pv-xfer-1", "fh-1", "finance_head", { paymentMode: "NEFT", paymentDate: "2026-09-22" });

    const ledgerInserts = conn.execute.mock.calls.filter(([sql]: [string]) =>
      String(sql).includes("INSERT INTO bank_account_ledger_entry"));
    expect(ledgerInserts).toHaveLength(2);

    const [debitCall, creditCall] = ledgerInserts;
    // debit_amount and credit_amount are never both bound params in the same INSERT — whichever
    // side is 0 is a SQL literal, so the amount is at params index 4 on both rows.
    expect(debitCall[1][1]).toBe("acct-1");
    expect(debitCall[1][4]).toBe(5000); // debit_amount
    expect(creditCall[1][1]).toBe("acct-2");
    expect(creditCall[1][4]).toBe(5000); // credit_amount
  });

  it("computes the destination account's running_balance independently of the source account's", async () => {
    const conn = mockInternalTransferConnection({ destLastRunningBalance: 20000 });
    getConnection.mockResolvedValueOnce(conn);

    await paymentVoucherService.release("pv-xfer-1", "fh-1", "finance_head", { paymentMode: "NEFT", paymentDate: "2026-09-22" });

    const ledgerInserts = conn.execute.mock.calls.filter(([sql]: [string]) =>
      String(sql).includes("INSERT INTO bank_account_ledger_entry"));
    const creditCall = ledgerInserts.find((c: [string, any[]]) => c[1][1] === "acct-2");
    // running_balance is the 9th bound value (index 8) in both INSERT statements.
    expect(creditCall![1][8]).toBe(25000); // 20000 + 5000
  });

  it("posts no journal lines for an internal transfer", async () => {
    const conn = mockInternalTransferConnection();
    getConnection.mockResolvedValueOnce(conn);

    await paymentVoucherService.release("pv-xfer-1", "fh-1", "finance_head", { paymentMode: "NEFT", paymentDate: "2026-09-22" });

    const journalInserts = conn.execute.mock.calls.filter(([sql]: [string]) => String(sql).includes("INSERT INTO journal_entry"));
    expect(journalInserts).toHaveLength(0);
  });
});

describe("paymentVoucherService.release — vendor_advance lane", () => {
  it("writes one bank debit and one vendor_advance_ledger credit, no dispatch() calls", async () => {
    const conn = mockAdvanceConnection({ advanceBalance: 0 });
    getConnection.mockResolvedValueOnce(conn);
    // First execute() call in release() re-selects the voucher itself; override for this row.
    conn.execute.mockImplementationOnce(async () => [[VOUCHER_ADVANCE_ROW]]);

    await paymentVoucherService.release("pv-adv-1", "fh-1", "finance_head", { paymentMode: "NEFT", paymentDate: "2026-09-10", transactionRef: "UTR200" });

    expect(dispatch).not.toHaveBeenCalled();
    const bankInsert = conn.execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO bank_account_ledger_entry"));
    expect(bankInsert).toBeDefined();
    const ledgerInsert = conn.execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO vendor_advance_ledger"));
    expect(ledgerInsert).toBeDefined();
    expect(ledgerInsert![0]).toContain("'credit'"); // direction is a SQL literal, not a bound param
    // params: [id, vendor_id, branch_id, amount, balance_after, voucher_id, narration, created_by]
    expect(ledgerInsert![1][3]).toBe(5000); // amount
    expect(ledgerInsert![1][4]).toBe(5000); // balance_after = 0 (prior) + 5000
  });
});

describe("paymentVoucherService.release — vendor_advance_application lane", () => {
  it("writes zero bank entries, one Adjustment dispatch per allocation, one vendor_advance_ledger debit", async () => {
    const conn = mockAdvanceConnection({ advanceBalance: 5000 });
    getConnection.mockResolvedValueOnce(conn);
    conn.execute.mockImplementationOnce(async () => [[VOUCHER_ADVANCE_APPLICATION_ROW]]);
    dispatch.mockResolvedValue({ payment: { grn_number: "GRN-X" }, transactions: [{ tds_amount: 0 }] });

    await paymentVoucherService.release("pv-adv-2", "fh-1", "finance_head", { paymentMode: "Cash", paymentDate: "2026-09-10" });

    const bankInsert = conn.execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO bank_account_ledger_entry"));
    expect(bankInsert).toBeUndefined();
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenNthCalledWith(1, "vpt-1", expect.objectContaining({ paymentMode: "Adjustment", paymentAmount: 1000 }), "fh-1", "finance_head", conn, "pv-adv-2");
    expect(dispatch).toHaveBeenNthCalledWith(2, "vpt-2", expect.objectContaining({ paymentMode: "Adjustment", paymentAmount: 2000 }), "fh-1", "finance_head", conn, "pv-adv-2");
    const ledgerInsert = conn.execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO vendor_advance_ledger"));
    expect(ledgerInsert![0]).toContain("'debit'");
    expect(ledgerInsert![1][3]).toBe(3000); // amount applied
    expect(ledgerInsert![1][4]).toBe(2000); // balance_after = 5000 - 3000
  });

  it("refuses to release when the advance balance has been drawn down below the applied amount since raise", async () => {
    const conn = mockAdvanceConnection({ advanceBalance: 1000 }); // was 5000+ at raise time, now only 1000
    getConnection.mockResolvedValueOnce(conn);
    conn.execute.mockImplementationOnce(async () => [[VOUCHER_ADVANCE_APPLICATION_ROW]]); // amount: 3000

    await expect(
      paymentVoucherService.release("pv-adv-2", "fh-1", "finance_head", { paymentMode: "Cash", paymentDate: "2026-09-10" }),
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("available advance balance") });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("paymentVoucherService.get — actor names and live balance (2026-09-17 CEO/CA compliance review)", () => {
  it("resolves raised_by/ceo_approved_by/released_by and every timeline actor to a display name, and reads the live ledger balance", async () => {
    const { listFinanceApprovalEvents } = await import("../../../shared/financeApprovalEvent.js");
    (listFinanceApprovalEvents as any).mockResolvedValueOnce([
      { id: "ev-1", action: "approve", actor_user_id: "ceo-1", actor_role: "ceo", created_at: "2026-09-11T10:00:00Z" },
    ]);
    execute
      .mockResolvedValueOnce([[{ ...VOUCHER_ROW, linked_vendor_id: null, released_by: "fh-2" }]]) // main SELECT
      .mockResolvedValueOnce([[{ action_type: "PAYMENT_VOUCHER_APPROVED", actor_user_id: "ceo-1", actor_role: "ceo", change_summary: null, created_at: "2026-09-11T10:00:00Z" }]]) // audit rows
      .mockResolvedValueOnce([[]]) // grn allocation rows
      .mockResolvedValueOnce([[{ running_balance: 42000 }]]) // latest bank_account_ledger_entry
      .mockResolvedValueOnce([[{ opening_balance: 100000 }]]) // company_bank_account (fetched unconditionally alongside the ledger entry)
      .mockResolvedValueOnce([[ // resolveActorNames batch lookup
        { id: "fh-1", name: "Priya Sharma" },
        { id: "ceo-1", name: "Rakesh Mehta" },
        { id: "fh-2", name: "Amit Rao" },
      ]]);

    const result = await paymentVoucherService.get("pv-1");

    expect(result!.raised_by_name).toBe("Priya Sharma");
    expect(result!.ceo_approved_by_name).toBe("Rakesh Mehta");
    expect(result!.released_by_name).toBe("Amit Rao");
    // The live figure comes from the latest ledger entry, NOT company_bank_account.opening_balance
    // (that column is a stale post-reconciliation seed, not a live balance — see get()'s own comment).
    expect(result!.current_bank_balance).toBe(42000);
    expect(result!.approval_events[0].actor_name).toBe("Rakesh Mehta");
    expect(result!.audit_log[0].actor_name).toBe("Rakesh Mehta");
  });

  it("falls back to company_bank_account.opening_balance when no ledger entry exists yet", async () => {
    const { listFinanceApprovalEvents } = await import("../../../shared/financeApprovalEvent.js");
    (listFinanceApprovalEvents as any).mockResolvedValueOnce([]);
    execute
      .mockResolvedValueOnce([[{ ...VOUCHER_ROW, linked_vendor_id: null, released_by: null, ceo_approved_by: null }]])
      .mockResolvedValueOnce([[]]) // audit rows
      .mockResolvedValueOnce([[]]) // grn allocation rows
      .mockResolvedValueOnce([[]]) // no ledger entry yet for this account
      .mockResolvedValueOnce([[{ opening_balance: 75000 }]]) // company_bank_account
      .mockResolvedValueOnce([[{ id: "fh-1", name: "Priya Sharma" }]]); // resolveActorNames

    const result = await paymentVoucherService.get("pv-1");
    expect(result!.current_bank_balance).toBe(75000);
  });
});

describe("paymentVoucherService.withdraw (2026-09-17 CEO/CA compliance review — no cancel path existed before this)", () => {
  it("lets the raiser withdraw their own voucher while status='raised'", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "raised", raised_by: "fh-1" }]]) // SELECT FOR UPDATE
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE status='withdrawn'
      .mockResolvedValueOnce([{}]); // writeVoucherAudit

    await paymentVoucherService.withdraw("pv-1", "fh-1", "finance_head", "Raised against the wrong bank account");

    const update = conn.execute.mock.calls.find(([sql]) => String(sql).includes("SET status = 'withdrawn'"));
    expect(update![1]).toEqual(["fh-1", "Raised against the wrong bank account", "pv-1", "raised"]);
    expect(conn.commit).toHaveBeenCalled();
  });

  it("refuses when someone other than the raiser tries to withdraw a raised voucher", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute.mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "raised", raised_by: "fh-1" }]]);

    await expect(
      paymentVoucherService.withdraw("pv-1", "someone-else", "finance_head", "Not mine to withdraw"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("lets Finance Head recall a ceo_approved voucher before release", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "ceo_approved", raised_by: "fh-1", ceo_approved_by: "ceo-1" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    await paymentVoucherService.withdraw("pv-1", "fh-2", "finance_head", "Vendor asked us to hold this payment");

    const update = conn.execute.mock.calls.find(([sql]) => String(sql).includes("SET status = 'withdrawn'"));
    expect(update![1]).toEqual(["fh-2", "Vendor asked us to hold this payment", "pv-1", "ceo_approved"]);
  });

  it("refuses a recall from someone who is neither release-capable nor the approving CEO", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute.mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "ceo_approved", raised_by: "fh-1", ceo_approved_by: "ceo-1" }]]);

    await expect(
      paymentVoucherService.withdraw("pv-1", "random-employee", "employee", "I don't like it"),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("refuses to withdraw a released voucher — money already moved, only reversal applies", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute.mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "released", raised_by: "fh-1" }]]);

    await expect(
      paymentVoucherService.withdraw("pv-1", "fh-1", "finance_head", "Too late"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("requires a reason", async () => {
    await expect(paymentVoucherService.withdraw("pv-1", "fh-1", "finance_head", "")).rejects.toThrow(/reason/i);
    expect(getConnection).not.toHaveBeenCalled();
  });
});

describe("paymentVoucherService.saveAttachment (2026-09-17 CEO/CA compliance review — no attachment path existed before this)", () => {
  it("saves the attachment while the voucher is not yet released", async () => {
    execute.mockReset();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE ... WHERE status <> 'released'
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("finance_action_audit_log")) return [[]];
      return [[VOUCHER_ROW]];
    });

    await paymentVoucherService.saveAttachment("pv-1", "uploads/payment-voucher-attachments/abc123", "invoice.pdf", "fh-1", "application/pdf");

    const update = execute.mock.calls[0];
    expect(String(update[0])).toContain("WHERE id = ? AND status <> 'released'");
    expect(update[1]).toEqual(["uploads/payment-voucher-attachments/abc123", "invoice.pdf", "application/pdf", "fh-1", "pv-1"]);
    expect(logSensitiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "PAYMENT_VOUCHER_ATTACHMENT_SAVED", entity_id: "pv-1" }),
    );
  });

  it("refuses once the voucher is released — money has moved, the attachment becomes part of the historical record", async () => {
    execute.mockReset();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }]); // WHERE status <> 'released' matched nothing

    await expect(
      paymentVoucherService.saveAttachment("pv-1", "uploads/x", "invoice.pdf", "fh-1"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses for a voucher id that does not exist", async () => {
    execute.mockReset();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(
      paymentVoucherService.saveAttachment("no-such-id", "uploads/x", "invoice.pdf", "fh-1"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
