import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { getCurrentDateIST } from "../../shared/istDate.js";
import { OWN_COMPANY_SQL } from "./pnl-actuals.service.js";

/**
 * Seat-billing revenue estimate: what a cost centre earns per day, from seat rate x seats.
 *
 * WHY THIS EXISTS. Live P&L reads revenue only from invoices (db_bill mirror) and billing
 * provisions. Invoices are raised in arrears, so for the current month and usually the month
 * before it, every cost centre reads Rs 0 revenue against a full month of cost — OP% prints "NA"
 * for the months a finance review is actually about. Measured 2026-09-15: August showed Rs 0
 * while db_bill already held Rs 274.10 lakh of MAS Callnet August invoices.
 *
 * WHERE THE RATE COMES FROM. The client's own invoice. Every seat-billed line in
 * db_bill.inv_particulars carries rate x qty for one LOB ("BVO Chat 38,000 x 21",
 * "Abandon Cart 34,500 x 12.38"), and one cost centre commonly bills several LOBs at different
 * rates — 7 of the 25 MAS cost centres billed in Aug-26 did. So the unit here is the invoice
 * LINE, never a single per-cost-centre rate. HRMS headcount is deliberately NOT used as the seat
 * count: it disagrees with billed seats badly (Godfrey 474 billed 118 seats with 0 staff mapped;
 * 465 billed 11 with 154 staff), so seats come from the invoice or from finance.
 *
 * PRECEDENCE, per cost centre, for a period:
 *   1. configured lines in pnl_seat_billing_line effective for the period (set in the UI);
 *   2. otherwise the seat/fixed lines of the cost centre's most recent invoiced month within
 *      INVOICE_LOOKBACK_MONTHS before the period.
 * A cost centre with configured lines never mixes in invoice lines — the configuration is the
 * whole answer, so finance can drop a LOB by leaving it out.
 *
 * This is an ESTIMATE and is always labelled one. Live P&L uses it only for cost centres that
 * have neither an invoice nor a provision for the period, and only inside the open billing
 * window (see isEstimateWindow) — a closed month with no invoice stays at zero rather than
 * acquiring revenue nobody billed.
 */

export type SeatLineKind = "seat" | "fixed";
export type ExcludedReason = "incentive" | "one_time" | "usage" | "revenue_share" | "zero_value";
export type InvoiceLineClass =
  | { kind: SeatLineKind }
  | { kind: "excluded"; reason: ExcludedReason };

export const SEAT_LINE_KINDS: readonly SeatLineKind[] = ["seat", "fixed"];

/** How far back to look for "the last invoice" before a cost centre is treated as unbilled. */
export const INVOICE_LOOKBACK_MONTHS = 3;
/** Months (current IST month included) in which an unbilled cost centre gets an estimate. */
export const ESTIMATE_WINDOW_MONTHS = 2;

// Month must be 01-12: a bare \d{2} accepted "2026-13" as a period and as an effective month
// (found by the sandbox end-to-end run, 2026-09-15).
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const TABLE = "pnl_seat_billing_line";
const AUDIT_ENTITY = "pnl_seat_billing_line";
const AUDIT_MODULE = "process_pnl_seat_billing";

const n = (value: unknown) => {
  const out = Number(value ?? 0);
  return Number.isFinite(out) ? out : 0;
};
const round2 = (value: number) => Math.round(value * 100) / 100;
const marks = (list: unknown[]) => list.map(() => "?").join(",");

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Days in the month, and how many have elapsed as of `asOf` (YYYY-MM-DD, IST). */
export function monthProgress(period: string, asOf: string): { daysInMonth: number; daysElapsed: number } {
  const [year, month] = period.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const asOfPeriod = asOf.slice(0, 7);
  if (asOfPeriod === period) return { daysInMonth, daysElapsed: Math.min(daysInMonth, Number(asOf.slice(8, 10))) };
  return { daysInMonth, daysElapsed: asOfPeriod > period ? daysInMonth : 0 };
}

