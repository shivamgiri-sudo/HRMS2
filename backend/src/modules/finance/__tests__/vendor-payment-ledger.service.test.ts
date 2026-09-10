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
function mockConnection(opts: { activeVoucher?: Record<string, unknown> | null } = {}) {
  const execute = vi.fn(async (sql: string) => {
    const text = String(sql);
    if (text.includes("FROM payment_voucher_grn_allocation")) {
      return [opts.activeVoucher ? [opts.activeVoucher] : []];
    }
    if (text.includes("FOR UPDATE")) return [[PENDING_PAYMENT]];
    if (text.includes("vm.tds_enabled")) return [[{ tds_enabled: 0, tds_rate: 0, tds_section: null }]];
    if (text.includes("AS last_sequence")) return [[{ last_sequence: 0 }]];
    if (text.includes("FROM bank_master")) return [[{ bank_name: "Test Bank" }]];
    return [{ affectedRows: 1 }];
  });
  return {
    execute,
    query: vi.fn(),
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
