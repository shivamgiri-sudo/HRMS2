// backend/src/modules/finance/money-flow.service.ts
/**
 * Ledger Analytics "Money Flow": one picture of MAS Callnet client money — provision (expected) ->
 * proforma -> bill raised -> sent -> received (gross, TDS, deductions) -> in bank — beside what we
 * owe vendors. Design: docs/superpowers/specs/2026-10-14-receivables-money-flow-design.md §6.
 *
 * Every figure comes from ONE bill row set (loadBills) and is summed in integer paise, so a KPI,
 * its funnel stage and the drill-down rows behind it always agree.
 *
 * Settled per bill = received + TDS + other deduction from HRMS receipts (SETTLEMENT_SQL). A bill
 * never allocated on any HRMS receipt, not even a voided one (I-Spark bills until their collections
 * are imported, or bills marked paid on the old Client Payments screen), falls back to
 * client_invoice_payment_status, the figure finance recorded there. Outstanding = grand total - settled - approved credit notes.
 */
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { ownCompanyCostCentreSql } from "../../shared/ownCompanyCostCentre.js";
import {
  CLIENT_NAME_SQL, CREDIT_NOTE_SQL, DUE_DATE_SQL, PAID_TOLERANCE, SETTLEMENT_SQL, financeYearOf,
} from "../client-billing/client-billing-receipt.service.js";

const toPaise = (n: unknown) => Math.round(Number(n ?? 0) * 100);
const rupees = (p: number) => Math.round(p) / 100;
const TOLERANCE_PAISE = Math.round(PAID_TOLERANCE * 100);

export interface MoneyFlowQuery {
  financeYear?: string;
  branchId?: string;
  client?: string;
  /** Branch-scoped callers: only these branch ids (null = org-wide). */
  branchIds?: string[] | null;
  /** For tests: "today" as YYYY-MM-DD. */
  today?: string;
}

export type BillStage = "billed_not_sent" | "sent_unpaid" | "part_paid" | "paid";
export type AgeBucket = "not_due" | "d0_30" | "d31_60" | "d61_90" | "d90_plus";

export interface BillRow {
  id: string;
  billNo: string;
  invoiceDate: string;
  dueDate: string | null;
  client: string;
  costCentre: string;
  branchId: string | null;
  branch: string;
  isMigrated: boolean;
  grandTotal: number;
  received: number;
  tds: number;
  deduction: number;
  credited: number;
  banked: number;
  outstanding: number;
  settlementSource: "receipts" | "client_payments" | "none";
  stage: BillStage;
  daysOverdue: number;
  ageBucket: AgeBucket | null;
}

function fyRange(fy: string): { from: string; to: string } {
  const start = Number(fy.slice(0, 4));
  if (!/^\d{4}-\d{2}$/.test(fy) || !start) throw Object.assign(new Error(`financeYear must look like 2026-27 (got ${fy})`), { statusCode: 400 });
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

const isoDate = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, "0"), d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
};

const daysBetween = (from: string, to: string) =>
  Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000);

export function ageBucket(daysOverdue: number): AgeBucket {
  if (daysOverdue <= 0) return "not_due";
  if (daysOverdue <= 30) return "d0_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90_plus";
}

