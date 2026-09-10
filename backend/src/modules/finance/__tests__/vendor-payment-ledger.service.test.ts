import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, query, getConnection, logSensitiveAction } = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
  getConnection: vi.fn(),
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute, query, getConnection } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

import { vendorPaymentLedgerService } from "../vendor-payment-ledger.service.js";

const PENDING_PAYMENT = {
  id: "pay-1",
  payment_status: "Payment Pending",
  paid_amount: 0,
  due_amount: 1000,
  balance_amount: 1000,
  grn_request_id: "grn-1",
  tds_deducted_amount: 0,
};

/**
 * Dispatches on SQL text rather than call order. dispatch() runs a fixed sequence of statements
 * and an ordered mockResolvedValueOnce chain silently mis-feeds every statement after any new
 * one is inserted — which is exactly what happened when the active-voucher guard was added.
 *
 * `activeVoucher` seeds the guard's lookup: null means no voucher is in flight for this due.
 */
function mockConnection(opts: {
  activeVoucher?: Record<string, unknown> | null;
  /** Whether `SELECT id FROM company_bank_account WHERE active_status = 1 LIMIT 1` (the
   *  required-once-accounts-exist guard) finds a row. */
  anyBankAccountExists?: boolean;
  /** The row returned by the `company_bank_account ... FOR UPDATE` lock the ledger-write block
   *  reads before computing running_balance. `undefined` (default) uses a normal active account. */
  companyBankAccount?: { opening_balance: number; active_status: number } | null;
  /** The `running_balance` of the most recent bank_account_ledger_entry row for this account, or
   *  null/undefined for a fresh account with no ledger history yet (seeds from opening_balance). */
  lastLedgerBalance?: number | null;
} = {}) {
  const execute = vi.fn(async (sql: string) => {
    const text = String(sql);
    if (text.includes("FROM payment_voucher_grn_allocation")) {
      return [opts.activeVoucher ? [opts.activeVoucher] : []];
    }
    if (text.includes("FROM company_bank_account") && text.includes("active_status = 1") && !text.includes("FOR UPDATE")) {
      return [opts.anyBankAccountExists ? [{ id: "any-account" }] : []];
    }
    if (text.includes("FROM company_bank_account") && text.includes("FOR UPDATE")) {
      const account = opts.companyBankAccount === undefined
        ? { opening_balance: 100000, active_status: 1 }
        : opts.companyBankAccount;
      return [account ? [{ id: "acct-1", ...account }] : []];
    }
    if (text.includes("FROM bank_account_ledger_entry") && text.includes("running_balance")) {
      return [opts.lastLedgerBalance != null ? [{ running_balance: opts.lastLedgerBalance }] : []];
    }
    if (text.includes("FROM payable_account_master")) {
      return [[{ id: "payable-1" }]];
    }
    if (text.includes("FOR UPDATE")) return [[PENDING_PAYMENT]];
    if (text.includes("vm.tds_enabled")) return [[{ tds_enabled: 0, tds_rate: 0, tds_section: null }]];
    if (text.includes("AS last_sequence")) return [[{ last_sequence: 0 }]];
    if (text.includes("FROM bank_master")) return [[{ bank_name: "Test Bank" }]];
    return [{ affectedRows: 1 }];
  });
  return {
    execute,
    // GET_LOCK/RELEASE_LOCK — only exercised when a reference is supplied (referenceLock gets
    // set). Real calls in these new tests, unlike the Cash-only tests above this describe block,
    // so this needs to behave like a real connection.query(), not the default vi.fn() that
    // returns undefined and breaks `.catch()` on the RELEASE_LOCK call.
    query: vi.fn(async (sql: string) => {
      if (String(sql).includes("GET_LOCK")) return [[{ acquired: 1 }]];
      return [[]];
    }),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
}

beforeEach(() => {
  execute.mockReset(); query.mockReset(); getConnection.mockReset(); logSensitiveAction.mockClear();
  // dispatch()'s own return value calls this.getPayment()/this.listTransactions() post-commit,
  // both of which use plain `db.execute` (not the connection) — every test needs these two.
  execute.mockImplementation(async (sql: string) => {
    if (String(sql).includes("FROM vendor_payment_tracking")) return [[{ id: "pay-1" }]];
    if (String(sql).includes("FROM vendor_payment_transaction")) return [[]];
    return [[]];
  });
});

describe("vendorPaymentLedgerService.dispatch with an external connection", () => {
  it("never opens its own connection or calls beginTransaction/commit/release when one is passed in", async () => {
    const conn = mockConnection();

    await vendorPaymentLedgerService.dispatch(
      "pay-1",
      { paymentMode: "Cash", paymentDate: "2026-09-01", paymentAmount: 500, remarks: "test" },
      "actor-1", "accounts_head", conn as any,
    );

    expect(getConnection).not.toHaveBeenCalled();
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).not.toHaveBeenCalled();
  });

  it("still opens, commits, and releases its own connection when none is passed (unchanged behavior)", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);

    await vendorPaymentLedgerService.dispatch(
      "pay-1",
      { paymentMode: "Cash", paymentDate: "2026-09-01", paymentAmount: 500, remarks: "test" },
      "actor-1", "accounts_head",
    );

    expect(getConnection).toHaveBeenCalledTimes(1);
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});

