import { Router } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { loadBranchPolicy } from "../../shared/branchDecisionScope.js";
import { MONEY_FLOW_ROLES } from "./money-flow.routes.js";
import {
  PAYABLE_AMOUNT_SQL, branchFilter, isoDay, loadBills, monthlyCollections, monthlyInvoiced, monthsAgo,
  payablesFrom, sumRupees, type AnalyticsScope,
} from "./finance-analytics-receivables.js";
import type { BillRow } from "./money-flow.service.js";

/**
 * Finance Analytics API — read-only analytical endpoints consumed by the analytics dashboard.
 *
 * Receivables (snapshot AR / overdue / DSO, ar-aging, collection-trend, cash-flow-forecast
 * expected-in, revenue-collections) follow the Money Flow rules exactly; see
 * finance-analytics-receivables.ts for the rule and the collections (no double count) rule.
 *
 * Access: the Money Flow roles (MONEY_FLOW_ROLES). Anyone not org-wide (isOrgWideUser) sees only
 * their own branch; company bank balances are shown to org-wide users only.
 *
 * Responses keep their original fields and also carry the names FinanceAnalyticsPage reads
 * (dso_days, bank_balance, days_* ageing keys, month_label, week_label).
 */

export const financeAnalyticsRouter = Router();

financeAnalyticsRouter.use(requireAuth);
financeAnalyticsRouter.use(requireRole(...MONEY_FLOW_ROLES));

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/** Branch scope of the caller: null for org-wide, else the own branch ([] when unknown — fail closed). */
async function scopeOf(req: AuthenticatedRequest): Promise<AnalyticsScope> {
  const userId = req.authUser?.id;
  if (!userId) return { branchIds: [] };
  const policy = await loadBranchPolicy(userId);
  return { branchIds: policy.orgWide ? null : policy.ownBranchId ? [policy.ownBranchId] : [] };
}