/**
 * True for the months where invoices are normally still to come: the current IST month and the
 * ESTIMATE_WINDOW_MONTHS - 1 before it. Never a future month (nothing is earned yet) and never an
 * older one (a cost centre unbilled three months ago was genuinely unbilled).
 */
export function isEstimateWindow(period: string, asOf: string): boolean {
  const current = asOf.slice(0, 7);
  return period <= current && period >= shiftPeriod(current, -(ESTIMATE_WINDOW_MONTHS - 1));
}

/**
 * Which invoice lines are recurring seat/fixed billing, and which are not.
 *
 * Differs from billingPattern() in sync-db-bill-snapshot.mjs on purpose, in two places found in
 * real Aug-26 lines: (1) seat vocabulary is checked BEFORE "retainer" — Onfido bills
 * "Cart2profit (Monthly Retainer) | Onfido FTE" at 53,653 x 175, which billingPattern files as a
 * fixed retainer; (2) incentives are excluded — "R&R Incentive for Mumbai 34,250 x 1" and
 * "July CSR Incentives 1,05,950 x 1" have seat-like shape but are one-month extras, not a rate.
 * The sync's classifier is left alone because other consumers read its is_seat_line.
 */
export function classifyInvoiceLine(line: {
  service?: string | null;
  particulars?: string | null;
  rate?: unknown;
  qty?: unknown;
  amount?: unknown;
}): InvoiceLineClass {
  const hay = `${line.service ?? ""} ${line.particulars ?? ""}`.toLowerCase();
  const rate = n(line.rate);
  const qty = n(line.qty);
  const amount = n(line.amount);
  if (amount <= 0) return { kind: "excluded", reason: "zero_value" };
  if (/revenue share/.test(hay) || /\d\s*%/.test(hay)) return { kind: "excluded", reason: "revenue_share" };
  if (/incentive|\br\s*&\s*r\b|\brnr\b|reward|bonus|penalt|arrear/.test(hay)) return { kind: "excluded", reason: "incentive" };
  if (/set ?up|implementation|integration charge|customi[sz]ation|development|one[- ]?time/.test(hay)) {
    return { kind: "excluded", reason: "one_time" };
  }
  if (/excess usage|top ?up|talk ?time|recharge|per (call|minute|transaction|lead|case)/.test(hay)) {
    return { kind: "excluded", reason: "usage" };
  }
  const seatWords = /seat|\bfte\b|manpower|deployment|resource|telecalling|calling|agent|advisor|executive|team leader|\btl\b|supervisor|service charge|call cent(er|re)/;
  if (seatWords.test(hay) && rate > 0 && qty > 0) return { kind: "seat" };
  // Shape beats vocabulary: a seat-sized rate against a unit count that multiplies out to the
  // amount is per-seat billing whatever the LOB is called ("BVO Chat", "Abandon Cart", "Email").
  if (rate >= 5000 && qty > 0 && Math.abs(rate * qty - amount) < 1) return { kind: "seat" };
  return { kind: "fixed" };
}

export interface SeatBillingLine {
  /** Configured row id; null for a line read straight off an invoice. */
  id: string | null;
  lineLabel: string;
  lineKind: SeatLineKind;
  rateMonthly: number;
  seats: number;
  /** rate x seats for a seat line; the billed amount for a fixed line. */
  monthlyValue: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  notes: string | null;
  sourceBillId: number | null;
}

export interface ExcludedInvoiceLine {
  lineLabel: string;
  amount: number;
  reason: ExcludedReason;
  sourceBillId: number | null;
}

export interface CostCentreSeatBilling {
  costCentreId: string;
  costCentreCode: string;
  costCentreName: string;
  branchId: string | null;
  branchName: string | null;
  source: "configured" | "invoice" | "none";
  /** For source = invoice, the month whose invoice the lines came from. */
  sourcePeriod: string | null;
  lines: SeatBillingLine[];
  excludedLines: ExcludedInvoiceLine[];
  seats: number;
  monthlyValue: number;
  perDay: number;
  toDate: number;
}

