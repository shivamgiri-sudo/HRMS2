import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import {
  calculateBudgetLine,
  type BudgetGstType,
  type BudgetTaxTreatment,
} from "./branch-budget.service.js";
import { financeBranchFilter, type FinanceBranchScope } from "../finance/finance-access-scope.js";
import { resolvePendingWith } from "../finance/finance-workflow-role.js";
import { lockActiveBudgetLine } from "./budget-consumption.service.js";
import { isPeriodLocked } from "./finance-period-lock.js";

export type BudgetTopupStatus =
  | "submitted"
  | "branch_head_approved"
  | "finance_head_approved"
  | "rejected"
  | "applied";

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 10_000) / 10_000;
}

/**
 * Applies an approved top-up to its budget line, and to the header totals that summarise it.
 *
 * The line is RECOMPUTED from its new quantity through calculateBudgetLine — the same function
 * that produced every amount on it in the first place — rather than having a figure added to one
 * column. Two reasons:
 *
 *  1. `requested_amount` is a QUOTED amount. BudgetTopupPanel derives requestedQuantity as
 *     amount / unit_rate, and calculateBudgetLine's quotedAmount is quantity * unit_rate. Under
 *     exclusive GST the gross rises by quoted * (1 + rate/100), so the previous
 *     `gross_amount = gross_amount + requested_amount` under-stated the gross by the tax on the
 *     increase, and left quantity, base, tax and gross disagreeing with each other.
 *  2. It only ever touched gross_amount and quantity. base_amount, tax_amount,
 *     recoverable_tax_amount, the CGST/SGST/IGST split and — most importantly —
 *     pnl_cost_amount were left at their pre-top-up values. pnl_cost_amount is what every P&L
 *     read uses (bpo-pnl.service.ts, branch-budget.service.ts), so a formally approved increase
 *     raised the GRN ceiling while the branch went on being reported overspent against the old
 *     budget. The header's gross_budget_amount / pnl_budget_amount were not updated either.
 *
 * Recomputing is safe because lines are internally consistent by construction: verified against
 * production, all 94 existing lines satisfy quantity * unit_rate = the quoted base.
 */
