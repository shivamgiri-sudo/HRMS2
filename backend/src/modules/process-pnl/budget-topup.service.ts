import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { financeBranchFilter, type FinanceBranchScope } from "../finance/finance-access-scope.js";
import { lockActiveBudgetLine } from "./budget-consumption.service.js";

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
    return rows;
  },

  /** Two-stage chain, identical shape to GRN review: branch_head at 'submitted',
   *  finance_head at 'branch_head_approved'. Approval at finance_head atomically applies
   *  the increase to the budget line under the same row lock GRN consumption already uses. */
  async review(id: string, decision: "approve" | "reject", actorId: string, effectiveRole: string, remarks?: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM finance_budget_topup_request WHERE id = ? FOR UPDATE`,
        [id]
      );
      const request = rows[0];
      if (!request) throw new Error("Top-up request not found");
      const status = String(request.status);

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
        // Same lock GRN reserve()/consume() already use — a top-up and a GRN cannot race
        // against the same line's headroom.
        await lockActiveBudgetLine(connection, String(request.budget_line_id));
        await connection.execute(
          `UPDATE finance_budget_line
              SET gross_amount = gross_amount + ?,
                  quantity = quantity + ?
            WHERE id = ?`,
          [Number(request.requested_amount), Number(request.requested_quantity), request.budget_line_id]
        );
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