export interface SeatBillingEstimate {
  period: string;
  asOfDate: string;
  daysInMonth: number;
  daysElapsed: number;
  configurationAvailable: boolean;
  costCentres: CostCentreSeatBilling[];
  totals: {
    costCentres: number;
    configured: number;
    fromInvoice: number;
    withoutRate: number;
    seats: number;
    monthlyValue: number;
    perDay: number;
    toDate: number;
  };
}

interface CcRow extends RowDataPacket {
  id: string;
  cost_centre_code: string;
  cost_centre_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
}

async function readOwnCostCentres(filters: { branchIds?: string[]; costCentreId?: string }): Promise<CcRow[]> {
  const where = [OWN_COMPANY_SQL, "ccm.active_status = 1"];
  const params: unknown[] = [];
  if (filters.branchIds?.length) {
    where.push(`ccm.branch_id IN (${marks(filters.branchIds)})`);
    params.push(...filters.branchIds);
  }
  if (filters.costCentreId) {
    where.push("ccm.id = ?");
    params.push(filters.costCentreId);
  }
  const [rows] = await db.execute<CcRow[]>(
    `SELECT ccm.id, ccm.cost_centre_code, ccm.cost_centre_name, ccm.branch_id, bm.branch_name
       FROM cost_centre_master ccm
       LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
      WHERE ${where.join(" AND ")}`,
    params,
  );
  return rows;
}

interface ConfiguredRow extends RowDataPacket {
  id: string;
  cost_centre_id: string;
  line_label: string;
  line_kind: string;
  rate_monthly: number | string;
  seats: number | string;
  monthly_amount: number | string | null;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
}

function configuredLineValue(row: { line_kind: string; rate_monthly: unknown; seats: unknown; monthly_amount?: unknown }) {
  return row.line_kind === "fixed" ? n(row.monthly_amount ?? row.rate_monthly) : n(row.rate_monthly) * n(row.seats);
}

async function readConfiguredLines(period: string, costCentreIds: string[]): Promise<Map<string, SeatBillingLine[]>> {
  const out = new Map<string, SeatBillingLine[]>();
  if (!costCentreIds.length || !(await tableExists(TABLE))) return out;
  const [rows] = await db.execute<ConfiguredRow[]>(
    `SELECT id, cost_centre_id, line_label, line_kind, rate_monthly, seats, monthly_amount,
            effective_from, effective_to, notes
       FROM ${TABLE}
      WHERE active_status = 1
        AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
        AND cost_centre_id IN (${marks(costCentreIds)})
      ORDER BY line_label`,
    [period, period, ...costCentreIds],
  );
  for (const r of rows) {
    const kind: SeatLineKind = r.line_kind === "fixed" ? "fixed" : "seat";
    const list = out.get(String(r.cost_centre_id)) ?? [];
    list.push({
      id: String(r.id),
      lineLabel: String(r.line_label),
      lineKind: kind,
      rateMonthly: n(r.rate_monthly),
      seats: kind === "fixed" ? 0 : n(r.seats),
      monthlyValue: configuredLineValue(r),
      effectiveFrom: r.effective_from ? String(r.effective_from) : null,
      effectiveTo: r.effective_to ? String(r.effective_to) : null,
      notes: r.notes ? String(r.notes) : null,
      sourceBillId: null,
    });
    out.set(String(r.cost_centre_id), list);
  }
  return out;
}

interface InvoiceRow extends RowDataPacket {
  cost_centre_id: string;
  period_code: string;
  bill_source_id: number | null;
  service: string | null;
  particulars: string | null;
  rate: number | string;
  qty: number | string;
  amount: number | string;
}

