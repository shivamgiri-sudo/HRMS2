/**
 * Client receipts — money received against raised bills (design:
 * docs/superpowers/specs/2026-10-14-receivables-money-flow-design.md).
 *
 * A receipt is entered once, fully allocated to bills of one client: per bill the amount that
 * reached the bank, the TDS the client withheld, and any other deduction. Settled = all three.
 * Outstanding = grand_total - settled - approved credit notes, computed LIVE from these rows
 * (`SETTLEMENT_SQL`), so a voided receipt or a rejected/withdrawn voucher immediately
 * un-settles the bill. The bank credit itself goes through the existing sales_receipt payment
 * voucher (raise -> approve -> release posts bank_account_ledger_entry); money counts as
 * "in bank" only after release.
 *
 * All money is handled in integer paise and stored as DECIMAL(14,2).
 */
import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { paymentVoucherService } from "../finance/payment-voucher.service.js";
import { ownCompanyCostCentreSql } from "../../shared/ownCompanyCostCentre.js";
import { fromPaise as taxFromPaise, toPaise as taxToPaise } from "./client-billing-tax.js";

function clientError(message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode });
}
// Paise-safe (L7): the module's single rounding rule, robust to 1.005 * 100 = 100.4999….
const toPaise = (n: unknown) => taxToPaise(Number(String(n ?? 0).replace(/,/g, "")) || 0);
const fromPaise = (p: number) => taxFromPaise(Math.round(p));

/** H9: TDS on one bill may not exceed 10% of that bill's taxable value. */
export const MAX_TDS_RATE = 0.1;

