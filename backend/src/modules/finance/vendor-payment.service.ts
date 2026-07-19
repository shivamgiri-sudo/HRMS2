import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { inboxService } from "../inbox/inbox.service.js";

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

const PAYMENT_MODES = [
  "Cheque",
  "NEFT",
  "RTGS",
  "IMPS",
  "UPI",
  "Cash",
  "Bank Transfer",
  "Adjustment",
  "Other",
] as const;
const BANK_MODES = new Set([
  "Cheque",
  "NEFT",
  "RTGS",
  "IMPS",
  "UPI",
  "Bank Transfer",
]);
const PAYMENT_STATUSES = new Set([
  "Payment Pending",
  "Partially Paid",
  "Paid",
  "On Hold",
  "Rejected",
  "Closed",
]);

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function writeFinanceAudit(
  actionType: string,
  entityId: string,
  actorUserId: string,
  actorRole: string | undefined,
  changeSummary: Record<string, unknown>,
  executor: any = db
) {
  await executor.execute(
    `INSERT INTO finance_action_audit_log
       (id, action_type, entity_type, entity_id, actor_user_id, actor_role, change_summary)
     VALUES (?, ?, 'VENDOR_PAYMENT', ?, ?, ?, ?)`,
    [
      randomUUID(),
      actionType,
      entityId,
      actorUserId,
      actorRole ?? null,
      JSON.stringify(changeSummary),
    ]
  );
}

function ensureImmutableAttribution(existing: any, payload: UpdatePaymentPayload) {
  if (payload.processId != null && payload.processId !== (existing.process_id ?? "")) {
    throw new Error("Process mapping is locked from the approved GRN");
  }
  if (
    payload.costCentreId != null
    && payload.costCentreId !== (existing.cost_centre_id ?? "")
  ) {
    throw new Error("Cost centre mapping is locked from the approved GRN");
  }
  if (payload.costClass != null && payload.costClass !== existing.cost_class) {
    throw new Error("Cost classification is locked from the approved GRN");
  }
}

function grnPaymentStatus(paymentStatus: string, paidAmount: number) {
  if (paymentStatus === "Paid") {
    return { grnStatus: "paid", accountsStatus: "paid" };
  }
  if (paymentStatus === "Partially Paid") {
    return { grnStatus: "partially_paid", accountsStatus: "partially_paid" };
  }
  if (paymentStatus === "On Hold") {
    return {
      grnStatus: paidAmount > 0 ? "partially_paid" : "pending_accounts_payment",
      accountsStatus: "on_hold",
    };
  }
  return { grnStatus: "pending_accounts_payment", accountsStatus: "pending" };
}