/** The most recent invoiced month (before `period`, within the lookback) for each cost centre. */
async function readInvoiceLines(period: string, costCentreIds: string[]): Promise<Map<string, { sourcePeriod: string; rows: InvoiceRow[] }>> {
  const out = new Map<string, { sourcePeriod: string; rows: InvoiceRow[] }>();
  if (!costCentreIds.length || !(await tableExists("billing_invoice_particular_snapshot"))) return out;
  // Both code columns are utf8mb4_unicode_ci, so a plain equality join keeps the index usable —
  // a COLLATE cast on either side would not.
  const [rows] = await db.execute<InvoiceRow[]>(
    `SELECT ccm.id AS cost_centre_id, p.period_code, p.bill_source_id, p.service, p.particulars,
            p.rate, p.qty, p.amount
       FROM billing_invoice_particular_snapshot p
       JOIN cost_centre_master ccm ON ccm.cost_centre_code = p.cost_centre_code
      WHERE p.period_code >= ? AND p.period_code < ?
        AND ccm.id IN (${marks(costCentreIds)})
      ORDER BY p.period_code DESC, p.amount DESC`,
    [shiftPeriod(period, -INVOICE_LOOKBACK_MONTHS), period, ...costCentreIds],
  );
  for (const r of rows) {
    const key = String(r.cost_centre_id);
    const current = out.get(key);
    if (!current) out.set(key, { sourcePeriod: String(r.period_code), rows: [r] });
    else if (current.sourcePeriod === String(r.period_code)) current.rows.push(r);
  }
  return out;
}

function invoiceLabel(r: InvoiceRow) {
  const text = String(r.particulars ?? r.service ?? "").replace(/\s+/g, " ").trim();
  return (text || "Invoice line").slice(0, 200);
}

function linesFromInvoice(rows: InvoiceRow[]): { lines: SeatBillingLine[]; excluded: ExcludedInvoiceLine[] } {
  const lines: SeatBillingLine[] = [];
  const excluded: ExcludedInvoiceLine[] = [];
  for (const r of rows) {
    const cls = classifyInvoiceLine(r);
    const sourceBillId = r.bill_source_id == null ? null : Number(r.bill_source_id);
    if (cls.kind === "excluded") {
      excluded.push({ lineLabel: invoiceLabel(r), amount: n(r.amount), reason: cls.reason, sourceBillId });
      continue;
    }
    lines.push({
      id: null,
      lineLabel: invoiceLabel(r),
      lineKind: cls.kind,
      rateMonthly: cls.kind === "seat" ? n(r.rate) : n(r.amount),
      seats: cls.kind === "seat" ? n(r.qty) : 0,
      monthlyValue: cls.kind === "seat" ? n(r.rate) * n(r.qty) : n(r.amount),
      effectiveFrom: null,
      effectiveTo: null,
      notes: null,
      sourceBillId,
    });
  }
  return { lines, excluded };
}

export async function getSeatBillingEstimate(
  period: string,
  options: { branchIds?: string[]; costCentreId?: string; asOfDate?: string } = {},
): Promise<SeatBillingEstimate> {
  if (!PERIOD_RE.test(period)) throw httpError(400, "period must be YYYY-MM");
  const asOfDate = options.asOfDate ?? getCurrentDateIST();
  const { daysInMonth, daysElapsed } = monthProgress(period, asOfDate);

  const ccs = await readOwnCostCentres(options);
  const ids = ccs.map((cc) => String(cc.id));
  const [configurationAvailable, configured, invoiced] = await Promise.all([
    tableExists(TABLE),
    readConfiguredLines(period, ids),
    readInvoiceLines(period, ids),
  ]);

  const costCentres: CostCentreSeatBilling[] = ccs.map((cc) => {
    const id = String(cc.id);
    const own = configured.get(id);
    const inv = invoiced.get(id);
    const fromInvoice = inv ? linesFromInvoice(inv.rows) : { lines: [], excluded: [] };
    const source: CostCentreSeatBilling["source"] = own?.length ? "configured" : fromInvoice.lines.length ? "invoice" : "none";
    const lines = source === "configured" ? own! : fromInvoice.lines;
    const monthlyValue = round2(lines.reduce((total, line) => total + line.monthlyValue, 0));
    const perDay = daysInMonth > 0 ? monthlyValue / daysInMonth : 0;
    return {
      costCentreId: id,
      costCentreCode: String(cc.cost_centre_code ?? ""),
      costCentreName: String(cc.cost_centre_name ?? cc.cost_centre_code ?? "Unnamed cost centre"),
      branchId: cc.branch_id ? String(cc.branch_id) : null,
      branchName: cc.branch_name ? String(cc.branch_name) : null,
      source,
      sourcePeriod: source === "invoice" ? inv!.sourcePeriod : null,
      lines,
      excludedLines: source === "configured" ? [] : fromInvoice.excluded,
      seats: round2(lines.reduce((total, line) => total + line.seats, 0)),
      monthlyValue,
      perDay: round2(perDay),
      toDate: round2(perDay * daysElapsed),
    };
  });
  costCentres.sort((a, b) => b.monthlyValue - a.monthlyValue || a.costCentreCode.localeCompare(b.costCentreCode));

  const sum = (pick: (cc: CostCentreSeatBilling) => number) => round2(costCentres.reduce((t, cc) => t + pick(cc), 0));
  return {
    period,
    asOfDate,
    daysInMonth,
    daysElapsed,
    configurationAvailable,
    costCentres,
    totals: {
      costCentres: costCentres.length,
      configured: costCentres.filter((cc) => cc.source === "configured").length,
      fromInvoice: costCentres.filter((cc) => cc.source === "invoice").length,
      withoutRate: costCentres.filter((cc) => cc.source === "none").length,
      seats: sum((cc) => cc.seats),
      monthlyValue: sum((cc) => cc.monthlyValue),
      perDay: sum((cc) => cc.perDay),
      toDate: sum((cc) => cc.toDate),
    },
  };
}

