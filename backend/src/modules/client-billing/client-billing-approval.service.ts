import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { clientBillingNumberingService } from "./client-billing-numbering.service.js";
import { normaliseCompanyKey, toPaise } from "./client-billing-tax.js";
import { parsePoNumbers, validatePoCoverage, type PoRow } from "./client-billing-po.js";
import { creditDays } from "./client-billing-receipt.service.js";

export interface ApproveInvoiceInput {
  invoiceId: string;
  userId: string;
}

export interface ApproveInvoiceResult {
  id: string;
  billNo: string;
  invoiceStatus: "approved";
}

function clientError(message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode });
}

/** Owner rule (audit 2026-10-14 C2): whoever created a proforma never approves it, at either step. */
export const MAKER_CHECKER_MESSAGE = "You created this proforma — another approver must approve it";
export function assertNotMaker(createdBy: unknown, userId: string): void {
  if (createdBy && String(createdBy) === String(userId)) throw clientError(MAKER_CHECKER_MESSAGE, 403);
}

/** H6: a bill needs a positive taxable total (at least one charge line outweighing deductions). */
export function assertPositiveTaxable(totalAmount: unknown): void {
  if (!(toPaise(Number(totalAmount ?? 0)) > 0)) {
    throw clientError("The taxable total must be greater than zero — add at least one charge line");
  }
}

export interface ApproveProformaResult {
  id: string;
  proformaApprovedAt: string;
}

/**
 * Step 1 of 2 — legacy "View & Approve Proforma". Signs off the proforma's figures; no bill
 * number yet. The invoice stays invoice_status='proforma' and moves to the Invoice Approval
 * queue (proforma_approved_at IS NOT NULL), where approveInvoice mints the bill number.
 */
async function approveProforma(input: { invoiceId: string; userId: string }): Promise<ApproveProformaResult> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, invoice_status, is_migrated, proforma_approved_at, created_by, total_amount
       FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.invoiceId]
    );
    const invoice = rows[0] as
      | {
          id: string; invoice_status: string; is_migrated: number; proforma_approved_at: Date | string | null;
          created_by?: string | null; total_amount?: number | string | null;
        }
      | undefined;
    if (!invoice) throw clientError(`Invoice ${input.invoiceId} not found`);
    if (invoice.is_migrated) {
      throw clientError(`Invoice ${input.invoiceId} is a migrated historical record (is_migrated=1) and cannot be approved through the live workflow`);
    }
    if (invoice.invoice_status !== "proforma") {
      throw clientError(`Invoice ${input.invoiceId} is not in proforma status (currently: ${invoice.invoice_status})`);
    }
    if (invoice.proforma_approved_at) {
      throw clientError(`Proforma ${input.invoiceId} is already approved — it is waiting in Invoice Approval`);
    }
    assertNotMaker(invoice.created_by, input.userId);
    assertPositiveTaxable(invoice.total_amount);
    await conn.execute(
      `UPDATE client_invoice SET proforma_approved_by = ?, proforma_approved_at = NOW() WHERE id = ?`,
      [input.userId, input.invoiceId]
    );
    await conn.execute(
      `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id) VALUES (?, ?, 'proforma_approved', ?)`,
      [randomUUID(), input.invoiceId, input.userId]
    );
    await conn.commit();
    return { id: input.invoiceId, proformaApprovedAt: new Date().toISOString() };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/** Step 2 of 2 — legacy "Invoice Approval": mints the bill number and consumes PO balance. */
