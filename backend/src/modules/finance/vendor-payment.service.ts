import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { inboxService } from "../inbox/inbox.service.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VendorPaymentFilters {
  financialYear?: string;
  month?: string;
  branchId?: string;
  processId?: string;
  costCentreId?: string;
  costClass?: string;
  head?: string;
  subHead?: string;
  vendorId?: string;
  paymentStatus?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface UpdatePaymentPayload {
  processId?: string;
  costCentreId?: string;
  costClass?: "direct" | "indirect";
  paymentMode?: string;
  paymentDate?: string;
  bankId?: string;
  transactionId?: string;
  paidAmount?: number;
  remarks?: string;
  paymentStatus?: string;
}

const BANK_MODES = ["Cheque", "NEFT", "RTGS", "IMPS", "UPI", "Bank Transfer"];

// ── Audit helper ──────────────────────────────────────────────────────────────

async function writeFinanceAudit(
  actionType: string,
  entityId: string,
  actorUserId: string,
  actorRole: string | undefined,
  changeSummary: Record<string, unknown>
) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO finance_action_audit_log
       (id, action_type, entity_type, entity_id, actor_user_id, actor_role, change_summary)
     VALUES (?, ?, 'VENDOR_PAYMENT', ?, ?, ?, ?)`,
    [id, actionType, entityId, actorUserId, actorRole ?? null, JSON.stringify(changeSummary)]
  );
}

// ── Service ───────────────────────────────────────────────────────────────────

export const vendorPaymentService = {

  async listBanks() {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, bank_name, bank_code, ifsc_prefix FROM bank_master WHERE active_status = 1 ORDER BY bank_name"
    );
    return rows;
  },

  async listPayments(filters: VendorPaymentFilters) {
    const conds: string[] = ["1=1"];
    const params: unknown[] = [];

    if (filters.financialYear) { conds.push("vpt.financial_year = ?"); params.push(filters.financialYear); }
    if (filters.month) {
      conds.push("DATE_FORMAT(vpt.due_date, '%Y-%m') = ?");
      params.push(filters.month);
    }
    if (filters.branchId)     { conds.push("vpt.branch_id = ?");    params.push(filters.branchId); }
    if (filters.processId)    { conds.push("vpt.process_id = ?");   params.push(filters.processId); }
    if (filters.costCentreId) { conds.push("vpt.cost_centre_id = ?"); params.push(filters.costCentreId); }
    if (filters.costClass)    { conds.push("vpt.cost_class = ?");   params.push(filters.costClass); }
    if (filters.head)         { conds.push("vpt.head = ?");         params.push(filters.head); }
    if (filters.subHead)      { conds.push("vpt.sub_head = ?");     params.push(filters.subHead); }
    if (filters.vendorId)     { conds.push("vpt.vendor_id = ?");    params.push(filters.vendorId); }
    if (filters.paymentStatus){ conds.push("vpt.payment_status = ?"); params.push(filters.paymentStatus); }
    if (filters.dueDateFrom)  { conds.push("vpt.due_date >= ?");    params.push(filters.dueDateFrom); }
    if (filters.dueDateTo)    { conds.push("vpt.due_date <= ?");    params.push(filters.dueDateTo); }
    if (filters.search) {
      conds.push("(vpt.grn_number LIKE ? OR vpt.vendor_name LIKE ?)");
      const like = `%${filters.search}%`;
      params.push(like, like);
    }

    const page  = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const offset = (page - 1) * limit;

    const where = `WHERE ${conds.join(" AND ")}`;

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM vendor_payment_tracking vpt ${where}`,
      params
    );
    const total = Number((countRows[0] as any).total ?? 0);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT vpt.*,
              bm.bank_name    AS bank_master_name,
              bm.ifsc_prefix,
              b.branch_name,
              b.branch_code,
              pm.process_name,
              ccm.cost_centre_name,
              vm.vendor_type,
              vm.gst_number   AS vendor_gst
       FROM vendor_payment_tracking vpt
       LEFT JOIN bank_master  bm ON bm.id = vpt.bank_id
       LEFT JOIN branch_master b  ON b.id  = vpt.branch_id
       LEFT JOIN process_master pm ON pm.id = vpt.process_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
       LEFT JOIN vendor_master vm ON vm.id = vpt.vendor_id
       ${where}
       ORDER BY vpt.due_date ASC, vpt.created_at ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { rows, total, page, limit };
  },

  async getPayment(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT vpt.*,
              bm.bank_name  AS bank_master_name,
              b.branch_name, b.branch_code,
              pm.process_name,
              ccm.cost_centre_name,
              vm.vendor_type, vm.contact_email, vm.contact_phone
       FROM vendor_payment_tracking vpt
       LEFT JOIN bank_master  bm ON bm.id = vpt.bank_id
       LEFT JOIN branch_master b  ON b.id  = vpt.branch_id
       LEFT JOIN process_master pm ON pm.id = vpt.process_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
       LEFT JOIN vendor_master vm ON vm.id = vpt.vendor_id
       WHERE vpt.id = ? LIMIT 1`,
      [id]
    );
    return (rows[0] as any) ?? null;
  },

  async updatePayment(
    id: string,
    payload: UpdatePaymentPayload,
    actorUserId: string,
    actorRole: string | undefined
  ) {
    const existing = await this.getPayment(id);
    if (!existing) throw new Error("Vendor payment record not found");

    // ── Validation ─────────────────────────────────────────────────────────────
    const paidAmount = payload.paidAmount ?? existing.paid_amount;
    const dueAmount  = Number(existing.due_amount);

    if (paidAmount > dueAmount) {
      throw new Error(`Paid amount (${paidAmount}) cannot exceed due amount (${dueAmount})`);
    }

    const mode = payload.paymentMode ?? existing.payment_mode;
    if (mode && mode !== "Cash" && !payload.transactionId && !existing.transaction_id) {
      throw new Error("Transaction ID / Cheque No. is required for this payment mode");
    }
    if (mode && BANK_MODES.includes(mode) && !payload.bankId && !existing.bank_id) {
      throw new Error("Bank Name is required for this payment mode");
    }
    if (paidAmount > 0 && !payload.paymentDate && !existing.payment_date) {
      throw new Error("Payment Date is required when paid amount is entered");
    }

    // ── Compute derived fields ─────────────────────────────────────────────────
    const balanceAmount = dueAmount - paidAmount;
    let paymentStatus = payload.paymentStatus ?? existing.payment_status;
    if (!payload.paymentStatus) {
      if (paidAmount === 0) paymentStatus = "Payment Pending";
      else if (paidAmount < dueAmount) paymentStatus = "Partially Paid";
      else paymentStatus = "Paid";
    }

    // Resolve bank name if bankId supplied
    let bankName = existing.bank_name;
    if (payload.bankId) {
      const [bRows] = await db.execute<RowDataPacket[]>(
        "SELECT bank_name FROM bank_master WHERE id = ? LIMIT 1",
        [payload.bankId]
      );
      bankName = (bRows[0] as any)?.bank_name ?? bankName;
    }

    await db.execute(
      `UPDATE vendor_payment_tracking SET
         payment_mode   = COALESCE(?, payment_mode),
         payment_date   = COALESCE(?, payment_date),
         bank_id        = COALESCE(?, bank_id),
         bank_name      = ?,
         transaction_id = COALESCE(?, transaction_id),
         paid_amount    = ?,
         balance_amount = ?,
         payment_status = ?,
         remarks        = COALESCE(?, remarks),
         updated_by     = ?,
         updated_at     = NOW()
       WHERE id = ?`,
      [
        payload.paymentMode ?? null,
        payload.paymentDate ?? null,
        payload.bankId ?? null,
        bankName,
        payload.transactionId ?? null,
        paidAmount,
        balanceAmount,
        paymentStatus,
        payload.remarks ?? null,
        actorUserId,
        id,
      ]
    );

    await writeFinanceAudit("VENDOR_PAYMENT_UPDATED", id, actorUserId, actorRole, {
      before: {
        payment_mode:   existing.payment_mode,
        payment_date:   existing.payment_date,
        bank_id:        existing.bank_id,
        transaction_id: existing.transaction_id,
        paid_amount:    existing.paid_amount,
        balance_amount: existing.balance_amount,
        payment_status: existing.payment_status,
        remarks:        existing.remarks,
      },
      after: {
        payment_mode:   payload.paymentMode ?? existing.payment_mode,
        payment_date:   payload.paymentDate ?? existing.payment_date,
        bank_id:        payload.bankId ?? existing.bank_id,
        transaction_id: payload.transactionId ?? existing.transaction_id,
        paid_amount:    paidAmount,
        balance_amount: balanceAmount,
        payment_status: paymentStatus,
        remarks:        payload.remarks ?? existing.remarks,
      },
    });

    await logSensitiveAction({
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action_type: "VENDOR_PAYMENT_UPDATED",
      module_key: "FINANCE",
      entity_type: "vendor_payment_tracking",
      entity_id: id,
      change_summary: { grn_number: existing.grn_number, payment_status: paymentStatus, paid_amount: paidAmount },
    });

    return this.getPayment(id);
  },

  async bulkUpdate(
    updates: Array<{ id: string } & UpdatePaymentPayload>,
    actorUserId: string,
    actorRole: string | undefined
  ) {
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    for (const update of updates) {
      try {
        const { id, ...payload } = update;
        await this.updatePayment(id, payload, actorUserId, actorRole);
        results.push({ id, success: true });
      } catch (err: any) {
        results.push({ id: update.id, success: false, error: err.message });
      }
    }
    return results;
  },

  async saveProofPath(
    id: string,
    fileName: string,
    filePath: string,
    fileMime: string,
    actorUserId: string
  ) {
    await db.execute(
      `UPDATE vendor_payment_tracking SET
         payment_proof_file_name = ?,
         payment_proof_file_path = ?,
         payment_proof_file_mime = ?,
         updated_by = ?, updated_at = NOW()
       WHERE id = ?`,
      [fileName, filePath, fileMime, actorUserId, id]
    );
    await writeFinanceAudit("VENDOR_PAYMENT_PROOF_UPLOADED", id, actorUserId, undefined, {
      file_name: fileName, file_mime: fileMime,
    });
  },

  async exportPayments(filters: VendorPaymentFilters) {
    const { rows } = await this.listPayments({ ...filters, limit: 5000, page: 1 });
    return rows;
  },

  // Called when a vendor GRN is approved and GRN number is generated
  async createFromGrn(grnId: string, actorUserId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT g.*, b.branch_name FROM grn_request g
       LEFT JOIN branch_master b ON b.id = g.branch_id
       WHERE g.id = ? AND g.grn_type = 'vendor' AND g.status = 'approved' LIMIT 1`,
      [grnId]
    );
    const grn = (rows[0] as any);
    if (!grn) throw new Error("Approved vendor GRN not found");

    // Idempotent — skip if row already exists
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM vendor_payment_tracking WHERE grn_request_id = ? LIMIT 1",
      [grnId]
    );
    if ((existing as RowDataPacket[]).length > 0) return null;

    const id = randomUUID();
    const dueDate = grn.due_date ?? grn.bill_date ?? null;
    const fy = grn.financial_year ?? null;

    await db.execute(
      `INSERT INTO vendor_payment_tracking
         (id, grn_request_id, grn_number, branch_id, vendor_id, vendor_name,
          head, sub_head, due_amount, due_date, grn_file_name, grn_file_path,
          grn_file_mime, paid_amount, balance_amount, payment_status, financial_year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'Payment Pending', ?)`,
      [
        id, grnId, grn.grn_number, grn.branch_id, grn.vendor_id ?? null,
        grn.vendor_name ?? null, grn.head, grn.sub_head,
        grn.amount, dueDate, grn.attachment_file_name ?? null,
        grn.attachment_file_path ?? null, grn.attachment_file_mime ?? null,
        grn.amount, fy,
      ]
    );

    // Create work inbox task for accounts_head role users
    const [accountsUsers] = await db.execute<RowDataPacket[]>(
      `SELECT u.id FROM auth_user u
       JOIN user_role_assignment ura ON ura.user_id = u.id
       WHERE ura.role_name IN ('accounts_head','finance_head') AND u.active_status = 1
       LIMIT 20`
    );
    for (const user of accountsUsers as RowDataPacket[]) {
      try {
        await inboxService.createItem({
          user_id: (user as any).id,
          type: "VENDOR_PAYMENT_PENDING",
          title: `Vendor Payment Pending — GRN ${grn.grn_number ?? grnId}`,
          description: `Branch: ${grn.branch_name ?? grn.branch_id} | Vendor: ${grn.vendor_name ?? "N/A"} | Due: ₹${Number(grn.amount).toLocaleString("en-IN")} | Due Date: ${dueDate ?? "TBD"}`,
          entity_type: "vendor_payment_tracking",
          entity_id: id,
          action_url: `/finance/vendor-payment-tracking`,
          priority: "high",
        });
      } catch {
        // Non-critical — don't fail GRN approval if inbox fails
      }
    }

    await writeFinanceAudit("VENDOR_PAYMENT_ROW_CREATED", id, actorUserId, undefined, {
      grn_id: grnId, grn_number: grn.grn_number, due_amount: grn.amount,
    });

    return id;
  },
};