/** Pure: one DB row -> BillRow with paise-exact maths. Exported for tests. */
export function toBillRow(r: RowDataPacket, today: string): BillRow {
  // A bill ever allocated on an HRMS receipt is settled from receipts only, even when every
  // receipt on it was voided (SETTLEMENT_SQL then has no row): falling back to the stale
  // client_invoice_payment_status row there would resurrect money that was taken back.
  const fromReceipts = r.s_invoice_id != null || Number(r.has_allocation ?? 0) === 1;
  const fromCips = !fromReceipts && r.cips_invoice_id != null;
  const received = fromReceipts ? toPaise(r.s_received) : fromCips ? toPaise(r.cips_received) : 0;
  const tds = fromReceipts ? toPaise(r.s_tds) : fromCips ? toPaise(r.cips_tds) : 0;
  const deduction = fromReceipts ? toPaise(r.s_deduction) : fromCips ? toPaise(r.cips_deduction) : 0;
  // Money recorded on the old screen / in I-Spark was already in the bank; HRMS receipts count once released.
  const banked = fromReceipts ? toPaise(r.s_banked) : received;
  const grand = toPaise(r.grand_total);
  const credited = toPaise(r.credited);
  const settled = received + tds + deduction;
  const outstanding = Math.max(0, grand - settled - credited);
  const open = outstanding > TOLERANCE_PAISE;
  const sent = Number(r.is_migrated) === 1 || r.last_sent_at != null;
  const stage: BillStage = !open ? "paid" : settled > 0 ? "part_paid" : sent ? "sent_unpaid" : "billed_not_sent";
  const dueDate = isoDate(r.due_date);
  const daysOverdue = open && dueDate ? Math.max(0, daysBetween(dueDate, today)) : 0;
  return {
    id: String(r.id),
    billNo: String(r.bill_no ?? ""),
    invoiceDate: isoDate(r.invoice_date) ?? "",
    dueDate,
    client: String(r.client_name ?? ""),
    costCentre: String(r.cost_centre_code ?? ""),
    branchId: r.branch_id ? String(r.branch_id) : null,
    branch: String(r.branch_name ?? ""),
    isMigrated: Number(r.is_migrated) === 1,
    grandTotal: rupees(grand),
    received: rupees(received),
    tds: rupees(tds),
    deduction: rupees(deduction),
    credited: rupees(credited),
    banked: rupees(banked),
    outstanding: open ? rupees(outstanding) : 0,
    settlementSource: fromReceipts ? "receipts" : fromCips ? "client_payments" : "none",
    stage,
    daysOverdue,
    ageBucket: open ? ageBucket(daysOverdue) : null,
  };
}

function scope(q: MoneyFlowQuery, branchCol: string, params: unknown[]): string[] {
  const where: string[] = [];
  if (q.branchIds) {
    if (!q.branchIds.length) where.push("1 = 0");
    else { where.push(`${branchCol} IN (${q.branchIds.map(() => "?").join(",")})`); params.push(...q.branchIds); }
  }
  if (q.branchId) { where.push(`${branchCol} = ?`); params.push(q.branchId); }
  return where;
}

async function loadBills(q: MoneyFlowQuery, fy: string, today: string): Promise<BillRow[]> {
  const { from, to } = fyRange(fy);
  const params: unknown[] = [from, to];
  const where = ["ci.invoice_status = 'approved'", "ci.invoice_date BETWEEN ? AND ?", ownCompanyCostCentreSql("cc")];
  where.push(...scope(q, "cc.branch_id", params));
  if (q.client) { where.push(`${CLIENT_NAME_SQL} = ?`); params.push(q.client); }
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
  return rows.map((r) => toBillRow(r, today));
}

export interface PipelineRow {
  id: string;
  ref: string;
  date: string;
  client: string;
  costCentre: string;
  branch: string;
  amount: number;
}

