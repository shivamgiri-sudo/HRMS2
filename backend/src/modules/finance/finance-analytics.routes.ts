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
    // 1. Total receivables — only invoices NOT fully paid
    let totalReceivables = 0;
    let overdueAmount = 0;
    let overdueCount = 0;
    let dso = 0;
    try {
      const [receivableRows] = await db.query<any[]>(
        `SELECT
           SUM(ci.grand_total) AS total_receivables,
           SUM(CASE WHEN DATEDIFF(CURDATE(), ci.invoice_date) > 30
                    AND (cips.payment_status IS NULL OR cips.payment_status != 'paid')
                    THEN ci.grand_total ELSE 0 END) AS overdue_amount,
           SUM(CASE WHEN DATEDIFF(CURDATE(), ci.invoice_date) > 30
                    AND (cips.payment_status IS NULL OR cips.payment_status != 'paid')
                    THEN 1 ELSE 0 END) AS overdue_count
         FROM client_invoice ci
         LEFT JOIN client_invoice_payment_status cips ON cips.invoice_id = ci.id
         WHERE ci.invoice_status = 'approved'
           AND (cips.payment_status IS NULL OR cips.payment_status != 'paid')`,
      );
      if (receivableRows.length > 0) {
        totalReceivables = num(receivableRows[0].total_receivables);
        overdueAmount = num(receivableRows[0].overdue_amount);
        overdueCount = num(receivableRows[0].overdue_count);
      }

      // DSO = (open AR / avg monthly collected over 12 months) * 30
      const [collectedRows] = await db.query<any[]>(
        `SELECT SUM(pay_amount) / 12 AS avg_monthly_collected
         FROM client_bill_collection_run_snapshot
         WHERE pay_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)`,
      );
      const avgMonthly = num(collectedRows?.[0]?.avg_monthly_collected);
      if (avgMonthly > 0) {
        dso = Math.round((totalReceivables / avgMonthly) * 30 * 10) / 10;
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
         LEFT JOIN client_invoice_payment_status cips ON cips.invoice_id = ci.id
         WHERE ci.invoice_status = 'approved'
           AND ci.invoice_date >= DATE_SUB(CURDATE(), INTERVAL 3 YEAR)
           AND (cips.payment_status IS NULL OR cips.payment_status != 'paid')
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
          monthMap.set(m, {
            month: m,
            invoiced: num(r.invoiced),
            collected: 0,
            gap: 0,
          });
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
          monthMap.set(m, {
            month: m,
            invoiced: 0,
            collected: num(r.collected),
            gap: 0,
          });
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
           DATE_ADD(ci.invoice_date, INTERVAL 30 DAY) AS due_date,
           SUM(ci.grand_total) AS amount
         FROM client_invoice ci
         LEFT JOIN client_invoice_payment_status cips ON cips.invoice_id = ci.id
         WHERE ci.invoice_status = 'approved'
           AND ci.invoice_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
           AND DATE_ADD(ci.invoice_date, INTERVAL 30 DAY) >= ?
           AND DATE_ADD(ci.invoice_date, INTERVAL 30 DAY) < ?
           AND (cips.payment_status IS NULL OR cips.payment_status != 'paid')
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

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/expense-trends?financialYear=2026-27
// ---------------------------------------------------------------------------
financeAnalyticsRouter.get(
  "/expense-trends",
  h(async (req, res) => {
    const fy = (req.query.financialYear as string) || "2026-27";
    const [yearParts] = fy.split("-");
    const fyStart = `${yearParts}-04-01`;
    const fyEnd = `${parseInt(yearParts) + 1}-03-31`;

    let kpis = { total_spend: 0, pending_payments: 0, avg_approval_days: 0 };
    let monthly: any[] = [];
    let topVendors: any[] = [];

    try {
      const [kpiRows] = await db.query<any[]>(
        `SELECT
           SUM(gr.amount_with_tax) AS total_spend,
           SUM(CASE WHEN vpt.payment_status IN ('Payment Pending','Partially Paid') THEN vpt.due_amount ELSE 0 END) AS pending_payments,
           AVG(DATEDIFF(gr.approved_at, gr.submitted_at)) AS avg_approval_days
         FROM grn_request gr
         LEFT JOIN vendor_payment_tracking vpt ON vpt.grn_request_id = gr.id
         WHERE gr.status = 'approved'
           AND gr.bill_date BETWEEN ? AND ?`,
        [fyStart, fyEnd],
      );
      if (kpiRows.length > 0) {
        kpis = {
          total_spend: num(kpiRows[0].total_spend),
          pending_payments: num(kpiRows[0].pending_payments),
          avg_approval_days:
            Math.round(num(kpiRows[0].avg_approval_days) * 10) / 10,
        };
      }
    } catch {
      /* fallback */
    }

    try {
      const [monthRows] = await db.query<any[]>(
        `SELECT
           DATE_FORMAT(gr.bill_date, '%Y-%m') AS month,
           gr.head AS expense_head,
           SUM(gr.amount_with_tax) AS amount
         FROM grn_request gr
         WHERE gr.status = 'approved'
           AND gr.bill_date BETWEEN ? AND ?
           AND gr.head IS NOT NULL
         GROUP BY month, gr.head
         ORDER BY month ASC`,
        [fyStart, fyEnd],
      );
      // Pivot: month -> { month (string), [head]: number }
      const monthMap = new Map<string, Record<string, number | string>>();
      const headSet = new Set<string>();
      for (const r of monthRows) {
        const m = String(r.month);
        const h2 = String(r.expense_head);
        headSet.add(h2);
        if (!monthMap.has(m)) monthMap.set(m, { month: m });
        const entry = monthMap.get(m)!;
        entry[h2] = ((entry[h2] as number) || 0) + num(r.amount);
      }
      // Keep only top 6 heads by total
      const headTotals: Record<string, number> = {};
      for (const row of monthRows) {
        const h2 = String(row.expense_head);
        headTotals[h2] = (headTotals[h2] || 0) + num(row.amount);
      }
      const topHeads = Object.entries(headTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k]) => k);
      monthly = Array.from(monthMap.values()).sort((a, b) =>
        String(a.month).localeCompare(String(b.month)),
      );
      res.json({
        success: true,
        data: { kpis, monthly, topHeads, topVendors },
      });
      return;
    } catch {
      /* fallback */
    }

    try {
      const [vendorRows] = await db.query<any[]>(
        `SELECT
           COALESCE(v.vendor_name, gr.vendor_id) AS vendor_name,
           SUM(gr.amount_with_tax) AS total_spend,
           COUNT(*) AS grn_count
         FROM grn_request gr
         LEFT JOIN vendor_master v ON v.id = gr.vendor_id
         WHERE gr.status = 'approved'
           AND gr.bill_date BETWEEN ? AND ?
         GROUP BY gr.vendor_id, v.vendor_name
         ORDER BY total_spend DESC
         LIMIT 15`,
        [fyStart, fyEnd],
      );
      topVendors = vendorRows.map((r) => ({
        vendor_name: String(r.vendor_name ?? "Unknown"),
        total_spend: num(r.total_spend),
        grn_count: num(r.grn_count),
      }));
    } catch {
      /* fallback */
    }

    res.json({
      success: true,
      data: { kpis, monthly: [], topHeads: [], topVendors },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/revenue-collections?months=12
// ---------------------------------------------------------------------------
financeAnalyticsRouter.get(
  "/revenue-collections",
  h(async (req, res) => {
    const months = Math.min(
      24,
      Math.max(1, parseInt(String(req.query.months || "12"))),
    );

    let trend: any[] = [];
    let clientBreakdown: any[] = [];
    let paymentStatusSummary: any[] = [];

    try {
      const monthMap = new Map<
        string,
        { month: string; invoiced: number; collected: number }
      >();
      const [invRows] = await db.query<any[]>(
        `SELECT DATE_FORMAT(invoice_date, '%Y-%m') AS month, SUM(grand_total) AS invoiced
         FROM client_invoice
         WHERE invoice_status = 'approved'
           AND invoice_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
         GROUP BY month ORDER BY month`,
        [months],
      );
      for (const r of invRows) {
        const m = String(r.month);
        monthMap.set(m, { month: m, invoiced: num(r.invoiced), collected: 0 });
      }
      const [colRows] = await db.query<any[]>(
        `SELECT DATE_FORMAT(pay_date, '%Y-%m') AS month, SUM(pay_amount) AS collected
         FROM client_bill_collection_run_snapshot
         WHERE pay_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
         GROUP BY month ORDER BY month`,
        [months],
      );
      for (const r of colRows) {
        const m = String(r.month);
        const existing = monthMap.get(m);
        if (existing) existing.collected = num(r.collected);
        else
          monthMap.set(m, {
            month: m,
            invoiced: 0,
            collected: num(r.collected),
          });
      }
      trend = Array.from(monthMap.values()).sort((a, b) =>
        a.month.localeCompare(b.month),
      );
    } catch {
      /* fallback */
    }

    try {
      const [cbRows] = await db.query<any[]>(
        `SELECT
           COALESCE(ccm.company_name, ci.cost_centre_id) AS client_name,
           SUM(ci.grand_total) AS invoiced
         FROM client_invoice ci
         LEFT JOIN cost_centre_master ccm ON ci.cost_centre_id = ccm.id
         WHERE ci.invoice_status = 'approved'
           AND ci.invoice_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
         GROUP BY ci.cost_centre_id, ccm.company_name
         ORDER BY invoiced DESC
         LIMIT 5`,
      );
      clientBreakdown = cbRows.map((r) => ({
        client_name: String(r.client_name ?? "Unknown"),
        invoiced: num(r.invoiced),
      }));
    } catch {
      /* fallback */
    }

    try {
      const [psRows] = await db.query<any[]>(
        `SELECT payment_status, COUNT(*) AS cnt, SUM(total_amount) AS amount
         FROM client_invoice_payment_status
         GROUP BY payment_status`,
      );
      paymentStatusSummary = psRows.map((r) => ({
        status: String(r.payment_status),
        count: num(r.cnt),
        amount: num(r.amount),
      }));
    } catch {
      /* fallback */
    }

    res.json({
      success: true,
      data: { trend, clientBreakdown, paymentStatusSummary },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/payables-aging
// ---------------------------------------------------------------------------
financeAnalyticsRouter.get(
  "/payables-aging",
  h(async (_req, res) => {
    let buckets = { b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0, total: 0 };
    let topVendors: any[] = [];

    try {
      const [rows] = await db.query<any[]>(
        `SELECT
           SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(due_date, created_at)) <= 30 THEN due_amount ELSE 0 END) AS b0_30,
           SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(due_date, created_at)) BETWEEN 31 AND 60 THEN due_amount ELSE 0 END) AS b31_60,
           SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(due_date, created_at)) BETWEEN 61 AND 90 THEN due_amount ELSE 0 END) AS b61_90,
           SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(due_date, created_at)) > 90 THEN due_amount ELSE 0 END) AS b90_plus,
           SUM(due_amount) AS total
         FROM vendor_payment_tracking
         WHERE payment_status IN ('Payment Pending', 'Partially Paid')`,
      );
      if (rows.length > 0) {
        buckets = {
          b0_30: num(rows[0].b0_30),
          b31_60: num(rows[0].b31_60),
          b61_90: num(rows[0].b61_90),
          b90_plus: num(rows[0].b90_plus),
          total: num(rows[0].total),
        };
      }
    } catch {
      /* fallback */
    }

    try {
      const [vRows] = await db.query<any[]>(
        `SELECT
           COALESCE(vm.vendor_name, vpt.vendor_id) AS vendor_name,
           SUM(vpt.due_amount) AS pending_amount,
           MIN(vpt.due_date) AS oldest_due
         FROM vendor_payment_tracking vpt
         LEFT JOIN vendor_master vm ON vm.id = vpt.vendor_id
         WHERE vpt.payment_status IN ('Payment Pending', 'Partially Paid')
         GROUP BY vpt.vendor_id, vm.vendor_name
         ORDER BY pending_amount DESC
         LIMIT 10`,
      );
      topVendors = vRows.map((r) => ({
        vendor_name: String(r.vendor_name ?? "Unknown"),
        pending_amount: num(r.pending_amount),
        oldest_due: r.oldest_due ? String(r.oldest_due).slice(0, 10) : null,
      }));
    } catch {
      /* fallback */
    }

    res.json({ success: true, data: { buckets, topVendors } });
  }),
);
