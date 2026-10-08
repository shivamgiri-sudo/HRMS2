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

export type PaidGrnTwin = { grnId: string; grnNumber: string | null; status: string; amount: number };

/**
 * Same idea as findPaidTwin, but asked at SUBMIT time about the GRN itself, before it has a
 * payment-tracking row. A bill already paid under another GRN (typically the legacy db_bill copy,
 * which has no invoice number) is the case that reached live data in Sept-Oct 2026: the second copy
 * sat in approval and counted against the budget until someone noticed. Only a PAID twin blocks
 * here; two bills that are both still open are left to the payment-stage check above.
 */
export async function findPaidTwinForGrn(executor: Executor, grnId: string): Promise<PaidGrnTwin | null> {
  const [rows] = (await executor.execute(
    `SELECT g2.id, g2.grn_number, g2.status, g2.amount
       FROM grn_request g
       JOIN grn_request g2
         ON g2.id <> g.id
        AND g2.grn_type = g.grn_type
        AND (g2.vendor_id = g.vendor_id OR UPPER(TRIM(g2.vendor_name)) = UPPER(TRIM(g.vendor_name)))
      WHERE g.id = ?
        AND g.grn_type = 'vendor'
        AND g.vendor_id IS NOT NULL
        AND ABS(g2.amount - g.amount) <= 1
        AND g.amount >= 1000
        AND DATE_FORMAT(g2.bill_date, '%Y-%m') = DATE_FORMAT(g.bill_date, '%Y-%m')
        AND g.branch_id <=> g2.branch_id
        AND g2.status = 'paid'
        AND (${INVOICE("g")} = ${INVOICE("g2")} OR ${INVOICE("g")} IS NULL OR ${INVOICE("g2")} IS NULL)
      ORDER BY g2.created_at ASC
      LIMIT 1`,
    [grnId],
  )) as [RowDataPacket[], unknown];
  const row = (rows as RowDataPacket[])[0];
  if (!row) return null;
  return { grnId: String(row.id), grnNumber: row.grn_number ?? null, status: String(row.status), amount: Number(row.amount ?? 0) };
}

/** Refuses to submit a GRN for a bill that is already paid under another GRN, unless a finance head overrides. */
export async function assertNoPaidTwinForGrn(
  executor: Executor, grnId: string, grnLabel: string,
  opts: { allow?: boolean; actorRole?: string } = {},
  makeError: (message: string) => Error = (m) => new Error(m),
): Promise<void> {
  const twin = await findPaidTwinForGrn(executor, grnId);
  if (!twin) return;
  if (opts.allow && OVERRIDE_ROLES.has(String(opts.actorRole ?? ""))) return;
  throw makeError(
    `${grnLabel} looks like a duplicate of ${twin.grnNumber ?? twin.grnId}, which is already paid ` +
    `(same vendor, amount, bill month and branch). Do not raise it again. If it is a genuinely different bill, ` +
    `ask a finance head to submit it with the duplicate confirmation.`,
  );
}
