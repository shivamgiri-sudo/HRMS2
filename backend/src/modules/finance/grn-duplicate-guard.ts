import type { RowDataPacket } from "mysql2";

/**
 * Refuses to pay a bill whose twin has already been paid (or is being paid right now).
 *
 * WHY: the same bill reached Payment Dispatch twice in Sept-2026 — once as a legacy db_bill GRN
 * (Mas/9/26/127, wrongly relabelled "paid") and once re-entered by hand (MAS/09/26/0009). Both
 * showed as payable, so paying them both would have sent the money twice. Nothing in the system
 * compared one bill with another.
 *
 * A TWIN is another live bill of the same vendor (same vendor id, or same vendor name — 159 vendor
 * names exist under several ids) with:
 *   - the same amount (within Re 1),
 *   - the same bill month and branch, and
 *   - the same invoice number, or an invoice number missing / "NA" on either side.
 * Two different real invoice numbers are never twins (monthly rent of the same amount is fine).
 * It only counts as a blocker once money has gone out for it, or a payment voucher for it is in
 * flight; two unpaid twins can both sit there until one of them is paid.
 */

type Executor = { execute(sql: string, params?: any[]): Promise<[any, any]> };

export type PaidTwin = { trackingId: string; grnNumber: string | null; paidAmount: number; status: string; voucherNumber: string | null };

const INVOICE = (alias: string) =>
  `CASE WHEN UPPER(TRIM(COALESCE(${alias}.invoice_number, ''))) IN ('', 'NA', 'N/A', '-', '0') THEN NULL ELSE UPPER(TRIM(${alias}.invoice_number)) END`;

export async function findPaidTwin(executor: Executor, trackingId: string): Promise<PaidTwin | null> {
  const [rows] = (await executor.execute(
    `SELECT t2.id, t2.grn_number, t2.paid_amount, t2.payment_status,
            (SELECT pv.voucher_number
               FROM payment_voucher_grn_allocation a JOIN payment_voucher pv ON pv.id = a.payment_voucher_id
              WHERE a.vendor_payment_tracking_id = t2.id
                AND pv.status IN ('raised','ceo_approved','changes_requested','released')
              LIMIT 1) AS voucher_number
       FROM vendor_payment_tracking t
       JOIN grn_request g ON g.id = t.grn_request_id
       JOIN vendor_payment_tracking t2
         ON t2.id <> t.id
        AND (t2.vendor_id = t.vendor_id OR UPPER(TRIM(t2.vendor_name)) = UPPER(TRIM(t.vendor_name)))
       JOIN grn_request g2 ON g2.id = t2.grn_request_id
      WHERE t.id = ?
        AND ABS(t2.due_amount - t.due_amount) <= 1
        AND DATE_FORMAT(COALESCE(g2.bill_date, DATE(t2.created_at)), '%Y-%m') = DATE_FORMAT(COALESCE(g.bill_date, DATE(t.created_at)), '%Y-%m')
        AND t2.payment_status NOT IN ('Rejected', 'Closed')
        AND g2.status NOT IN ('rejected', 'cancelled', 'draft')
        AND g.branch_id <=> g2.branch_id
        AND (${INVOICE("g")} = ${INVOICE("g2")} OR ${INVOICE("g")} IS NULL OR ${INVOICE("g2")} IS NULL)
        AND (t2.paid_amount > 0 OR EXISTS (
              SELECT 1 FROM payment_voucher_grn_allocation a JOIN payment_voucher pv ON pv.id = a.payment_voucher_id
               WHERE a.vendor_payment_tracking_id = t2.id AND pv.status IN ('raised','ceo_approved','changes_requested','released')))
      ORDER BY t2.paid_amount DESC
      LIMIT 1`,
    [trackingId],
  )) as [RowDataPacket[], unknown];
  const row = (rows as RowDataPacket[])[0];
  if (!row) return null;
  return {
    trackingId: String(row.id), grnNumber: row.grn_number ?? null, paidAmount: Number(row.paid_amount ?? 0),
    status: String(row.payment_status), voucherNumber: row.voucher_number ?? null,
  };
}

const OVERRIDE_ROLES = new Set(["finance_head", "super_admin"]);

/** Throws a message for the caller to surface unless the bill is clear, or a finance head overrides it. */
export async function assertNoPaidTwin(
  executor: Executor, trackingId: string, grnLabel: string,
  opts: { allow?: boolean; actorRole?: string } = {},
  makeError: (message: string) => Error = (m) => new Error(m),
): Promise<void> {
  const twin = await findPaidTwin(executor, trackingId);
  if (!twin) return;
  if (opts.allow && OVERRIDE_ROLES.has(String(opts.actorRole ?? ""))) return;
  const how = twin.paidAmount > 0 ? `already paid ${twin.paidAmount.toFixed(2)}` : `has payment voucher ${twin.voucherNumber} in progress`;
  throw makeError(
    `${grnLabel} looks like a duplicate of ${twin.grnNumber ?? twin.trackingId} (same vendor, amount and bill month), which ${how}. ` +
    `Paying both would pay the same bill twice. Reject or cancel the duplicate GRN; if they really are two different bills, a finance head can confirm and pay.`,
  );
}
