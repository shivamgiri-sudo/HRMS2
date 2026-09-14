/**
 * Off-cycle / arrears payment ledger service.
 *
 * See sql/1692_payroll_arrears_payment.sql for the full "why this exists" note. In short: no
 * mechanism existed anywhere in this codebase to pay an employee money owed from a CLOSED payroll
 * run. salary_prep_line_adjustment looked like the governed route but is confirmed dead --
 * disabled for this release, and 0 rows ever reached net_salary even when it was live. This
 * service is the real, repeatable replacement: create -> approve/reject -> mark paid, fully
 * audited, independent of any specific salary_prep_line.
 *
 * This module deliberately never writes to salary_prep_line or any other payroll-calculation
 * table. Approving a row here authorizes a payment; it does not, by itself, pay anyone. Folding
 * an approved row into what an employee is actually paid (a manual transfer against
 * payment_reference, or wiring it into a future run) is a separate, explicit action -- matching
 * every other place in this codebase where payroll arithmetic stays read-only without approval.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export type ArrearsStatus = "draft" | "pending_approval" | "approved" | "rejected" | "paid";

export interface ArrearsPayment {
  id: string;
  employee_id: string;
  source_run_id: string | null;
  target_run_id: string | null;
  amount: number;
  reason: string;
  basis_note: string | null;
  status: ArrearsStatus;
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  paid_by: string | null;
  paid_at: string | null;
  payment_reference: string | null;
}

export class ArrearsPaymentError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "ArrearsPaymentError";
  }
}

async function getById(id: string): Promise<ArrearsPayment | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM payroll_arrears_payment WHERE id = ? LIMIT 1`,
    [id],
  );
  return (rows[0] as ArrearsPayment) ?? null;
}

export const arrearsPaymentService = {
  async create(
    input: {
      employeeId: string;
      amount: number;
      reason: string;
      basisNote?: string;
      sourceRunId?: string;
      targetRunId?: string;
    },
    requestedBy: string,
  ): Promise<ArrearsPayment> {
    if (!(input.amount > 0)) {
      throw new ArrearsPaymentError(422, "Arrears amount must be greater than zero.");
    }
    if (!input.reason?.trim()) {
      throw new ArrearsPaymentError(422, "A reason is required to create an arrears payment.");
    }
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees WHERE id = ? LIMIT 1`,
      [input.employeeId],
    );
    if (!empRows.length) throw new ArrearsPaymentError(404, "Employee not found.");

    const id = randomUUID();
    await db.execute(
      `INSERT INTO payroll_arrears_payment
         (id, employee_id, source_run_id, target_run_id, amount, reason, basis_note,
          status, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?)`,
      [
        id, input.employeeId, input.sourceRunId ?? null, input.targetRunId ?? null,
        input.amount, input.reason, input.basisNote ?? null, requestedBy,
      ],
    );

    await logSensitiveAction({
      actor_user_id: requestedBy,
      action_type: "ARREARS_PAYMENT_REQUESTED",
      module_key: "payroll",
      entity_type: "payroll_arrears_payment",
      entity_id: id,
      employee_id: input.employeeId,
      reason: input.reason,
      new_value_json: { amount: input.amount, source_run_id: input.sourceRunId, target_run_id: input.targetRunId },
    });

    return (await getById(id))!;
  },

  async approve(id: string, approvedBy: string): Promise<ArrearsPayment> {
    const row = await getById(id);
    if (!row) throw new ArrearsPaymentError(404, "Arrears payment not found.");
    if (row.status !== "pending_approval") {
      throw new ArrearsPaymentError(
        409,
        `Cannot approve a payment in status '${row.status}' — only 'pending_approval' rows may be approved.`,
      );
    }
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE payroll_arrears_payment
          SET status = 'approved', approved_by = ?, approved_at = NOW()
        WHERE id = ? AND status = 'pending_approval'`,
      [approvedBy, id],
    );
    if (res.affectedRows === 0) {
      // Replay guard: another approval landed between the read above and this write.
      throw new ArrearsPaymentError(409, "This payment was already actioned by someone else.");
    }

    await logSensitiveAction({
      actor_user_id: approvedBy,
      action_type: "ARREARS_PAYMENT_APPROVED",
      module_key: "payroll",
      entity_type: "payroll_arrears_payment",
      entity_id: id,
      employee_id: row.employee_id,
      old_value_json: { status: row.status },
      new_value_json: { status: "approved", amount: row.amount },
    });

    return (await getById(id))!;
  },

  async reject(id: string, rejectedBy: string, reason: string): Promise<ArrearsPayment> {
    if (!reason?.trim()) {
      throw new ArrearsPaymentError(422, "A reason is required to reject an arrears payment.");
    }
    const row = await getById(id);
    if (!row) throw new ArrearsPaymentError(404, "Arrears payment not found.");
    if (row.status !== "pending_approval") {
      throw new ArrearsPaymentError(
        409,
        `Cannot reject a payment in status '${row.status}' — only 'pending_approval' rows may be rejected.`,
      );
    }
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE payroll_arrears_payment
          SET status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ?
        WHERE id = ? AND status = 'pending_approval'`,
      [rejectedBy, reason, id],
    );
    if (res.affectedRows === 0) {
      throw new ArrearsPaymentError(409, "This payment was already actioned by someone else.");
    }

    await logSensitiveAction({
      actor_user_id: rejectedBy,
      action_type: "ARREARS_PAYMENT_REJECTED",
      module_key: "payroll",
      entity_type: "payroll_arrears_payment",
      entity_id: id,
      employee_id: row.employee_id,
      reason,
      old_value_json: { status: row.status },
      new_value_json: { status: "rejected" },
    });

    return (await getById(id))!;
  },

  /**
   * Records that an APPROVED arrears payment was actually paid out (e.g. a manual bank
   * transfer). This is a bookkeeping step, not a payment trigger — the transfer itself happens
   * outside this system, and paymentReference documents it after the fact (bank ref / cheque no
   * / UTR). No table this touches is read by payrollCalculate.service.ts.
   */
  async markPaid(id: string, paidBy: string, paymentReference: string): Promise<ArrearsPayment> {
    if (!paymentReference?.trim()) {
      throw new ArrearsPaymentError(422, "A payment reference is required to mark an arrears payment paid.");
    }
    const row = await getById(id);
    if (!row) throw new ArrearsPaymentError(404, "Arrears payment not found.");
    if (row.status !== "approved") {
      throw new ArrearsPaymentError(
        409,
        `Cannot mark paid a payment in status '${row.status}' — only 'approved' rows may be marked paid.`,
      );
    }
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE payroll_arrears_payment
          SET status = 'paid', paid_by = ?, paid_at = NOW(), payment_reference = ?
        WHERE id = ? AND status = 'approved'`,
      [paidBy, paymentReference, id],
    );
    if (res.affectedRows === 0) {
      throw new ArrearsPaymentError(409, "This payment was already actioned by someone else.");
    }

    await logSensitiveAction({
      actor_user_id: paidBy,
      action_type: "ARREARS_PAYMENT_MARKED_PAID",
      module_key: "payroll",
      entity_type: "payroll_arrears_payment",
      entity_id: id,
      employee_id: row.employee_id,
      new_value_json: { status: "paid", payment_reference: paymentReference },
    });

    return (await getById(id))!;
  },

  getById,

  async list(filter: { employeeId?: string; status?: ArrearsStatus } = {}): Promise<ArrearsPayment[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.employeeId) { clauses.push("employee_id = ?"); params.push(filter.employeeId); }
    if (filter.status) { clauses.push("status = ?"); params.push(filter.status); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM payroll_arrears_payment ${where} ORDER BY requested_at DESC`,
      params,
    );
    return rows as ArrearsPayment[];
  },
};