/** Rounding slack for "fully paid": half a rupee, as I-Spark bills are whole rupees. */
export const PAID_TOLERANCE = 0.5;
export const PAYMENT_MODES = ["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "DD", "Cash", "Other"] as const;

/** Credit days from the free-text cost centre payment terms ("45 days" -> 45); default 30. */
export function creditDays(paymentTerms: unknown): number {
  const m = /(\d{1,3})/.exec(String(paymentTerms ?? ""));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 365 ? n : 30;
}

/** SQL for a bill's due date: stored due_date, else invoice_date + credit days (same rule as creditDays). */
export const DUE_DATE_SQL = `COALESCE(ci.due_date, DATE_ADD(ci.invoice_date, INTERVAL COALESCE(NULLIF(LEAST(CAST(REGEXP_SUBSTR(COALESCE(cc.payment_terms, ''), '[0-9]{1,3}') AS UNSIGNED), 365), 0), 30) DAY))`;

/**
 * Per-bill settlement, joinable as `s` on s.invoice_id = ci.id. Counts only receipts that are not
 * void and whose voucher is not rejected/withdrawn. `banked` = the part whose voucher is released.
 */
export const SETTLEMENT_SQL = `
  SELECT a.invoice_id,
         SUM(a.received_amount) AS received,
         SUM(a.tds_amount) AS tds,
         SUM(a.deduction_amount) AS deduction,
         SUM(a.received_amount + a.tds_amount + a.deduction_amount) AS settled,
         SUM(CASE WHEN pv.status = 'released' OR r.is_migrated = 1 THEN a.received_amount ELSE 0 END) AS banked,
         MAX(r.receipt_date) AS last_receipt_date
  FROM client_receipt_allocation a
  JOIN client_receipt r ON r.id = a.receipt_id AND r.status = 'recorded'
  LEFT JOIN payment_voucher pv ON pv.id = r.voucher_id
  WHERE pv.id IS NULL OR pv.status NOT IN ('rejected', 'withdrawn')
  GROUP BY a.invoice_id`;

/** Approved credit notes per bill, joinable as `cn`. */
export const CREDIT_NOTE_SQL = `
  SELECT invoice_id, SUM(grand_total) AS credited FROM client_credit_note
  WHERE credit_status = 'approved' GROUP BY invoice_id`;

/** Client name: billing name, then the cost centre's client_name, and only last our company_name. */
export const CLIENT_NAME_SQL = `COALESCE(NULLIF(cc.billing_client_name, ''), NULLIF(cc.client_name, ''), cc.company_name)`;

/** The finance year a date falls in (Apr-Mar), e.g. 2026-10-14 -> 2026-27. */
export function financeYearOf(dateIso: string): string {
  const [y, m] = dateIso.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function legacyBillsAllowed(): boolean {
  return String(process.env.CLIENT_BILLING_LEGACY_COLLECTIONS_IMPORTED ?? "false").toLowerCase() === "true";
}

export interface OutstandingQuery {
  clientName?: string;
  costCentreId?: string;
  branchId?: string;
  companyName?: string;
  search?: string;
  /** Branch-scoped callers: only these branch ids. */
  branchIds?: string[] | null;
}

async function listOutstanding(q: OutstandingQuery) {
  // MAS Callnet India Pvt Ltd only (owner rule): IDC / other companies' bills never appear here.
  const conditions = ["ci.invoice_status = 'approved'", ownCompanyCostCentreSql("cc")];
  const params: unknown[] = [];
  if (!legacyBillsAllowed()) conditions.push("ci.is_migrated = 0");
  if (q.clientName) { conditions.push(`${CLIENT_NAME_SQL} = ?`); params.push(q.clientName); }
  if (q.costCentreId) { conditions.push("ci.cost_centre_id = ?"); params.push(q.costCentreId); }
  if (q.branchId) { conditions.push("cc.branch_id = ?"); params.push(q.branchId); }
  if (q.companyName) { conditions.push("cc.company_name = ?"); params.push(q.companyName); }
  if (q.branchIds) {
    if (q.branchIds.length === 0) return [];
    conditions.push(`cc.branch_id IN (${q.branchIds.map(() => "?").join(",")})`);
    params.push(...q.branchIds);
  }
  if (q.search && q.search.trim()) {
    conditions.push(`(ci.bill_no LIKE ? OR ${CLIENT_NAME_SQL} LIKE ? OR cc.cost_centre_code LIKE ?)`);
    const like = `%${q.search.trim()}%`;
    params.push(like, like, like);
  }
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ci.id, ci.bill_no, ci.invoice_date, ${DUE_DATE_SQL} AS due_date, ci.month_label, ci.finance_year,
            ci.total_amount, ci.grand_total, ci.description, ci.is_migrated,
            cc.cost_centre_code, cc.company_name, cc.branch_id, b.branch_name, ${CLIENT_NAME_SQL} AS client_name,
            COALESCE(s.received, 0) AS received, COALESCE(s.tds, 0) AS tds, COALESCE(s.deduction, 0) AS deduction,
            COALESCE(s.settled, 0) AS settled, COALESCE(cn.credited, 0) AS credited,
            ROUND(ci.grand_total - COALESCE(s.settled, 0) - COALESCE(cn.credited, 0), 2) AS outstanding,
            DATEDIFF(CURDATE(), ${DUE_DATE_SQL}) AS days_past_due
     FROM client_invoice ci
     JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
     LEFT JOIN branch_master b ON b.id = cc.branch_id
     LEFT JOIN (${SETTLEMENT_SQL}) s ON s.invoice_id = ci.id
     LEFT JOIN (${CREDIT_NOTE_SQL}) cn ON cn.invoice_id = ci.id
     WHERE ${conditions.join(" AND ")}
     HAVING outstanding > ${PAID_TOLERANCE}
     ORDER BY ${CLIENT_NAME_SQL}, ci.invoice_date, ci.bill_no
     LIMIT 1000`,
    params,
  );
  return rows;
}

export interface AllocationInput { invoiceId: string; received: number; tds?: number; deduction?: number }
export interface CreateReceiptInput {
  receiptDate: string;
  bankAccountId: string;
  paymentMode: string;
  referenceNo?: string | null;
  remarks?: string | null;
  /** Optional cross-check: what the user says reached the bank. Must equal the allocations' sum. */
  amountReceived?: number;
  allocations: AllocationInput[];
  userId: string;
  userRole?: string;
}

/** Locks the bills and returns each one's live outstanding (paise) and client identity. */
async function lockBills(conn: PoolConnection, invoiceIds: string[]) {
  const ids = [...new Set(invoiceIds)].sort();
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT ci.id, ci.bill_no, ci.invoice_status, ci.is_migrated, ci.grand_total, ci.total_amount, ci.cost_centre_id,
            cc.company_name, cc.branch_id, ${CLIENT_NAME_SQL} AS client_name, (${ownCompanyCostCentreSql("cc")}) AS is_mas
     FROM client_invoice ci JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
     WHERE ci.id IN (${ids.map(() => "?").join(",")})
     ORDER BY ci.id
     FOR UPDATE`,
    ids,
  );
  if (rows.length !== ids.length) throw clientError("One or more bills were not found");
  const [settled] = await conn.query<RowDataPacket[]>(
    `SELECT ci.id, COALESCE(s.settled, 0) AS settled, COALESCE(cn.credited, 0) AS credited
     FROM client_invoice ci
     LEFT JOIN (${SETTLEMENT_SQL}) s ON s.invoice_id = ci.id
     LEFT JOIN (${CREDIT_NOTE_SQL}) cn ON cn.invoice_id = ci.id
     WHERE ci.id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  const settledById = new Map(settled.map((r) => [String(r.id), r]));
  return rows.map((r) => {
    const s = settledById.get(String(r.id));
    return {
      id: String(r.id), bill_no: r.bill_no as string | null, invoice_status: String(r.invoice_status),
      is_migrated: Number(r.is_migrated), client_name: String(r.client_name), company_name: r.company_name as string | null,
      is_mas: Number(r.is_mas) === 1,
      branch_id: (r.branch_id as string | null) ?? null,
      taxablePaise: toPaise(r.total_amount),
      outstandingPaise: toPaise(r.grand_total) - toPaise(s?.settled) - toPaise(s?.credited),
    };
  });
}

/** Keeps client_invoice_payment_status (read by the legacy Client Payments screen) in step. */
async function refreshPaymentStatus(conn: PoolConnection, invoiceIds: string[]) {
  for (const id of [...new Set(invoiceIds)]) {
    const [[row]] = await conn.query<RowDataPacket[]>(
      `SELECT ci.id, ci.grand_total, ci.legacy_id, COALESCE(s.received, 0) AS received, COALESCE(s.tds, 0) AS tds,
              COALESCE(s.deduction, 0) AS deduction, COALESCE(s.settled, 0) AS settled, s.last_receipt_date,
              COALESCE(cn.credited, 0) AS credited
       FROM client_invoice ci
       LEFT JOIN (${SETTLEMENT_SQL}) s ON s.invoice_id = ci.id
       LEFT JOIN (${CREDIT_NOTE_SQL}) cn ON cn.invoice_id = ci.id
       WHERE ci.id = ?`,
      [id],
    );
    if (!row) continue;
    const outstanding = fromPaise(toPaise(row.grand_total) - toPaise(row.settled) - toPaise(row.credited));
    const status = outstanding <= PAID_TOLERANCE ? "paid" : Number(row.settled) > 0 ? "partial" : "pending";
    await conn.execute(
      `INSERT INTO client_invoice_payment_status
         (id, invoice_id, legacy_invoice_id, payment_status, total_amount, amount_received, tds_deducted,
          other_deduction, net_received, last_payment_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE payment_status = VALUES(payment_status), total_amount = VALUES(total_amount),
         amount_received = VALUES(amount_received), tds_deducted = VALUES(tds_deducted),
         other_deduction = VALUES(other_deduction), net_received = VALUES(net_received),
         last_payment_date = VALUES(last_payment_date)`,
      [randomUUID(), id, row.legacy_id ?? null, status, row.grand_total, row.received, row.tds, row.deduction,
        row.received, row.last_receipt_date ?? null],
    );
  }
}

async function nextReceiptNo(conn: PoolConnection, financeYear: string): Promise<string> {
  const [result] = await conn.execute(
    `INSERT INTO client_invoice_number_sequence (kind, scope_key, \`last_value\`, updated_at)
     VALUES ('receipt', ?, LAST_INSERT_ID(1), NOW())
     ON DUPLICATE KEY UPDATE \`last_value\` = LAST_INSERT_ID(\`last_value\` + 1), updated_at = NOW()`,
    [financeYear],
  );
  const n = (result as { insertId: number }).insertId;
  return `RCPT/${financeYear.slice(2)}/${String(n).padStart(5, "0")}`;
}

async function createReceipt(input: CreateReceiptInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.receiptDate)) || Number.isNaN(Date.parse(input.receiptDate))) {
    throw clientError("Receipt date must be a valid YYYY-MM-DD date");
  }
  if (input.receiptDate > new Date().toISOString().slice(0, 10)) throw clientError("Receipt date cannot be in the future");
  if (!PAYMENT_MODES.includes(input.paymentMode as (typeof PAYMENT_MODES)[number])) {
    throw clientError(`Payment mode must be one of ${PAYMENT_MODES.join(", ")}`);
  }
  if (!input.bankAccountId) throw clientError("Bank account is required");
  if (!Array.isArray(input.allocations) || input.allocations.length === 0) throw clientError("Allocate the receipt to at least one bill");
  const lines = input.allocations.map((a) => ({
    invoiceId: String(a.invoiceId),
    received: toPaise(a.received),
    tds: toPaise(a.tds ?? 0),
    deduction: toPaise(a.deduction ?? 0),
  }));
  if (new Set(lines.map((l) => l.invoiceId)).size !== lines.length) throw clientError("A bill appears twice in the allocation");
  for (const l of lines) {
    if (l.received < 0 || l.tds < 0 || l.deduction < 0) throw clientError("Amounts cannot be negative");
    if (l.received + l.tds + l.deduction === 0) throw clientError("Every allocated bill needs an amount");
  }
  const remarks = String(input.remarks ?? "").trim();
  if (lines.some((l) => l.deduction > 0) && remarks.length < 5) {
    throw clientError("A deduction needs a reason — write it in the remarks (at least 5 characters)");
  }
  const receivedPaise = lines.reduce((s, l) => s + l.received, 0);
  const tdsPaise = lines.reduce((s, l) => s + l.tds, 0);
  const deductionPaise = lines.reduce((s, l) => s + l.deduction, 0);
  if (receivedPaise <= 0) throw clientError("Amount received must be greater than zero");
  if (input.amountReceived !== undefined && toPaise(input.amountReceived) !== receivedPaise) {
    throw clientError(`Amount received (${input.amountReceived}) does not match the total allocated to bills (${fromPaise(receivedPaise)})`);
  }

  const conn = await db.getConnection();
  let receiptId = "";
  let receiptNo = "";
  let clientName = "";
  try {
    await conn.beginTransaction();
    const [[bank]] = await conn.query<RowDataPacket[]>(
      `SELECT id, active_status FROM company_bank_account WHERE id = ? LIMIT 1`, [input.bankAccountId],
    );
    if (!bank) throw clientError("Bank account not found");
    if (!Number(bank.active_status)) throw clientError("That bank account is closed");

    const bills = await lockBills(conn, lines.map((l) => l.invoiceId));
    const byId = new Map(bills.map((b) => [String(b.id), b]));
    clientName = String(bills[0].client_name);
    for (const b of bills) {
      if (b.invoice_status !== "approved") throw clientError(`${b.bill_no ?? b.id} is not an approved bill`);
      if (!b.is_mas) throw clientError(`${b.bill_no} is not a MAS Callnet India Pvt Ltd bill`);
      if (Number(b.is_migrated) === 1 && !legacyBillsAllowed()) {
        throw clientError(`${b.bill_no} is an I-Spark bill; its collections come in through the legacy import, not here`);
      }
      if (String(b.client_name) !== clientName) throw clientError("All bills in one receipt must be of the same client");
      if (String(b.company_name) !== String(bills[0].company_name)) throw clientError("All bills in one receipt must be of the same company");
    }
    for (const l of lines) {
      const b = byId.get(l.invoiceId)!;
      if (l.tds > 0 && l.tds * 10 > b.taxablePaise) {
        throw clientError(
          `${b.bill_no}: TDS ${fromPaise(l.tds)} is more than 10% of the bill's taxable value ${fromPaise(b.taxablePaise)} — check the TDS amount`,
        );
      }
      const settle = l.received + l.tds + l.deduction;
      if (settle > b.outstandingPaise) {
        throw clientError(`${b.bill_no}: ${fromPaise(settle)} is more than its outstanding ${fromPaise(b.outstandingPaise)}`);
      }
    }
    const branches = new Set(bills.map((b) => b.branch_id ?? ""));
    const financeYear = financeYearOf(input.receiptDate);
    receiptNo = await nextReceiptNo(conn, financeYear);
    receiptId = randomUUID();
    await conn.execute(
      `INSERT INTO client_receipt
         (id, receipt_no, finance_year, receipt_date, client_name, company_name, branch_id, amount_received,
          tds_amount, other_deduction, payment_mode, reference_no, bank_account_id, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receiptId, receiptNo, financeYear, input.receiptDate, clientName, bills[0].company_name ?? null,
        branches.size === 1 ? (bills[0].branch_id ?? null) : null, fromPaise(receivedPaise), fromPaise(tdsPaise),
        fromPaise(deductionPaise), input.paymentMode, String(input.referenceNo ?? "").trim().slice(0, 100) || null,
        input.bankAccountId, remarks.slice(0, 500) || null, input.userId],
    );
    for (const l of lines) {
      await conn.execute(
        `INSERT INTO client_receipt_allocation (id, receipt_id, invoice_id, received_amount, tds_amount, deduction_amount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), receiptId, l.invoiceId, fromPaise(l.received), fromPaise(l.tds), fromPaise(l.deduction)],
      );
      await conn.execute(
        `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, 'receipt_recorded', ?, ?)`,
        [randomUUID(), l.invoiceId, input.userId,
          `${receiptNo}: received ${fromPaise(l.received)}, TDS ${fromPaise(l.tds)}, deduction ${fromPaise(l.deduction)}${l.deduction > 0 ? ` (${remarks})` : ""}`.slice(0, 2000)],
      );
    }
    await refreshPaymentStatus(conn, lines.map((l) => l.invoiceId));
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  // Bank credit through the existing receipt voucher workflow (its own transaction).
  const billNos = (await billNumbers(lines.map((l) => l.invoiceId))).join(", ");
  try {
    const voucher = await paymentVoucherService.raise(
      {
        sourceType: "sales_receipt",
        bankAccountId: input.bankAccountId,
        payableAccountId: "",
        clientName,
        amount: fromPaise(receivedPaise),
        paymentMode: input.paymentMode,
        transactionRef: input.referenceNo ?? null,
        remarks: `${receiptNo} against ${billNos}`.slice(0, 500),
      },
      input.userId,
      input.userRole,
    );
    await db.execute(`UPDATE client_receipt SET voucher_id = ? WHERE id = ?`, [(voucher as { id: string }).id, receiptId]);
  } catch (e) {
    await voidInternal(receiptId, `Receipt voucher could not be raised: ${(e as Error).message}`.slice(0, 500), input.userId);
    throw clientError(`Receipt not saved: the bank receipt voucher could not be raised (${(e as Error).message})`);
  }
  return getReceipt(receiptId);
}

