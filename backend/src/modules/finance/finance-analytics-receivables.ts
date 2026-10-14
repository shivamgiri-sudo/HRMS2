// backend/src/modules/finance/finance-analytics-receivables.ts
/**
 * Receivables, collections and payables for Finance Analytics, on the SAME rules as Ledger
 * Analytics "Money Flow" (money-flow.service.ts), so the two pages can never show different AR:
 *
 *  - MAS Callnet India Pvt Ltd cost centres only (ownCompanyCostCentreSql), approved bills only.
 *  - Outstanding per bill = grand total - settled - approved credit notes, computed by Money
 *    Flow's own toBillRow from the same columns: settled from HRMS receipts (SETTLEMENT_SQL), with
 *    client_invoice_payment_status used only for a bill never allocated on any receipt.
 *  - Overdue by the bill's due date (DUE_DATE_SQL), not invoice age; client label CLIENT_NAME_SQL.
 *
 * Collections rule (never double counted): money received is HRMS client_receipt (recorded,
 * voucher not rejected / withdrawn — the Money Flow rule). The db_bill collection snapshot
 * (client_bill_collection_run_snapshot, MAS rows only) is used only for dates BEFORE the earliest
 * recorded client_receipt, i.e. the history HRMS receipts do not cover yet. Once the I-Spark
 * collections are imported as client_receipt rows the earliest receipt moves back and the
 * snapshot drops out by itself.
 */
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { ownCompanyCostCentreSql } from "../../shared/ownCompanyCostCentre.js";
import {
  CLIENT_NAME_SQL, CREDIT_NOTE_SQL, DUE_DATE_SQL, PAID_TOLERANCE, SETTLEMENT_SQL,
} from "../client-billing/client-billing-receipt.service.js";
import { toBillRow, type BillRow } from "./money-flow.service.js";

/** null = org-wide; otherwise only these branch ids ([] = nothing, fail closed). */
export interface AnalyticsScope {
  branchIds: string[] | null;
}

function branchClause(scope: AnalyticsScope, col: string, params: unknown[]): string[] {
  if (!scope.branchIds) return [];
  if (!scope.branchIds.length) return ["1 = 0"];
  params.push(...scope.branchIds);
  return [`${col} IN (${scope.branchIds.map(() => "?").join(",")})`];
}

/** Settled as toBillRow takes it, in SQL — only to prune fully paid bills before mapping. */
const SETTLED_SQL = `CASE WHEN s.invoice_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM client_receipt_allocation ra WHERE ra.invoice_id = ci.id)
    THEN COALESCE(s.settled, 0)
    ELSE COALESCE(cips.amount_received, 0) + COALESCE(cips.tds_deducted, 0) + COALESCE(cips.other_deduction, 0) END`;

export interface BillQuery {
  /** Only bills still owing (a SQL pre-filter; toBillRow decides). */
  openOnly?: boolean;
  /** invoice_date >= this (YYYY-MM-DD). */
  from?: string;
}

/**
 * Bill rows in Money Flow's shape (same SELECT columns as money-flow loadBills), not limited to a
 * finance year: AR is every open bill, whatever year it was raised in.
 */
