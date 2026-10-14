import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rejected / withdrawn sales_receipt voucher must refresh client_invoice_payment_status of the
 * bills allocated on its receipts, inside the same transaction.
 */
const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent: vi.fn().mockResolvedValue(undefined),
  listFinanceApprovalEvents: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../inbox/inbox.service.js", () => ({
  inboxService: { createItem: vi.fn().mockResolvedValue(undefined), resolveItems: vi.fn().mockResolvedValue(0) },
}));
vi.mock("../../../shared/recipient-resolver.js", () => ({ resolveRoleHolderUserIds: vi.fn().mockResolvedValue([]) }));

import { refreshPaymentStatusForVoucher } from "../client-receipt-voucher-sync.js";
import { paymentVoucherService } from "../payment-voucher.service.js";

/** A connection scripted by SQL text; records every call. */
function scriptedConn(voucher: Record<string, unknown>, bills: Record<string, Record<string, unknown>>) {
  const conn = {
    execute: vi.fn(async (raw: unknown, params: unknown[] = []) => {
      const sql = String(raw);
      if (sql.includes("FROM payment_voucher WHERE id = ? FOR UPDATE")) return [[voucher], []];
      if (sql.startsWith("UPDATE payment_voucher") || sql.trim().startsWith("UPDATE payment_voucher")) return [{ affectedRows: 1 }, []];
      if (sql.includes("SELECT DISTINCT a.invoice_id")) return [Object.keys(bills).map((invoice_id) => ({ invoice_id })), []];
      if (sql.includes("FROM client_invoice ci") && sql.includes("WHERE ci.id = ?")) return [[bills[String(params[0])]].filter(Boolean), []];
      return [{}, []];
    }),
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  };
  return conn;
}
const upserts = (conn: ReturnType<typeof scriptedConn>) =>
  conn.execute.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO client_invoice_payment_status"));

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
  execute.mockResolvedValue([[{ id: "pv-1" }], []]);
});

describe("refreshPaymentStatusForVoucher", () => {
  it("recomputes every bill on the voucher's receipts with SETTLEMENT_SQL (rejected voucher excluded)", async () => {
    const conn = scriptedConn({}, {
      i1: { id: "i1", grand_total: "118000.00", legacy_id: null, received: "0", tds: "0", deduction: "0", settled: "0", last_receipt_date: null, credited: "0" },
      i2: { id: "i2", grand_total: "1000.00", legacy_id: "L2", received: "500.00", tds: "0", deduction: "0", settled: "500.00", last_receipt_date: "2026-10-01", credited: "500.00" },
    });
    const n = await refreshPaymentStatusForVoucher(conn as never, "pv-1");
    expect(n).toBe(2);
    const calcSql = String(conn.execute.mock.calls.find(([s]) => String(s).includes("WHERE ci.id = ?"))![0]);
    expect(calcSql).toContain("pv.status NOT IN ('rejected', 'withdrawn')");
    expect(calcSql).toContain("credit_status = 'approved'");
    const rows = upserts(conn).map(([, p]) => p as unknown[]);
    expect(rows[0].slice(1, 6)).toEqual(["i1", null, "pending", "118000.00", "0"]);
    expect(rows[1].slice(1, 4)).toEqual(["i2", "L2", "paid"]);
  });

  it("does nothing for a voucher with no client receipt", async () => {
    const conn = scriptedConn({}, {});
    expect(await refreshPaymentStatusForVoucher(conn as never, "pv-x")).toBe(0);
    expect(upserts(conn)).toHaveLength(0);
  });
});

describe("payment voucher reject / withdraw refresh client bill status", () => {
  const bill = { i1: { id: "i1", grand_total: "100.00", legacy_id: null, received: "0", tds: "0", deduction: "0", settled: "0", last_receipt_date: null, credited: "0" } };

  it("CEO reject of a sales_receipt voucher refreshes before commit", async () => {
    const conn = scriptedConn({ id: "pv-1", status: "raised", raised_by: "fh-1", source_type: "sales_receipt" }, bill);
    getConnection.mockResolvedValueOnce(conn);
    await paymentVoucherService.ceoApprove("pv-1", "ceo-1", "ceo", "reject", "Wrong amount");
    expect(upserts(conn)).toHaveLength(1);
    expect(upserts(conn)[0][1]).toContain("pending");
    expect(conn.commit).toHaveBeenCalled();
  });

  it("withdraw of a sales_receipt voucher refreshes; a vendor voucher does not", async () => {
    const conn = scriptedConn({ id: "pv-1", status: "raised", raised_by: "fh-1", source_type: "sales_receipt" }, bill);
    getConnection.mockResolvedValueOnce(conn);
    await paymentVoucherService.withdraw("pv-1", "fh-1", "finance_head", "Duplicate receipt");
    expect(upserts(conn)).toHaveLength(1);

    const vendor = scriptedConn({ id: "pv-2", status: "raised", raised_by: "fh-1", source_type: "vendor_grn" }, bill);
    getConnection.mockResolvedValueOnce(vendor);
    await paymentVoucherService.withdraw("pv-2", "fh-1", "finance_head", "Not needed");
    expect(vendor.execute.mock.calls.some(([s]) => String(s).includes("client_receipt_allocation"))).toBe(false);
  });

  it("approving does not touch client bill status", async () => {
    const conn = scriptedConn({ id: "pv-1", status: "raised", raised_by: "fh-1", source_type: "sales_receipt" }, bill);
    getConnection.mockResolvedValueOnce(conn);
    await paymentVoucherService.ceoApprove("pv-1", "ceo-1", "ceo", "approve");
    expect(upserts(conn)).toHaveLength(0);
  });
});