// ── configuration writes ─────────────────────────────────────────────────────────────────────

export interface SeatBillingLineInput {
  costCentreId?: string;
  lineLabel?: string;
  lineKind?: string;
  rateMonthly?: unknown;
  seats?: unknown;
  monthlyAmount?: unknown;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  notes?: string | null;
}

interface ValidLine {
  lineLabel: string;
  lineKind: SeatLineKind;
  rateMonthly: number;
  seats: number;
  monthlyAmount: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
}

export function validateLineInput(input: SeatBillingLineInput): ValidLine {
  const lineLabel = String(input.lineLabel ?? "").replace(/\s+/g, " ").trim();
  if (!lineLabel) throw httpError(400, "Line name (LOB) is required");
  if (lineLabel.length > 200) throw httpError(400, "Line name must be 200 characters or fewer");
  const lineKind = String(input.lineKind ?? "seat") as SeatLineKind;
  if (!SEAT_LINE_KINDS.includes(lineKind)) throw httpError(400, "Line type must be seat or fixed");
  const effectiveFrom = String(input.effectiveFrom ?? "");
  if (!PERIOD_RE.test(effectiveFrom)) throw httpError(400, "Effective from must be a month (YYYY-MM)");
  const effectiveTo = input.effectiveTo ? String(input.effectiveTo) : null;
  if (effectiveTo && !PERIOD_RE.test(effectiveTo)) throw httpError(400, "Effective to must be a month (YYYY-MM)");
  if (effectiveTo && effectiveTo < effectiveFrom) throw httpError(400, "Effective to cannot be before effective from");
  const notes = input.notes ? String(input.notes).trim().slice(0, 500) || null : null;

  if (lineKind === "fixed") {
    const monthlyAmount = n(input.monthlyAmount ?? input.rateMonthly);
    if (!(monthlyAmount > 0) || monthlyAmount > 100_000_000) throw httpError(400, "Monthly amount must be between 1 and 10,00,00,000");
    return { lineLabel, lineKind, rateMonthly: monthlyAmount, seats: 0, monthlyAmount, effectiveFrom, effectiveTo, notes };
  }
  const rateMonthly = n(input.rateMonthly);
  const seats = n(input.seats);
  if (!(rateMonthly > 0) || rateMonthly > 10_000_000) throw httpError(400, "Seat rate must be between 1 and 1,00,00,000 per month");
  if (!(seats > 0) || seats > 100_000) throw httpError(400, "Seats must be greater than 0");
  return { lineLabel, lineKind, rateMonthly: round2(rateMonthly), seats: round2(seats), monthlyAmount: null, effectiveFrom, effectiveTo, notes };
}

