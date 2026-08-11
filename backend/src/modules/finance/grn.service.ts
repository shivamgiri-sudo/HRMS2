import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolvePendingWith } from "./finance-workflow-role.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { recordFinanceApprovalEvent } from "../../shared/financeApprovalEvent.js";
import {
  branchBudgetService,
  calculateBudgetLine,
  type BudgetGstType,
  type BudgetTaxTreatment,
} from "../process-pnl/branch-budget.service.js";
import { financeBranchFilter, type FinanceBranchScope } from "./finance-access-scope.js";
import { budgetConsumptionService } from "../process-pnl/budget-consumption.service.js";
import { isPeriodLocked } from "../process-pnl/finance-period-lock.js";
import { allocateGrnNumber } from "./grn-number.service.js";
import {
  allocateMonthlyGrnNumber,
  resolveAccountingPeriod,
  resolveGrnNumberFormat,
} from "./grn-number-monthly.service.js";
import { grnSmartService } from "./grn-smart.service.js";
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
  | "cancelled"
  | "consumption_reversed";

/** Statuses reached only after Finance Head approval actually moved budget from reserved
 *  into consumed via budgetConsumptionService.consume(). The only statuses eligible for
 *  reverseConsumption(). */
const CONSUMED_GRN_STATUSES: GrnStatus[] = [
  "pending_accounts_payment",
  "payment_scheduled",
  "partially_paid",
  "paid",
  "approved",
];

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
  /**
   * The month the GRN books to, when it differs from the bill month.
   *
   * Optional and NULL on every existing caller, which is what keeps this change inert: the
   * number falls back to bill_date exactly as before. It matters only under the monthly
   * numbering format, where the MM/YY is the accounting month rather than the vendor's
   * invoice date.
   */
  accountingPeriod?: string;
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

// ---------------------------------------------------------------------------
// Legacy GRN helpers
// ---------------------------------------------------------------------------

/**
 * Branch scope condition for grn_entry_snapshot.
 *
 * Primary path: grn_entry_line_snapshot → cost_centre_master.branch_id (UUID).
 * Fallback: branch_master.branch_name COLLATE = grn_entry_snapshot.branch_name.
 * ids appear twice: once for the cost_centre join, once for the name fallback.
 */
