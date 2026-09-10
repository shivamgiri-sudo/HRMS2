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

function mockConnection() {
  return {
    execute: vi.fn(),
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
    conn.execute
      .mockResolvedValueOnce([[{ id: "pay-1", payment_status: "Payment Pending", paid_amount: 0, due_amount: 1000, balance_amount: 1000, grn_request_id: "grn-1", tds_deducted_amount: 0 }]]) // lockedPayment
      .mockResolvedValueOnce([[{ tds_enabled: 0, tds_rate: 0, tds_section: null }]]) // vendor TDS lookup
      .mockResolvedValueOnce([[{ last_sequence: 0 }]]) // sequence
      .mockResolvedValueOnce([{}]) // INSERT vendor_payment_transaction
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE vendor_payment_tracking
      .mockResolvedValueOnce([{}]) // UPDATE grn_request
      .mockResolvedValueOnce([{}]); // writeAudit INSERT

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
    conn.execute
      .mockResolvedValueOnce([[{ id: "pay-1", payment_status: "Payment Pending", paid_amount: 0, due_amount: 1000, balance_amount: 1000, grn_request_id: "grn-1", tds_deducted_amount: 0 }]])
      .mockResolvedValueOnce([[{ tds_enabled: 0, tds_rate: 0, tds_section: null }]])
      .mockResolvedValueOnce([[{ last_sequence: 0 }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);

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
