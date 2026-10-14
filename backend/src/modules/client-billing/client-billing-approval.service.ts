import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { clientBillingNumberingService } from "./client-billing-numbering.service.js";
import { parsePoNumbers } from "./client-billing-po.js";
import { creditDays } from "./client-billing-receipt.service.js";

export interface ApproveInvoiceInput {
  invoiceId: string;
  poNumbers?: string[];
  userId: string;
}

export interface ApproveInvoiceResult {
  id: string;
  billNo: string;
  invoiceStatus: "approved";
}

function clientError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
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
      `SELECT id, invoice_status, is_migrated, proforma_approved_at
       FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.invoiceId]
    );
    const invoice = rows[0] as
      | { id: string; invoice_status: string; is_migrated: number; proforma_approved_at: Date | string | null }
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
  if (input.poNumbers && input.poNumbers.length > 4) {
    throw clientError("Cannot attach more than 4 PO numbers to a single invoice");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [invoiceRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, invoice_status, cost_centre_id, finance_year, grand_total, is_migrated,
              proforma_approved_at, po_numbers
       FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.invoiceId]
    );
    const invoice = invoiceRows[0] as
      | {
          id: string; invoice_status: string; cost_centre_id: string; finance_year: string; grand_total: number;
          is_migrated: number; proforma_approved_at: Date | string | null; po_numbers: string | null;
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

    // POs typed on the proforma are stored on the row; the page's Approve button sends none,
    // so fall back to them — otherwise their balance was never consumed.
    const poNumbers = input.poNumbers && input.poNumbers.length > 0
      ? input.poNumbers
      : parsePoNumbers(invoice.po_numbers);
    if (poNumbers.length > 4) {
      throw clientError("Cannot attach more than 4 PO numbers to a single invoice");
    }

    let poRows: Array<{ id: string; balance_amount: number }> = [];
    if (poNumbers.length > 0) {
      const placeholders = poNumbers.map(() => "?").join(", ");
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, balance_amount FROM client_po_number WHERE po_number IN (${placeholders}) AND cost_centre_id = ? FOR UPDATE`,
        [...poNumbers, invoice.cost_centre_id]
      );
      poRows = rows as Array<{ id: string; balance_amount: number }>;
      const totalPoBalance = poRows.reduce(
        (sum, po) => sum + Number(po.balance_amount), 0
      );
      if (totalPoBalance < Number(invoice.grand_total)) {
        throw clientError(
          `Attached PO balance (${totalPoBalance}) is less than the invoice grand total (${invoice.grand_total})`
        );
      }
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