/** Work not billed yet: approved provision balance and proformas in the two approval steps. */
async function loadPipeline(q: MoneyFlowQuery, fy: string) {
  const { from, to } = fyRange(fy);
  const pParams: unknown[] = [fy];
  const pWhere = ["cp.provision_status = 'approved'", "cp.finance_year = ?", "cp.provision_balance > 0", ownCompanyCostCentreSql("cc")];
  pWhere.push(...scope(q, "cc.branch_id", pParams));
  if (q.client) { pWhere.push(`${CLIENT_NAME_SQL} = ?`); pParams.push(q.client); }
  const iParams: unknown[] = [from, to];
  const iWhere = ["ci.invoice_status = 'proforma'", "ci.is_migrated = 0", "ci.invoice_date BETWEEN ? AND ?", ownCompanyCostCentreSql("cc")];
  iWhere.push(...scope(q, "cc.branch_id", iParams));
  if (q.client) { iWhere.push(`${CLIENT_NAME_SQL} = ?`); iParams.push(q.client); }
  const [[prov], [proformas]] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT cp.id, cp.month_label AS ref, cp.updated_at AS date, ${CLIENT_NAME_SQL} AS client_name, cc.cost_centre_code,
              bm.branch_name, cp.provision_balance AS amount
       FROM client_provision cp JOIN cost_centre_master cc ON cc.id = cp.cost_centre_id
       LEFT JOIN branch_master bm ON bm.id = cc.branch_id
       WHERE ${pWhere.join(" AND ")} ORDER BY cp.month_label`, pParams),
    db.query<RowDataPacket[]>(
      `SELECT ci.id, ci.proforma_no AS ref, ci.invoice_date AS date, ${CLIENT_NAME_SQL} AS client_name, cc.cost_centre_code,
              bm.branch_name, ci.grand_total AS amount, ci.proforma_approved_at
       FROM client_invoice ci JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
       LEFT JOIN branch_master bm ON bm.id = cc.branch_id
       WHERE ${iWhere.join(" AND ")} ORDER BY ci.invoice_date`, iParams),
  ]);
  const map = (r: RowDataPacket): PipelineRow => ({
    id: String(r.id), ref: String(r.ref ?? ""), date: isoDate(r.date) ?? "", client: String(r.client_name ?? ""),
    costCentre: String(r.cost_centre_code ?? ""), branch: String(r.branch_name ?? ""), amount: rupees(toPaise(r.amount)),
  });
  return {
    provision: prov.map(map),
    proformaPending: proformas.filter((r) => r.proforma_approved_at == null).map(map),
    awaitingBillNo: proformas.filter((r) => r.proforma_approved_at != null).map(map),
  };
}

export interface PayableRow {
  id: string; grnNumber: string; vendor: string; branch: string; dueDate: string | null; amount: number; ageBucket: AgeBucket;
}

/** Vendor money still owed on MAS cost centres (GRN payment tracking). */
async function loadPayables(q: MoneyFlowQuery, today: string): Promise<PayableRow[]> {
  const params: unknown[] = [];
  const where = ["vpt.payment_status IN ('Payment Pending', 'Partially Paid')", ownCompanyCostCentreSql("cc")];
  where.push(...scope(q, "vpt.branch_id", params));
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT vpt.id, vpt.grn_number, COALESCE(vm.vendor_name, vpt.vendor_name) AS vendor, bm.branch_name,
            COALESCE(vpt.due_date, DATE(vpt.created_at)) AS due_date,
            CASE WHEN vpt.payment_status = 'Partially Paid'
                 THEN COALESCE(vpt.balance_amount, vpt.due_amount - COALESCE(vpt.paid_amount, 0))
                 ELSE vpt.due_amount END AS amount
     FROM vendor_payment_tracking vpt
     JOIN cost_centre_master cc ON cc.id = vpt.cost_centre_id
     LEFT JOIN vendor_master vm ON vm.id = vpt.vendor_id
     LEFT JOIN branch_master bm ON bm.id = vpt.branch_id
     WHERE ${where.join(" AND ")}`,
    params,
  );
  return rows
    .map((r) => {
      const due = isoDate(r.due_date);
      return {
        id: String(r.id), grnNumber: String(r.grn_number ?? ""), vendor: String(r.vendor ?? ""), branch: String(r.branch_name ?? ""),
        dueDate: due, amount: rupees(toPaise(r.amount)), ageBucket: ageBucket(due ? daysBetween(due, today) : 0),
      };
    })
    .filter((r) => r.amount > 0);
}