async function approveInvoice(input: ApproveInvoiceInput): Promise<ApproveInvoiceResult> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [invoiceRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, invoice_status, cost_centre_id, finance_year, grand_total, is_migrated,
              proforma_approved_at, po_numbers, invoice_date, created_by, total_amount
       FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.invoiceId]
    );
    const invoice = invoiceRows[0] as
      | {
          id: string; invoice_status: string; cost_centre_id: string; finance_year: string; grand_total: number;
          is_migrated: number; proforma_approved_at: Date | string | null; po_numbers: string | null;
          invoice_date: string; created_by?: string | null; total_amount?: number | string | null;
        }
      | undefined;
    if (!invoice) {
      throw clientError(`Invoice ${input.invoiceId} not found`);
    }
    // design §3: a migrated historical row is read-only through the live workflow —
    // never re-approved/re-rejected. Checked before the status check below so the
    // error message is unambiguous about WHY the mutation is refused.
    if (invoice.is_migrated) {
      throw clientError(`Invoice ${input.invoiceId} is a migrated historical record (is_migrated=1) and cannot be approved through the live workflow`);
    }
    if (invoice.invoice_status !== "proforma") {
      throw clientError(`Invoice ${input.invoiceId} is not in proforma status (currently: ${invoice.invoice_status})`);
    }
    if (!invoice.proforma_approved_at) {
      throw clientError(`Proforma ${input.invoiceId} must be approved first (View & Approve Proforma) before the bill number is generated`);
    }

    assertNotMaker(invoice.created_by, input.userId);
    assertPositiveTaxable(invoice.total_amount);

    // H10: always the PO numbers stored on the proforma (validated at create / edit); a request can
    // no longer swap in different POs at approval time.
    const poNumbers = parsePoNumbers(invoice.po_numbers);
    if (poNumbers.length > 4) {
      throw clientError("Cannot attach more than 4 PO numbers to a single invoice");
    }

    let poRows: Array<{ id: string; balance_amount: number }> = [];
    if (poNumbers.length > 0) {
      const placeholders = poNumbers.map(() => "?").join(", ");
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, po_number, period_from, period_to, balance_amount, approval_status FROM client_po_number
         WHERE po_number IN (${placeholders}) AND cost_centre_id = ? FOR UPDATE`,
        [...poNumbers, invoice.cost_centre_id]
      );
      // Same rule as create / edit, now under the row locks: every PO must exist for this cost
      // centre, its period must cover the bill date, and the usable balance must cover the bill.
      // (Before, approval checked only the balance, so an unknown or out-of-period PO slipped through.)
      const coverage = validatePoCoverage({
        poNumbers,
        poRows: rows as PoRow[],
        invoiceDate: String(invoice.invoice_date).slice(0, 10),
        grandTotal: Number(invoice.grand_total),
      });
      if (!coverage.ok) throw clientError(coverage.errors.join("; "));
      poRows = coverage.usableRows as unknown as Array<{ id: string; balance_amount: number }>;
    }

    const [costCentreRows] = await conn.execute<RowDataPacket[]>(
      `SELECT cc.company_name AS companyName, b.gst_state_code AS stateCode
       FROM cost_centre_master cc
       LEFT JOIN branch_master b ON b.id = cc.branch_id
       WHERE cc.id = ?`,
      [invoice.cost_centre_id]
    );
    const costCentre = costCentreRows[0] as { companyName: string; stateCode: string | null } | undefined;
    if (!costCentre || !costCentre.stateCode) {
      throw clientError(`Cost centre ${invoice.cost_centre_id} has no branch GST state code — cannot mint a bill number`);
    }

    const billNo = await clientBillingNumberingService.mintBillNumber(
      costCentre.stateCode, costCentre.companyName, invoice.finance_year, conn
    );
    // H11: bill_no cannot carry a UNIQUE index (I-Spark history has duplicates), so refuse a number
    // another live bill of the same company already carries; throwing rolls the counter back too.
    const [dupRows] = await conn.execute<RowDataPacket[]>(
      `SELECT ci.id FROM client_invoice ci
       JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
       WHERE ci.bill_no = ? AND ci.id <> ? AND ci.invoice_status <> 'rejected'
         AND LOWER(REPLACE(REPLACE(REPLACE(COALESCE(cc.company_name, ''), ' ', ''), '.', ''), ',', '')) = ?
       LIMIT 1`,
      [billNo, input.invoiceId, normaliseCompanyKey(costCentre.companyName)]
    );
    if (Array.isArray(dupRows) && dupRows.length > 0) {
      throw clientError(
        `Bill number ${billNo} is already used by another bill of this company — the bill counter needs re-seeding (scripts/client-billing-sync-counters.ts). Nothing was approved.`,
        409,
      );
    }

    if (poRows.length > 0) {
      let remaining = Number(invoice.grand_total);
      for (const po of poRows) {
        const consume = Math.min(remaining, Number(po.balance_amount));
        await conn.execute(
          `UPDATE client_po_number SET balance_amount = balance_amount - ? WHERE id = ?`,
          [consume, po.id]
        );
        await conn.execute(
          `INSERT INTO client_po_particular (id, po_id, invoice_id, amount_consumed) VALUES (?, ?, ?, ?)`,
          [randomUUID(), po.id, input.invoiceId, consume]
        );
        remaining -= consume;
        if (remaining <= 0) break;
      }
    }

    // Due date = invoice date + the cost centre's credit days (payment terms text, default 30),
    // fixed at billing time so a later change of terms does not move an issued bill's due date.
    const [termRows] = await conn.execute<RowDataPacket[]>(
      `SELECT cc.payment_terms FROM cost_centre_master cc WHERE cc.id = ?`, [invoice.cost_centre_id]
    );
    const terms = Array.isArray(termRows) ? termRows[0] : undefined;
    await conn.execute(
      `UPDATE client_invoice SET invoice_status = 'approved', bill_no = ?,
              due_date = DATE_ADD(invoice_date, INTERVAL ? DAY) WHERE id = ?`,
      [billNo, creditDays(terms?.payment_terms), input.invoiceId]
    );

    await conn.execute(
      `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id) VALUES (?, ?, ?, ?)`,
      [randomUUID(), input.invoiceId, 'approved', input.userId]
    );

    await conn.commit();
    return { id: input.invoiceId, billNo, invoiceStatus: "approved" };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export interface RejectInvoiceInput {
  invoiceId: string;
  reason: string;
  userId: string;
}

export interface RejectInvoiceResult {
  id: string;
  invoiceStatus: "rejected";
}

async function rejectInvoice(input: RejectInvoiceInput): Promise<RejectInvoiceResult> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw clientError("A reason is required to reject an invoice");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [invoiceRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, invoice_status, is_migrated FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.invoiceId]
    );
    const invoice = invoiceRows[0] as { id: string; invoice_status: string; is_migrated: number } | undefined;
    if (!invoice) {
      throw clientError(`Invoice ${input.invoiceId} not found`);
    }
    // design §3: a migrated historical row is read-only through the live workflow.
    if (invoice.is_migrated) {
      throw clientError(`Invoice ${input.invoiceId} is a migrated historical record (is_migrated=1) and cannot be rejected through the live workflow`);
    }
    if (invoice.invoice_status === "rejected") {
      throw clientError(`Invoice ${input.invoiceId} is already rejected`);
    }
    // A billed invoice (bill number issued) is cancelled only through the delete/void change
    // request, which a second person approves and which refuses while an approved credit note or
    // a receipt exists. Direct reject here is for proformas only, so it cannot bypass those checks.
    if (invoice.invoice_status === "approved") {
      throw clientError("This invoice already has a bill number; raise a delete (void) request instead of rejecting it");
    }

    const [deductionRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, provision_id, amount_used FROM client_provision_deduction WHERE invoice_id = ?`,
      [input.invoiceId]
    );
    for (const deduction of deductionRows as Array<{ id: string; provision_id: string; amount_used: number }>) {
      await conn.execute(
        `UPDATE client_provision SET provision_balance = provision_balance + ? WHERE id = ?`,
        [deduction.amount_used, deduction.provision_id]
      );
      await conn.execute(`DELETE FROM client_provision_deduction WHERE id = ?`, [deduction.id]);
    }

    // Mirrors the provision reversal immediately above — approveInvoice can consume PO
    // balance (client_po_particular rows) as well as provision balance, and rejecting an
    // already-approved invoice must reverse both, not just one. Before this, rejecting an
    // approved invoice silently orphaned client_po_particular rows and permanently burned
    // the PO's balance_amount. A plain UPDATE ... SET balance_amount = balance_amount + ?
    // takes its own exclusive row lock atomically (InnoDB), so this is race-safe against a
    // concurrent approveInvoice's SELECT ... FOR UPDATE on the same client_po_number row
    // without needing a separate lock read first — same reasoning as the additive UPDATE
    // pattern already used for client_provision above.
    const [poParticularRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, po_id, amount_consumed FROM client_po_particular WHERE invoice_id = ?`,
      [input.invoiceId]
    );
    for (const particular of poParticularRows as Array<{ id: string; po_id: string; amount_consumed: number }>) {
      await conn.execute(
        `UPDATE client_po_number SET balance_amount = balance_amount + ? WHERE id = ?`,
        [particular.amount_consumed, particular.po_id]
      );
      await conn.execute(`DELETE FROM client_po_particular WHERE id = ?`, [particular.id]);
    }

    await conn.execute(
      `UPDATE client_invoice SET invoice_status = 'rejected', rejected_reason = ?, rejected_by = ?, rejected_at = NOW() WHERE id = ?`,
      [input.reason, input.userId, input.invoiceId]
    );

    await conn.execute(
      `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), input.invoiceId, 'rejected', input.userId, input.reason]
    );

    await conn.commit();
    return { id: input.invoiceId, invoiceStatus: "rejected" };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Rejection logic executed within a CALLER-owned transaction.
 * The caller must beginTransaction / commit / rollback — this function only executes
 * the DML (provision reversal, PO reversal, status update, audit log insert).
 * Used by the change-request void-approval flow so the void decision and the rejection
 * run atomically in the same transaction.
 */
