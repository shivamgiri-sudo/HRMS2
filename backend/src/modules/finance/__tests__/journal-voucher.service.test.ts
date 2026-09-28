import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, getConnection, logSensitiveAction, recordFinanceApprovalEvent, resolveRoleHolderUserIds, createItem, resolveItems, journalPost, journalReverse } =
  vi.hoisted(() => ({
    execute: vi.fn(),
    getConnection: vi.fn(),
    logSensitiveAction: vi.fn().mockResolvedValue(undefined),
    recordFinanceApprovalEvent: vi.fn().mockResolvedValue(undefined),
    resolveRoleHolderUserIds: vi.fn().mockResolvedValue([]),
    createItem: vi.fn().mockResolvedValue(undefined),
    resolveItems: vi.fn().mockResolvedValue(0),
    journalPost: vi.fn().mockResolvedValue({ journalEntryId: "je-new-1" }),
    journalReverse: vi.fn().mockResolvedValue({ reversalEntryId: "je-reversal-1" }),
  }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent,
  listFinanceApprovalEvents: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../shared/recipient-resolver.js", () => ({ resolveRoleHolderUserIds }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem, resolveItems } }));
vi.mock("../journal.service.js", () => ({ journalService: { post: journalPost, reverse: journalReverse } }));

import { journalVoucherService } from "../journal-voucher.service.js";

const MAKER = { id: "maker-1", roles: ["finance"] };
const APPROVER = { id: "approver-1", roles: ["finance_head"] };

const BALANCED_INPUT = {
  voucherDate: "2026-09-20",
  jvType: "provision",
  narration: "Accrue September electricity bill not yet received",
  referenceNo: null,
  branchId: null,
  costCentreId: null,
  processId: null,
  lines: [
    { accountType: "expense_sub_head", accountId: "11111111-1111-1111-1111-111111111111", debitAmount: 10000, creditAmount: 0 },
    { accountType: "payable_account", accountId: "22222222-2222-2222-2222-222222222222", debitAmount: 0, creditAmount: 10000 },
  ],
};

function mockConnection() {
  return {
    execute: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
}

/** Draft voucher row as lockVoucher()/SELECT ... FOR UPDATE would return it. */
function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "jv-1",
    voucher_number: null,
    voucher_date_str: BALANCED_INPUT.voucherDate,
    jv_type: BALANCED_INPUT.jvType,
    narration: BALANCED_INPUT.narration,
    reference_no: null,
    branch_id: null,
    cost_centre_id: null,
    process_id: null,
    total_amount: "10000.00",
    status: "draft",
    created_by: MAKER.id,
    ...overrides,
  };
}

const ACTIVE_MASTER_ROWS = [{ id: "11111111-1111-1111-1111-111111111111" }];
const ACTIVE_PAYABLE_ROWS = [{ id: "22222222-2222-2222-2222-222222222222", account_name: "Statutory Dues" }];

beforeEach(() => {
  execute.mockReset(); getConnection.mockReset(); logSensitiveAction.mockClear();
  recordFinanceApprovalEvent.mockClear(); resolveRoleHolderUserIds.mockClear();
  createItem.mockClear(); resolveItems.mockClear(); journalPost.mockClear(); journalReverse.mockClear();
  journalPost.mockResolvedValue({ journalEntryId: "je-new-1" });
  journalReverse.mockResolvedValue({ reversalEntryId: "je-reversal-1" });
  // Post-commit `getJournalVoucher()` re-reads go through plain `db.execute`; shape doesn't
  // matter for these tests beyond not throwing.
  execute.mockImplementation(async (sql: string) => {
    if (/FROM journal_voucher jv WHERE jv\.id = \?/.test(sql)) return [[draftRow({ status: "posted" })]];
    if (/FROM journal_voucher_line/.test(sql)) return [[]];
    if (/FROM finance_action_audit_log/.test(sql)) return [[]];
    return [[]];
  });
});

function connectionFor(voucher: Record<string, unknown>, lines: Record<string, unknown>[] = []) {
  const conn = mockConnection();
  conn.execute.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/SELECT jv\.\*.*FOR UPDATE/s.test(sql)) return [[voucher]];
    if (/FROM journal_voucher_line WHERE journal_voucher_id = \? ORDER BY line_order/.test(sql)) return [lines];
    if (/finance_expense_sub_head_master/.test(sql)) return [ACTIVE_MASTER_ROWS];
    if (/payable_account_master/.test(sql)) return [ACTIVE_PAYABLE_ROWS];
    if (/branch_master/.test(sql)) return [[{ id: "b1" }]];
    if (/cost_centre_master/.test(sql)) return [[{ id: "c1", branch_id: null }]];
    if (/process_master/.test(sql)) return [[{ id: "p1" }]];
    if (/COALESCE\(MAX/.test(sql)) return [[{ last_seq: 0 }]];
    if (/UPDATE journal_voucher SET voucher_number/.test(sql)) return [{ affectedRows: 1 }];
    if (/UPDATE journal_voucher SET status/.test(sql)) return [{ affectedRows: 1 }];
    if (/INSERT INTO journal_voucher_line/.test(sql)) return [{ affectedRows: 1 }];
    if (/INSERT INTO journal_voucher /.test(sql)) return [{ affectedRows: 1 }];
    if (/INSERT INTO finance_action_audit_log/.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  return conn;
}

describe("journalVoucherService.create", () => {
  it("creates a draft with an unbalanced entry allowed (no submit-time check applied at create)", async () => {
    const conn = connectionFor(draftRow());
    getConnection.mockResolvedValue(conn);
    const unbalanced = {
      ...BALANCED_INPUT,
      lines: [
        { accountType: "expense_sub_head", accountId: "11111111-1111-1111-1111-111111111111", debitAmount: 500, creditAmount: 0 },
        { accountType: "payable_account", accountId: "22222222-2222-2222-2222-222222222222", debitAmount: 0, creditAmount: 400 },
      ],
    };
    await journalVoucherService.create(unbalanced, MAKER);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it("refuses a control account (Imprest Float) even at draft creation", async () => {
    const conn = connectionFor(draftRow());
    conn.execute.mockImplementation(async (sql: string) => {
      if (/payable_account_master/.test(sql)) return [[{ id: "22222222-2222-2222-2222-222222222222", account_name: "Imprest Float" }]];
      if (/finance_expense_sub_head_master/.test(sql)) return [ACTIVE_MASTER_ROWS];
      return [[]];
    });
    getConnection.mockResolvedValue(conn);
    await expect(journalVoucherService.create(BALANCED_INPUT, MAKER)).rejects.toThrow(/control account/i);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe("journalVoucherService.submit", () => {
  it("blocks submit when the draft's lines do not balance", async () => {
    const unbalancedLines = [
      { account_type: "expense_sub_head", account_id: "11111111-1111-1111-1111-111111111111", debit_amount: "500.00", credit_amount: "0.00", narration: null },
      { account_type: "payable_account", account_id: "22222222-2222-2222-2222-222222222222", debit_amount: "0.00", credit_amount: "400.00", narration: null },
    ];
    const conn = connectionFor(draftRow(), unbalancedLines);
    getConnection.mockResolvedValue(conn);
    await expect(journalVoucherService.submit("jv-1", MAKER)).rejects.toThrow(/does not match|₹100\.00/);
    expect(conn.rollback).toHaveBeenCalled();
    expect(journalPost).not.toHaveBeenCalled();
  });

  it("refuses submit from anyone other than the voucher's own maker", async () => {
    const conn = connectionFor(draftRow({ created_by: "someone-else" }));
    getConnection.mockResolvedValue(conn);
    await expect(journalVoucherService.submit("jv-1", MAKER)).rejects.toThrow(/only the maker/i);
  });

  it("refuses submit on an already-submitted voucher", async () => {
    const conn = connectionFor(draftRow({ status: "pending_approval" }));
    getConnection.mockResolvedValue(conn);
    await expect(journalVoucherService.submit("jv-1", MAKER)).rejects.toThrow(/only the maker can submit their own draft/i);
  });

  it("allocates a voucher number and moves to pending_approval on a balanced draft", async () => {
    const balancedLines = [
      { account_type: "expense_sub_head", account_id: "11111111-1111-1111-1111-111111111111", debit_amount: "10000.00", credit_amount: "0.00", narration: null },
      { account_type: "payable_account", account_id: "22222222-2222-2222-2222-222222222222", debit_amount: "0.00", credit_amount: "10000.00", narration: null },
    ];
    const conn = connectionFor(draftRow(), balancedLines);
    getConnection.mockResolvedValue(conn);
    await journalVoucherService.submit("jv-1", MAKER);
    expect(conn.commit).toHaveBeenCalled();
    const numberCall = conn.execute.mock.calls.find((c: unknown[]) => /UPDATE journal_voucher SET voucher_number/.test(String(c[0])));
    expect(numberCall?.[1]?.[0]).toMatch(/^JV\/HQ\/202609\/0001$/);
    expect(resolveRoleHolderUserIds).toHaveBeenCalledWith("finance_head", null);
  });
});

describe("journalVoucherService.approve", () => {
  const pendingLines = [
    { account_type: "expense_sub_head", account_id: "11111111-1111-1111-1111-111111111111", debit_amount: "10000.00", credit_amount: "0.00", narration: null },
    { account_type: "payable_account", account_id: "22222222-2222-2222-2222-222222222222", debit_amount: "0.00", credit_amount: "10000.00", narration: null },
  ];

  it("posts through journalService.post() and marks the voucher posted", async () => {
    const conn = connectionFor(draftRow({ status: "pending_approval", voucher_number: "JV/HQ/202609/0001" }), pendingLines);
    getConnection.mockResolvedValue(conn);
    await journalVoucherService.approve("jv-1", "looks correct", APPROVER);
    expect(journalPost).toHaveBeenCalledTimes(1);
    const postArg = journalPost.mock.calls[0][1];
    expect(postArg.sourceType).toBe("manual");
    expect(postArg.sourceId).toBe("jv-1");
    expect(conn.commit).toHaveBeenCalled();
  });

  it("refuses self-approval — the maker cannot approve their own voucher", async () => {
    const conn = connectionFor(draftRow({ status: "pending_approval", created_by: APPROVER.id }), pendingLines);
    getConnection.mockResolvedValue(conn);
    await expect(journalVoucherService.approve("jv-1", null, APPROVER)).rejects.toThrow(/cannot approve a voucher you made/i);
    expect(journalPost).not.toHaveBeenCalled();
  });

  it("refuses approval from a role that is not finance_head/ceo/super_admin", async () => {
    const conn = connectionFor(draftRow({ status: "pending_approval" }), pendingLines);
    getConnection.mockResolvedValue(conn);
    await expect(journalVoucherService.approve("jv-1", null, { id: "someone", roles: ["employee"] })).rejects.toThrow(/finance head or ceo/i);
  });

  it("refuses approval of a voucher that is not pending_approval", async () => {
    const conn = connectionFor(draftRow({ status: "draft" }), pendingLines);
    getConnection.mockResolvedValue(conn);
    await expect(journalVoucherService.approve("jv-1", null, APPROVER)).rejects.toThrow(/cannot be approved/i);
  });
});

describe("journalVoucherService.reject", () => {
  it("requires a reason", async () => {
    const conn = connectionFor(draftRow({ status: "pending_approval" }));
    getConnection.mockResolvedValue(conn);
    await expect(journalVoucherService.reject("jv-1", "", APPROVER)).rejects.toThrow(/reason is required/i);
  });

  it("rejects a pending voucher and records the reason", async () => {
    const conn = connectionFor(draftRow({ status: "pending_approval", voucher_number: "JV/HQ/202609/0001" }));
    getConnection.mockResolvedValue(conn);
    await journalVoucherService.reject("jv-1", "Wrong ledger head used", APPROVER);
    const rejectCall = conn.execute.mock.calls.find((c: unknown[]) => /SET status = 'rejected'/.test(String(c[0])));
    expect(rejectCall?.[1]).toContain("Wrong ledger head used");
    expect(createItem).toHaveBeenCalled();
  });
});

describe("journalVoucherService.reverse", () => {
  it("reverses a posted voucher and flags BOTH the original and the contra entry as reversed", async () => {
    const conn = connectionFor(draftRow({ status: "posted", journal_entry_id: "je-original-1", voucher_number: "JV/HQ/202609/0001" }));
    getConnection.mockResolvedValue(conn);
    await journalVoucherService.reverse("jv-1", "Wrong period — reversing and reposting", APPROVER);

    expect(journalReverse).toHaveBeenCalledWith(conn, "je-original-1", APPROVER.id, expect.stringContaining("Wrong period"));
    const flagContraCall = conn.execute.mock.calls.find(
      (c: unknown[]) => /UPDATE journal_entry SET reversed_by_entry_id = \?/.test(String(c[0])) && c[1]?.[0] === "je-original-1",
    );
    expect(flagContraCall, "the reversal entry itself must also be flagged reversed, or ledger reports double-count it").toBeTruthy();
    expect(flagContraCall?.[1]).toEqual(["je-original-1", "je-reversal-1"]);
  });

  it("refuses to reverse a voucher that was never posted", async () => {
    const conn = connectionFor(draftRow({ status: "draft" }));
    getConnection.mockResolvedValue(conn);
    await expect(journalVoucherService.reverse("jv-1", "Some reason", APPROVER)).rejects.toThrow(/cannot be reversed/i);
    expect(journalReverse).not.toHaveBeenCalled();
  });
});

describe("journalVoucherService.withdraw", () => {
  it("lets the maker withdraw their own pending voucher", async () => {
    const conn = connectionFor(draftRow({ status: "pending_approval" }));
    getConnection.mockResolvedValue(conn);
    await journalVoucherService.withdraw("jv-1", "Raised in error, redoing it", MAKER);
    expect(conn.commit).toHaveBeenCalled();
  });

  it("refuses withdraw from someone who is neither the maker nor finance_head", async () => {
    const conn = connectionFor(draftRow({ status: "pending_approval", created_by: "someone-else" }));
    getConnection.mockResolvedValue(conn);
    await expect(journalVoucherService.withdraw("jv-1", "trying to withdraw someone else's", { id: "bystander", roles: ["employee"] })).rejects.toThrow(/only the maker/i);
  });
});