async function requireTable() {
  if (!(await tableExists(TABLE))) {
    throw httpError(503, "Seat billing configuration is not enabled yet — its database table has not been created.");
  }
}

interface LineRow extends RowDataPacket {
  id: string;
  cost_centre_id: string;
  line_label: string;
  line_kind: string;
  rate_monthly: number | string;
  seats: number | string;
  monthly_amount: number | string | null;
  effective_from: string;
  effective_to: string | null;
  source: string;
  source_period: string | null;
  source_bill_id: number | null;
  notes: string | null;
  active_status: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

async function readLine(id: string): Promise<LineRow> {
  const [rows] = await db.execute<LineRow[]>(`SELECT * FROM ${TABLE} WHERE id = ?`, [id]);
  if (!rows[0]) throw httpError(404, "Seat billing line not found");
  return rows[0];
}

/** Branch of a MAS cost centre — the caller checks it against the user's finance scope. */
export async function getOwnCostCentreBranch(costCentreId: string): Promise<{ branchId: string | null }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.branch_id FROM cost_centre_master ccm WHERE ccm.id = ? AND ${OWN_COMPANY_SQL}`,
    [costCentreId],
  );
  if (!rows[0]) throw httpError(404, "Cost centre not found or not a MAS Callnet cost centre");
  return { branchId: rows[0].branch_id ? String(rows[0].branch_id) : null };
}

export async function getLineCostCentre(id: string): Promise<{ costCentreId: string }> {
  await requireTable();
  const row = await readLine(id);
  return { costCentreId: String(row.cost_centre_id) };
}

function lineSnapshot(row: Partial<LineRow> & Record<string, unknown>) {
  return {
    cost_centre_id: row.cost_centre_id ?? null,
    line_label: row.line_label ?? null,
    line_kind: row.line_kind ?? null,
    rate_monthly: row.rate_monthly == null ? null : n(row.rate_monthly),
    seats: row.seats == null ? null : n(row.seats),
    monthly_amount: row.monthly_amount == null ? null : n(row.monthly_amount),
    effective_from: row.effective_from ?? null,
    effective_to: row.effective_to ?? null,
    active_status: row.active_status ?? null,
    notes: row.notes ?? null,
  };
}

async function audit(action: string, id: string, userId: string, before: unknown, after: unknown, extra: Record<string, unknown> = {}) {
  await writeAuditLog({
    actor_user_id: userId,
    action_type: action,
    module_key: AUDIT_MODULE,
    entity_type: AUDIT_ENTITY,
    entity_id: id,
    metadata: { before, after, ...extra },
  });
}

export async function createSeatBillingLine(input: SeatBillingLineInput, userId: string, source: "manual" | "invoice" = "manual", sourceMeta: { sourcePeriod?: string | null; sourceBillId?: number | null } = {}) {
  await requireTable();
  const costCentreId = String(input.costCentreId ?? "");
  if (!costCentreId) throw httpError(400, "Cost centre is required");
  await getOwnCostCentreBranch(costCentreId);
  const v = validateLineInput(input);
  const id = randomUUID();
  await db.execute(
    `INSERT INTO ${TABLE}
       (id, cost_centre_id, line_label, line_kind, rate_monthly, seats, monthly_amount,
        effective_from, effective_to, source, source_period, source_bill_id, notes,
        active_status, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, costCentreId, v.lineLabel, v.lineKind, v.rateMonthly, v.seats, v.monthlyAmount,
      v.effectiveFrom, v.effectiveTo, source, sourceMeta.sourcePeriod ?? null, sourceMeta.sourceBillId ?? null,
      v.notes, userId, userId],
  );
  const after = { cost_centre_id: costCentreId, line_label: v.lineLabel, line_kind: v.lineKind, rate_monthly: v.rateMonthly, seats: v.seats, monthly_amount: v.monthlyAmount, effective_from: v.effectiveFrom, effective_to: v.effectiveTo, active_status: 1, notes: v.notes };
  await audit("seat_billing_line_created", id, userId, null, after, { source });
  return { id, ...after };
}