async function billNumbers(ids: string[]): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT bill_no FROM client_invoice WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY bill_no`, ids,
  );
  return rows.map((r) => String(r.bill_no));
}

async function voidInternal(receiptId: string, reason: string, userId: string) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [upd] = await conn.execute(
      `UPDATE client_receipt SET status = 'void', void_reason = ?, voided_by = ?, voided_at = NOW() WHERE id = ? AND status = 'recorded'`,
      [reason, userId, receiptId],
    );
    const [alloc] = await conn.query<RowDataPacket[]>(
      `SELECT a.invoice_id, a.received_amount, a.tds_amount, a.deduction_amount, r.receipt_no
       FROM client_receipt_allocation a JOIN client_receipt r ON r.id = a.receipt_id WHERE a.receipt_id = ?`,
      [receiptId],
    );
    if (Number((upd as { affectedRows?: number })?.affectedRows ?? 0) > 0) {
      for (const a of alloc) {
        await conn.execute(
          `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, 'receipt_voided', ?, ?)`,
          [randomUUID(), String(a.invoice_id), userId,
            `${a.receipt_no ?? receiptId}: received ${Number(a.received_amount)}, TDS ${Number(a.tds_amount)}, deduction ${Number(a.deduction_amount)} — ${reason}`.slice(0, 2000)],
        );
      }
    }
    await refreshPaymentStatus(conn, alloc.map((a) => String(a.invoice_id)));
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Void: allowed while the bank voucher is not released; withdraws a still-pending voucher. */
async function voidReceipt(id: string, reason: string, userId: string, userRole?: string) {
  const why = String(reason ?? "").trim();
  if (why.length < 5) throw clientError("A reason of at least 5 characters is required");
  const [[r]] = await db.query<RowDataPacket[]>(
    `SELECT r.*, pv.status AS voucher_status FROM client_receipt r LEFT JOIN payment_voucher pv ON pv.id = r.voucher_id WHERE r.id = ?`, [id],
  );
  if (!r) throw clientError("Receipt not found", 404);
  if (r.status === "void") throw clientError("Receipt is already void");
  if (Number(r.is_migrated) === 1) throw clientError("An imported I-Spark collection cannot be voided here");
  if (r.voucher_status === "released") {
    throw clientError("The money is already posted to the bank ledger (voucher released); reverse it with a journal instead");
  }
  if (r.voucher_id && !["rejected", "withdrawn"].includes(String(r.voucher_status))) {
    await paymentVoucherService.withdraw(String(r.voucher_id), userId, userRole, `Receipt ${r.receipt_no} voided: ${why}`);
  }
  await voidInternal(id, why.slice(0, 500), userId);
  return getReceipt(id);
}

export interface ReceiptListQuery {
  fromDate?: string; toDate?: string; branchId?: string; companyName?: string; search?: string; status?: string;
  page?: number; limit?: number; branchIds?: string[] | null;
}

const RECEIPT_STATE_SQL = `CASE
    WHEN r.status = 'void' THEN 'void'
    WHEN r.is_migrated = 1 THEN 'in_bank'
    WHEN pv.status = 'released' THEN 'in_bank'
    WHEN pv.status IN ('rejected', 'withdrawn') THEN 'voucher_rejected'
    ELSE 'awaiting_bank' END`;

async function listReceipts(q: ReceiptListQuery) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (q.fromDate) { conditions.push("r.receipt_date >= ?"); params.push(q.fromDate); }
  if (q.toDate) { conditions.push("r.receipt_date <= ?"); params.push(q.toDate); }
  if (q.branchId) { conditions.push("r.branch_id = ?"); params.push(q.branchId); }
  if (q.companyName) { conditions.push("r.company_name = ?"); params.push(q.companyName); }
  if (q.branchIds) {
    if (q.branchIds.length === 0) return { rows: [], total: 0, page: 1, limit: 50 };
    conditions.push(`r.branch_id IN (${q.branchIds.map(() => "?").join(",")})`);
    params.push(...q.branchIds);
  }
  if (q.search && q.search.trim()) {
    const like = `%${q.search.trim()}%`;
    conditions.push("(r.receipt_no LIKE ? OR r.client_name LIKE ? OR r.reference_no LIKE ?)");
    params.push(like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const having = q.status ? `HAVING state = ${db.escape(q.status)}` : "";
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT r.*, ${RECEIPT_STATE_SQL} AS state, pv.voucher_number, pv.status AS voucher_status,
            b.branch_name, cba.account_name AS bank_account_name,
            (SELECT GROUP_CONCAT(ci.bill_no ORDER BY ci.bill_no SEPARATOR ', ') FROM client_receipt_allocation a
              JOIN client_invoice ci ON ci.id = a.invoice_id WHERE a.receipt_id = r.id) AS bill_nos
     FROM client_receipt r
     LEFT JOIN payment_voucher pv ON pv.id = r.voucher_id
     LEFT JOIN branch_master b ON b.id = r.branch_id
     LEFT JOIN company_bank_account cba ON cba.id = r.bank_account_id
     ${where} ${having}
     ORDER BY r.receipt_date DESC, r.created_at DESC, r.id DESC
     LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    params,
  );
  const [[count]] = await db.query<RowDataPacket[]>(
    q.status
      ? `SELECT COUNT(*) AS total FROM (SELECT ${RECEIPT_STATE_SQL} AS state FROM client_receipt r LEFT JOIN payment_voucher pv ON pv.id = r.voucher_id ${where} ${having}) x`
      : `SELECT COUNT(*) AS total FROM client_receipt r ${where}`,
    params,
  );
  return { rows, total: Number(count?.total ?? 0), page, limit };
}

async function getReceipt(id: string) {
  const [[r]] = await db.query<RowDataPacket[]>(
    `SELECT r.*, ${RECEIPT_STATE_SQL} AS state, pv.voucher_number, pv.status AS voucher_status, cba.account_name AS bank_account_name
     FROM client_receipt r LEFT JOIN payment_voucher pv ON pv.id = r.voucher_id
     LEFT JOIN company_bank_account cba ON cba.id = r.bank_account_id WHERE r.id = ?`, [id],
  );
  if (!r) throw clientError("Receipt not found", 404);
  const [allocations] = await db.query<RowDataPacket[]>(
    `SELECT a.*, ci.bill_no, ci.invoice_date, ci.grand_total FROM client_receipt_allocation a
     JOIN client_invoice ci ON ci.id = a.invoice_id WHERE a.receipt_id = ? ORDER BY ci.bill_no`, [id],
  );
  return { ...r, branch_id: (r.branch_id as string | null) ?? null, allocations };
}

export const clientBillingReceiptService = { listOutstanding, createReceipt, voidReceipt, listReceipts, getReceipt };
