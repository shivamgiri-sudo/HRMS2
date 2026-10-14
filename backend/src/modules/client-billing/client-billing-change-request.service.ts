/**
 * Maker-checker change requests on an invoice — legacy `view_status_change_request`
 * (RequestInvoiceType / InvoiceTypeRemarks) and the commented-out `delete_invoice` flow,
 * rebuilt with a real approval gate, audit trail and balance reversal.
 *
 *  - `void`           : request to cancel a proforma/approved invoice. On approval the invoice is
 *                       moved to `rejected` via the SAME code path as a direct reject
 *                       (clientBillingApprovalService.rejectInvoiceInTransaction), which gives
 *                       back provision and PO balances. Blocked while an approved or DRAFT
 *                       credit note or a receipt allocation exists against the invoice, and
 *                       once the bill has been exported to Tally (raise a credit note instead).
 *  - `status_change`  : request to change the invoice's TYPE/CATEGORY (legacy "invoice type"
 *                       change). On approval `client_invoice.category` is updated.
 *
 * Maker-checker: the approver must be a different user than the requester.
 */
import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { clientBillingApprovalService } from "./client-billing-approval.service.js";

export const INVOICE_TYPE_OPTIONS = [
  "Subscription",
  "Non Subscription",
  "Talk Time",
  "Setup Cost",
  "One time cost",
  "Development Cost",
  "Topup",
  "Others",
] as const;

export type ChangeRequestType = "void" | "status_change";
export type ChangeRequestStatus = "pending" | "approved" | "declined";

function clientError(message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode });
}

export interface CreateChangeRequestInput {
  invoiceId: string;
  requestType: ChangeRequestType;
  reason: string;
  requestedValue?: string;
  userId: string;
}

async function tableExists(
  conn: PoolConnection,
  table: string,
): Promise<boolean> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT 1 AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table],
  );
  return rows.length > 0;
}

/**
 * Void is refused once the bill is in Tally, or while a draft credit note waits on it (audit
 * 2026-10-14). Caller holds the invoice lock.
 */
async function assertNoTallyOrDraftCredit(conn: PoolConnection, invoiceId: string): Promise<void> {
  const [exported] = await conn.execute<RowDataPacket[]>(
    `SELECT 1 AS present FROM tally_voucher_export WHERE source_type = 'invoice' AND source_id = ? LIMIT 1`,
    [invoiceId],
  );
  if (Array.isArray(exported) && exported.length > 0) {
    throw clientError(
      "This bill has already been exported to Tally, so it cannot be voided — raise a credit note instead",
    );
  }
  const [drafts] = await conn.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM client_credit_note WHERE invoice_id = ? AND credit_status = 'draft'`,
    [invoiceId],
  );
  if (Number(drafts[0]?.n ?? 0) > 0) {
    throw clientError(
      "A draft credit note is waiting on this bill; reject that credit note first, then void the bill",
    );
  }
}

async function createChangeRequest(
  input: CreateChangeRequestInput,
): Promise<{ id: string }> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 5) {
    throw clientError("A reason of at least 5 characters is required");
  }
  if (input.requestType !== "void" && input.requestType !== "status_change") {
    throw clientError("requestType must be 'void' or 'status_change'");
  }
  if (input.requestType === "status_change") {
    if (
      !input.requestedValue ||
      !(INVOICE_TYPE_OPTIONS as readonly string[]).includes(
        input.requestedValue,
      )
    ) {
      throw clientError(
        `requestedValue must be one of: ${INVOICE_TYPE_OPTIONS.join(", ")}`,
      );
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, invoice_status, category, is_migrated FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.invoiceId],
    );
    const invoice = rows[0];
    if (!invoice)
      throw clientError(`Invoice ${input.invoiceId} not found`, 404);
    if (invoice.is_migrated) {
      throw clientError(
        "A migrated historical invoice cannot be changed through the live workflow",
      );
    }
    if (invoice.invoice_status === "rejected") {
      throw clientError("The invoice is already rejected/void");
    }
    if (input.requestType === "void") {
      await assertNoTallyOrDraftCredit(conn, input.invoiceId);
    }
    if (
      input.requestType === "status_change" &&
      invoice.category === input.requestedValue
    ) {
      throw clientError(
        `The invoice is already of type ${input.requestedValue}`,
      );
    }

    const [pending] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM client_invoice_change_request
       WHERE invoice_id = ? AND request_type = ? AND request_status = 'pending' LIMIT 1`,
      [input.invoiceId, input.requestType],
    );
    if (pending.length > 0) {
      throw clientError(
        `A ${input.requestType === "void" ? "void" : "status-change"} request is already pending for this invoice`,
      );
    }

    const id = randomUUID();
    await conn.execute(
      `INSERT INTO client_invoice_change_request
         (id, invoice_id, request_type, current_value, requested_value, reason, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.invoiceId,
        input.requestType,
        input.requestType === "status_change"
          ? String(invoice.category)
          : String(invoice.invoice_status),
        input.requestedValue ?? null,
        reason,
        input.userId,
      ],
    );
    await conn.execute(
      `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.invoiceId,
        input.requestType === "void"
          ? "void_requested"
          : "status_change_requested",
        input.userId,
        input.requestType === "status_change"
          ? `${invoice.category} → ${input.requestedValue}: ${reason}`
          : reason,
      ],
    );
    await conn.commit();
    return { id };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export interface DecideChangeRequestInput {
  requestId: string;
  decision: "approve" | "decline";
  note?: string;
  userId: string;
}

