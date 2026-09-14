import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Direct ("real bank-funded") Imprest Allocation never used to write to
 * bank_account_ledger_entry — despite createAllocation()'s own comment calling it "a real
 * bank-funded top-up" — so it was invisible to Bank Reconciliation and the Bank Ledger report,
 * the same gap Direct Vendor Payment Dispatch had. Supplying companyBankAccountId closes it, the
 * same way it does for vendor-payment-ledger.service.ts's dispatch().
 */

const { execute, getConnection } = vi.hoisted(() => ({
  execute: vi.fn(),
  getConnection: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

const { post } = vi.hoisted(() => ({ post: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../imprest-ledger.service.js", () => ({ imprestLedgerService: { post } }));

const { recordFinanceApprovalEvent } = vi.hoisted(() => ({ recordFinanceApprovalEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../shared/financeApprovalEvent.js", () => ({ recordFinanceApprovalEvent }));

import { imprestService } from "../imprest.service.js";

const MANAGER = { id: "mgr-1", branch_id: "branch-1" };
const ALLOCATION_ROW = {
  id: "alloc-1",
  allocation_no: "IMP/09/26/0001",
  imprest_manager_id: "mgr-1",
  branch_id: "branch-1",
  amount: "5000.00",
  allocation_date: "2026-09-10",
  reference_no: "IMPUTR1",
  status: "submitted",
  company_bank_account_id: "acct-1",
};

/** SQL-text-dispatching mock connection, same idiom as vendor-payment-ledger.service.test.ts. */
function mockConnection(opts: {
  anyBankAccountExists?: boolean;
  companyBankAccount?: { opening_balance: number; active_status: number } | null;
  lastLedgerBalance?: number | null;
  allocationRow?: Record<string, unknown>;
} = {}) {
  const execute = vi.fn(async (sql: string) => {
    const text = String(sql);
    if (text.includes("FROM imprest_manager")) return [[MANAGER]];
    if (text.includes("imprest_allocation_sequence") && text.includes("FOR UPDATE")) {
      return [[{ next_sequence: 1 }]];
    }
    if (text.includes("FROM imprest_allocation WHERE id")) {
      return [[opts.allocationRow ?? ALLOCATION_ROW]];
    }
    if (text.includes("FROM company_bank_account") && text.includes("active_status = 1") && !text.includes("FOR UPDATE")) {
      return [opts.anyBankAccountExists ? [{ id: "any-account" }] : []];
    }
    if (text.includes("FROM company_bank_account") && text.includes("FOR UPDATE")) {
      const account = opts.companyBankAccount === undefined
        ? { opening_balance: 50000, active_status: 1 }
        : opts.companyBankAccount;
      return [account ? [{ id: "acct-1", ...account }] : []];
    }
    if (text.includes("FROM bank_reconciliation_period")) {
      // assertNotInClosedPeriod's own lookup — no closed period covers the test date by default.
      return [[]];
    }
    if (text.includes("FROM bank_account_ledger_entry") && text.includes("running_balance")) {
      return [opts.lastLedgerBalance != null ? [{ running_balance: opts.lastLedgerBalance }] : []];
    }
    if (text.includes("FROM payable_account_master")) {
      return [[{ id: "payable-imprest-1" }]];
    }
    return [{ affectedRows: 1 }];
  });
  return {
    execute,
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
}

beforeEach(() => {
  execute.mockReset(); getConnection.mockReset(); post.mockClear(); recordFinanceApprovalEvent.mockClear();
});

describe("imprestService.createAllocation bank ledger completeness (immediate disbursement)", () => {
  const BASE_INPUT = {
    imprestManagerId: "mgr-1",
    branchId: "branch-1",
    allocationDate: "2026-09-10",
    amount: 5000,
    paymentMode: "NEFT",
    referenceNo: "IMPUTR1",
    companyBankAccountId: "acct-1",
    disburseImmediately: true,
  };

  it("writes a bank_account_ledger_entry row when companyBankAccountId is supplied", async () => {
    const conn = mockConnection({ anyBankAccountExists: true, lastLedgerBalance: null });
    getConnection.mockResolvedValueOnce(conn);

    await imprestService.createAllocation(BASE_INPUT as any, "actor-1");

    const insertCall = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO bank_account_ledger_entry")
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as any[];
    // id, bank_account_id, entry_date, debit_amount, payable_account_id, narration,
    // instrument_ref, running_balance, created_by — voucher_id/credit_amount are SQL literals.
    expect(params[1]).toBe("acct-1");
    expect(params[3]).toBe(5000);
    expect(params[7]).toBe(45000); // 50000 opening_balance - 5000
  });

  it("does NOT write a ledger row for a deferred (submitted, not disbursed) allocation", async () => {
    const conn = mockConnection({ anyBankAccountExists: true });
    getConnection.mockResolvedValueOnce(conn);

    await imprestService.createAllocation({ ...BASE_INPUT, disburseImmediately: false } as any, "actor-1");

    const insertCall = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO bank_account_ledger_entry")
    );
    expect(insertCall).toBeUndefined();
    // Nor should the float itself be credited yet — the pre-existing guard this fix must not touch.
    expect(post).not.toHaveBeenCalled();
  });

  it("requires a bank account once the org has one configured, for a bank-rail mode", async () => {
    const conn = mockConnection({ anyBankAccountExists: true });
    getConnection.mockResolvedValueOnce(conn);
    const { companyBankAccountId, ...withoutAccount } = BASE_INPUT;

    await expect(
      imprestService.createAllocation(withoutAccount as any, "actor-1")
    ).rejects.toThrow("Bank account is required");
  });

  it("does not require a bank account when the org has none configured yet", async () => {
    const conn = mockConnection({ anyBankAccountExists: false });
    getConnection.mockResolvedValueOnce(conn);
    const { companyBankAccountId, ...withoutAccount } = BASE_INPUT;

    await expect(
      imprestService.createAllocation(withoutAccount as any, "actor-1")
    ).resolves.toBeDefined();
  });
});

describe("imprestService.reviewAllocation bank ledger completeness (approve a submitted allocation)", () => {
  it("writes the ledger row only at approval, using the bank account chosen at creation", async () => {
    const conn = mockConnection({ anyBankAccountExists: true, lastLedgerBalance: 45000 });
    getConnection.mockResolvedValueOnce(conn);

    await imprestService.reviewAllocation("alloc-1", "approve", "actor-1", "finance_head");

    const insertCall = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO bank_account_ledger_entry")
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as any[];
    expect(params[1]).toBe("acct-1"); // the account stored on the allocation row at creation, not re-asked here
    expect(params[7]).toBe(40000); // 45000 - 5000 (allocation.amount), continuing the chain
  });

  it("writes no ledger row when the allocation carries no company_bank_account_id (legacy/skipped)", async () => {
    const conn = mockConnection({
      anyBankAccountExists: true,
      allocationRow: { ...ALLOCATION_ROW, company_bank_account_id: null },
    });
    getConnection.mockResolvedValueOnce(conn);

    await imprestService.reviewAllocation("alloc-1", "approve", "actor-1", "finance_head");

    const insertCall = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO bank_account_ledger_entry")
    );
    expect(insertCall).toBeUndefined();
  });

  it("writes no ledger row on rejection", async () => {
    const conn = mockConnection({ anyBankAccountExists: true });
    getConnection.mockResolvedValueOnce(conn);

    await imprestService.reviewAllocation("alloc-1", "reject", "actor-1", "finance_head", "not needed");

    const insertCall = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO bank_account_ledger_entry")
    );
    expect(insertCall).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });
});