export async function updateSeatBillingLine(id: string, input: SeatBillingLineInput, userId: string) {
  await requireTable();
  const before = await readLine(id);
  if (Number(before.active_status) !== 1) throw httpError(409, "This line is inactive; add a new line instead of editing it");
  const merged: SeatBillingLineInput = {
    lineLabel: input.lineLabel ?? before.line_label,
    lineKind: input.lineKind ?? before.line_kind,
    rateMonthly: input.rateMonthly ?? before.rate_monthly,
    seats: input.seats ?? before.seats,
    monthlyAmount: input.monthlyAmount ?? before.monthly_amount ?? undefined,
    effectiveFrom: input.effectiveFrom ?? before.effective_from,
    effectiveTo: input.effectiveTo === undefined ? before.effective_to : input.effectiveTo,
    notes: input.notes === undefined ? before.notes : input.notes,
  };
  const v = validateLineInput(merged);
  await db.execute(
    `UPDATE ${TABLE}
        SET line_label = ?, line_kind = ?, rate_monthly = ?, seats = ?, monthly_amount = ?,
            effective_from = ?, effective_to = ?, notes = ?, updated_by = ?
      WHERE id = ?`,
    [v.lineLabel, v.lineKind, v.rateMonthly, v.seats, v.monthlyAmount, v.effectiveFrom, v.effectiveTo, v.notes, userId, id],
  );
  const after = { ...lineSnapshot(before), line_label: v.lineLabel, line_kind: v.lineKind, rate_monthly: v.rateMonthly, seats: v.seats, monthly_amount: v.monthlyAmount, effective_from: v.effectiveFrom, effective_to: v.effectiveTo, notes: v.notes };
  await audit("seat_billing_line_updated", id, userId, lineSnapshot(before), after);
  return { id, ...after };
}

export async function deactivateSeatBillingLine(id: string, userId: string, reason?: string | null) {
  await requireTable();
  const before = await readLine(id);
  if (Number(before.active_status) !== 1) return { id, active_status: 0 };
  await db.execute(`UPDATE ${TABLE} SET active_status = 0, updated_by = ? WHERE id = ?`, [userId, id]);
  await audit("seat_billing_line_deactivated", id, userId, lineSnapshot(before), { ...lineSnapshot(before), active_status: 0 }, { reason: reason ?? null });
  return { id, active_status: 0 };
}

/**
 * Copies a cost centre's last-invoice lines into the configuration, effective from `period`,
 * so finance can then edit seats or rates per LOB. Refuses when the cost centre already has
 * configured lines for that period — importing again would silently double its revenue.
 */
export async function importSeatBillingFromInvoice(costCentreId: string, period: string, userId: string) {
  await requireTable();
  if (!PERIOD_RE.test(period)) throw httpError(400, "period must be YYYY-MM");
  await getOwnCostCentreBranch(costCentreId);
  const existing = await readConfiguredLines(period, [costCentreId]);
  if (existing.get(costCentreId)?.length) {
    throw httpError(409, "This cost centre already has configured lines for this month. Edit them instead of importing again.");
  }
  const inv = (await readInvoiceLines(period, [costCentreId])).get(costCentreId);
  if (!inv) throw httpError(404, `No invoice found for this cost centre in the ${INVOICE_LOOKBACK_MONTHS} months before ${period}`);
  const { lines } = linesFromInvoice(inv.rows);
  if (!lines.length) throw httpError(404, "The last invoice has no seat or fixed recurring lines to import");
  const created: Array<Awaited<ReturnType<typeof createSeatBillingLine>>> = [];
  for (const line of lines) {
    created.push(await createSeatBillingLine({
      costCentreId,
      lineLabel: line.lineLabel,
      lineKind: line.lineKind,
      rateMonthly: line.rateMonthly,
      seats: line.seats,
      monthlyAmount: line.lineKind === "fixed" ? line.monthlyValue : undefined,
      effectiveFrom: period,
      notes: `Imported from ${inv.sourcePeriod} invoice`,
    }, userId, "invoice", { sourcePeriod: inv.sourcePeriod, sourceBillId: line.sourceBillId }));
  }
  return { costCentreId, sourcePeriod: inv.sourcePeriod, imported: created.length, lines: created };
}