export async function loadBills(scope: AnalyticsScope, today: string, q: BillQuery = {}): Promise<BillRow[]> {
  const params: unknown[] = [];
  const where = ["ci.invoice_status = 'approved'", ownCompanyCostCentreSql("cc")];
  if (q.from) { where.push("ci.invoice_date >= ?"); params.push(q.from); }
  where.push(...branchClause(scope, "cc.branch_id", params));
  // A little under the tolerance so rounding never prunes a bill toBillRow would call open.
  if (q.openOnly) where.push(`ci.grand_total - COALESCE(cn.credited, 0) - (${SETTLED_SQL}) > ${PAID_TOLERANCE - 0.1}`);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ci.id, ci.bill_no, ci.invoice_date, ci.grand_total, ci.is_migrated, ci.last_sent_at,
            ${DUE_DATE_SQL} AS due_date, ${CLIENT_NAME_SQL} AS client_name, cc.cost_centre_code, cc.branch_id,
            bm.branch_name,
            s.invoice_id AS s_invoice_id, s.received AS s_received, s.tds AS s_tds, s.deduction AS s_deduction, s.banked AS s_banked,
            cips.invoice_id AS cips_invoice_id, cips.amount_received AS cips_received, cips.tds_deducted AS cips_tds,
            cips.other_deduction AS cips_deduction,
            EXISTS (SELECT 1 FROM client_receipt_allocation ra WHERE ra.invoice_id = ci.id) AS has_allocation,
            COALESCE(cn.credited, 0) AS credited
     FROM client_invoice ci
     JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
     LEFT JOIN branch_master bm ON bm.id = cc.branch_id
     LEFT JOIN (${SETTLEMENT_SQL}) s ON s.invoice_id = ci.id
     LEFT JOIN (${CREDIT_NOTE_SQL}) cn ON cn.invoice_id = ci.id
     LEFT JOIN client_invoice_payment_status cips ON cips.invoice_id = ci.id
       AND (cips.amount_received > 0 OR cips.tds_deducted > 0 OR cips.other_deduction > 0)
     WHERE ${where.join(" AND ")}
     ORDER BY ci.invoice_date, ci.bill_no`,
    params,
  );
  const bills = rows.map((r) => toBillRow(r, today));
  return q.openOnly ? bills.filter((b) => b.outstanding > 0) : bills;
}

/** Money received per month (YYYY-MM -> rupees) since `from`, by the collections rule above. */
export async function monthlyCollections(scope: AnalyticsScope, from: string): Promise<Map<string, number>> {
  const rParams: unknown[] = [from];
  const rWhere = ["r.status = 'recorded'", "r.receipt_date >= ?", "(pv.id IS NULL OR pv.status NOT IN ('rejected', 'withdrawn'))"];
  rWhere.push(...branchClause(scope, "r.branch_id", rParams));
  const sParams: unknown[] = [from];
  const sWhere = [
    "s.pay_date >= ?",
    "s.pay_date < COALESCE((SELECT MIN(r0.receipt_date) FROM client_receipt r0 WHERE r0.status = 'recorded'), '9999-12-31')",
    ownCompanyCostCentreSql("s"),
  ];
  if (scope.branchIds) {
    if (!scope.branchIds.length) sWhere.push("1 = 0");
    else {
      sWhere.push(`s.branch_name IN (SELECT b.branch_name FROM branch_master b WHERE b.id IN (${scope.branchIds.map(() => "?").join(",")}))`);
      sParams.push(...scope.branchIds);
    }
  }
  const [[receipts], [legacy]] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(r.receipt_date, '%Y-%m') AS month, SUM(r.amount_received) AS collected
       FROM client_receipt r LEFT JOIN payment_voucher pv ON pv.id = r.voucher_id
       WHERE ${rWhere.join(" AND ")} GROUP BY month`,
      rParams,
    ),
    db.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(s.pay_date, '%Y-%m') AS month, SUM(s.pay_amount) AS collected
       FROM client_bill_collection_run_snapshot s
       WHERE ${sWhere.join(" AND ")} GROUP BY month`,
      sParams,
    ),
  ]);
  const out = new Map<string, number>();
  for (const r of [...receipts, ...legacy]) {
    const m = String(r.month);
    out.set(m, Math.round(((out.get(m) ?? 0) + Number(r.collected ?? 0)) * 100) / 100);
  }
  return out;
}

/** Approved MAS bills raised per month since `from` (grand total). */
export async function monthlyInvoiced(scope: AnalyticsScope, from: string): Promise<Map<string, number>> {
  const params: unknown[] = [from];
  const where = ["ci.invoice_status = 'approved'", "ci.invoice_date >= ?", ownCompanyCostCentreSql("cc")];
  where.push(...branchClause(scope, "cc.branch_id", params));
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(ci.invoice_date, '%Y-%m') AS month, SUM(ci.grand_total) AS invoiced
     FROM client_invoice ci JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
     WHERE ${where.join(" AND ")} GROUP BY month`,
    params,
  );
  return new Map(rows.map((r) => [String(r.month), Number(r.invoiced ?? 0)]));
}

/**
 * Vendor money still owed on MAS cost centres — the Money Flow payables rule (a part-paid GRN
 * owes its balance, not its full due amount). Returns the FROM ... WHERE part; binds into `params`.
 */
export function payablesFrom(scope: AnalyticsScope, params: unknown[]): string {
  const where = ["vpt.payment_status IN ('Payment Pending', 'Partially Paid')", ownCompanyCostCentreSql("cc")];
  where.push(...branchClause(scope, "vpt.branch_id", params));
  return `FROM vendor_payment_tracking vpt
     JOIN cost_centre_master cc ON cc.id = vpt.cost_centre_id
     LEFT JOIN vendor_master vm ON vm.id = vpt.vendor_id
     WHERE ${where.join(" AND ")}`;
}

export const PAYABLE_AMOUNT_SQL = `CASE WHEN vpt.payment_status = 'Partially Paid'
  THEN COALESCE(vpt.balance_amount, vpt.due_amount - COALESCE(vpt.paid_amount, 0))
  ELSE vpt.due_amount END`;

export function branchFilter(scope: AnalyticsScope, col: string, params: unknown[]): string {
  const c = branchClause(scope, col, params);
  return c.length ? ` AND ${c.join(" AND ")}` : "";
}

const toPaise = (n: unknown) => Math.round(Number(n ?? 0) * 100);
export const sumRupees = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + toPaise(f(r)), 0) / 100;

/** YYYY-MM-DD of a local date. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The same day `monthsBack` months before `today` (DATE_SUB(CURDATE(), INTERVAL n MONTH)). */
export function monthsAgo(today: string, monthsBack: number): string {
  const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)));
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.toISOString().slice(0, 10);
}