/**
 * The Vendor Payment Dispatch page and the Payment Voucher page both settle the same
 * vendor_payment_tracking row. Once a voucher is in flight, the voucher is the only legitimate
 * route — otherwise Accounts could pay money the CEO is still deciding on.
 */
describe("vendorPaymentLedgerService.dispatch active-voucher guard", () => {
  const PAYLOAD = {
    paymentMode: "Cash" as const,
    paymentDate: "2026-09-01",
    paymentAmount: 500,
    remarks: "test",
  };

  it("refuses a direct dispatch while a voucher is awaiting CEO approval", async () => {
    const conn = mockConnection({
      activeVoucher: { id: "pv-1", voucher_number: "PV/CORP/202609/0007", status: "raised" },
    });

    await expect(
      vendorPaymentLedgerService.dispatch("pay-1", PAYLOAD, "actor-1", "accounts_head", conn as any)
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("PV/CORP/202609/0007"),
    });

    // Nothing may have been written before the guard tripped.
    const wrote = conn.execute.mock.calls.some(([sql]) =>
      /INSERT INTO vendor_payment_transaction|UPDATE vendor_payment_tracking/i.test(String(sql))
    );
    expect(wrote).toBe(false);
  });

  it("excludes the releasing voucher itself, so release() does not block its own dispatch", async () => {
    // release() calls dispatch() while its voucher is still 'ceo_approved'. The guard must not
    // find that voucher — it is passed as callingVoucherId and excluded in SQL.
    const conn = mockConnection({ activeVoucher: null });

    await expect(
      vendorPaymentLedgerService.dispatch(
        "pay-1", PAYLOAD, "actor-1", "finance_head", conn as any, "pv-being-released"
      )
    ).resolves.toBeDefined();

    const guardCall = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("FROM payment_voucher_grn_allocation")
    );
    expect(guardCall?.[1]).toEqual(["pay-1", "pv-being-released"]);
  });

  it("lets a direct dispatch through when no voucher is in flight (unchanged common case)", async () => {
    const conn = mockConnection({ activeVoucher: null });

    await expect(
      vendorPaymentLedgerService.dispatch("pay-1", PAYLOAD, "actor-1", "accounts_head", conn as any)
    ).resolves.toBeDefined();

    // No callingVoucherId supplied: the exclusion parameter is an id nothing can match.
    const guardCall = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("FROM payment_voucher_grn_allocation")
    );
    expect(guardCall?.[1]).toEqual(["pay-1", ""]);
  });
});

/**
 * A direct "Pay" click never used to write to bank_account_ledger_entry — the only table Bank
 * Reconciliation and the Bank Ledger report ever read — so a due paid this way was invisible to
 * both. This closes that gap: supplying companyBankAccountId makes dispatch() write its own
 * ledger entry, the same way payment-voucher.service.ts's release() already does for a voucher.
 */
