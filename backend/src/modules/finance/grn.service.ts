import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { branchBudgetService, calculateBudgetLine, type BudgetTaxTreatment, type BudgetGstType } from "../process-pnl/branch-budget.service.js";
import { vendorPaymentService } from "./vendor-payment.service.js";

export type GrnType = "vendor" | "imprest";
export type GrnStatus = "draft" | "submitted" | "branch_head_approved" | "finance_head_approved" | "pending_accounts_payment" | "payment_scheduled" | "partially_paid" | "paid" | "approved" | "rejected" | "cancelled";

export interface CreateGrnPayload {
  grnType: GrnType;
  branchId: string;
  budgetLineId: string;
  processId?: string;
  costCentreId?: string;
  vendorId?: string;
  vendorName?: string;
  quantity: number;
  unitRate?: number;
  billDate?: string;
  paymentTermsDays?: number;
  remarks?: string;
  financialYear?: string;
}

export interface SubmitGrnPayload { remarks?: string; }
export interface ReviewGrnPayload { decision: "approved" | "rejected"; reviewNote?: string; }

async function generateGrnNumber(branchId: string, financialYear: string): Promise<string> {
  const [branchRows] = await db.execute<RowDataPacket[]>(`SELECT branch_seq FROM branch_master WHERE id = ? LIMIT 1`, [branchId]);
  if (!branchRows[0]) throw new Error("Selected branch was not found");
  const branchSeq = Number(branchRows[0].branch_seq ?? 0);
  const yy = financialYear.slice(2, 4);
  const [seqRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM grn_request WHERE branch_id = ? AND financial_year = ?`,
    [branchId, financialYear]
  );
  return `Mas/${branchSeq}/${yy}/${Number(seqRows[0]?.cnt ?? 0) + 1}`;
}

async function writeGrnAudit(action: string, grnId: string, actorId: string, actorRole: string, changes: Record<string, unknown>) {
  await logSensitiveAction({
    actor_user_id: actorId,
    actor_role: actorRole,
    action_type: `GRN_${action}`,
    module_key: "FINANCE",
    entity_type: "grn_request",
    entity_id: grnId,
    change_summary: changes,
  });
}

export const grnService = {
  async createDraft(payload: CreateGrnPayload, actorUserId: string, actorRole: string) {
    if (!payload.branchId) throw new Error("Branch is required");
    if (!payload.budgetLineId) throw new Error("An approved budget line is required");
    if (!Number.isFinite(Number(payload.quantity)) || Number(payload.quantity) <= 0) throw new Error("Quantity must be greater than zero");
    if (payload.grnType === "vendor" && !payload.vendorId && !payload.vendorName?.trim()) throw new Error("Vendor is required for vendor GRN");

    const budgetLine = await branchBudgetService.getLineForGrn(payload.budgetLineId, payload.branchId) as any;
    const quantity = Number(payload.quantity);
    const unitRate = payload.unitRate == null ? Number(budgetLine.unit_rate) : Number(payload.unitRate);
    if (!Number.isFinite(unitRate) || unitRate < 0) throw new Error("Unit rate cannot be negative");
    if (unitRate > Number(budgetLine.unit_rate) + 0.0001) throw new Error("GRN unit rate exceeds the approved budget rate");

    const values = calculateBudgetLine({
      head: String(budgetLine.head),
      subHead: budgetLine.sub_head,
      itemName: String(budgetLine.item_name),
      quantity,
      unit: String(budgetLine.unit),
      unitRate,
      taxTreatment: String(budgetLine.tax_treatment) as BudgetTaxTreatment,
      gstRate: Number(budgetLine.gst_rate),
      gstType: String(budgetLine.gst_type) as BudgetGstType,
      recoverableTaxPct: Number(budgetLine.recoverable_tax_pct),
      justification: String(budgetLine.justification || "Approved budget line"),
    });
    if (values.grossAmount > Number(budgetLine.available_gross_amount) + 0.01) throw new Error("GRN amount exceeds the available approved budget");

    const id = randomUUID();
    const fy = payload.financialYear ?? getCurrentFinancialYear();
    const grnNumber = await generateGrnNumber(payload.branchId, fy);
    const dueDate = payload.billDate && payload.paymentTermsDays != null ? addDays(payload.billDate, payload.paymentTermsDays) : null;
    const costClass: "direct" | "indirect" = budgetLine.process_id ? "direct" : "indirect";

    await db.execute(
      `INSERT INTO grn_request
       (id,grn_number,grn_type,branch_id,process_id,cost_centre_id,cost_class,vendor_id,vendor_name,head,sub_head,
        quantity,unit,unit_rate,tax_treatment,gst_rate,gst_type,recoverable_tax_pct,amount_without_tax,tax_amount,amount_with_tax,pnl_cost_amount,amount,
        bill_date,payment_terms_days,due_date,description,remarks,status,financial_year,budget_id,budget_line_id,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft',?,?,?,?,NOW())`,
      [id, grnNumber, payload.grnType, payload.branchId, budgetLine.process_id ?? null, budgetLine.cost_centre_id ?? null, costClass,
       payload.vendorId ?? budgetLine.preferred_vendor_id ?? null, payload.vendorName?.trim() || budgetLine.preferred_vendor_name || null,
       budgetLine.head, budgetLine.sub_head ?? "", quantity, budgetLine.unit, unitRate, budgetLine.tax_treatment, budgetLine.gst_rate,
       budgetLine.gst_type, budgetLine.recoverable_tax_pct, values.baseAmount, values.taxAmount, values.grossAmount, values.pnlCostAmount,
       values.grossAmount, payload.billDate ?? null, payload.paymentTermsDays ?? 0, dueDate, budgetLine.item_name,
       payload.remarks?.trim() || null, fy, budgetLine.budget_id, budgetLine.id, actorUserId]
    );

    await writeGrnAudit("CREATE_DRAFT", id, actorUserId, actorRole, {
      grn_number: grnNumber,
      budget_id: budgetLine.budget_id,
      budget_line_id: budgetLine.id,
      amount_without_tax: values.baseAmount,
      tax_amount: values.taxAmount,
      amount_with_tax: values.grossAmount,
    });
    return { id, grnNumber };
  },

  async submitForApproval(grnId: string, payload: SubmitGrnPayload, actorUserId: string, actorRole: string) {
    const grn = await getGrnOrThrow(grnId);
    if (grn.status !== "draft") throw new Error(`GRN is already ${grn.status}, cannot submit`);
    if (!grn.budget_line_id) throw new Error("GRN is not linked to an approved budget line");
    if (!grn.attachment_path && !grn.attachment_file_path) throw new Error("Invoice / supporting attachment is required before submission");
    await db.execute(
      `UPDATE grn_request SET status='submitted', submitted_by=?, submitted_at=NOW(), remarks=COALESCE(?,remarks) WHERE id=?`,
      [actorUserId, payload.remarks ?? null, grnId]
    );
    await writeGrnAudit("SUBMIT", grnId, actorUserId, actorRole, { remarks: payload.remarks });
    return { success: true, newStatus: "submitted" };
  },

  async reviewGrn(grnId: string, payload: ReviewGrnPayload, actorUserId: string, actorRole: string) {
    const role = actorRole.toLowerCase();
    const connection = await db.getConnection();
    let paymentId: string | null = null;
    let newStatus: GrnStatus;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM grn_request WHERE id=? FOR UPDATE`, [grnId]);
      const grn = rows[0] as any;
      if (!grn) throw new Error("GRN not found");

      const effectiveStage = role === "super_admin"
        ? (grn.status === "submitted" ? "branch_head" : grn.status === "branch_head_approved" ? "finance_head" : null)
        : role;
      if (effectiveStage === "branch_head") {
        if (grn.status !== "submitted") throw new Error(`Branch Head can only review submitted GRNs. Current status: ${grn.status}`);
        if (payload.decision === "approved") {
          await branchBudgetService.reserveLine(connection, grn.budget_line_id, Number(grn.amount_with_tax || grn.amount));
          newStatus = "branch_head_approved";
        } else {
          newStatus = "rejected";
        }
        await connection.execute(
          `UPDATE grn_request SET status=?, branch_head_reviewed_by=?, branch_head_reviewed_at=NOW(), branch_head_review_note=?, reviewed_by=?, reviewed_at=NOW(), review_note=? WHERE id=?`,
          [newStatus, actorUserId, payload.reviewNote ?? null, actorUserId, payload.reviewNote ?? null, grnId]
        );
      } else if (effectiveStage === "finance_head") {
        if (grn.status !== "branch_head_approved") throw new Error(`Finance Head can only review Branch Head-approved GRNs. Current status: ${grn.status}`);
        if (payload.decision === "approved") {
          await branchBudgetService.consumeLine(connection, grn.budget_line_id, Number(grn.amount_with_tax || grn.amount));
          newStatus = grn.grn_type === "vendor" ? "pending_accounts_payment" : "approved";
          await connection.execute(
            `UPDATE grn_request SET status=?, accounts_payment_status=?, finance_head_reviewed_by=?, finance_head_reviewed_at=NOW(), finance_head_review_note=?, reviewed_by=?, reviewed_at=NOW(), review_note=?, approved_by=?, approved_at=NOW() WHERE id=?`,
            [newStatus, grn.grn_type === "vendor" ? "pending" : "not_required", actorUserId, payload.reviewNote ?? null,
             actorUserId, payload.reviewNote ?? null, actorUserId, grnId]
          );
          if (grn.grn_type === "vendor") paymentId = await vendorPaymentService.createFromGrn(grnId, actorUserId, connection);
        } else {
          await branchBudgetService.releaseLine(connection, grn.budget_line_id, Number(grn.amount_with_tax || grn.amount));
          newStatus = "rejected";
          await connection.execute(
            `UPDATE grn_request SET status='rejected', finance_head_reviewed_by=?, finance_head_reviewed_at=NOW(), finance_head_review_note=?, reviewed_by=?, reviewed_at=NOW(), review_note=? WHERE id=?`,
            [actorUserId, payload.reviewNote ?? null, actorUserId, payload.reviewNote ?? null, grnId]
          );
        }
      } else {
        throw new Error(`Role ${actorRole} is not permitted to review GRNs`);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await writeGrnAudit(payload.decision.toUpperCase(), grnId, actorUserId, actorRole, { review_note: payload.reviewNote, new_status: newStatus! });
    if (paymentId) await vendorPaymentService.notifyPaymentPending(paymentId).catch(() => undefined);
    return { success: true, newStatus: newStatus!, paymentId };
  },

  async cancelGrn(grnId: string, actorUserId: string, actorRole: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM grn_request WHERE id=? FOR UPDATE`, [grnId]);
      const grn = rows[0] as any;
      if (!grn) throw new Error("GRN not found");
      if (["finance_head_approved", "pending_accounts_payment", "payment_scheduled", "partially_paid", "paid", "approved", "cancelled"].includes(grn.status)) {
        throw new Error(`Cannot cancel a GRN with status '${grn.status}'`);
      }
      if (grn.status === "branch_head_approved" && grn.budget_line_id) {
        await branchBudgetService.releaseLine(connection, grn.budget_line_id, Number(grn.amount_with_tax || grn.amount));
      }
      await connection.execute(`UPDATE grn_request SET status='cancelled', reviewed_by=?, reviewed_at=NOW() WHERE id=?`, [actorUserId, grnId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await writeGrnAudit("CANCEL", grnId, actorUserId, actorRole, {});
    return { success: true };
  },

  async listGrns(filters: { branchId?: string; processId?: string; costCentreId?: string; costClass?: string; status?: string; financialYear?: string; grnType?: string; search?: string; page?: number; limit?: number }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.branchId) { conditions.push("g.branch_id = ?"); params.push(filters.branchId); }
    if (filters.processId) { conditions.push("g.process_id = ?"); params.push(filters.processId); }
    if (filters.costCentreId) { conditions.push("g.cost_centre_id = ?"); params.push(filters.costCentreId); }
    if (filters.costClass) { conditions.push("g.cost_class = ?"); params.push(filters.costClass); }
    if (filters.status) { conditions.push("g.status = ?"); params.push(filters.status); }
    if (filters.financialYear) { conditions.push("g.financial_year = ?"); params.push(filters.financialYear); }
    if (filters.grnType) { conditions.push("g.grn_type = ?"); params.push(filters.grnType); }
    if (filters.search) {
      conditions.push("(g.grn_number LIKE ? OR g.vendor_name LIKE ? OR g.head LIKE ? OR g.description LIKE ?)");
      const like = `%${filters.search}%`;
      params.push(like, like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 30));
    const offset = (page - 1) * limit;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT g.*, bm.branch_name, pm.process_name, ccm.cost_centre_name,
              h.budget_number, l.item_name AS budget_item_name,
              CONCAT(cb.first_name,' ',cb.last_name) AS created_by_name,
              CONCAT(rb.first_name,' ',rb.last_name) AS reviewed_by_name
         FROM grn_request g
         LEFT JOIN branch_master bm ON bm.id=g.branch_id
         LEFT JOIN process_master pm ON pm.id=g.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id=g.cost_centre_id
         LEFT JOIN finance_budget_header h ON h.id=g.budget_id
         LEFT JOIN finance_budget_line l ON l.id=g.budget_line_id
         LEFT JOIN auth_user cb ON cb.id=g.created_by
         LEFT JOIN auth_user rb ON rb.id=g.reviewed_by
         ${where}
        ORDER BY g.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM grn_request g ${where}`, params);
    return { data: rows, total: Number(countRows[0]?.total ?? 0), page, limit };
  },

  async getGrn(grnId: string) { return getGrnOrThrow(grnId); },

  async saveAttachment(grnId: string, filePath: string, originalName: string, actorUserId: string) {
    await db.execute(`UPDATE grn_request SET attachment_path=?, attachment_original_name=? WHERE id=?`, [filePath, originalName, grnId]);
    await logSensitiveAction({ actor_user_id: actorUserId, action_type: "GRN_ATTACHMENT_SAVED", module_key: "finance", entity_type: "grn_request", entity_id: grnId, change_summary: { filePath } });
  },
};

async function getGrnOrThrow(grnId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM grn_request WHERE id=? LIMIT 1`, [grnId]);
  if (!rows[0]) throw new Error("GRN not found");
  return rows[0] as any;
}

function getCurrentFinancialYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  return now.getMonth() + 1 >= 4 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
