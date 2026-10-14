// backend/src/modules/finance/client-receipt-voucher-sync.ts
/**
 * Keeps client_invoice_payment_status in step when the bank-side voucher of a client receipt dies.
 *
 * A client receipt (client-billing-receipt.service.ts) raises a sales_receipt payment voucher and
 * links it as client_receipt.voucher_id. SETTLEMENT_SQL already ignores receipts whose voucher is
 * rejected or withdrawn, so live outstanding figures un-settle at once - but the stored
 * client_invoice_payment_status row (read by Client Payments, the bill list badges and the
 * Money Flow fallback) kept saying "paid" / "partial". This recomputes that row for every bill
 * allocated on a receipt carried by the voucher, with the same columns and rules as the private
 * refreshPaymentStatus in client-billing-receipt.service.ts.
 *
 * Call it inside the transaction that changed the voucher status, after the UPDATE, so the
 * recomputation sees the new status and commits or rolls back with it.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";

/** The slice of a mysql2 connection this needs (a PoolConnection fits). */
export interface ExecuteConnection {
  execute<T extends RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

const toPaise = (n: unknown) => Math.round(Number(n ?? 0) * 100);
const fromPaise = (p: number) => Math.round(p) / 100;

/** Returns the number of bills whose payment status was rewritten. */
export async function refreshPaymentStatusForVoucher(conn: ExecuteConnection, voucherId: string): Promise<number> {
  // Loaded lazily: client-billing-receipt.service imports payment-voucher.service, which calls this.
  const { SETTLEMENT_SQL, CREDIT_NOTE_SQL, PAID_TOLERANCE } = await import("../client-billing/client-billing-receipt.service.js");
  const [ids] = await conn.execute<RowDataPacket[]>(
    `SELECT DISTINCT a.invoice_id FROM client_receipt_allocation a
       JOIN client_receipt r ON r.id = a.receipt_id
      WHERE r.voucher_id = ?`,
    [voucherId],
  );
  let n = 0;
  for (const { invoice_id: id } of ids) {
    const [[row]] = await conn.execute<RowDataPacket[]>(
      `SELECT ci.id, ci.grand_total, ci.legacy_id, COALESCE(s.received, 0) AS received, COALESCE(s.tds, 0) AS tds,
              COALESCE(s.deduction, 0) AS deduction, COALESCE(s.settled, 0) AS settled, s.last_receipt_date,
              COALESCE(cn.credited, 0) AS credited
       FROM client_invoice ci
       LEFT JOIN (${SETTLEMENT_SQL}) s ON s.invoice_id = ci.id
       LEFT JOIN (${CREDIT_NOTE_SQL}) cn ON cn.invoice_id = ci.id
       WHERE ci.id = ?`,
      [id],
    );
    if (!row) continue;
    const outstanding = fromPaise(toPaise(row.grand_total) - toPaise(row.settled) - toPaise(row.credited));
    const status = outstanding <= PAID_TOLERANCE ? "paid" : Number(row.settled) > 0 ? "partial" : "pending";
    await conn.execute(
      `INSERT INTO client_invoice_payment_status
         (id, invoice_id, legacy_invoice_id, payment_status, total_amount, amount_received, tds_deducted,
          other_deduction, net_received, last_payment_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE payment_status = VALUES(payment_status), total_amount = VALUES(total_amount),
         amount_received = VALUES(amount_received), tds_deducted = VALUES(tds_deducted),
         other_deduction = VALUES(other_deduction), net_received = VALUES(net_received),
         last_payment_date = VALUES(last_payment_date)`,
      [randomUUID(), id, row.legacy_id ?? null, status, row.grand_total, row.received, row.tds, row.deduction,
        row.received, row.last_receipt_date ?? null],
    );
    n += 1;
  }
  return n;
}
