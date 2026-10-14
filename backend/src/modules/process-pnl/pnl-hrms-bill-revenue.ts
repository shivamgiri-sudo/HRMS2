// backend/src/modules/process-pnl/pnl-hrms-bill-revenue.ts
/**
 * HRMS client-invoice leg of invoiced revenue (getInvoicedRevenueActuals), behind
 * PNL_REVENUE_FROM_HRMS_BILLS (default off).
 *
 * db_bill is being retired: bills raised in HRMS Client Billing never reach the db_bill snapshots
 * (billing_invoice_particular_snapshot / billing_credit_note_snapshot), so without this leg the
 * P&L does not see them. The leg is:
 *
 *   approved client_invoice.total_amount (ex-GST) - approved client_credit_note.total_amount
 *
 * for MAS Callnet cost centres only, is_migrated = 0 only (migrated rows came from db_bill and are
 * already in the snapshots), and a row whose legacy_id is present in the db_bill header snapshot
 * is skipped as a second guard against double counting. The month is the bill's service month
 * (month_label 'Mmm-YY', the same month_for the snapshot's period_code comes from), else the
 * invoice / credit date when the label is blank.
 */

/** True when PNL_REVENUE_FROM_HRMS_BILLS is "true" / "1" (default off). */
export function hrmsBillRevenueEnabled(): boolean {
  const v = String(process.env.PNL_REVENUE_FROM_HRMS_BILLS ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" -> "Sep-26". */
export function monthLabelOfPeriod(periodCode: string): string {
  return `${MONTHS[Number(periodCode.slice(5, 7)) - 1]}-${periodCode.slice(2, 4)}`;
}

export interface SqlPart {
  sql: string;
  params: unknown[];
}

/**
 * Rows (cost_centre_code, branch_id, cost_centre_id, process_id, invoice_amount) of HRMS-raised
 * approved invoices for the period. `ownCompanySql` is the caller's MAS predicate on alias `ccm`;
 * `processJoin` its PROCESS_BY_COST_CENTRE derived table (joined as `pc`).
 */
export function hrmsInvoiceRevenueSql(periodCode: string, ownCompanySql: string, processJoin: string): SqlPart {
  return {
    sql: `SELECT ccm.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_centre_code,
              ccm.branch_id AS branch_id, ccm.id AS cost_centre_id,
              COALESCE(pc.process_id, ccm.process_id) AS process_id, SUM(ci.total_amount) AS invoice_amount
         FROM client_invoice ci
         JOIN cost_centre_master ccm ON ccm.id = ci.cost_centre_id
         LEFT JOIN ${processJoin} pc ON pc.cost_centre_id = ccm.id
        WHERE ci.invoice_status = 'approved' AND ci.is_migrated = 0
          AND (ci.month_label = ? OR (NULLIF(TRIM(COALESCE(ci.month_label, '')), '') IS NULL AND DATE_FORMAT(ci.invoice_date, '%Y-%m') = ?))
          AND (ci.legacy_id IS NULL OR NOT EXISTS (SELECT 1 FROM billing_invoice_snapshot bis WHERE bis.bill_source_id = ci.legacy_id))
          AND ${ownCompanySql}
        GROUP BY ccm.cost_centre_code COLLATE utf8mb4_unicode_ci, ccm.branch_id, ccm.id, COALESCE(pc.process_id, ccm.process_id)`,
    params: [monthLabelOfPeriod(periodCode), periodCode],
  };
}

/** Rows (branch_id, cost_centre_id, process_id, amount < 0) of HRMS-raised approved credit notes. */
export function hrmsCreditRevenueSql(periodCode: string, ownCompanySql: string, processJoin: string): SqlPart {
  return {
    sql: `SELECT ccm.branch_id, ccm.id, COALESCE(pc.process_id, ccm.process_id), -cn.total_amount
          FROM client_credit_note cn
          JOIN cost_centre_master ccm ON ccm.id = cn.cost_centre_id
          LEFT JOIN ${processJoin} pc ON pc.cost_centre_id = ccm.id
         WHERE cn.credit_status = 'approved' AND cn.is_migrated = 0
           AND (cn.month_label = ? OR (NULLIF(TRIM(COALESCE(cn.month_label, '')), '') IS NULL AND DATE_FORMAT(cn.credit_date, '%Y-%m') = ?))
           AND (cn.legacy_id IS NULL OR NOT EXISTS (SELECT 1 FROM billing_credit_note_snapshot bcs WHERE bcs.bill_source_id = cn.legacy_id))
           AND ${ownCompanySql}`,
    params: [monthLabelOfPeriod(periodCode), periodCode],
  };
}
