import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import {
  branchBudgetService,
  calculateBudgetLine,
  type BudgetGstType,
  type BudgetTaxTreatment,
} from "../process-pnl/branch-budget.service.js";
import { budgetConsumptionService } from "../process-pnl/budget-consumption.service.js";
import { allocateGrnNumber } from "./grn-number.service.js";
import { vendorPaymentService } from "./vendor-payment.service.js";

export type GrnType = "vendor" | "imprest";
export type GrnStatus =
  | "draft"
  | "submitted"
  | "branch_head_approved"
  | "finance_head_approved"
  | "pending_accounts_payment"
  | "payment_scheduled"
  | "partially_paid"
  | "paid"
  | "approved"
  | "rejected"
  | "cancelled";

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

export interface SubmitGrnPayload {
  remarks?: string;
}

export interface ReviewGrnPayload {
  decision: "approved" | "rejected";
  reviewNote?: string;
}

async function writeGrnAudit(
  action: string,
  grnId: string,
  actorId: string,
  actorRole: string,
  changes: Record<string, unknown>
) {
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

async function resolveCanonicalVendor(
  grnType: GrnType,
  requestedVendorId: string | undefined,
  preferredVendorId: string | null | undefined
) {
  if (grnType === "imprest") {
    return { vendorId: null, vendorName: null };
  }

  const vendorId = requestedVendorId?.trim() || preferredVendorId || null;
  if (!vendorId) {
    throw new Error("Vendor GRN requires an active vendor selected from Vendor Master");
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, vendor_name, is_active
       FROM vendor_master
      WHERE id = ?
      LIMIT 1`,
    [vendorId]
  );
  const vendor = rows[0];
  if (!vendor) throw new Error("Selected vendor was not found in Vendor Master");
  if (Number(vendor.is_active ?? 0) !== 1) {
    throw new Error("Selected vendor is inactive and cannot be used for a GRN");
  }

  return {
    vendorId: String(vendor.id),
    vendorName: String(vendor.vendor_name),
  };
}

function financialYearFromPeriod(periodCode: string) {
  const [year, month] = periodCode.split("-").map(Number);
  if (!year || !month) throw new Error("Approved budget has an invalid period");
  return month >= 4
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function getGrnOrThrow(grnId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM grn_request WHERE id = ? LIMIT 1`,
    [grnId]
  );
  if (!rows[0]) throw new Error("GRN not found");
  return rows[0] as any;
}

export const grnService = {
  async createDraft(payload: CreateGrnPayload, actorUserId: string, actorRole: string) {
    if (!payload.branchId) throw new Error("Branch is required");
    if (!payload.budgetLineId) throw new Error("An approved budget line is required");
    if (!payload.billDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.billDate)) {
      throw new Error("A valid bill/receipt date is required");
    }
    if (!Number.isFinite(Number(payload.quantity)) || Number(payload.quantity) <= 0) {
      throw new Error("Quantity must be greater than zero");
    }

    const paymentTermsDays = Number(payload.paymentTermsDays ?? 0);
    if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365) {
      throw new Error("Payment terms must be a whole number between 0 and 365 days");
    }

    const budgetLine = await branchBudgetService.getLineForGrn(
      payload.budgetLineId,
      payload.branchId
    ) as any;

    if (payload.billDate.slice(0, 7) !== String(budgetLine.period_code)) {
      throw new Error(
        `Bill date must fall within approved budget period ${budgetLine.period_code}`
      );
    }
    if (payload.processId && payload.processId !== budgetLine.process_id) {
      throw new Error("GRN process does not match the approved budget line");
    }
    if (payload.costCentreId && payload.costCentreId !== budgetLine.cost_centre_id) {
      throw new Error("GRN cost centre does not match the approved budget line");
    }

    const quantity = Number(payload.quantity);
    const availableQuantity =
      Number(budgetLine.quantity ?? 0)
      - Number(budgetLine.reserved_quantity ?? 0)
      - Number(budgetLine.consumed_quantity ?? 0);
    if (quantity > availableQuantity + 0.0001) {
      throw new Error(
        `GRN quantity exceeds available approved quantity by ${(
          quantity - availableQuantity
        ).toFixed(4)}`
      );
    }

    const unitRate = payload.unitRate == null
      ? Number(budgetLine.unit_rate)
      : Number(payload.unitRate);
    if (!Number.isFinite(unitRate) || unitRate < 0) {
      throw new Error("Unit rate cannot be negative");
    }
    if (unitRate > Number(budgetLine.unit_rate) + 0.0001) {
      throw new Error("GRN unit rate exceeds the approved budget rate");
    }

    const amounts = calculateBudgetLine({
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

    if (amounts.grossAmount > Number(budgetLine.available_gross_amount) + 0.01) {
      throw new Error("GRN amount exceeds the available approved budget");
    }

    const vendor = await resolveCanonicalVendor(
      payload.grnType,
      payload.vendorId,
      budgetLine.preferred_vendor_id
    );
    const financialYear = financialYearFromPeriod(String(budgetLine.period_code));
    if (payload.financialYear && payload.financialYear !== financialYear) {
      throw new Error(`Financial year must be ${financialYear} for the selected budget`);
    }

    const id = randomUUID();
    const grnNumber = await allocateGrnNumber(payload.branchId, financialYear);
    const dueDate = addDays(payload.billDate, paymentTermsDays);
    const costClass: "direct" | "indirect" =
      budgetLine.process_id || budgetLine.cost_centre_id ? "direct" : "indirect";

    await db.execute(
      `INSERT INTO grn_request
       (id, grn_number, grn_type, branch_id, process_id, cost_centre_id, cost_class,
        vendor_id, vendor_name, head, sub_head, quantity, unit, unit_rate,
        tax_treatment, gst_rate, gst_type, recoverable_tax_pct,
        amount_without_tax, tax_amount, amount_with_tax, pnl_cost_amount, amount,
        bill_date, payment_terms_days, due_date, description, remarks, status,
        financial_year, budget_id, budget_line_id, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,NOW())`,
      [
        id,
        grnNumber,
        payload.grnType,
        payload.branchId,
        budgetLine.process_id ?? null,
        budgetLine.cost_centre_id ?? null,
        costClass,
        vendor.vendorId,
        vendor.vendorName,
        budgetLine.head,
        budgetLine.sub_head ?? "",
        quantity,
        budgetLine.unit,
        unitRate,
        budgetLine.tax_treatment,
        budgetLine.gst_rate,
        budgetLine.gst_type,
        budgetLine.recoverable_tax_pct,
        amounts.baseAmount,
        amounts.taxAmount,
        amounts.grossAmount,
        amounts.pnlCostAmount,
        amounts.grossAmount,
        payload.billDate,
        paymentTermsDays,
        dueDate,
        budgetLine.item_name,
        payload.remarks?.trim() || null,
        financialYear,
        budgetLine.budget_id,
        budgetLine.id,
        actorUserId,
      ]
    );

    await writeGrnAudit("CREATE_DRAFT", id, actorUserId, actorRole, {
      grn_number: grnNumber,
      budget_id: budgetLine.budget_id,
      budget_line_id: budgetLine.id,
      process_id: budgetLine.process_id ?? null,
      cost_centre_id: budgetLine.cost_centre_id ?? null,
      cost_class: costClass,
      quantity,
      unit: budgetLine.unit,
      unit_rate: unitRate,
      amount_without_tax: amounts.baseAmount,
      tax_amount: amounts.taxAmount,
      amount_with_tax: amounts.grossAmount,
    });
    return { id, grnNumber };
  },

  async submitForApproval(
    grnId: string,
    payload: SubmitGrnPayload,
    actorUserId: string,
    actorRole: string
  ) {
    const grn = await getGrnOrThrow(grnId);
    if (grn.status !== "draft") {
      throw new Error(`GRN is already ${grn.status}, cannot submit`);
    }
    if (!grn.budget_line_id) {
      throw new Error("GRN is not linked to an approved budget line");
    }
    if (!grn.attachment_path && !grn.attachment_file_path) {
      throw new Error("Invoice / supporting attachment is required before submission");
    }

    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE grn_request
          SET status = 'submitted',
              submitted_by = ?,
              submitted_at = NOW(),
              remarks = COALESCE(?, remarks)
        WHERE id = ? AND status = 'draft'`,
      [actorUserId, payload.remarks?.trim() || null, grnId]
    );
    if (result.affectedRows !== 1) {
      throw new Error("GRN status changed before submission; refresh and try again");
    }

    await writeGrnAudit("SUBMIT", grnId, actorUserId, actorRole, {
      remarks: payload.remarks,
    });
    return { success: true, newStatus: "submitted" as const };
  },

  async reviewGrn(
    grnId: string,
    payload: ReviewGrnPayload,
    actorUserId: string,
    actorRole: string
  ) {
    if (!payload || !["approved", "rejected"].includes(payload.decision)) {
      throw new Error("Review decision must be approved or rejected");
    }
    if (payload.decision === "rejected" && !payload.reviewNote?.trim()) {
      throw new Error("Review remarks are required when rejecting a GRN");
    }

    const role = actorRole.toLowerCase();
    const connection = await db.getConnection();
    let paymentId: string | null = null;
    let newStatus: GrnStatus;

    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM grn_request WHERE id = ? FOR UPDATE`,
        [grnId]
      );
      const grn = rows[0] as any;
      if (!grn) throw new Error("GRN not found");
      if (!grn.budget_line_id) throw new Error("GRN has no approved budget mapping");

      const effectiveStage = role === "super_admin"
        ? grn.status === "submitted"
          ? "branch_head"
          : grn.status === "branch_head_approved"
            ? "finance_head"
            : null
        : role;

      if (effectiveStage === "branch_head") {
        if (grn.status !== "submitted") {
          throw new Error(
            `Branch Head can only review submitted GRNs. Current status: ${grn.status}`
          );
        }

        if (payload.decision === "approved") {
          await budgetConsumptionService.reserve(
            connection,
            grn.budget_line_id,
            Number(grn.amount_with_tax || grn.amount),
            Number(grn.quantity)
          );
          newStatus = "branch_head_approved";
        } else {
          newStatus = "rejected";
        }

        await connection.execute(
          `UPDATE grn_request
              SET status = ?,
                  branch_head_reviewed_by = ?,
                  branch_head_reviewed_at = NOW(),
                  branch_head_review_note = ?,
                  reviewed_by = ?,
                  reviewed_at = NOW(),
                  review_note = ?,
                  rejection_reason = ?
            WHERE id = ?`,
          [
            newStatus,
            actorUserId,
            payload.reviewNote?.trim() || null,
            actorUserId,
            payload.reviewNote?.trim() || null,
            payload.decision === "rejected" ? payload.reviewNote?.trim() : null,
            grnId,
          ]
        );
      } else if (effectiveStage === "finance_head") {
        if (grn.status !== "branch_head_approved") {
          throw new Error(
            `Finance Head can only review Branch Head-approved GRNs. Current status: ${grn.status}`
          );
        }

        if (payload.decision === "approved") {
          await budgetConsumptionService.consume(
            connection,
            grn.budget_line_id,
            Number(grn.amount_with_tax || grn.amount),
            Number(grn.quantity)
          );
          newStatus = grn.grn_type === "vendor"
            ? "pending_accounts_payment"
            : "approved";

          await connection.execute(
            `UPDATE grn_request
                SET status = ?,
                    accounts_payment_status = ?,
                    finance_head_reviewed_by = ?,
                    finance_head_reviewed_at = NOW(),
                    finance_head_review_note = ?,
                    reviewed_by = ?,
                    reviewed_at = NOW(),
                    review_note = ?,
                    approved_by = ?,
                    approved_at = NOW(),
                    rejection_reason = NULL
              WHERE id = ?`,
            [
              newStatus,
              grn.grn_type === "vendor" ? "pending" : "not_required",
              actorUserId,
              payload.reviewNote?.trim() || null,
              actorUserId,
              payload.reviewNote?.trim() || null,
              actorUserId,
              grnId,
            ]
          );

          if (grn.grn_type === "vendor") {
            paymentId = await vendorPaymentService.createFromGrn(
              grnId,
              actorUserId,
              connection
            );
          }
        } else {
          await budgetConsumptionService.release(
            connection,
            grn.budget_line_id,
            Number(grn.amount_with_tax || grn.amount),
            Number(grn.quantity)
          );
          newStatus = "rejected";
          await connection.execute(
            `UPDATE grn_request
                SET status = 'rejected',
                    finance_head_reviewed_by = ?,
                    finance_head_reviewed_at = NOW(),
                    finance_head_review_note = ?,
                    reviewed_by = ?,
                    reviewed_at = NOW(),
                    review_note = ?,
                    rejection_reason = ?
              WHERE id = ?`,
            [
              actorUserId,
              payload.reviewNote?.trim(),
              actorUserId,
              payload.reviewNote?.trim(),
              payload.reviewNote?.trim(),
              grnId,
            ]
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

    await writeGrnAudit(
      payload.decision.toUpperCase(),
      grnId,
      actorUserId,
      actorRole,
      {
        review_note: payload.reviewNote,
        new_status: newStatus!,
        payment_id: paymentId,
      }
    );
    if (paymentId) {
      await vendorPaymentService.notifyPaymentPending(paymentId).catch(() => undefined);
    }
    return { success: true, newStatus: newStatus!, paymentId };
  },

  async cancelGrn(grnId: string, actorUserId: string, actorRole: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM grn_request WHERE id = ? FOR UPDATE`,
        [grnId]
      );
      const grn = rows[0] as any;
      if (!grn) throw new Error("GRN not found");
      if (
        [
          "finance_head_approved",
          "pending_accounts_payment",
          "payment_scheduled",
          "partially_paid",
          "paid",
          "approved",
          "cancelled",
        ].includes(grn.status)
      ) {
        throw new Error(`Cannot cancel a GRN with status '${grn.status}'`);
      }

      if (grn.status === "branch_head_approved" && grn.budget_line_id) {
        await budgetConsumptionService.release(
          connection,
          grn.budget_line_id,
          Number(grn.amount_with_tax || grn.amount),
          Number(grn.quantity)
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE grn_request
            SET status = 'cancelled', reviewed_by = ?, reviewed_at = NOW()
          WHERE id = ? AND status = ?`,
        [actorUserId, grnId, grn.status]
      );
      if (result.affectedRows !== 1) {
        throw new Error("GRN status changed before cancellation; refresh and try again");
      }
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

  async listGrns(filters: {
    branchId?: string;
    processId?: string;
    costCentreId?: string;
    costClass?: string;
    status?: string;
    financialYear?: string;
    grnType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.branchId) {
      conditions.push("g.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.processId) {
      conditions.push("g.process_id = ?");
      params.push(filters.processId);
    }
    if (filters.costCentreId) {
      conditions.push("g.cost_centre_id = ?");
      params.push(filters.costCentreId);
    }
    if (filters.costClass) {
      conditions.push("g.cost_class = ?");
      params.push(filters.costClass);
    }
    if (filters.status) {
      conditions.push("g.status = ?");
      params.push(filters.status);
    }
    if (filters.financialYear) {
      conditions.push("g.financial_year = ?");
      params.push(filters.financialYear);
    }
    if (filters.grnType) {
      conditions.push("g.grn_type = ?");
      params.push(filters.grnType);
    }
    if (filters.search) {
      conditions.push(
        "(g.grn_number LIKE ? OR g.vendor_name LIKE ? OR g.head LIKE ? OR g.description LIKE ?)"
      );
      const like = `%${filters.search}%`;
      params.push(like, like, like, like);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 30));
    const offset = (page - 1) * limit;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT g.*,
              bm.branch_name,
              pm.process_name,
              ccm.cost_centre_name,
              h.budget_number,
              l.item_name AS budget_item_name,
              CONCAT(cb.first_name, ' ', cb.last_name) AS created_by_name,
              CONCAT(rb.first_name, ' ', rb.last_name) AS reviewed_by_name
         FROM grn_request g
         LEFT JOIN branch_master bm ON bm.id = g.branch_id
         LEFT JOIN process_master pm ON pm.id = g.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
         LEFT JOIN finance_budget_header h ON h.id = g.budget_id
         LEFT JOIN finance_budget_line l ON l.id = g.budget_line_id
         LEFT JOIN auth_user cb ON cb.id = g.created_by
         LEFT JOIN auth_user rb ON rb.id = g.reviewed_by
         ${where}
        ORDER BY g.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM grn_request g ${where}`,
      params
    );

    return {
      data: rows,
      total: Number(countRows[0]?.total ?? 0),
      page,
      limit,
    };
  },

  async getGrn(grnId: string) {
    return getGrnOrThrow(grnId);
  },

  async saveAttachment(
    grnId: string,
    filePath: string,
    originalName: string,
    actorUserId: string,
    mimeType?: string
  ) {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE grn_request
          SET attachment_path = ?,
              attachment_original_name = ?,
              attachment_mime = ?,
              attachment_file_path = ?,
              attachment_file_name = ?,
              attachment_file_mime = ?
        WHERE id = ? AND status = 'draft'`,
      [
        filePath,
        originalName,
        mimeType ?? null,
        filePath,
        originalName,
        mimeType ?? null,
        grnId,
      ]
    );
    if (result.affectedRows !== 1) {
      throw new Error("Attachment can only be changed on an existing draft GRN");
    }

    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: "GRN_ATTACHMENT_SAVED",
      module_key: "finance",
      entity_type: "grn_request",
      entity_id: grnId,
      change_summary: { filePath, originalName, mimeType },
    });
  },
};