describe("vendorPaymentLedgerService.dispatch bank ledger completeness", () => {
  const NEFT_PAYLOAD = {
    paymentMode: "NEFT" as const,
    paymentDate: "2026-09-10",
    paymentAmount: 500,
    bankId: "bank-master-1",
    transactionId: "UTR999",
    companyBankAccountId: "acct-1",
  };

  it("writes a bank_account_ledger_entry row when companyBankAccountId is supplied", async () => {
    const conn = mockConnection({ activeVoucher: null, anyBankAccountExists: true, lastLedgerBalance: null });

    await vendorPaymentLedgerService.dispatch("pay-1", NEFT_PAYLOAD, "actor-1", "accounts_head", conn as any);

    const insertCall = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO bank_account_ledger_entry")
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as any[];
    // Bound params, in order: id, bank_account_id, entry_date, debit_amount, payable_account_id,
    // narration, instrument_ref, running_balance, created_by — voucher_id and credit_amount are
    // SQL literals (NULL / 0) in the VALUES clause, not bound params.
    expect(params[1]).toBe("acct-1"); // bank_account_id
    expect(params[3]).toBe(500); // debit_amount = the gross installment amount
    // Fresh account, no prior ledger entry: running_balance seeds from opening_balance (100000).
    expect(params[7]).toBe(99500); // running_balance = 100000 - 500
  });

  it("chains running_balance off the previous ledger entry on a second dispatch", async () => {
    const conn = mockConnection({ activeVoucher: null, anyBankAccountExists: true, lastLedgerBalance: 99500 });

    await vendorPaymentLedgerService.dispatch("pay-1", NEFT_PAYLOAD, "actor-1", "accounts_head", conn as any);

    const insertCall = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO bank_account_ledger_entry")
    );
    const params = insertCall![1] as any[];
    expect(params[7]).toBe(99000); // 99500 - 500, continuing the chain, not re-seeding from opening_balance
  });

  it("does NOT insert a ledger row when called with callingVoucherId (release() writes its own)", async () => {
    const conn = mockConnection({ activeVoucher: null, anyBankAccountExists: true, lastLedgerBalance: 99500 });

    await vendorPaymentLedgerService.dispatch(
      "pay-1", NEFT_PAYLOAD, "actor-1", "finance_head", conn as any, "pv-being-released"
    );

    const insertCall = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO bank_account_ledger_entry")
    );
    expect(insertCall).toBeUndefined();
  });

  it("does NOT insert a ledger row when companyBankAccountId is omitted (unchanged common case)", async () => {
    const conn = mockConnection({ activeVoucher: null, anyBankAccountExists: false });
    const { companyBankAccountId, ...withoutAccount } = NEFT_PAYLOAD;

    await vendorPaymentLedgerService.dispatch("pay-1", withoutAccount, "actor-1", "accounts_head", conn as any);

    const insertCall = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO bank_account_ledger_entry")
    );
    expect(insertCall).toBeUndefined();
  });

  it("requires a bank account once the org has one configured, for a bank-rail mode", async () => {
    const conn = mockConnection({ activeVoucher: null, anyBankAccountExists: true });
    const { companyBankAccountId, ...withoutAccount } = NEFT_PAYLOAD;

    await expect(
      vendorPaymentLedgerService.dispatch("pay-1", withoutAccount, "actor-1", "accounts_head", conn as any)
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("Bank account is required") });
  });

  it("does not require a bank account when the org has none configured yet", async () => {
    const conn = mockConnection({ activeVoucher: null, anyBankAccountExists: false });
    const { companyBankAccountId, ...withoutAccount } = NEFT_PAYLOAD;

    await expect(
      vendorPaymentLedgerService.dispatch("pay-1", withoutAccount, "actor-1", "accounts_head", conn as any)
    ).resolves.toBeDefined();
  });

  it("does not require a bank account for Cash, even once the org has one configured", async () => {
    const conn = mockConnection({ activeVoucher: null, anyBankAccountExists: true });

    await expect(
      vendorPaymentLedgerService.dispatch(
        "pay-1",
        { paymentMode: "Cash", paymentDate: "2026-09-10", paymentAmount: 500 },
        "actor-1", "accounts_head", conn as any
      )
    ).resolves.toBeDefined();
  });
});