function legacyBranchCondition(
  scope: FinanceBranchScope,
  alias: string = "g"
): { sql: string; params: unknown[] } {
  if (scope.mode === "all") return { sql: "1=1", params: [] };

  const ids = scope.branchIds;
  const ph = ids.map(() => "?").join(", ");

  const sql = `(
    EXISTS (
      SELECT 1
        FROM grn_entry_line_snapshot l
        JOIN cost_centre_master ccm
          ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
           = l.cost_centre_code  COLLATE utf8mb4_unicode_ci
       WHERE l.grn_source_id = ${alias}.bill_source_id
         AND ccm.branch_id IN (${ph})
    )
    OR EXISTS (
      SELECT 1
        FROM branch_master bm
       WHERE bm.id IN (${ph})
         AND bm.branch_name COLLATE utf8mb4_unicode_ci
           = ${alias}.branch_name COLLATE utf8mb4_unicode_ci
    )
  )`;
  return { sql, params: [...ids, ...ids] };
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
    if (await isPeriodLocked(budgetLine.period_code)) {
      throw new Error(
        `${budgetLine.period_code} is locked for P&L close. Raise this against the current open period.`
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
    /*
     * Which numbering format runs is a CONFIG FLAG, not a deploy (Requirement 12).
     *
     * finance_config.grn_number_format ships as 'legacy_branch_fy', so this is byte-identical
     * to the old behaviour until somebody switches it — at which point new GRNs get
     * MAS/MM/YY/SERIAL and existing numbers are untouched, because the two formats use
     * different sequence tables.
     *
     * Wiring this in was overdue: the monthly allocator, its sequence table and the flag all
     * existed and were tested, but NOTHING read the flag, so flipping it did nothing at all.
     * Requirement 12 was built and unreachable.
     */
    const numberFormat = await resolveGrnNumberFormat();
    const grnNumber = numberFormat === "monthly_company"
      ? await allocateMonthlyGrnNumber({
          // The accounting period, not bill_date — the MM/YY belongs to the month the GRN books
          // to, which is the decision taken when multi-month was specified.
          periodCode: resolveAccountingPeriod({
            accountingPeriod: payload.accountingPeriod,
            billDate: payload.billDate,
          }),
        })
      : await allocateGrnNumber(payload.branchId, financialYear);
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

  /** Corrects a Finance-Head-approved GRN that should not have consumed budget — releases the
   *  consumed_amount/consumed_quantity back onto the budget line and moves the GRN to a
   *  terminal 'consumption_reversed' status. Symmetric to the release() already used when a
   *  GRN is rejected before reaching this stage; there was previously no way back once a GRN
   *  passed finance_head_approved (cancelGrn explicitly refuses at that point). */
  async reverseConsumption(
    grnId: string,
    reason: string,
    actorUserId: string,
    actorRole: string
  ) {
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      throw new Error("A reason is required to reverse a GRN's budget consumption");
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM grn_request WHERE id = ? FOR UPDATE`,
        [grnId]
      );
      const grn = rows[0] as any;
      if (!grn) throw new Error("GRN not found");
      if (!CONSUMED_GRN_STATUSES.includes(grn.status)) {
        throw new Error(
          `Cannot reverse consumption for a GRN with status '${grn.status}' — it has not consumed budget, or has already been reversed`
        );
      }

      if (await grnSmartService.hasAllocations(grnId)) {
        await grnSmartService.reverseConsumption(connection, grnId);
      } else {
        await budgetConsumptionService.reverseConsumption(
          connection,
          grn.budget_line_id,
          Number(grn.amount_with_tax || grn.amount),
          Number(grn.quantity)
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE grn_request
            SET status = 'consumption_reversed',
                reviewed_by = ?,
                reviewed_at = NOW(),
                review_note = ?,
                rejection_reason = ?
          WHERE id = ? AND status = ?`,
        [actorUserId, trimmedReason, trimmedReason, grnId, grn.status]
      );
      if (result.affectedRows !== 1) {
        throw new Error("GRN status changed before reversal; refresh and try again");
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await writeGrnAudit("CONSUMPTION_REVERSED", grnId, actorUserId, actorRole, {
      reason: trimmedReason,
    });
    return { success: true };
  },

  async listGrns(filters: {
    branchId?: string;
    /**
     * Multi-branch scope. Wins over `branchId` when present.
     *
     * Both are accepted so routers can migrate one at a time: an unmigrated caller keeps
     * passing a single `branchId` and behaves exactly as before.
     */
    branchScope?: FinanceBranchScope;
    processId?: string;
    costCentreId?: string;
    costClass?: string;
    status?: string;
    financialYear?: string;
    grnType?: string;
    search?: string;
    // Requirement 14 — the GRN Search workspace. Free-text `search` stays; these are the
    // structured filters, which an operator needs to answer "which GRNs are this vendor's,
    // in August, over a lakh, still unpaid" without scrolling.
    grnNumber?: string;
    invoiceNumber?: string;
    vendorId?: string;
    head?: string;
    subHead?: string;
    billingCycleStatus?: string;
    accountingPeriod?: string;
    billDateFrom?: string;
    billDateTo?: string;
    amountFrom?: number;
    amountTo?: number;
    createdBy?: string;
    multiMonth?: boolean;
    page?: number;
    limit?: number;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.branchScope) {
      const filter = financeBranchFilter(filters.branchScope, "g.branch_id");
      if (filter.sql !== "1=1") {
        conditions.push(filter.sql);
        params.push(...filter.params);
      }
    } else if (filters.branchId) {
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
    // Partial match on the two identifiers people actually quote at each other.
    if (filters.grnNumber) {
      conditions.push("g.grn_number LIKE ?");
      params.push(`%${filters.grnNumber}%`);
    }
    if (filters.invoiceNumber) {
      conditions.push("g.invoice_number LIKE ?");
      params.push(`%${filters.invoiceNumber}%`);
    }
    if (filters.vendorId) {
      conditions.push("g.vendor_id = ?");
      params.push(filters.vendorId);
    }
    if (filters.head) {
      conditions.push("g.head = ?");
      params.push(filters.head);
    }
    if (filters.subHead) {
      conditions.push("g.sub_head = ?");
      params.push(filters.subHead);
    }
    if (filters.billingCycleStatus) {
      // 'UNCLASSIFIED' is how the UI asks for historical rows, which are NULL because the
      // column postdates them. A plain equality would silently return nothing for those.
      if (filters.billingCycleStatus === "UNCLASSIFIED") {
        conditions.push("g.billing_cycle_status IS NULL");
      } else {
        conditions.push("g.billing_cycle_status = ?");
        params.push(filters.billingCycleStatus);
      }
    }
    if (filters.accountingPeriod) {
      // Falls back to bill_date for rows raised before accounting_period existed, so a period
      // filter does not simply hide every historical GRN.
      conditions.push(
        "COALESCE(g.accounting_period, DATE_FORMAT(g.bill_date, '%Y-%m')) = ?"
      );
      params.push(filters.accountingPeriod);
    }
    if (filters.billDateFrom) {
      conditions.push("g.bill_date >= ?");
      params.push(filters.billDateFrom);
    }
    if (filters.billDateTo) {
      conditions.push("g.bill_date <= ?");
      params.push(filters.billDateTo);
    }
    // Compared against the gross, which is what the list column shows — filtering on a
    // different figure from the one on screen is how "the filter is broken" reports start.
    if (filters.amountFrom !== undefined && Number.isFinite(filters.amountFrom)) {
      conditions.push("COALESCE(g.amount_with_tax, g.amount) >= ?");
      params.push(filters.amountFrom);
    }
    if (filters.amountTo !== undefined && Number.isFinite(filters.amountTo)) {
      conditions.push("COALESCE(g.amount_with_tax, g.amount) <= ?");
      params.push(filters.amountTo);
    }
    if (filters.createdBy) {
      conditions.push("g.created_by = ?");
      params.push(filters.createdBy);
    }
    if (filters.multiMonth !== undefined) {
      conditions.push("COALESCE(g.is_multi_month, 0) = ?");
      params.push(filters.multiMonth ? 1 : 0);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 30));
    const offset = (page - 1) * limit;

    // mysql2 3.22.3 throws ER_WRONG_ARGUMENTS (errno 1210) binding LIMIT/OFFSET
    // via execute()'s prepared-statement protocol on this server — reproduced
    // even for a trivial single-column, no-join query. limit/offset are
    // server-clamped numbers (Math.min/Math.max above), never raw user input,
    // so query()'s text protocol is safe here.
    // Named per stage (not just the latest generic reviewed_by) so a history/timeline view can
    // show who actually acted at Branch Head vs Finance Head, not just who touched it last.
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT g.*,
              bm.branch_name,
              pm.process_name,
              ccm.cost_centre_name,
              h.budget_number,
              l.item_name AS budget_item_name,
              CONCAT(cb.first_name, ' ', cb.last_name) AS created_by_name,
              CONCAT(rb.first_name, ' ', rb.last_name) AS reviewed_by_name,
              CONCAT(bhb.first_name, ' ', bhb.last_name) AS branch_head_reviewed_by_name,
              CONCAT(fhb.first_name, ' ', fhb.last_name) AS finance_head_reviewed_by_name
         FROM grn_request g
         LEFT JOIN branch_master bm ON bm.id = g.branch_id
         LEFT JOIN process_master pm ON pm.id = g.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
         LEFT JOIN finance_budget_header h ON h.id = g.budget_id
         LEFT JOIN finance_budget_line l ON l.id = g.budget_line_id
         LEFT JOIN employees cb ON cb.user_id = g.created_by
         LEFT JOIN employees rb ON rb.user_id = g.reviewed_by
         LEFT JOIN employees bhb ON bhb.user_id = g.branch_head_reviewed_by
         LEFT JOIN employees fhb ON fhb.user_id = g.finance_head_reviewed_by
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
      data: (rows as RowDataPacket[]).map(decorateGrnPendency),
      total: Number(countRows[0]?.total ?? 0),
      page,
      limit,
    };
  },

  async listLegacyGrns(filters: {
    branchScope?: FinanceBranchScope;
    processId?: string;
    costCentreId?: string;
    status?: string;
    grnNumber?: string;
    head?: string;
    subHead?: string;
    accountingPeriod?: string;
    billDateFrom?: string;
    billDateTo?: string;
    amountFrom?: number;
    amountTo?: number;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.branchScope) {
      const { sql, params: bParams } = legacyBranchCondition(filters.branchScope);
      if (sql !== "1=1") {
        conditions.push(sql);
        params.push(...bParams);
      }
    }

    if (filters.costCentreId) {
      conditions.push(`EXISTS (
        SELECT 1
          FROM grn_entry_line_snapshot l
          JOIN cost_centre_master ccm
            ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
             = l.cost_centre_code  COLLATE utf8mb4_unicode_ci
         WHERE l.grn_source_id = g.bill_source_id
           AND ccm.id = ?
      )`);
      params.push(filters.costCentreId);
    }

    if (filters.processId) {
      conditions.push(`EXISTS (
        SELECT 1
          FROM grn_entry_line_snapshot l
          JOIN cost_centre_master ccm
            ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
             = l.cost_centre_code  COLLATE utf8mb4_unicode_ci
          JOIN employees e
            ON e.cost_centre_id = ccm.id
           AND e.active_status   = 1
           AND e.process_id IS NOT NULL
         WHERE l.grn_source_id = g.bill_source_id
           AND e.process_id = ?
      )`);
      params.push(filters.processId);
    }

    if (filters.status) {
      if (filters.status === "rejected") {
        conditions.push("g.is_rejected = 1");
      } else if (filters.status === "approved" || filters.status === "paid") {
        conditions.push("g.is_rejected = 0 AND g.entry_status = 'Close'");
      } else if (
        filters.status === "pending_accounts_payment" ||
        filters.status === "payment_scheduled"
      ) {
        conditions.push("g.is_rejected = 0 AND g.entry_status = 'Booked'");
      } else if (filters.status === "submitted" || filters.status === "branch_head_approved") {
        conditions.push("g.is_rejected = 0 AND g.entry_status = 'Open'");
      } else {
        conditions.push("1 = 0");
      }
    } else {
      conditions.push("g.is_rejected = 0");
    }

    if (filters.accountingPeriod) {
      conditions.push("g.period_code = ?");
      params.push(filters.accountingPeriod);
    }
    if (filters.billDateFrom) {
      conditions.push("g.period_code >= ?");
      params.push(filters.billDateFrom.slice(0, 7));
    }
    if (filters.billDateTo) {
      conditions.push("g.period_code <= ?");
      params.push(filters.billDateTo.slice(0, 7));
    }

    if (filters.amountFrom !== undefined && Number.isFinite(filters.amountFrom)) {
      conditions.push("(g.amount + g.cgst + g.sgst + g.igst) >= ?");
      params.push(filters.amountFrom);
    }
    if (filters.amountTo !== undefined && Number.isFinite(filters.amountTo)) {
      conditions.push("(g.amount + g.cgst + g.sgst + g.igst) <= ?");
      params.push(filters.amountTo);
    }

    if (filters.grnNumber) {
      conditions.push("g.grn_no LIKE ?");
      params.push(`%${filters.grnNumber}%`);
    }

    if (filters.head) {
      conditions.push("(hd.head_name = ? OR g.head_id = ?)");
      params.push(filters.head, filters.head);
    }
    if (filters.subHead) {
      conditions.push("(shd.head_name = ? OR g.sub_head_id = ?)");
      params.push(filters.subHead, filters.subHead);
    }

    if (filters.search) {
      conditions.push(
        "(g.grn_no LIKE ? OR g.vendor LIKE ? OR hd.head_name LIKE ? OR g.description LIKE ?)"
      );
      const like = `%${filters.search}%`;
      params.push(like, like, like, like);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const page  = Math.max(1, filters.page  ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 30));
    const offset = (page - 1) * limit;

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
          CONCAT('leg_', g.bill_source_id)           AS id,
          g.grn_no                                   AS grn_number,
          'legacy'                                   AS source_type,
          'vendor'                                   AS grn_type,
          g.vendor                                   AS vendor_name,
          g.branch_name,
          COALESCE(hd.head_name,  g.head_id)         AS head,
          COALESCE(shd.head_name, g.sub_head_id)     AS sub_head,
          NULL                                       AS invoice_number,
          g.bill_date,
          g.amount                                   AS amount,
          g.amount + g.cgst + g.sgst + g.igst        AS amount_with_tax,
          g.period_code                              AS accounting_period,
          CASE
            WHEN g.is_rejected = 1           THEN 'rejected'
            WHEN g.entry_status = 'Close'    THEN 'approved'
            WHEN g.entry_status = 'Booked'   THEN 'pending_accounts_payment'
            ELSE                                  'submitted'
          END                                        AS status,
          g.entry_status                             AS legacy_entry_status,
          NULL                                       AS billing_cycle_status,
          0                                          AS is_multi_month,
          NULL                                       AS created_by_name,
          g.source_created_at                        AS created_at,
          NULL                                       AS submitted_at,
          NULL                                       AS branch_head_reviewed_at,
          NULL                                       AS branch_head_reviewed_by_name,
          g.approved_by_fh_at                        AS finance_head_reviewed_at,
          NULL                                       AS finance_head_reviewed_by_name,
          NULL                                       AS rejection_reason,
          NULL                                       AS process_name,
          NULL                                       AS cost_centre_name,
          NULL                                       AS budget_number,
          NULL                                       AS budget_item_name,
          NULL                                       AS reviewed_by_name
        FROM grn_entry_snapshot g
        LEFT JOIN finance_expense_head_snapshot hd
               ON hd.bill_source_id = g.head_id  AND hd.head_type = 'head'
        LEFT JOIN finance_expense_head_snapshot shd
               ON shd.bill_source_id = g.sub_head_id AND shd.head_type = 'subhead'
        ${where}
        ORDER BY g.source_created_at DESC, g.bill_source_id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM grn_entry_snapshot g
         LEFT JOIN finance_expense_head_snapshot hd
                ON hd.bill_source_id = g.head_id  AND hd.head_type = 'head'
         LEFT JOIN finance_expense_head_snapshot shd
                ON shd.bill_source_id = g.sub_head_id AND shd.head_type = 'subhead'
         ${where}`,
      params
    );

    return {
      data: rows as RowDataPacket[],
      total: Number(countRows[0]?.total ?? 0),
      page,
      limit,
    };
  },

  /**
   * Counts and rupee totals per status, for the GRN page header and its filter chips.
   *
   * This exists because listGrns clamps limit to 100 (see above), so summing amounts from a
   * fetched page silently under-reports on any branch with more than 100 GRNs — and a wrong
   * money figure on a finance screen is worse than no figure. Aggregating in SQL is exact at
   * any volume and costs one query instead of one per chip.
   *
   * Branch scope is applied by the caller via resolveFinanceBranchScope, exactly as the list
   * endpoint does; this method never widens what the caller may see.
   */
  /**
   * Sets the OPEN / BOOKED / CLOSED billing cycle status (Requirement 4).
   *
   * Deliberately its own method touching its own column. billing_cycle_status answers
   * "is another invoice expected against this service cycle?", which is orthogonal to
   * grn_request.status, the twelve-value approval and payment chain. Overloading `status`
   * would have made "is this paid" and "is this cycle finished" the same question, and they
   * are not — a monthly rental GRN can be fully paid and still OPEN.
   *
   * No approval transition ever writes this column, and this never writes `status`. A contract
   * test asserts they never appear in the same UPDATE, because the moment they do, closing a
   * billing cycle starts moving GRNs through the payment workflow.
   *
   * NULL stays reachable: historical rows predate the column and read as "Not classified".
   * Clearing back to unclassified is allowed rather than forcing a guess.
   */
  async setBillingCycleStatus(
    grnId: string,
    billingCycleStatus: "OPEN" | "BOOKED" | "CLOSED" | null,
    actorUserId: string,
  ) {
    const allowed = new Set(["OPEN", "BOOKED", "CLOSED"]);
    if (billingCycleStatus !== null && !allowed.has(billingCycleStatus)) {
      throw new Error("Billing status must be OPEN, BOOKED or CLOSED");
    }

    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id, billing_cycle_status FROM grn_request WHERE id = ? LIMIT 1`,
      [grnId],
    );
    if (!existing[0]) throw new Error("GRN not found");
    const previous = existing[0].billing_cycle_status ?? null;

    await db.execute(
      `UPDATE grn_request SET billing_cycle_status = ? WHERE id = ?`,
      [billingCycleStatus, grnId],
    );

    await recordFinanceApprovalEvent({
      entityType: "grn",
      entityId: grnId,
      action: "billing_cycle_set",
      fromStatus: previous ? String(previous) : null,
      toStatus: billingCycleStatus ?? "UNCLASSIFIED",
      actorUserId,
      actorRole: "finance",
      remarks: null,
    });

    return { id: grnId, billing_cycle_status: billingCycleStatus };
  },

  /**
   * Sends a GRN back for correction instead of killing it (Requirement 9).
   *
   * Rejection was terminal: a voucher rejected by Finance had to be raised again from scratch,
   * and the original reason lived only in a column the next transition overwrote. That is
   * unusable for imprest, where a Branch Head is expected to correct and resubmit.
   *
   * Two return targets, deliberately distinct:
   *   returned_to_branch_head  Finance sends it back to the Branch Head, who can fix and
   *                            resubmit without the raiser being involved.
   *   returned_to_raiser       the Branch Head sends it further back to whoever raised it,
   *                            because the correction needs the original documents.
   *
   * WHY NOT REUSE 'draft'
   * `draft` means "never submitted", and saveAllocations/saveComponentAllocations gate on it.
   * Reusing it would let a returned GRN silently rewrite its allocations with nobody aware it
   * had already been through approval.
   *
   * The reservation is RELEASED on return. Holding it while the GRN sits with someone freezes
   * budget headroom for an unbounded time and starves the line — the money is not committed
   * until it comes back and is approved again.
   *
   * History is appended, never overwritten: every hop writes a finance_approval_event carrying
   * its own reason, so a GRN returned twice shows both.
   */
  async returnGrn(
    grnId: string,
    target: "branch_head" | "raiser",
    reason: string,
    actorUserId: string,
    actorRole: string,
  ) {
    if (!reason || !reason.trim()) {
      throw new Error("A reason is required to return a GRN");
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM grn_request WHERE id = ? FOR UPDATE`,
        [grnId],
      );
      const grn = rows[0];
      if (!grn) throw new Error("GRN not found");
      const from = String(grn.status);

      // Only a GRN that is actually with a reviewer can be sent back. Returning a paid or
      // cancelled one would reopen something already accounted for.
      const RETURNABLE = new Set(["submitted", "branch_head_approved", "returned_to_branch_head"]);
      if (!RETURNABLE.has(from)) {
        throw new Error(`A GRN with status ${from} cannot be returned`);
      }
      const to = target === "branch_head" ? "returned_to_branch_head" : "returned_to_raiser";
      if (from === to) throw new Error(`This GRN is already ${to}`);

      // Release only from branch_head_approved — that is the only state holding a reservation.
      if (from === "branch_head_approved" && grn.budget_line_id) {
        await budgetConsumptionService.release(
          connection,
          String(grn.budget_line_id),
          Number(grn.amount_with_tax || grn.amount),
          Number(grn.quantity),
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE grn_request
            SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW()
          WHERE id = ? AND status = ?`,
        [to, reason, actorUserId, grnId, from],
      );
      // Optimistic guard: someone else moved it while we were deciding.
      if (result.affectedRows !== 1) {
        throw new Error("GRN status changed during review; refresh and retry");
      }

      await recordFinanceApprovalEvent(
        {
          entityType: "grn",
          entityId: grnId,
          action: "return",
          fromStatus: from,
          toStatus: to,
          decision: target === "branch_head" ? "returned_to_branch_head" : "returned_to_raiser",
          actorUserId,
          actorRole,
          remarks: reason,
        },
        connection,
      );

      await connection.commit();
      return { id: grnId, status: to };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  /**
   * Puts a returned GRN back into the approval chain.
   *
   * From returned_to_branch_head it goes to 'submitted', NOT straight to
   * branch_head_approved — the Branch Head must approve it again, which re-reserves the
   * budget through the normal path rather than through a second reservation route here.
   */
  async resubmitReturnedGrn(grnId: string, actorUserId: string, actorRole: string, note?: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, status FROM grn_request WHERE id = ? FOR UPDATE`,
        [grnId],
      );
      const grn = rows[0];
      if (!grn) throw new Error("GRN not found");
      const from = String(grn.status);
      if (from !== "returned_to_branch_head" && from !== "returned_to_raiser") {
        throw new Error(`Only a returned GRN can be resubmitted; this one is ${from}`);
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE grn_request SET status = 'submitted', submitted_at = NOW() WHERE id = ? AND status = ?`,
        [grnId, from],
      );
      if (result.affectedRows !== 1) {
        throw new Error("GRN status changed during resubmission; refresh and retry");
      }

      await recordFinanceApprovalEvent(
        {
          entityType: "grn",
          entityId: grnId,
          action: "resubmit",
          fromStatus: from,
          toStatus: "submitted",
          actorUserId,
          actorRole,
          remarks: note ?? null,
        },
        connection,
      );

      await connection.commit();
      return { id: grnId, status: "submitted" };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async getGrnSummary(filters: {
    branchId?: string;
    branchScope?: FinanceBranchScope;
    financialYear?: string;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.branchScope) {
      const filter = financeBranchFilter(filters.branchScope, "g.branch_id");
      if (filter.sql !== "1=1") {
        conditions.push(filter.sql);
        params.push(...filter.params);
      }
    } else if (filters.branchId) {
      conditions.push("g.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.financialYear) {
      conditions.push("g.financial_year = ?");
      params.push(filters.financialYear);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT g.status AS status,
              COUNT(*) AS count,
              COALESCE(SUM(COALESCE(g.amount_with_tax, g.amount)), 0) AS value
         FROM grn_request g
         ${where}
        GROUP BY g.status`,
      params
    );

    const byStatus: Record<string, { count: number; value: number }> = {};
    for (const row of rows) {
      byStatus[String(row.status)] = {
        count: Number(row.count ?? 0),
        value: Number(row.value ?? 0),
      };
    }

    // "In queue" spans both review stages: a GRN waiting on the Branch Head and one already
    // through it and waiting on Finance are both awaiting a decision from someone.
    const inQueue = ["submitted", "branch_head_approved"].reduce(
      (acc, status) => {
        const bucket = byStatus[status];
        if (bucket) {
          acc.count += bucket.count;
          acc.value += bucket.value;
        }
        return acc;
      },
      { count: 0, value: 0 }
    );

    return { byStatus, inQueue };
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


/**
 * Adds the pendency fields the approval queue renders (Requirement 10).
 *
 * Derived, never stored. Pending-with is a pure function of status, so a column would be a
 * second source of truth free to drift from the status it describes.
 *
 * Ageing counts time in the CURRENT stage, not since the GRN was raised. Measuring from
 * creation buries a fast Finance turnaround inside a slow Branch Head one, which is the
 * opposite of what a pendency queue is for.
 */
function decorateGrnPendency(row: RowDataPacket): RowDataPacket {
  const status = String(row.status ?? "");
  const pending = resolvePendingWith(status, "grn");

  // The clock restarts at each hand-off, so it reads from the most recent one.
  const stageStartedAt =
    row.branch_head_reviewed_at ?? row.submitted_at ?? row.created_at ?? null;
  const ageDays =
    pending.isPending && stageStartedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(String(stageStartedAt)).getTime()) / 86_400_000))
      : null;

  return {
    ...row,
    pending_with_role: pending.role,
    pending_with: pending.label,
    is_pending: pending.isPending,
    pending_since: pending.isPending ? stageStartedAt : null,
    ageing_days: ageDays,
    age_bucket: ageDays === null ? null : ageDays <= 2 ? "0-2" : ageDays <= 7 ? "3-7" : "7+",
  } as RowDataPacket;
}