export const vendorPaymentService = {
  async listBanks() {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, bank_name, bank_code, ifsc_prefix
         FROM bank_master
        WHERE active_status = 1
        ORDER BY bank_name`
    );
    return rows;
  },

  async listPayments(filters: VendorPaymentFilters) {
    const conditions: string[] = ["1=1"];
    const params: unknown[] = [];

    if (filters.financialYear) {
      conditions.push("vpt.financial_year = ?");
      params.push(filters.financialYear);
    }
    if (filters.month) {
      conditions.push("DATE_FORMAT(vpt.due_date, '%Y-%m') = ?");
      params.push(filters.month);
    }
    if (filters.branchId) {
      conditions.push("vpt.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.processId) {
      conditions.push("vpt.process_id = ?");
      params.push(filters.processId);
    }
    if (filters.costCentreId) {
      conditions.push("vpt.cost_centre_id = ?");
      params.push(filters.costCentreId);
    }
    if (filters.costClass) {
      conditions.push("vpt.cost_class = ?");
      params.push(filters.costClass);
    }
    if (filters.head) {
      conditions.push("vpt.head = ?");
      params.push(filters.head);
    }
    if (filters.subHead) {
      conditions.push("vpt.sub_head = ?");
      params.push(filters.subHead);
    }
    if (filters.vendorId) {
      conditions.push("vpt.vendor_id = ?");
      params.push(filters.vendorId);
    }
    if (filters.paymentStatus) {
      if (!PAYMENT_STATUSES.has(filters.paymentStatus)) {
        throw new Error("Invalid payment status filter");
      }
      conditions.push("vpt.payment_status = ?");
      params.push(filters.paymentStatus);
    }
    if (filters.dueDateFrom) {
      conditions.push("vpt.due_date >= ?");
      params.push(filters.dueDateFrom);
    }
    if (filters.dueDateTo) {
      conditions.push("vpt.due_date <= ?");
      params.push(filters.dueDateTo);
    }
    if (filters.search) {
      conditions.push(
        "(vpt.grn_number LIKE ? OR vpt.vendor_name LIKE ? OR vpt.transaction_id LIKE ?)"
      );
      const like = `%${filters.search}%`;
      params.push(like, like, like);
    }

    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const offset = (page - 1) * limit;
    const where = `WHERE ${conditions.join(" AND ")}`;

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM vendor_payment_tracking vpt ${where}`,
      params
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT vpt.*,
              bm.bank_name AS bank_master_name,
              bm.ifsc_prefix,
              b.branch_name,
              b.branch_code,
              pm.process_name,
              ccm.cost_centre_name,
              vm.vendor_type,
              vm.gst_number AS vendor_gst
         FROM vendor_payment_tracking vpt
         LEFT JOIN bank_master bm ON bm.id = vpt.bank_id
         LEFT JOIN branch_master b ON b.id = vpt.branch_id
         LEFT JOIN process_master pm ON pm.id = vpt.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
         LEFT JOIN vendor_master vm ON vm.id = vpt.vendor_id
         ${where}
        ORDER BY vpt.due_date ASC, vpt.created_at ASC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return {
      rows,
      total: Number(countRows[0]?.total ?? 0),
      page,
      limit,
    };
  },

  async getPayment(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT vpt.*,
              bm.bank_name AS bank_master_name,
              b.branch_name,
              b.branch_code,
              pm.process_name,
              ccm.cost_centre_name,
              vm.vendor_type,
              vm.contact_email,
              vm.contact_phone
         FROM vendor_payment_tracking vpt
         LEFT JOIN bank_master bm ON bm.id = vpt.bank_id
         LEFT JOIN branch_master b ON b.id = vpt.branch_id
         LEFT JOIN process_master pm ON pm.id = vpt.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = vpt.cost_centre_id
         LEFT JOIN vendor_master vm ON vm.id = vpt.vendor_id
        WHERE vpt.id = ?
        LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  },

  async updatePayment(
    id: string,
    payload: UpdatePaymentPayload,
    actorUserId: string,
    actorRole?: string
  ) {
    const connection = await db.getConnection();
    let auditSummary: Record<string, unknown> = {};
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT *
           FROM vendor_payment_tracking
          WHERE id = ?
          FOR UPDATE`,
        [id]
      );
      const existing = rows[0] as any;
      if (!existing) throw new Error("Vendor payment record not found");
      ensureImmutableAttribution(existing, payload);

      const dueAmount = roundMoney(Number(existing.due_amount));
      const paidAmount = roundMoney(
        payload.paidAmount == null
          ? Number(existing.paid_amount ?? 0)
          : Number(payload.paidAmount)
      );
      if (!Number.isFinite(paidAmount) || paidAmount < 0) {
        throw new Error("Paid amount must be zero or greater");
      }
      if (paidAmount > dueAmount + 0.01) {
        throw new Error(
          `Paid amount (${paidAmount}) cannot exceed due amount (${dueAmount})`
        );
      }

      const paymentMode = payload.paymentMode ?? existing.payment_mode ?? null;
      if (paymentMode && !PAYMENT_MODES.includes(paymentMode as any)) {
        throw new Error("Invalid payment mode");
      }
      const paymentDate = payload.paymentDate ?? existing.payment_date ?? null;
      if (paymentDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(paymentDate).slice(0, 10))) {
        throw new Error("Payment date must be a valid date");
      }
      if (
        paymentDate
        && String(paymentDate).slice(0, 10) > new Date().toISOString().slice(0, 10)
      ) {
        throw new Error("Payment date cannot be in the future");
      }

      const bankId = payload.bankId ?? existing.bank_id ?? null;
      let bankName = existing.bank_name ?? null;
      if (bankId) {
        const [bankRows] = await connection.execute<RowDataPacket[]>(
          `SELECT bank_name
             FROM bank_master
            WHERE id = ? AND active_status = 1
            LIMIT 1`,
          [bankId]
        );
        if (!bankRows[0]) throw new Error("Selected bank is inactive or unavailable");
        bankName = String(bankRows[0].bank_name);
      }

      const transactionId =
        payload.transactionId?.trim() || existing.transaction_id || null;
      if (paidAmount > 0) {
        if (!paymentMode) throw new Error("Payment mode is required");
        if (!paymentDate) throw new Error("Payment date is required");
        if (paymentMode !== "Cash" && !transactionId) {
          throw new Error("Transaction ID / UTR / Cheque No. is required");
        }
        if (BANK_MODES.has(paymentMode) && !bankId) {
          throw new Error("Bank is required for this payment mode");
        }
      }

      if (transactionId) {
        const [duplicates] = await connection.execute<RowDataPacket[]>(
          `SELECT id
             FROM vendor_payment_tracking
            WHERE transaction_id = ? AND id <> ?
            LIMIT 1`,
          [transactionId, id]
        );
        if (duplicates[0]) {
          throw new Error("This transaction ID / UTR is already used on another payment");
        }
      }

      const requestedStatus = payload.paymentStatus ?? existing.payment_status;
      if (requestedStatus && !PAYMENT_STATUSES.has(String(requestedStatus))) {
        throw new Error("Invalid payment status");
      }
      if (requestedStatus === "On Hold" && !payload.remarks?.trim()) {
        throw new Error("Hold reason is required");
      }
      if (["Rejected", "Closed"].includes(String(requestedStatus))) {
        throw new Error("Rejected/Closed status cannot be set through payment dispatch");
      }

      const balanceAmount = roundMoney(dueAmount - paidAmount);
      const paymentStatus = requestedStatus === "On Hold"
        ? "On Hold"
        : paidAmount === 0
          ? "Payment Pending"
          : balanceAmount > 0.01
            ? "Partially Paid"
            : "Paid";
      const mappedStatus = grnPaymentStatus(paymentStatus, paidAmount);

      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE vendor_payment_tracking
            SET payment_mode = ?,
                payment_date = ?,
                bank_id = ?,
                bank_name = ?,
                transaction_id = ?,
                paid_amount = ?,
                balance_amount = ?,
                payment_status = ?,
                remarks = COALESCE(?, remarks),
                updated_by = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [
          paymentMode,
          paymentDate ? String(paymentDate).slice(0, 10) : null,
          bankId,
          bankName,
          transactionId,
          paidAmount,
          balanceAmount,
          paymentStatus,
          payload.remarks?.trim() || null,
          actorUserId,
          id,
        ]
      );
      if (updateResult.affectedRows !== 1) {
        throw new Error("Vendor payment update did not affect a record");
      }

      if (existing.grn_request_id) {
        await connection.execute(
          `UPDATE grn_request
              SET status = ?, accounts_payment_status = ?
            WHERE id = ?`,
          [
            mappedStatus.grnStatus,
            mappedStatus.accountsStatus,
            existing.grn_request_id,
          ]
        );
      }

      auditSummary = {
        grn_number: existing.grn_number,
        branch_id: existing.branch_id,
        budget_id: existing.budget_id ?? null,
        budget_line_id: existing.budget_line_id ?? null,
        before: {
          payment_mode: existing.payment_mode,
          payment_date: existing.payment_date,
          bank_id: existing.bank_id,
          transaction_id: existing.transaction_id,
          paid_amount: existing.paid_amount,
          balance_amount: existing.balance_amount,
          payment_status: existing.payment_status,
          remarks: existing.remarks,
        },
        after: {
          payment_mode: paymentMode,
          payment_date: paymentDate,
          bank_id: bankId,
          transaction_id: transactionId,
          paid_amount: paidAmount,
          balance_amount: balanceAmount,
          payment_status: paymentStatus,
          remarks: payload.remarks ?? existing.remarks,
        },
      };
      await writeFinanceAudit(
        "VENDOR_PAYMENT_UPDATED",
        id,
        actorUserId,
        actorRole,
        auditSummary,
        connection
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await logSensitiveAction({
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action_type: "VENDOR_PAYMENT_UPDATED",
      module_key: "FINANCE",
      entity_type: "vendor_payment_tracking",
      entity_id: id,
      change_summary: auditSummary,
    }).catch(() => undefined);

    return this.getPayment(id);
  },

  async bulkUpdate(
    updates: Array<{ id: string } & UpdatePaymentPayload>,
    actorUserId: string,
    actorRole?: string
  ) {
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    for (const update of updates) {
      try {
        const { id, ...payload } = update;
        await this.updatePayment(id, payload, actorUserId, actorRole);
        results.push({ id, success: true });
      } catch (error: unknown) {
        results.push({
          id: update.id,
          success: false,
          error: error instanceof Error ? error.message : "Payment update failed",
        });
      }
    }
    return results;
  },

  async saveProofPath(
    id: string,
    fileName: string,
    filePath: string,
    fileMime: string,
    actorUserId: string,
    actorRole?: string
  ) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT paid_amount, payment_status
           FROM vendor_payment_tracking
          WHERE id = ?
          FOR UPDATE`,
        [id]
      );
      if (!rows[0]) throw new Error("Vendor payment record not found");
      if (Number(rows[0].paid_amount ?? 0) <= 0) {
        throw new Error("Dispatch payment details before uploading payment proof");
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE vendor_payment_tracking
            SET payment_proof_file_name = ?,
                payment_proof_file_path = ?,
                payment_proof_file_mime = ?,
                updated_by = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [fileName, filePath, fileMime, actorUserId, id]
      );
      if (result.affectedRows !== 1) {
        throw new Error("Payment proof could not be saved");
      }
      await writeFinanceAudit(
        "VENDOR_PAYMENT_PROOF_UPLOADED",
        id,
        actorUserId,
        actorRole,
        { file_name: fileName, file_mime: fileMime },
        connection
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async exportPayments(filters: VendorPaymentFilters) {
    const { rows } = await this.listPayments({
      ...filters,
      limit: 5000,
      page: 1,
    });
    return rows;
  },

  async createFromGrn(
    grnId: string,
    actorUserId: string,
    connection?: PoolConnection
  ) {
    const executor = connection ?? db;
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT g.*, b.branch_name
         FROM grn_request g
         LEFT JOIN branch_master b ON b.id = g.branch_id
        WHERE g.id = ?
          AND g.grn_type = 'vendor'
          AND g.status IN ('pending_accounts_payment','finance_head_approved','approved')
        LIMIT 1`,
      [grnId]
    );
    const grn = rows[0] as any;
    if (!grn) throw new Error("Finance-approved vendor GRN not found");
    if (!grn.vendor_id || !grn.vendor_name) {
      throw new Error("Vendor GRN has no canonical Vendor Master mapping");
    }
    if (!grn.attachment_path && !grn.attachment_file_path) {
      throw new Error("Vendor GRN has no invoice/supporting attachment");
    }

    const [existing] = await executor.execute<RowDataPacket[]>(
      `SELECT id
         FROM vendor_payment_tracking
        WHERE grn_request_id = ?
        LIMIT 1`,
      [grnId]
    );
    if (existing[0]) return String(existing[0].id);

    const id = randomUUID();
    const dueAmount = roundMoney(Number(grn.amount_with_tax ?? grn.amount ?? 0));
    if (dueAmount <= 0) throw new Error("Vendor GRN payable amount must be positive");

    await executor.execute(
      `INSERT INTO vendor_payment_tracking
       (id, grn_request_id, grn_number, branch_id, process_id, cost_centre_id,
        cost_class, vendor_id, vendor_name, head, sub_head, due_amount, due_date,
        grn_file_name, grn_file_path, grn_file_mime, paid_amount, balance_amount,
        payment_status, financial_year, budget_id, budget_line_id,
        amount_without_tax, tax_amount, amount_with_tax)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,'Payment Pending',?,?,?,?,?,?)`,
      [
        id,
        grnId,
        grn.grn_number,
        grn.branch_id,
        grn.process_id ?? null,
        grn.cost_centre_id ?? null,
        grn.cost_class ?? "indirect",
        grn.vendor_id,
        grn.vendor_name,
        grn.head,
        grn.sub_head,
        dueAmount,
        grn.due_date ?? grn.bill_date,
        grn.attachment_original_name ?? grn.attachment_file_name,
        grn.attachment_path ?? grn.attachment_file_path,
        grn.attachment_mime ?? grn.attachment_file_mime,
        dueAmount,
        grn.financial_year ?? null,
        grn.budget_id ?? null,
        grn.budget_line_id ?? null,
        Number(grn.amount_without_tax || grn.amount || 0),
        Number(grn.tax_amount || 0),
        dueAmount,
      ]
    );
    await executor.execute(
      `UPDATE grn_request
          SET status = 'pending_accounts_payment', accounts_payment_status = 'pending'
        WHERE id = ?`,
      [grnId]
    );

    if (!connection) {
      await this.auditCreatedPayment(id, actorUserId);
    }
    return id;
  },

  async auditCreatedPayment(id: string, actorUserId: string) {
    const payment = await this.getPayment(id);
    if (!payment) throw new Error("Vendor payment record not found for audit");
    await writeFinanceAudit(
      "VENDOR_PAYMENT_ROW_CREATED",
      id,
      actorUserId,
      undefined,
      {
        grn_id: payment.grn_request_id,
        grn_number: payment.grn_number,
        due_amount: Number(payment.due_amount),
        budget_id: payment.budget_id ?? null,
        budget_line_id: payment.budget_line_id ?? null,
        process_id: payment.process_id ?? null,
        cost_centre_id: payment.cost_centre_id ?? null,
      }
    );
  },

  async notifyPaymentPending(id: string) {
    const payment = await this.getPayment(id);
    if (!payment) return;
    const [accountsUsers] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT u.id
         FROM auth_user u
         JOIN user_role_assignment ura ON ura.user_id = u.id
        WHERE ura.role_name = 'accounts_head'
          AND u.active_status = 1
        LIMIT 100`
    );

    for (const user of accountsUsers) {
      await inboxService.createItem({
        user_id: String(user.id),
        type: "VENDOR_PAYMENT_PENDING",
        title: `Vendor Payment Pending - GRN ${
          payment.grn_number ?? payment.grn_request_id
        }`,
        description: `Branch: ${
          payment.branch_name ?? payment.branch_id
        } | Vendor: ${payment.vendor_name ?? "N/A"} | Due: Rs ${Number(
          payment.due_amount
        ).toLocaleString("en-IN")} | Due Date: ${payment.due_date ?? "TBD"}`,
        entity_type: "vendor_payment_tracking",
        entity_id: id,
        action_url: "/finance/vendor-payment-tracking",
        priority: "high",
      });
    }
  },
};