/** Money received per ISO week (Monday start), last 12 weeks: recorded vs released to bank. */
async function loadWeeklyIncoming(q: MoneyFlowQuery, today: string) {
  const params: unknown[] = [today, today];
  const where = ["r.status = 'recorded'", "r.receipt_date > DATE_SUB(?, INTERVAL 12 WEEK)", "r.receipt_date <= ?",
    "(pv.id IS NULL OR pv.status NOT IN ('rejected', 'withdrawn'))"];
  where.push(...scope(q, "r.branch_id", params));
  if (q.client) { where.push("r.client_name = ?"); params.push(q.client); }
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_SUB(r.receipt_date, INTERVAL WEEKDAY(r.receipt_date) DAY) AS week_start,
            SUM(r.amount_received) AS recorded,
            SUM(CASE WHEN pv.status = 'released' OR r.is_migrated = 1 THEN r.amount_received ELSE 0 END) AS banked
     FROM client_receipt r LEFT JOIN payment_voucher pv ON pv.id = r.voucher_id
     WHERE ${where.join(" AND ")}
     GROUP BY week_start ORDER BY week_start`,
    params,
  );
  return rows.map((r) => ({ weekStart: isoDate(r.week_start) ?? "", recorded: rupees(toPaise(r.recorded)), banked: rupees(toPaise(r.banked)) }));
}

const sumPaise = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + toPaise(f(r)), 0);
const agg = <T>(rows: T[], f: (r: T) => number) => ({ count: rows.length, amount: rupees(sumPaise(rows, f)) });

function todayIso(): string {
  return isoDate(new Date())!;
}

async function summary(q: MoneyFlowQuery) {
  const today = q.today ?? todayIso();
  const fy = q.financeYear || financeYearOf(today);
  const [bills, pipeline, payables, weekly] = await Promise.all([
    loadBills(q, fy, today), loadPipeline(q, fy), loadPayables(q, today), loadWeeklyIncoming(q, today),
  ]);
  const open = bills.filter((b) => b.outstanding > 0);
  const overdue = open.filter((b) => b.daysOverdue > 0);
  const monthStart = today.slice(0, 8) + "01";
  const [[bank]] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(r.amount_received), 0) AS banked FROM client_receipt r
     JOIN payment_voucher pv ON pv.id = r.voucher_id AND pv.status = 'released'
     WHERE r.status = 'recorded' AND r.receipt_date BETWEEN ? AND ?${q.branchIds ? (q.branchIds.length ? ` AND r.branch_id IN (${q.branchIds.map(() => "?").join(",")})` : " AND 1 = 0") : ""}${q.branchId ? " AND r.branch_id = ?" : ""}${q.client ? " AND r.client_name = ?" : ""}`,
    [monthStart, today, ...(q.branchIds ?? []), ...(q.branchId ? [q.branchId] : []), ...(q.client ? [q.client] : [])],
  );

  const stages: BillStage[] = ["billed_not_sent", "sent_unpaid", "part_paid", "paid"];
  const buckets: AgeBucket[] = ["not_due", "d0_30", "d31_60", "d61_90", "d90_plus"];
  const byClient = new Map<string, { client: string; outstanding: number; overdue: number; bills: number }>();
  for (const b of open) {
    const c = byClient.get(b.client) ?? { client: b.client, outstanding: 0, overdue: 0, bills: 0 };
    c.outstanding += toPaise(b.outstanding);
    if (b.daysOverdue > 0) c.overdue += toPaise(b.outstanding);
    c.bills += 1;
    byClient.set(b.client, c);
  }
  const topClients = [...byClient.values()]
    .sort((a, b) => b.outstanding - a.outstanding).slice(0, 10)
    .map((c) => ({ ...c, outstanding: rupees(c.outstanding), overdue: rupees(c.overdue) }));

  return {
    financeYear: fy,
    asOf: today,
    kpis: {
      expected: agg(pipeline.provision, (r) => r.amount),
      billed: agg(bills, (b) => b.grandTotal),
      received: { count: bills.filter((b) => b.received > 0).length, amount: rupees(sumPaise(bills, (b) => b.received)),
        tds: rupees(sumPaise(bills, (b) => b.tds)), deduction: rupees(sumPaise(bills, (b) => b.deduction)),
        credited: rupees(sumPaise(bills, (b) => b.credited)) },
      outstanding: agg(open, (b) => b.outstanding),
      overdue: agg(overdue, (b) => b.outstanding),
      bankedThisMonth: { amount: rupees(toPaise(bank.banked)), from: monthStart, to: today },
      awaitingBank: rupees(sumPaise(bills, (b) => b.received) - sumPaise(bills, (b) => b.banked)),
      payables: agg(payables, (p) => p.amount),
    },
    funnel: [
      { key: "provision", label: "Provision not billed", ...agg(pipeline.provision, (r) => r.amount) },
      { key: "proforma_pending", label: "Proforma awaiting approval", ...agg(pipeline.proformaPending, (r) => r.amount) },
      { key: "awaiting_bill_no", label: "Awaiting bill no.", ...agg(pipeline.awaitingBillNo, (r) => r.amount) },
      ...stages.map((s) => {
        const rows = bills.filter((b) => b.stage === s);
        // Open stages show what is still due; "paid" shows the billed value collected.
        return { key: s, label: STAGE_LABEL[s], ...agg(rows, (b) => (s === "paid" ? b.grandTotal : b.outstanding)) };
      }),
    ],
    receivablesAgeing: buckets.map((k) => ({ key: k, ...agg(open.filter((b) => b.ageBucket === k), (b) => b.outstanding) })),
    payablesAgeing: buckets.map((k) => ({ key: k, ...agg(payables.filter((p) => p.ageBucket === k), (p) => p.amount) })),
    weeklyIncoming: weekly,
    topClients,
    settlementSources: {
      receipts: bills.filter((b) => b.settlementSource === "receipts").length,
      clientPayments: bills.filter((b) => b.settlementSource === "client_payments").length,
    },
  };
}