const today = () => isoDay(new Date());
const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)} ${m.slice(2, 4)}`;

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/snapshot
// ---------------------------------------------------------------------------
financeAnalyticsRouter.get(
  "/snapshot",
  h(async (req, res) => {
    const scope = await scopeOf(req);
    const asOf = today();
    let totalReceivables = 0;
    let overdueAmount = 0;
    let overdueCount = 0;
    let dso = 0;
    // Independent blocks run together; each degrades alone to its zero/empty fallback.
    const receivablesBlock = (async () => {
      try {
        const collectedPromise = monthlyCollections(scope, monthsAgo(asOf, 12));
        collectedPromise.catch(() => undefined);
        const open = await loadBills(scope, asOf, { openOnly: true });
        const overdue = open.filter((b) => b.daysOverdue > 0);
        totalReceivables = sumRupees(open, (b) => b.outstanding);
        overdueAmount = sumRupees(overdue, (b) => b.outstanding);
        overdueCount = overdue.length;
        // DSO = open AR / average monthly collection over 12 months * 30.
        const collected = await collectedPromise;
        const avgMonthly = [...collected.values()].reduce((s, v) => s + v, 0) / 12;
        if (avgMonthly > 0) dso = Math.round((totalReceivables / avgMonthly) * 30 * 10) / 10;
      } catch {
        // fallback: leave 0s
      }
    })();

    let bankBalances: { id: string; name: string; balance: number }[] = [];
    const bankBlock = (async () => {
      // Company bank balances are not a branch figure.
      if (scope.branchIds) return;
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
        bankBalances = (bankRows ?? []).map((r) => ({ id: String(r.id), name: String(r.name), balance: num(r.balance) }));
      } catch {
        // fallback: empty array
      }
    })();

    let totalPayables = 0;
    const payablesBlock = (async () => {
      try {
        const params: unknown[] = [];
        const from = payablesFrom(scope, params);
        const [payableRows] = await db.query<any[]>(`SELECT SUM(${PAYABLE_AMOUNT_SQL}) AS total_payables ${from}`, params);
        totalPayables = num(payableRows?.[0]?.total_payables);
      } catch {
        // fallback: 0
      }
    })();

    await Promise.all([receivablesBlock, bankBlock, payablesBlock]);

    res.json({
      success: true,
      data: {
        total_receivables: totalReceivables,
        overdue_amount: overdueAmount,
        overdue_count: overdueCount,
        dso,
        dso_days: dso,
        bank_balances: bankBalances,
        bank_balance: r2(bankBalances.reduce((s, b) => s + b.balance, 0)),
        total_payables: totalPayables,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/ar-aging — by client, days past the due date
// ---------------------------------------------------------------------------
type AgingKey = "current" | "days_1_30" | "days_31_60" | "days_61_90" | "days_90_plus";
const AGING_OF: Record<NonNullable<BillRow["ageBucket"]>, AgingKey> = {
  not_due: "current", d0_30: "days_1_30", d31_60: "days_31_60", d61_90: "days_61_90", d90_plus: "days_90_plus",
};

financeAnalyticsRouter.get(
  "/ar-aging",
  h(async (req, res) => {
    const scope = await scopeOf(req);
    type Acc = Record<AgingKey, number> & { total: number };
    const blank = (): Acc => ({ current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0, total: 0 });
    // Original keys kept: d30 = 31-60, d60 = 61-90, d90_plus = 90+ days past due.
    const shape = (a: Acc) => ({
      current: r2(a.current), days_1_30: r2(a.days_1_30), days_31_60: r2(a.days_31_60),
      days_61_90: r2(a.days_61_90), days_90_plus: r2(a.days_90_plus),
      d30: r2(a.days_31_60), d60: r2(a.days_61_90), d90_plus: r2(a.days_90_plus), total: r2(a.total),
    });
    let rows: Array<{ client_name: string } & ReturnType<typeof shape>> = [];
    const totals = blank();
    try {
      const open = await loadBills(scope, today(), { openOnly: true });
      const byClient = new Map<string, Acc>();
      for (const b of open) {
        const key = AGING_OF[b.ageBucket ?? "not_due"];
        const a = byClient.get(b.client) ?? blank();
        a[key] += b.outstanding;
        a.total += b.outstanding;
        totals[key] += b.outstanding;
        totals.total += b.outstanding;
        byClient.set(b.client, a);
      }
      rows = [...byClient]
        .sort((x, y) => y[1].total - x[1].total)
        .slice(0, 15)
        .map(([client, a]) => ({ client_name: client || "Unknown", ...shape(a) }));
    } catch {
      // fallback: empty
    }
    res.json({ success: true, data: { rows, totals: shape(totals) } });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/collection-trend — billed vs collected, last 12 months
// ---------------------------------------------------------------------------
financeAnalyticsRouter.get(
  "/collection-trend",
  h(async (req, res) => {
    const scope = await scopeOf(req);
    const from = monthsAgo(today(), 12);
    const [inv, col] = await Promise.allSettled([monthlyInvoiced(scope, from), monthlyCollections(scope, from)]);
    const invoiced = inv.status === "fulfilled" ? inv.value : new Map<string, number>();
    const collected = col.status === "fulfilled" ? col.value : new Map<string, number>();
    const months = [...new Set([...invoiced.keys(), ...collected.keys()])].sort().map((m) => {
      const i = r2(invoiced.get(m) ?? 0);
      const c = r2(collected.get(m) ?? 0);
      return { month: m, month_label: monthLabel(m), invoiced: i, collected: c, gap: r2(i - c) };
    });
    res.json({ success: true, data: { months } });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/cash-flow-forecast — 14 weeks from this Monday
// ---------------------------------------------------------------------------
financeAnalyticsRouter.get(
  "/cash-flow-forecast",
  h(async (req, res) => {
    const scope = await scopeOf(req);
    function weekStart(offsetWeeks: number): string {
      const now = new Date();
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day) + offsetWeeks * 7);
      return isoDay(monday);
    }
    const starts = Array.from({ length: 15 }, (_, i) => weekStart(i));
    const weeks = starts.slice(0, 14).map((ws) => ({
      week_start: ws, week_label: `${ws.slice(8, 10)} ${MONTH_NAMES[Number(ws.slice(5, 7)) - 1]}`,
      expected_in: 0, expected_out: 0, net: 0, cumulative: 0,
    }));
    const place = (date: string | null, amount: number, key: "expected_in" | "expected_out") => {
      if (!date) return;
      for (let i = 0; i < 14; i++) {
        if (date >= starts[i] && date < starts[i + 1]) { weeks[i][key] = r2(weeks[i][key] + amount); return; }
      }
    };

    const outParams: unknown[] = [];
    const outFrom = payablesFrom(scope, outParams);
    const [inRes, outRes] = await Promise.allSettled([
      // expected_in: what is still owed on open bills, in the week of each bill's due date.
      loadBills(scope, today(), { openOnly: true }),
      db.query<any[]>(
        `SELECT vpt.due_date, SUM(${PAYABLE_AMOUNT_SQL}) AS amount ${outFrom}
           AND vpt.due_date >= ? AND vpt.due_date < ?
         GROUP BY vpt.due_date`,
        [...outParams, starts[0], starts[14]],
      ),
    ]);
    if (inRes.status === "fulfilled") for (const b of inRes.value) place(b.dueDate, b.outstanding, "expected_in");
    if (outRes.status === "fulfilled") {
      for (const r of outRes.value[0] ?? []) {
        const d = r.due_date instanceof Date ? isoDay(r.due_date) : r.due_date ? String(r.due_date).slice(0, 10) : null;
        place(d, num(r.amount), "expected_out");
      }
    }
    let cumulative = 0;
    for (const w of weeks) {
      w.net = r2(w.expected_in - w.expected_out);
      cumulative = r2(cumulative + w.net);
      w.cumulative = cumulative;
    }
    res.json({ success: true, data: { weeks } });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/expense-trends?financialYear=2026-27
// ---------------------------------------------------------------------------
financeAnalyticsRouter.get(
  "/expense-trends",
  h(async (req, res) => {
    const scope = await scopeOf(req);
    const fy = (req.query.financialYear as string) || "2026-27";
    const [yearParts] = fy.split("-");
    const fyStart = `${yearParts}-04-01`;
    const fyEnd = `${parseInt(yearParts) + 1}-03-31`;

    let kpis = { total_spend: 0, pending_payments: 0, avg_approval_days: 0 };
    let topVendors: any[] = [];

    const mParams: unknown[] = [fyStart, fyEnd];
    const mScope = branchFilter(scope, "gr.branch_id", mParams);
    const monthQuery = db.query<any[]>(
      `SELECT
         DATE_FORMAT(gr.bill_date, '%Y-%m') AS month,
         gr.head AS expense_head,
         SUM(gr.amount_with_tax) AS amount
       FROM grn_request gr
       WHERE gr.status = 'approved'
         AND gr.bill_date BETWEEN ? AND ?
         AND gr.head IS NOT NULL${mScope}
       GROUP BY month, gr.head
       ORDER BY month ASC`,
      mParams,
    );
    monthQuery.catch(() => undefined);

    try {
      const kParams: unknown[] = [fyStart, fyEnd];
      const kScope = branchFilter(scope, "gr.branch_id", kParams);
      const [kpiRows] = await db.query<any[]>(
        `SELECT
           SUM(gr.amount_with_tax) AS total_spend,
           SUM(CASE WHEN vpt.payment_status IN ('Payment Pending','Partially Paid') THEN vpt.due_amount ELSE 0 END) AS pending_payments,
           AVG(DATEDIFF(gr.approved_at, gr.submitted_at)) AS avg_approval_days
         FROM grn_request gr
         LEFT JOIN vendor_payment_tracking vpt ON vpt.grn_request_id = gr.id
         WHERE gr.status = 'approved'
           AND gr.bill_date BETWEEN ? AND ?${kScope}`,
        kParams,
      );
      if (kpiRows.length > 0) {
        kpis = {
          total_spend: num(kpiRows[0].total_spend),
          pending_payments: num(kpiRows[0].pending_payments),
          avg_approval_days: Math.round(num(kpiRows[0].avg_approval_days) * 10) / 10,
        };
      }
    } catch {
      /* fallback */
    }

    try {
      const [monthRows] = await monthQuery;
      const monthMap = new Map<string, Record<string, number | string>>();
      const headTotals: Record<string, number> = {};
      for (const r of monthRows) {
        const m = String(r.month);
        const h2 = String(r.expense_head);
        if (!monthMap.has(m)) monthMap.set(m, { month: m });
        const entry = monthMap.get(m)!;
        entry[h2] = ((entry[h2] as number) || 0) + num(r.amount);
        headTotals[h2] = (headTotals[h2] || 0) + num(r.amount);
      }
      const topHeads = Object.entries(headTotals).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
      const monthly = Array.from(monthMap.values()).sort((a, b) => String(a.month).localeCompare(String(b.month)));
      res.json({ success: true, data: { kpis, monthly, topHeads, topVendors } });
      return;
    } catch {
      /* fallback */
    }

    try {
      const vParams: unknown[] = [fyStart, fyEnd];
      const vScope = branchFilter(scope, "gr.branch_id", vParams);
      const [vendorRows] = await db.query<any[]>(
        `SELECT
           COALESCE(v.vendor_name, gr.vendor_id) AS vendor_name,
           SUM(gr.amount_with_tax) AS total_spend,
           COUNT(*) AS grn_count
         FROM grn_request gr
         LEFT JOIN vendor_master v ON v.id = gr.vendor_id
         WHERE gr.status = 'approved'
           AND gr.bill_date BETWEEN ? AND ?${vScope}
         GROUP BY gr.vendor_id, v.vendor_name
         ORDER BY total_spend DESC
         LIMIT 15`,
        vParams,
      );
      topVendors = vendorRows.map((r) => ({
        vendor_name: String(r.vendor_name ?? "Unknown"),
        total_spend: num(r.total_spend),
        grn_count: num(r.grn_count),
      }));
    } catch {
      /* fallback */
    }

    res.json({ success: true, data: { kpis, monthly: [], topHeads: [], topVendors } });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/revenue-collections?months=12
// ---------------------------------------------------------------------------
financeAnalyticsRouter.get(
  "/revenue-collections",
  h(async (req, res) => {
    const scope = await scopeOf(req);
    const months = Math.min(24, Math.max(1, parseInt(String(req.query.months || "12")) || 12));
    const asOf = today();
    const from = monthsAgo(asOf, months);

    const [inv, col, bills] = await Promise.allSettled([
      monthlyInvoiced(scope, from),
      monthlyCollections(scope, from),
      // Bills raised in the window, for the client split and the payment status split.
      loadBills(scope, asOf, { from }),
    ]);

    let trend: { month: string; month_label: string; invoiced: number; collected: number }[] = [];
    if (inv.status === "fulfilled") {
      const collected = col.status === "fulfilled" ? col.value : new Map<string, number>();
      trend = [...new Set([...inv.value.keys(), ...collected.keys()])].sort().map((m) => ({
        month: m, month_label: monthLabel(m), invoiced: r2(inv.value.get(m) ?? 0), collected: r2(collected.get(m) ?? 0),
      }));
    }

    let clientBreakdown: { client_name: string; invoiced: number }[] = [];
    let paymentStatusSummary: { status: string; count: number; amount: number }[] = [];
    if (bills.status === "fulfilled") {
      const byClient = new Map<string, number>();
      const byStatus = new Map<string, { count: number; amount: number }>();
      for (const b of bills.value) {
        byClient.set(b.client, (byClient.get(b.client) ?? 0) + b.grandTotal);
        // Same status rule as client_invoice_payment_status: paid when nothing is owed, partial
        // when something was settled, else pending.
        const status = b.outstanding === 0 ? "paid" : b.received + b.tds + b.deduction > 0 ? "partial" : "pending";
        const s = byStatus.get(status) ?? { count: 0, amount: 0 };
        s.count += 1;
        s.amount += b.grandTotal;
        byStatus.set(status, s);
      }
      clientBreakdown = [...byClient]
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([client, amount]) => ({ client_name: client || "Unknown", invoiced: r2(amount) }));
      paymentStatusSummary = [...byStatus].map(([status, s]) => ({ status, count: s.count, amount: r2(s.amount) }));
    }

    res.json({ success: true, data: { trend, clientBreakdown, paymentStatusSummary } });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/finance/analytics/payables-aging
// ---------------------------------------------------------------------------
financeAnalyticsRouter.get(
  "/payables-aging",
  h(async (req, res) => {
    const scope = await scopeOf(req);
    let buckets = { b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0, total: 0 };
    let topVendors: any[] = [];

    const vParams: unknown[] = [];
    const vFrom = payablesFrom(scope, vParams);
    const vendorQuery = db.query<any[]>(
      `SELECT
           COALESCE(vm.vendor_name, vpt.vendor_id) AS vendor_name,
           SUM(${PAYABLE_AMOUNT_SQL}) AS pending_amount,
           MIN(vpt.due_date) AS oldest_due
         ${vFrom}
         GROUP BY vpt.vendor_id, vm.vendor_name
         ORDER BY pending_amount DESC
         LIMIT 10`,
      vParams,
    );
    vendorQuery.catch(() => undefined);

    try {
      const bParams: unknown[] = [];
      const bFrom = payablesFrom(scope, bParams);
      const age = "DATEDIFF(CURDATE(), COALESCE(vpt.due_date, vpt.created_at))";
      const [rows] = await db.query<any[]>(
        `SELECT
           SUM(CASE WHEN ${age} <= 30 THEN ${PAYABLE_AMOUNT_SQL} ELSE 0 END) AS b0_30,
           SUM(CASE WHEN ${age} BETWEEN 31 AND 60 THEN ${PAYABLE_AMOUNT_SQL} ELSE 0 END) AS b31_60,
           SUM(CASE WHEN ${age} BETWEEN 61 AND 90 THEN ${PAYABLE_AMOUNT_SQL} ELSE 0 END) AS b61_90,
           SUM(CASE WHEN ${age} > 90 THEN ${PAYABLE_AMOUNT_SQL} ELSE 0 END) AS b90_plus,
           SUM(${PAYABLE_AMOUNT_SQL}) AS total
         ${bFrom}`,
        bParams,
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
      const [vRows] = await vendorQuery;
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