async function applyTopupToLine(
  connection: PoolConnection,
  budgetLineId: string,
  additionalQuantity: number
) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id, budget_id, head, item_name, quantity, unit, unit_rate,
            tax_treatment, gst_rate, gst_type, recoverable_tax_pct
       FROM finance_budget_line WHERE id = ?`,
    [budgetLineId]
  );
  const line = rows[0];
  if (!line) throw new Error("Budget line not found");

  const recomputed = calculateBudgetLine({
    head: String(line.head),
    itemName: String(line.item_name),
    quantity: Number(line.quantity) + additionalQuantity,
    unit: String(line.unit ?? ""),
    unitRate: Number(line.unit_rate),
    taxTreatment: String(line.tax_treatment) as BudgetTaxTreatment,
    gstRate: Number(line.gst_rate ?? 0),
    gstType: (line.gst_type ?? undefined) as BudgetGstType | undefined,
    recoverableTaxPct: line.recoverable_tax_pct == null ? undefined : Number(line.recoverable_tax_pct),
    justification: "",
  });

  await connection.execute(
    `UPDATE finance_budget_line
        SET quantity = ?,
            base_amount = ?,
            tax_amount = ?,
            gross_amount = ?,
            recoverable_tax_amount = ?,
            pnl_cost_amount = ?,
            cgst_amount = ?,
            sgst_amount = ?,
            igst_amount = ?
      WHERE id = ?`,
    [
      Number(line.quantity) + additionalQuantity,
      recomputed.baseAmount,
      recomputed.taxAmount,
      recomputed.grossAmount,
      recomputed.recoverableTaxAmount,
      recomputed.pnlCostAmount,
      recomputed.cgstAmount,
      recomputed.sgstAmount,
      recomputed.igstAmount,
      budgetLineId,
    ]
  );

  // Header totals are re-summed from the lines rather than incremented, so they cannot drift
  // from the rows beneath them however many top-ups a budget takes. Production confirms the
  // two are currently exact to the rupee, which is the invariant worth preserving.
  await connection.execute(
    `UPDATE finance_budget_header h
        SET h.gross_budget_amount = (
              SELECT COALESCE(SUM(l.gross_amount), 0) FROM finance_budget_line l WHERE l.budget_id = h.id),
            h.pnl_budget_amount = (
              SELECT COALESCE(SUM(l.pnl_cost_amount), 0) FROM finance_budget_line l WHERE l.budget_id = h.id)
      WHERE h.id = ?`,
    [String(line.budget_id)]
  );
}

export const budgetTopupService = {
  /** For the route-level branch scope check, before create() — same shape as
   *  branchBudgetService.get()'s branch_id, but a topup is targeted by line, not budget. */
  async getLineBranch(budgetLineId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT h.branch_id
         FROM finance_budget_line l
         JOIN finance_budget_header h ON h.id = l.budget_id
        WHERE l.id = ?`,
      [budgetLineId]
    );
    if (!rows[0]) throw new Error("Budget line not found");
    return String(rows[0].branch_id);
  },

  /** Raised by whoever hit "exceeds available budget" on a GRN — the branch_head/branch_admin
   *  raising against a specific budget line, never against the budget header directly. */
  async create(
    input: { budgetLineId: string; requestedAmount: number; requestedQuantity: number; reason: string },
    actorId: string,
    _actorRole: string
  ) {
    const requestedAmount = roundMoney(input.requestedAmount);
    const requestedQuantity = roundQuantity(input.requestedQuantity);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new Error("Requested amount must be greater than zero");
    }
    if (!Number.isFinite(requestedQuantity) || requestedQuantity < 0) {
      throw new Error("Requested quantity cannot be negative");
    }
    if (!input.reason?.trim()) {
      throw new Error("A reason is required to request a budget increase");
    }

    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT l.id, l.budget_id, h.status AS budget_status, h.branch_id
         FROM finance_budget_line l
         JOIN finance_budget_header h ON h.id = l.budget_id
        WHERE l.id = ?`,
      [input.budgetLineId]
    );
    const line = lineRows[0];
    if (!line) throw new Error("Budget line not found");
    if (String(line.budget_status) !== "active") {
      throw new Error("A top-up can only be requested against an active budget line");
    }

    const id = randomUUID();
    await db.execute(
      `INSERT INTO finance_budget_topup_request
         (id, budget_line_id, budget_id, requested_by, requested_amount, requested_quantity, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted')`,
      [id, input.budgetLineId, line.budget_id, actorId, requestedAmount, requestedQuantity, input.reason.trim()]
    );
    return this.get(id);
  },

  async get(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT t.*,
              l.head, l.sub_head, l.item_name, l.unit, l.unit_rate,
              l.gross_amount AS line_gross_amount, l.quantity AS line_quantity,
              h.budget_number, h.branch_id, h.period_code, bm.branch_name
         FROM finance_budget_topup_request t
         JOIN finance_budget_line l ON l.id = t.budget_line_id
         JOIN finance_budget_header h ON h.id = t.budget_id
         LEFT JOIN branch_master bm ON bm.id = h.branch_id
        WHERE t.id = ?`,
      [id]
    );
    if (!rows[0]) throw new Error("Top-up request not found");
    return rows[0];
  },

  async list(filters: {
    branchId?: string;
    /** Multi-branch scope; wins over branchId. Both exist so routers migrate one at a time. */
    branchScope?: FinanceBranchScope;
    status?: string;
    head?: string;
    subHead?: string;
    requestedBy?: string;
    period?: string;
    raisedFrom?: string;
    raisedTo?: string;
    /** Narrow to rows awaiting a given stage. Derived from status, never stored. */
    pendingWithRole?: string;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.branchScope) {
      const filter = financeBranchFilter(filters.branchScope, "h.branch_id");
      if (filter.sql !== "1=1") {
        conditions.push(filter.sql);
        params.push(...filter.params);
      }
    } else if (filters.branchId) {
      conditions.push("h.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.status) {
      conditions.push("t.status = ?");
      params.push(filters.status);
    }
    if (filters.head) {
      conditions.push("l.head = ?");
      params.push(filters.head);
    }
    if (filters.subHead) {
      conditions.push("l.sub_head = ?");
      params.push(filters.subHead);
    }
    if (filters.requestedBy) {
      conditions.push("t.requested_by = ?");
      params.push(filters.requestedBy);
    }
    if (filters.period) {
      conditions.push("h.period_code = ?");
      params.push(filters.period);
    }
    if (filters.raisedFrom) {
      conditions.push("t.created_at >= ?");
      params.push(`${filters.raisedFrom} 00:00:00`);
    }
    if (filters.raisedTo) {
      conditions.push("t.created_at <= ?");
      params.push(`${filters.raisedTo} 23:59:59`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    // LIMIT/OFFSET are not used here (no pagination yet, matches an already-fixed footgun in
    // grn.service.ts listGrns — mysql2 3.22.3 rejects them as execute() bind params).
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT t.*,
              l.head, l.sub_head, l.item_name,
              h.budget_number, h.branch_id, bm.branch_name
         FROM finance_budget_topup_request t
         JOIN finance_budget_line l ON l.id = t.budget_line_id
         JOIN finance_budget_header h ON h.id = t.budget_id
         LEFT JOIN branch_master bm ON bm.id = h.branch_id
         ${where}
        ORDER BY t.created_at DESC
        LIMIT 200`,
      params
    );

    const decorated = (rows as RowDataPacket[]).map((row) => decorateTopup(row));
    const visible = filters.pendingWithRole
      ? decorated.filter((r) => r.pending_with_role === filters.pendingWithRole)
      : decorated;

    // Counts come from the same scoped, filtered set the rows do — a tab badge that counted
    // more widely than the list beneath it would advertise other branches' requests.
    const counts = {
      all: decorated.length,
      pending_branch_head: decorated.filter((r) => r.pending_with_role === "branch_head").length,
      pending_finance_head: decorated.filter((r) => r.pending_with_role === "finance_head").length,
      applied: decorated.filter((r) => String(r.status) === "applied").length,
      rejected: decorated.filter((r) => String(r.status) === "rejected").length,
    };

    return { rows: visible, counts };
  },

  /** Two-stage chain, identical shape to GRN review: branch_head at 'submitted',
   *  finance_head at 'branch_head_approved'. Approval at finance_head atomically applies
   *  the increase to the budget line under the same row lock GRN consumption already uses. */
  async review(id: string, decision: "approve" | "reject", actorId: string, effectiveRole: string, remarks?: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      // P0-3: Join the header to get period_code so the lock check runs inside this transaction.
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT t.*, h.period_code
           FROM finance_budget_topup_request t
           JOIN finance_budget_header h ON h.id = t.budget_id
          WHERE t.id = ?
          FOR UPDATE`,
        [id]
      );
      const request = rows[0];
      if (!request) throw new Error("Top-up request not found");
      const status = String(request.status);

      // P0P1-4: Maker-checker — the approver cannot be the person who raised the request,
      // regardless of role.  Applies to both approve and reject so a requester cannot
      // "reject" their own request to unblock a later re-submission either.
      if (String(request.requested_by) === actorId) {
        throw new Error(
          "Maker-checker violation: the approver cannot be the same person who submitted this top-up request"
        );
      }

      if (decision === "reject") {
        if (!["submitted", "branch_head_approved"].includes(status)) {
          throw new Error(`Cannot reject a top-up request in status ${status}`);
        }
        if (!remarks?.trim()) throw new Error("A reason is required to reject a top-up request");
        const reviewedColumn = effectiveRole === "branch_head" ? "branch_head" : "finance_head";
        await connection.execute(
          `UPDATE finance_budget_topup_request
              SET status = 'rejected', rejection_reason = ?,
                  ${reviewedColumn}_reviewed_by = ?, ${reviewedColumn}_reviewed_at = NOW(),
                  ${reviewedColumn}_review_note = ?
            WHERE id = ?`,
          [remarks.trim(), actorId, remarks.trim(), id]
        );
        await connection.commit();
        return this.get(id);
      }

      if (effectiveRole === "branch_head") {
        if (status !== "submitted") {
          throw new Error(`Top-up request is not awaiting branch_head review (status: ${status})`);
        }
        await connection.execute(
          `UPDATE finance_budget_topup_request
              SET status = 'branch_head_approved',
                  branch_head_reviewed_by = ?, branch_head_reviewed_at = NOW(), branch_head_review_note = ?
            WHERE id = ?`,
          [actorId, remarks?.trim() || null, id]
        );
        await connection.commit();
        return this.get(id);
      }

      if (effectiveRole === "finance_head") {
        if (status !== "branch_head_approved") {
          throw new Error(`Top-up request is not awaiting finance_head review (status: ${status})`);
        }
        // P0-3: Re-check period lock inside the transaction before mutating the budget line.
        if (await isPeriodLocked(String(request.period_code), connection)) {
          throw new Error(
            `${request.period_code} is locked for P&L close. This top-up cannot be applied.`
          );
        }
        // Same lock GRN reserve()/consume() already use — a top-up and a GRN cannot race
        // against the same line's headroom.
        await lockActiveBudgetLine(connection, String(request.budget_line_id));
        await applyTopupToLine(connection, String(request.budget_line_id), Number(request.requested_quantity));
        await connection.execute(
          `UPDATE finance_budget_topup_request
              SET status = 'applied', applied_at = NOW(),
                  finance_head_reviewed_by = ?, finance_head_reviewed_at = NOW(), finance_head_review_note = ?
            WHERE id = ?`,
          [actorId, remarks?.trim() || null, id]
        );
        await connection.commit();
        return this.get(id);
      }

      throw new Error(`No approval role is valid for top-up status ${status}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};