// ── drawer detail ────────────────────────────────────────────────────────────────────────────

export async function getSeatBillingCostCentreDetail(costCentreId: string, period: string) {
  if (!PERIOD_RE.test(period)) throw httpError(400, "period must be YYYY-MM");
  const estimate = await getSeatBillingEstimate(period, { costCentreId });
  const current = estimate.costCentres[0];
  if (!current) throw httpError(404, "Cost centre not found or not an active MAS Callnet cost centre");

  let history: Array<Record<string, unknown>> = [];
  let auditTrail: Array<Record<string, unknown>> = [];
  if (estimate.configurationAvailable) {
    const [rows] = await db.execute<LineRow[]>(
      `SELECT * FROM ${TABLE} WHERE cost_centre_id = ? ORDER BY effective_from DESC, line_label`,
      [costCentreId],
    );
    history = rows.map((r) => ({
      id: String(r.id),
      lineLabel: r.line_label,
      lineKind: r.line_kind,
      rateMonthly: n(r.rate_monthly),
      seats: n(r.seats),
      monthlyValue: configuredLineValue(r),
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      source: r.source,
      sourcePeriod: r.source_period,
      notes: r.notes,
      active: Number(r.active_status) === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    const ids = rows.map((r) => String(r.id));
    if (ids.length) {
      try {
        const [auditRows] = await db.execute<RowDataPacket[]>(
          `SELECT a.created_at, a.action_type, a.entity_id, a.metadata_json,
                  COALESCE(e.full_name, u.email, a.actor_user_id) AS actor
             FROM audit_action_log a
             LEFT JOIN auth_user u ON u.id = a.actor_user_id
             LEFT JOIN employees e ON e.user_id = u.id AND e.active_status = 1
            WHERE a.entity_type = ? AND a.entity_id IN (${marks(ids)})
            ORDER BY a.created_at DESC
            LIMIT 50`,
          [AUDIT_ENTITY, ...ids],
        );
        auditTrail = auditRows.map((a) => ({
          at: a.created_at,
          action: a.action_type,
          lineId: a.entity_id,
          actor: a.actor,
          change: typeof a.metadata_json === "string" ? JSON.parse(a.metadata_json) : a.metadata_json,
        }));
      } catch {
        // The audit trail is supplementary; a failure to read it must not hide the lines.
        auditTrail = [];
      }
    }
  }

  let invoiceHistory: Array<Record<string, unknown>> = [];
  if (await tableExists("billing_invoice_particular_snapshot")) {
    const [rows] = await db.execute<InvoiceRow[]>(
      `SELECT p.period_code, p.bill_source_id, p.service, p.particulars, p.rate, p.qty, p.amount
         FROM billing_invoice_particular_snapshot p
         JOIN cost_centre_master ccm ON ccm.cost_centre_code = p.cost_centre_code
        WHERE ccm.id = ? AND p.period_code >= ? AND p.period_code <= ?
        ORDER BY p.period_code DESC, p.amount DESC`,
      [costCentreId, shiftPeriod(period, -INVOICE_LOOKBACK_MONTHS), period],
    );
    invoiceHistory = rows.map((r) => {
      const cls = classifyInvoiceLine(r);
      return {
        period: r.period_code,
        billSourceId: r.bill_source_id,
        lineLabel: invoiceLabel(r),
        rate: n(r.rate),
        qty: n(r.qty),
        amount: n(r.amount),
        classification: cls.kind === "excluded" ? `excluded:${cls.reason}` : cls.kind,
      };
    });
  }

  return {
    period,
    asOfDate: estimate.asOfDate,
    daysInMonth: estimate.daysInMonth,
    daysElapsed: estimate.daysElapsed,
    configurationAvailable: estimate.configurationAvailable,
    costCentre: current,
    history,
    invoiceHistory,
    auditTrail,
  };
}
