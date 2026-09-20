import { Router } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";

/**
 * Finance Analytics API — read-only analytical endpoints consumed by the analytics dashboard.
 *
 * Columns discovered via DESCRIBE (2026-09-20):
 *  - client_invoice: grand_total, invoice_date, cost_centre_id, invoice_status, is_migrated, legacy_id
 *  - cost_centre_master: id, company_name (used as client name for AR aging)
 *  - vendor_payment_tracking: due_amount (NOT net_payable), payment_status values:
 *      'Payment Pending' | 'Partially Paid' | 'Paid' | 'On Hold' | 'Rejected' | 'Closed'
 *  - client_bill_collection_run_snapshot: pay_date, pay_amount (used for collection trend)
 *  - company_bank_account: id, account_name, opening_balance, active_status
 *  - bank_account_ledger_entry: id, bank_account_id, running_balance
 */

const ANALYTICS_ROLES = [
  "finance_head",
  "accounts_head",
  "ceo",
  "super_admin",
  "admin",
] as const;

export const financeAnalyticsRouter = Router();

financeAnalyticsRouter.use(requireAuth);
financeAnalyticsRouter.use(requireRole(...ANALYTICS_ROLES));

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

// ---------------------------------------------------------------------------
// Helper: safe numeric — converts MySQL decimal strings / null to number
// ---------------------------------------------------------------------------
function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/snapshot
// ---------------------------------------------------------------------------
financeAnalyticsRouter.get(
  "/snapshot",
  h(async (_req, res) => {
    // 1. Total receivables — sum of all approved invoice grand_total
    let totalReceivables = 0;
    let overdueAmount = 0;
    let overdueCount = 0;
    let dso = 0;
    try {
      const [receivableRows] = await db.query<any[]>(
        `SELECT
           SUM(grand_total) AS total_receivables,
           SUM(CASE WHEN DATEDIFF(CURDATE(), invoice_date) > 30 THEN grand_total ELSE 0 END) AS overdue_amount,
           SUM(CASE WHEN DATEDIFF(CURDATE(), invoice_date) > 30 THEN 1 ELSE 0 END) AS overdue_count
         FROM client_invoice
         WHERE invoice_status = 'approved'`,
      );
      if (receivableRows.length > 0) {
        totalReceivables = num(receivableRows[0].total_receivables);
        overdueAmount = num(receivableRows[0].overdue_amount);
        overdueCount = num(receivableRows[0].overdue_count);
      }

      // DSO = (open AR / last-30-day collected) * 30
      const [collectedRows] = await db.query<any[]>(
        `SELECT SUM(pay_amount) AS collected_30d
         FROM client_bill_collection_run_snapshot
         WHERE pay_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
      );
      const collected30d = num(collectedRows?.[0]?.collected_30d);
      if (collected30d > 0) {
        dso = Math.round((totalReceivables / collected30d) * 30 * 10) / 10;
      }
    } catch {
      // fallback: leave 0s
    }

    // 2. Bank balances — last running_balance per account (or opening_balance if no entries)
    let bankBalances: { id: string; name: string; balance: number }[] = [];
    try {
      const [bankRows] = await db.query<any[]>(
        `SELECT
           cba.id,
           cba.account_name AS name,
           COALESCE(last_entry.running_balance, cba.opening_balance) AS balance
         FROM company_bank_account cba
         LEFT JOIN (
           SELECT bank_account_id, MAX(id) AS last_id
           FROM bank_account_ledger_entry
           GROUP BY bank_account_id
         ) latest ON cba.id = latest.bank_account_id
         LEFT JOIN bank_account_ledger_entry last_entry ON last_entry.id = latest.last_id
         WHERE cba.active_status = 1
         ORDER BY cba.account_name`,
      );
      bankBalances = (bankRows ?? []).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        balance: num(r.balance),
      }));
    } catch {
      // fallback: empty array
    }

    // 3. Total payables — vendor_payment_tracking pending/partial
    //    Actual status values: 'Payment Pending', 'Partially Paid'
    let totalPayables = 0;
    try {
      const [payableRows] = await db.query<any[]>(
        `SELECT SUM(due_amount) AS total_payables
         FROM vendor_payment_tracking
         WHERE payment_status IN ('Payment Pending', 'Partially Paid')`,
      );
      totalPayables = num(payableRows?.[0]?.total_payables);
    } catch {
      // fallback: 0
    }

    res.json({
      success: true,
      data: {
        total_receivables: totalReceivables,
        overdue_amount: overdueAmount,
        overdue_count: overdueCount,
        dso,
        bank_balances: bankBalances,
        total_payables: totalPayables,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/ar-aging
// ---------------------------------------------------------------------------
financeAnalyticsRouter.get(
  "/ar-aging",
  h(async (_req, res) => {
    interface AgingRow {
      client_name: string;
      current: number;
      d30: number;
      d60: number;
      d90_plus: number;
      total: number;
    }

    let rows: AgingRow[] = [];
    const totals = { current: 0, d30: 0, d60: 0, d90_plus: 0, total: 0 };

    try {
      const [agingRows] = await db.query<any[]>(
        `SELECT
           COALESCE(ccm.company_name, ci.cost_centre_id) AS client_name,
           SUM(CASE WHEN DATEDIFF(CURDATE(), ci.invoice_date) <= 30 THEN ci.grand_total ELSE 0 END) AS current_bucket,
           SUM(CASE WHEN DATEDIFF(CURDATE(), ci.invoice_date) BETWEEN 31 AND 60 THEN ci.grand_total ELSE 0 END) AS d30,
           SUM(CASE WHEN DATEDIFF(CURDATE(), ci.invoice_date) BETWEEN 61 AND 90 THEN ci.grand_total ELSE 0 END) AS d60,
           SUM(CASE WHEN DATEDIFF(CURDATE(), ci.invoice_date) > 90 THEN ci.grand_total ELSE 0 END) AS d90_plus,
           SUM(ci.grand_total) AS total
         FROM client_invoice ci
         LEFT JOIN cost_centre_master ccm ON ci.cost_centre_id = ccm.id
         WHERE ci.invoice_status = 'approved'
         GROUP BY ci.cost_centre_id, ccm.company_name
         ORDER BY total DESC
         LIMIT 15`,
      );

      rows = (agingRows ?? []).map((r) => ({
        client_name: String(r.client_name ?? "Unknown"),
        current: num(r.current_bucket),
        d30: num(r.d30),
        d60: num(r.d60),
        d90_plus: num(r.d90_plus),
        total: num(r.total),
      }));

      for (const row of rows) {
        totals.current += row.current;
        totals.d30 += row.d30;
        totals.d60 += row.d60;
        totals.d90_plus += row.d90_plus;
        totals.total += row.total;
      }
    } catch {
      // fallback: empty
    }

    res.json({ success: true, data: { rows, totals } });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/collection-trend
// ---------------------------------------------------------------------------
financeAnalyticsRouter.get(
  "/collection-trend",
  h(async (_req, res) => {
    interface MonthEntry {
      month: string;
      invoiced: number;
      collected: number;
      gap: number;
    }

    const monthMap = new Map<string, MonthEntry>();

    // Invoiced by month
    try {
      const [invoicedRows] = await db.query<any[]>(
        `SELECT
           DATE_FORMAT(invoice_date, '%Y-%m') AS month,
           SUM(grand_total) AS invoiced
         FROM client_invoice
         WHERE invoice_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
           AND invoice_status = 'approved'
         GROUP BY month
         ORDER BY month ASC`,
      );
      for (const r of invoicedRows ?? []) {
        const m = String(r.month);
        const existing = monthMap.get(m);
        if (existing) {
          existing.invoiced += num(r.invoiced);
        } else {
          monthMap.set(m, { month: m, invoiced: num(r.invoiced), collected: 0, gap: 0 });
        }
      }
    } catch {
      // fallback: skip
    }

    // Collected by month (from collection run snapshots)
    try {
      const [collectedRows] = await db.query<any[]>(
        `SELECT
           DATE_FORMAT(pay_date, '%Y-%m') AS month,
           SUM(pay_amount) AS collected
         FROM client_bill_collection_run_snapshot
         WHERE pay_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
         GROUP BY month
         ORDER BY month ASC`,
      );
      for (const r of collectedRows ?? []) {
        const m = String(r.month);
        const existing = monthMap.get(m);
        if (existing) {
          existing.collected += num(r.collected);
        } else {
          monthMap.set(m, { month: m, invoiced: 0, collected: num(r.collected), gap: 0 });
        }
      }
    } catch {
      // fallback: skip
    }

    // Compute gap and sort
    const months: MonthEntry[] = Array.from(monthMap.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((entry) => ({ ...entry, gap: entry.invoiced - entry.collected }));

    res.json({ success: true, data: { months } });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/cash-flow-forecast
// ---------------------------------------------------------------------------
financeAnalyticsRouter.get(
  "/cash-flow-forecast",
  h(async (_req, res) => {
    interface WeekBucket {
      week_start: string;
      expected_in: number;
      expected_out: number;
      net: number;
      cumulative: number;
    }

    // Build 14 weekly buckets starting from the Monday of the current week
    function getWeekStart(offsetWeeks: number): Date {
      const now = new Date();
      const day = now.getDay(); // 0=Sun, 1=Mon...
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMonday + offsetWeeks * 7);
      monday.setHours(0, 0, 0, 0);
      return monday;
    }

    function toISODate(d: Date): string {
      return d.toISOString().slice(0, 10);
    }

    const weekBuckets: WeekBucket[] = Array.from({ length: 14 }, (_, i) => ({
      week_start: toISODate(getWeekStart(i)),
      expected_in: 0,
      expected_out: 0,
      net: 0,
      cumulative: 0,
    }));

    // expected_in: invoices whose due date (invoice_date + 30 days) falls in each week
    try {
      const [inRows] = await db.query<any[]>(
        `SELECT
           DATE_ADD(invoice_date, INTERVAL 30 DAY) AS due_date,
           SUM(grand_total) AS amount
         FROM client_invoice
         WHERE invoice_status = 'approved'
           AND DATE_ADD(invoice_date, INTERVAL 30 DAY) >= ?
           AND DATE_ADD(invoice_date, INTERVAL 30 DAY) < ?
         GROUP BY due_date`,
        [toISODate(getWeekStart(0)), toISODate(getWeekStart(14))],
      );
      for (const r of inRows ?? []) {
        const dueDate = new Date(r.due_date);
        for (let i = 0; i < 14; i++) {
          const ws = getWeekStart(i);
          const we = getWeekStart(i + 1);
          if (dueDate >= ws && dueDate < we) {
            weekBuckets[i].expected_in += num(r.amount);
            break;
          }
        }
      }
    } catch {
      // fallback: leave 0
    }

    // expected_out: vendor payments pending/partial due in each week
    //   vendor_payment_tracking has a due_date column
    try {
      const [outRows] = await db.query<any[]>(
        `SELECT
           due_date,
           SUM(due_amount) AS amount
         FROM vendor_payment_tracking
         WHERE payment_status IN ('Payment Pending', 'Partially Paid')
           AND due_date >= ?
           AND due_date < ?
         GROUP BY due_date`,
        [toISODate(getWeekStart(0)), toISODate(getWeekStart(14))],
      );
      for (const r of outRows ?? []) {
        if (!r.due_date) continue;
        const dueDate = new Date(r.due_date);
        for (let i = 0; i < 14; i++) {
          const ws = getWeekStart(i);
          const we = getWeekStart(i + 1);
          if (dueDate >= ws && dueDate < we) {
            weekBuckets[i].expected_out += num(r.amount);
            break;
          }
        }
      }
    } catch {
      // fallback: leave 0
    }

    // Compute net and cumulative
    let cumulative = 0;
    for (const bucket of weekBuckets) {
      bucket.net = bucket.expected_in - bucket.expected_out;
      cumulative += bucket.net;
      bucket.cumulative = cumulative;
    }

    res.json({ success: true, data: { weeks: weekBuckets } });
  }),
);