/**
 * Adds the derived pendency fields Requirement 1 asks for.
 *
 * All of it is computed, not stored. Pending-with is a pure function of status, and ageing is
 * a function of when the current stage began — a stored copy of either would be a second
 * source of truth free to drift from the status it describes.
 *
 * Ageing counts time in the CURRENT stage, not since the request was raised. Measuring from
 * creation buries a fast Finance turnaround inside a slow Branch Head one, which is the
 * opposite of what a pendency report is for.
 */
type DecoratedTopup = RowDataPacket & {
  pending_with_role: string | null;
  pending_with: string;
  is_pending: boolean;
  ageing_days: number | null;
  age_bucket: string | null;
};

function decorateTopup(row: RowDataPacket): DecoratedTopup {
  const status = String(row.status ?? "");
  const pending = resolvePendingWith(status, "topup");

  const stageStartedAt =
    row.branch_head_reviewed_at ?? row.created_at ?? null;
  const lastActionAt =
    row.applied_at ?? row.finance_head_reviewed_at ?? row.branch_head_reviewed_at ?? null;
  const lastActionBy =
    row.finance_head_reviewed_by ?? row.branch_head_reviewed_by ?? null;

  const ageDays = pending.isPending && stageStartedAt
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
    last_action_by: lastActionBy,
    last_action_at: lastActionAt,
    approval_remarks:
      row.finance_head_review_note ?? row.branch_head_review_note ?? row.rejection_reason ?? null,
  } as DecoratedTopup;
}