async function rejectInvoiceInTransaction(
  conn: PoolConnection,
  input: RejectInvoiceInput,
  auditAction = "rejected",
): Promise<void> {
  const [deductionRows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, provision_id, amount_used FROM client_provision_deduction WHERE invoice_id = ?`,
    [input.invoiceId],
  );
  for (const d of deductionRows as Array<{ id: string; provision_id: string; amount_used: number }>) {
    await conn.execute(
      `UPDATE client_provision SET provision_balance = provision_balance + ? WHERE id = ?`,
      [d.amount_used, d.provision_id],
    );
    await conn.execute(`DELETE FROM client_provision_deduction WHERE id = ?`, [d.id]);
  }
  const [poParticularRows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, po_id, amount_consumed FROM client_po_particular WHERE invoice_id = ?`,
    [input.invoiceId],
  );
  for (const p of poParticularRows as Array<{ id: string; po_id: string; amount_consumed: number }>) {
    await conn.execute(
      `UPDATE client_po_number SET balance_amount = balance_amount + ? WHERE id = ?`,
      [p.amount_consumed, p.po_id],
    );
    await conn.execute(`DELETE FROM client_po_particular WHERE id = ?`, [p.id]);
  }
  await conn.execute(
    `UPDATE client_invoice SET invoice_status = 'rejected', rejected_reason = ?, rejected_by = ?, rejected_at = NOW() WHERE id = ?`,
    [input.reason, input.userId, input.invoiceId],
  );
  await conn.execute(
    `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), input.invoiceId, auditAction, input.userId, input.reason],
  );
}

export const clientBillingApprovalService = {
  approveProforma, approveInvoice, rejectInvoice, rejectInvoiceInTransaction };