async function decideChangeRequest(
  input: DecideChangeRequestInput,
): Promise<{ id: string; requestStatus: ChangeRequestStatus }> {
  if (input.decision !== "approve" && input.decision !== "decline") {
    throw clientError("decision must be 'approve' or 'decline'");
  }
  const note = String(input.note ?? "").trim();
  if (input.decision === "decline" && note.length < 3) {
    throw clientError("A note is required to decline a request");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [reqRows] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM client_invoice_change_request WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.requestId],
    );
    const request = reqRows[0];
    if (!request) throw clientError("Change request not found", 404);
    if (request.request_status !== "pending") {
      throw clientError(`Request is already ${request.request_status}`);
    }
    if (request.requested_by === input.userId) {
      throw clientError(
        "Maker-checker: the person who raised a request cannot decide it",
        403,
      );
    }

    const invoiceId = String(request.invoice_id);
    const isVoid = request.request_type === "void";

    if (input.decision === "approve") {
      const [invRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, invoice_status, is_migrated FROM client_invoice WHERE id = ? LIMIT 1 FOR UPDATE`,
        [invoiceId],
      );
      const invoice = invRows[0];
      if (!invoice) throw clientError("Invoice no longer exists", 404);
      if (invoice.invoice_status === "rejected") {
        throw clientError("The invoice is already rejected/void");
      }

      if (isVoid) {
        await assertNoTallyOrDraftCredit(conn, invoiceId);
        const [cnRows] = await conn.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM client_credit_note WHERE invoice_id = ? AND credit_status = 'approved'`,
          [invoiceId],
        );
        if (Number(cnRows[0]?.n ?? 0) > 0) {
          throw clientError(
            "An approved credit note exists against this invoice; it cannot be voided",
          );
        }
        if (await tableExists(conn, "client_receipt_allocation")) {
          const [allocRows] = await conn.execute<RowDataPacket[]>(
            // Only live receipts block a void: a voided receipt, or one whose bank voucher was
            // rejected/withdrawn, no longer settles anything.
            `SELECT COUNT(*) AS n FROM client_receipt_allocation a
             JOIN client_receipt r ON r.id = a.receipt_id AND r.status = 'recorded'
             LEFT JOIN payment_voucher pv ON pv.id = r.voucher_id
             WHERE a.invoice_id = ? AND (pv.id IS NULL OR pv.status NOT IN ('rejected', 'withdrawn'))`,
            [invoiceId],
          );
          if (Number(allocRows[0]?.n ?? 0) > 0) {
            throw clientError(
              "Receipts are recorded against this invoice; void those receipts first",
            );
          }
        }
        await clientBillingApprovalService.rejectInvoiceInTransaction(
          conn,
          {
            invoiceId,
            userId: input.userId,
            reason: `Void approved: ${String(request.reason)}`.slice(0, 1000),
          },
          "void_approved",
        );
      } else {
        await conn.execute(
          `UPDATE client_invoice SET category = ? WHERE id = ?`,
          [String(request.requested_value), invoiceId],
        );
        await conn.execute(
          `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, 'status_change_approved', ?, ?)`,
          [
            randomUUID(),
            invoiceId,
            input.userId,
            `${request.current_value} → ${request.requested_value}${note ? `: ${note}` : ""}`,
          ],
        );
      }
    } else {
      await conn.execute(
        `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          invoiceId,
          isVoid ? "void_declined" : "status_change_declined",
          input.userId,
          note,
        ],
      );
    }

    const status: ChangeRequestStatus =
      input.decision === "approve" ? "approved" : "declined";
    await conn.execute(
      `UPDATE client_invoice_change_request
       SET request_status = ?, decided_by = ?, decided_at = NOW(), decision_note = ?
       WHERE id = ?`,
      [status, input.userId, note || null, input.requestId],
    );

    await conn.commit();
    return { id: input.requestId, requestStatus: status };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export interface BulkApproveResult {
  invoiceId: string;
  ok: boolean;
  billNo?: string;
  error?: string;
}

const BULK_APPROVE_MAX = 100;

/** Approves proformas one by one, each in its own transaction; one failure never blocks the rest. */
async function bulkApprove(
  invoiceIds: string[],
  userId: string,
): Promise<BulkApproveResult[]> {
  const unique = [...new Set(invoiceIds.map(String))];
  if (unique.length === 0) throw clientError("invoiceIds is required");
  if (unique.length > BULK_APPROVE_MAX) {
    throw clientError(
      `At most ${BULK_APPROVE_MAX} invoices can be approved at once`,
    );
  }
  const results: BulkApproveResult[] = [];
  for (const invoiceId of unique) {
    try {
      const r = await clientBillingApprovalService.approveInvoice({
        invoiceId,
        userId,
      });
      results.push({ invoiceId, ok: true, billNo: r.billNo });
    } catch (error) {
      results.push({
        invoiceId,
        ok: false,
        error: error instanceof Error ? error.message : "Approval failed",
      });
    }
  }
  return results;
}

export const clientBillingChangeRequestService = {
  createChangeRequest,
  decideChangeRequest,
  bulkApprove,
};
