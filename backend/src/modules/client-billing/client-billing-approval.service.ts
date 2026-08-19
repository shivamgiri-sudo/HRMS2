import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { clientBillingNumberingService } from "./client-billing-numbering.service.js";

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

async function approveInvoice(input: ApproveInvoiceInput): Promise<ApproveInvoiceResult> {
  if (input.poNumbers && input.poNumbers.length > 4) {
    throw clientError("Cannot attach more than 4 PO numbers to a single invoice");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [invoiceRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, invoice_status, cost_centre_id, finance_year, grand_total
       FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.invoiceId]
    );
    const invoice = invoiceRows[0] as
      | { id: string; invoice_status: string; cost_centre_id: string; finance_year: string; grand_total: number }
      | undefined;
    if (!invoice) {
      throw clientError(`Invoice ${input.invoiceId} not found`);
    }
    if (invoice.invoice_status !== "proforma") {
      throw clientError(`Invoice ${input.invoiceId} is not in proforma status (currently: ${invoice.invoice_status})`);
    }

    let poRows: Array<{ id: string; balance_amount: number }> = [];
    if (input.poNumbers && input.poNumbers.length > 0) {
      const placeholders = input.poNumbers.map(() => "?").join(", ");
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, balance_amount FROM client_po_number WHERE po_number IN (${placeholders}) AND cost_centre_id = ? FOR UPDATE`,
        [...input.poNumbers, invoice.cost_centre_id]
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

    await conn.execute(
      `UPDATE client_invoice SET invoice_status = 'approved', bill_no = ? WHERE id = ?`,
      [billNo, input.invoiceId]
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
      `SELECT id, invoice_status FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.invoiceId]
    );
    const invoice = invoiceRows[0] as { id: string; invoice_status: string } | undefined;
    if (!invoice) {
      throw clientError(`Invoice ${input.invoiceId} not found`);
    }
    if (invoice.invoice_status === "rejected") {
      throw clientError(`Invoice ${input.invoiceId} is already rejected`);
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

export const clientBillingApprovalService = { approveInvoice, rejectInvoice };