const STAGE_LABEL: Record<BillStage, string> = {
  billed_not_sent: "Billed, not sent",
  sent_unpaid: "Sent, unpaid",
  part_paid: "Part paid",
  paid: "Paid",
};

export const DRILL_KEYS = [
  "provision", "proforma_pending", "awaiting_bill_no", "billed", "billed_not_sent", "sent_unpaid", "part_paid", "paid",
  "received", "outstanding", "overdue", "not_due", "d0_30", "d31_60", "d61_90", "d90_plus", "payables",
] as const;
export type DrillKey = typeof DRILL_KEYS[number];

/** The rows behind one number on the page. */
async function rows(q: MoneyFlowQuery, key: DrillKey) {
  const today = q.today ?? todayIso();
  const fy = q.financeYear || financeYearOf(today);
  if (key === "provision" || key === "proforma_pending" || key === "awaiting_bill_no") {
    const p = await loadPipeline(q, fy);
    const map = { provision: p.provision, proforma_pending: p.proformaPending, awaiting_bill_no: p.awaitingBillNo };
    return { kind: "pipeline" as const, rows: map[key] };
  }
  if (key === "payables") return { kind: "payables" as const, rows: await loadPayables(q, today) };
  const bills = await loadBills(q, fy, today);
  const pick: Record<string, (b: BillRow) => boolean> = {
    billed: () => true,
    received: (b) => b.received > 0,
    outstanding: (b) => b.outstanding > 0,
    overdue: (b) => b.outstanding > 0 && b.daysOverdue > 0,
  };
  const filter = pick[key] ?? ((b: BillRow) => b.stage === key || (b.outstanding > 0 && b.ageBucket === key));
  return { kind: "bills" as const, rows: bills.filter(filter) };
}

/** Clients and branches with a MAS bill in the year, for the filters. */
async function options(q: MoneyFlowQuery) {
  const fy = q.financeYear || financeYearOf(q.today ?? todayIso());
  const { from, to } = fyRange(fy);
  const params: unknown[] = [from, to];
  const where = ["ci.invoice_status = 'approved'", "ci.invoice_date BETWEEN ? AND ?", ownCompanyCostCentreSql("cc")];
  where.push(...scope({ branchIds: q.branchIds }, "cc.branch_id", params));
  const [r] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT ${CLIENT_NAME_SQL} AS client, cc.branch_id, bm.branch_name
     FROM client_invoice ci JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
     LEFT JOIN branch_master bm ON bm.id = cc.branch_id
     WHERE ${where.join(" AND ")}`, params);
  const clients = [...new Set(r.map((x) => String(x.client ?? "")).filter(Boolean))].sort();
  const branches = new Map<string, string>();
  for (const x of r) if (x.branch_id) branches.set(String(x.branch_id), String(x.branch_name ?? x.branch_id));
  return {
    financeYear: fy,
    clients,
    branches: [...branches].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export const moneyFlowService = { summary, rows, options };
