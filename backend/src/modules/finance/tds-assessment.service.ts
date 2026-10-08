import type { RowDataPacket } from "mysql2";
import {
  computeExpectedTds,
  financialYearOf,
  hasValidPan,
  type TdsSection,
} from "./tds-engine.js";

/**
 * Advisory TDS check, run beside every vendor payment. It records what the rules say should have
 * been deducted next to what was actually deducted, and changes nothing about the payment.
 * Callers wrap it so a failure here can never block a payment (see recordTdsAssessmentSafely).
 */

type Executor = { execute(sql: string, params?: any[]): Promise<[any, any]> };

/** The old per-vendor section text (what finance typed on the vendor) mapped to a section code. */
const VENDOR_SECTION_TO_CODE: Record<string, string> = {
  "194C": "194C",
  "194J": "194J_PROF",
  "194I": "194I_LB",
  "194H": "194H",
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function toSection(row: RowDataPacket): TdsSection {
  return {
    sectionCode: String(row.section_code),
    rateIndividual: Number(row.rate_individual),
    rateOther: Number(row.rate_other),
    rateNoPan: Number(row.rate_no_pan),
    singleLimit: row.single_limit == null ? null : Number(row.single_limit),
    annualLimit: row.annual_limit == null ? null : Number(row.annual_limit),
  };
}

export type TdsAssessmentInput = {
  trackingId: string;
  transactionRowId: string;
  paymentAmount: number;
  deductedTds: number;
  paymentDate: string;
};

export async function recordTdsAssessment(
  executor: Executor,
  input: TdsAssessmentInput,
): Promise<void> {
  const [trackingRows] = (await executor.execute(
    `SELECT t.vendor_id, t.sub_head, t.amount_without_tax, t.amount_with_tax, vm.pan_number, vm.tds_section
       FROM vendor_payment_tracking t
       LEFT JOIN vendor_master vm ON vm.id = t.vendor_id
      WHERE t.id = ? LIMIT 1`,
    [input.trackingId],
  )) as [RowDataPacket[], unknown];
  const t = trackingRows[0];
  if (!t) return;

  const subHead = String(t.sub_head ?? "").trim();
  const fy = financialYearOf(input.paymentDate);

  // Section: what finance typed on the vendor wins when it names a known section, else the sub-head default.
  const vendorCode =
    VENDOR_SECTION_TO_CODE[
      String(t.tds_section ?? "")
        .trim()
        .toUpperCase()
    ] ?? null;
  let sectionCode = vendorCode;
  let confidence: string | null = vendorCode ? "firm" : null;
  if (!sectionCode && subHead) {
    const [defaults] = (await executor.execute(
      `SELECT section_code, confidence FROM tds_sub_head_default WHERE sub_head_name = ? LIMIT 1`,
      [subHead],
    )) as [RowDataPacket[], unknown];
    if (defaults[0]) {
      sectionCode = String(defaults[0].section_code);
      confidence = String(defaults[0].confidence);
    }
  }

  // The base is the share of this payment that is the amount before GST.
  const withTax = Number(t.amount_with_tax ?? 0);
  const withoutTax = Number(t.amount_without_tax ?? 0);
  const ratio =
    withTax > 0 && withoutTax > 0 ? Math.min(1, withoutTax / withTax) : 1;
  const base = round2(input.paymentAmount * ratio);

  let section: TdsSection | null = null;
  let ytdBase = 0;
  if (sectionCode) {
    const [sectionRows] = (await executor.execute(
      `SELECT * FROM tds_section_master WHERE section_code = ? AND active_status = 1 LIMIT 1`,
      [sectionCode],
    )) as [RowDataPacket[], unknown];
    if (sectionRows[0]) section = toSection(sectionRows[0]);
  }
  if (section && t.vendor_id) {
    // Year so far: this vendor's earlier payments in the same financial year under the same section
    // (their sub-heads map to it), each reduced to its before-GST share.
    const [names] = (await executor.execute(
      `SELECT sub_head_name FROM tds_sub_head_default WHERE section_code = ?`,
      [section.sectionCode],
    )) as [RowDataPacket[], unknown];
    const subHeads = names.map((n) => String(n.sub_head_name));
    if (subHeads.length > 0) {
      const fyStart = `${fy.slice(0, 4)}-04-01`;
      const [sum] = (await executor.execute(
        `SELECT COALESCE(SUM(tx.amount * IF(tr.amount_with_tax > 0 AND tr.amount_without_tax > 0, LEAST(1, tr.amount_without_tax / tr.amount_with_tax), 1)), 0) AS ytd
           FROM vendor_payment_transaction tx
           JOIN vendor_payment_tracking tr ON tr.id = tx.vendor_payment_id
          WHERE tr.vendor_id = ?
            AND tr.sub_head IN (${subHeads.map(() => "?").join(",")})
            AND tx.payment_date >= ? AND tx.payment_date <= ?
            AND tx.id <> ?`,
        [
          String(t.vendor_id),
          ...subHeads,
          fyStart,
          input.paymentDate,
          input.transactionRowId,
        ],
      )) as [RowDataPacket[], unknown];
      ytdBase = round2(Number(sum[0]?.ytd ?? 0));
    }
  }

  const result = computeExpectedTds({
    section,
    pan: t.pan_number ?? null,
    baseAmount: base,
    ytdBase,
  });
  const expected = result.applicable ? result.expectedTds : 0;
  const deducted = round2(input.deductedTds);
  const shortfall = round2(Math.max(0, expected - deducted));

  await executor.execute(
    `INSERT INTO tds_assessment
       (vendor_payment_tracking_id, transaction_row_id, vendor_id, sub_head_name, section_code, confidence, financial_year,
        payment_amount, base_amount, rate_pct, expected_tds, deducted_tds, shortfall, pan_valid, reason)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE expected_tds = VALUES(expected_tds), deducted_tds = VALUES(deducted_tds),
       shortfall = VALUES(shortfall), reason = VALUES(reason)`,
    [
      input.trackingId,
      input.transactionRowId,
      t.vendor_id ?? null,
      subHead || null,
      section?.sectionCode ?? null,
      confidence,
      fy,
      round2(input.paymentAmount),
      base,
      result.rate,
      expected,
      deducted,
      shortfall,
      hasValidPan(t.pan_number) ? 1 : 0,
      result.reason.slice(0, 500),
    ],
  );
}

/** Never lets an advisory check stop or roll back a payment; the failure is logged, not hidden. */
export async function recordTdsAssessmentSafely(
  executor: Executor,
  input: TdsAssessmentInput,
): Promise<void> {
  try {
    await recordTdsAssessment(executor, input);
  } catch (error) {
    console.error(
      "[tds-assessment] could not record the advisory TDS check for payment",
      input.transactionRowId,
      error,
    );
  }
}
