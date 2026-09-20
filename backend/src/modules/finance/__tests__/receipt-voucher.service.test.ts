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
