import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { refuse } from "./finance-error.js";
import { inboxService } from "../inbox/inbox.service.js";

/**
 * Monthly "business case" close/reopen per (budget, head, sub-head) — owner requirement,
 * 2026-08-21: every month's budget has to be closed, head/sub-head by head/sub-head, by the 7th
 * of the following month. Branch Admin and Finance Head can close directly (no approval needed
 * to close — see CLOSE_ROLES below). If an invoice arrives after closing, Branch Admin requests a
 * reopen; Finance Head must approve it before any further GRN can be raised against that
 * head/sub-head. If the approved budget left there is not enough, the normal top-up request flow
 * (budget-topup.service.ts) applies unchanged — this module does not duplicate it.
 *
 * Deliberately separate from:
 *  - finance-period-lock.ts's isPeriodLocked() — company-wide, period-only, no branch/head/
 *    sub-head granularity, and a different kind of lock (P&L close, not spend closure).
 *  - finance_budget_subhead_status (budget-coverage.service.ts) — a pre-spend PLANNING marker
 *    set once at budgeting time, advisory-only by design ("Sub-head coverage stopped gating
 *    submission on 2026-08-06"). Closure is a post-spend, monthly, re-toggleable, approval-gated
 *    state with a genuinely different meaning; overloading that table would make a "closed"
 *    sub-head indistinguishable from a "not_planned" one in every existing Coverage query.
 */

/** sub_head is stored NOT NULL DEFAULT '' (see 1534's own header comment for why) — every lookup
 *  and write normalizes a possibly-null caller value the same way. */
function normSubHead(subHead: string | null | undefined) {
  return subHead?.trim() ?? "";
}

const CLOSE_ROLES = new Set(["branch_admin", "finance_head", "super_admin"]);
const REOPEN_APPROVE_ROLES = new Set(["finance_head", "super_admin"]);
/** Mirrors MAKER_CHECKER_EXEMPT_ROLES in branch-budget.service.ts (owner decision, 2026-08-19):
 *  finance_head and super_admin may approve a reopen they raised themselves; every other role
 *  raising one is blocked from reviewing their own request. */
const REOPEN_MAKER_CHECKER_EXEMPT_ROLES = new Set(["finance_head", "super_admin"]);

async function getBudgetBranchOrThrow(budgetId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, branch_id, status FROM finance_budget_header WHERE id = ? LIMIT 1",
    [budgetId]
  );
  if (!rows[0]) throw refuse(404, "BUDGET_NOT_FOUND", "Budget not found");
  return rows[0] as any;
}

export const budgetClosureService = {
  /** For the route-level branch scope check on the review route, before reviewReopen() —
   *  same shape as budgetTopupService.getLineBranch(). */
  async getReopenRequestBranch(requestId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT h.branch_id
         FROM finance_budget_closure_reopen_request r
         JOIN finance_budget_header h ON h.id = r.budget_id
        WHERE r.id = ?`,
      [requestId]
    );
    if (!rows[0]) throw refuse(404, "REOPEN_REQUEST_NOT_FOUND", "Reopen request not found");
    return String(rows[0].branch_id);
  },

  /**
   * Every (head, sub-head) this budget actually has a line under, left-joined to its closure
   * row (a head/sub-head with no row is implicitly 'open' — nothing has to be closed to be
   * spendable, matching every other advisory/opt-in marker in this module) and to any pending
   * reopen request, so the Variance tab can render status + pending-reopen detail in one call.
   */
  async getStatus(budgetId: string) {
    await getBudgetBranchOrThrow(budgetId);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT l.head, COALESCE(l.sub_head, '') AS sub_head,
              c.id AS closure_id, c.status AS closure_status,
              c.closed_by, c.closed_at, c.closed_reason,
              NULLIF(TRIM(CONCAT_WS(' ', cb.first_name, cb.last_name)), '') AS closed_by_name,
              r.id AS reopen_request_id, r.status AS reopen_status, r.reason AS reopen_reason,
              r.requested_by AS reopen_requested_by, r.requested_at AS reopen_requested_at,
              NULLIF(TRIM(CONCAT_WS(' ', rb.first_name, rb.last_name)), '') AS reopen_requested_by_name
         FROM finance_budget_line l
         LEFT JOIN finance_budget_subhead_closure c
           ON c.budget_id = l.budget_id AND c.head = l.head AND c.sub_head = COALESCE(l.sub_head, '')
         LEFT JOIN employees cb ON cb.user_id = c.closed_by
         LEFT JOIN finance_budget_closure_reopen_request r
           ON r.closure_id = c.id AND r.status = 'pending'
         LEFT JOIN employees rb ON rb.user_id = r.requested_by
        WHERE l.budget_id = ?
        ORDER BY l.head, sub_head`,
      [budgetId, budgetId]
    );
    return rows.map((row) => ({
      head: String(row.head),
      subHead: String(row.sub_head) || null,
      closureId: row.closure_id ? String(row.closure_id) : null,
      status: row.closure_status ?? "open",
      closedBy: row.closed_by ? String(row.closed_by) : null,
      closedByName: row.closed_by_name ?? null,
      closedAt: row.closed_at ?? null,
      closedReason: row.closed_reason ?? null,
      pendingReopen: row.reopen_request_id
        ? {
            id: String(row.reopen_request_id),
            reason: row.reopen_reason,
            requestedBy: row.reopen_requested_by ? String(row.reopen_requested_by) : null,
            requestedByName: row.reopen_requested_by_name ?? null,
            requestedAt: row.reopen_requested_at,
          }
        : null,
    }));
  },

  /** Close one (head, sub-head) directly — Branch Admin or Finance Head, no approval needed.
   *  Idempotent: closing an already-closed head/sub-head is a no-op success, not an error, so a
   *  bulk "select all and close" never fails partway through on a mix of open and closed rows. */
  async close(budgetId: string, head: string, subHeadInput: string | null, reason: string | null, actorId: string, actorRole: string) {
    const role = actorRole.toLowerCase();
    if (!CLOSE_ROLES.has(role)) {
      throw refuse(403, "CLOSURE_NO_CLOSE_ROLE", `Role ${actorRole} cannot close a budget head/sub-head`);
    }
    await getBudgetBranchOrThrow(budgetId);
    const subHead = normSubHead(subHeadInput);
    const id = randomUUID();
    await db.execute(
      `INSERT INTO finance_budget_subhead_closure
         (id, budget_id, head, sub_head, status, closed_by, closed_at, closed_reason)
       VALUES (?, ?, ?, ?, 'closed', ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         status = 'closed', closed_by = VALUES(closed_by), closed_at = NOW(),
         closed_reason = VALUES(closed_reason)`,
      [id, budgetId, head, subHead, actorId, reason?.trim() || null]
    );
  },

  /** Bulk "select all and close" — same idempotent single-row close() repeated in one call, so a
   *  partial failure (e.g. one head name no longer matches a live line) does not silently drop
   *  the rest; every item's own outcome is reported back. */
  async bulkClose(
    budgetId: string,
    items: { head: string; subHead: string | null }[],
    reason: string | null,
    actorId: string,
    actorRole: string
  ) {
    const results: { head: string; subHead: string | null; ok: boolean; error?: string }[] = [];
    for (const item of items) {
      try {
        await this.close(budgetId, item.head, item.subHead, reason, actorId, actorRole);
        results.push({ head: item.head, subHead: item.subHead, ok: true });
      } catch (error) {
        results.push({
          head: item.head,
          subHead: item.subHead,
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
    return results;
  },

  /** Branch Admin (or Finance Head) requests a closed head/sub-head be reopened — e.g. an
   *  invoice arrived for a month already closed. Notifies every Finance Head via the work inbox
   *  (the one real precedent for a finance approval notification in this module —
   *  vendor-payment.service.ts's notifyPaymentPending). Email is a deliberate fast-follow, not
   *  wired in this pass — no finance/budget workflow in this codebase sends email today. */
  async requestReopen(budgetId: string, head: string, subHeadInput: string | null, reason: string, actorId: string, actorRole: string) {
    if (!reason?.trim()) {
      throw refuse(400, "REOPEN_REASON_REQUIRED", "A reason is required to request a reopen");
    }
    const budget = await getBudgetBranchOrThrow(budgetId);
    const subHead = normSubHead(subHeadInput);
    const [closureRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, status FROM finance_budget_subhead_closure
        WHERE budget_id = ? AND head = ? AND sub_head = ?`,
      [budgetId, head, subHead]
    );
    const closure = closureRows[0];
    if (!closure || String(closure.status) !== "closed") {
      throw refuse(409, "CLOSURE_NOT_CLOSED", "This head/sub-head is not closed — there is nothing to reopen");
    }
    const [pendingRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM finance_budget_closure_reopen_request WHERE closure_id = ? AND status = 'pending'`,
      [closure.id]
    );
    if (pendingRows[0]) {
      throw refuse(409, "REOPEN_ALREADY_PENDING", "A reopen request for this head/sub-head is already pending Finance Head approval");
    }

    const id = randomUUID();
    await db.execute(
      `INSERT INTO finance_budget_closure_reopen_request
         (id, closure_id, budget_id, head, sub_head, reason, status, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [id, closure.id, budgetId, head, subHead, reason.trim(), actorId]
    );

    // Notify every Finance Head (in-app inbox now; real email is a deliberate fast-follow).
    const [financeHeads] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT u.id
         FROM auth_user u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.role_key = 'finance_head'
          AND ur.active_status = 1
          AND (u.is_blocked IS NULL OR u.is_blocked = 0)
        LIMIT 100`
    );
    for (const user of financeHeads) {
      await inboxService.createItem({
        user_id: String(user.id),
        type: "BUDGET_CLOSURE_REOPEN_PENDING",
        title: `Budget reopen requested — ${head}${subHead ? ` / ${subHead}` : ""}`,
        description: `Branch budget ${String(budget.id).slice(0, 8)}: ${reason.trim()}`,
        entity_type: "budget_closure_reopen_request",
        entity_id: id,
        action_url: `/finance/branch-budget?tab=variance&branchId=${budget.branch_id}`,
        priority: "high",
      });
    }

    return { id, closureId: String(closure.id) };
  },

  /** Finance Head (or super_admin) approves or rejects a pending reopen request. Approve flips
   *  the closure row back to 'open' — GRN creation checks status via assertSubheadOpen() below,
   *  so approval takes effect the moment this commits, no separate "apply" step. */
  async reviewReopen(requestId: string, decision: "approve" | "reject", actorId: string, actorRole: string, reviewNotes?: string) {
    const role = actorRole.toLowerCase();
    if (!REOPEN_APPROVE_ROLES.has(role)) {
      throw refuse(403, "CLOSURE_NO_REVIEW_ROLE", `Role ${actorRole} cannot review a reopen request`);
    }
    if (decision === "reject" && !reviewNotes?.trim()) {
      throw refuse(400, "REOPEN_REJECT_REASON_REQUIRED", "A reason is required to reject a reopen request");
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM finance_budget_closure_reopen_request WHERE id = ? FOR UPDATE`,
        [requestId]
      );
      const request = rows[0];
      if (!request) throw refuse(404, "REOPEN_REQUEST_NOT_FOUND", "Reopen request not found");
      if (String(request.status) !== "pending") {
        throw refuse(409, "REOPEN_WRONG_STAGE", `Reopen request is already ${request.status}`);
      }
      if (String(request.requested_by) === actorId && !REOPEN_MAKER_CHECKER_EXEMPT_ROLES.has(role)) {
        throw refuse(409, "REOPEN_MAKER_CHECKER", "You raised this reopen request, so you cannot review it. A different Finance Head must approve or reject it.");
      }

      const nextStatus = decision === "approve" ? "approved" : "rejected";
      await connection.execute(
        `UPDATE finance_budget_closure_reopen_request
            SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_notes = ?
          WHERE id = ?`,
        [nextStatus, actorId, reviewNotes?.trim() || null, requestId]
      );
      if (decision === "approve") {
        await connection.execute(
          `UPDATE finance_budget_subhead_closure SET status = 'open' WHERE id = ?`,
          [request.closure_id]
        );
      }
      await connection.commit();
      return { id: requestId, status: nextStatus };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  /** Called by budget-consumption.service.ts's reserve() — the entry point for NEW spend — so a
   *  closed head/sub-head refuses a fresh GRN reservation. Deliberately NOT called from
   *  release()/consume()/reverseConsumption(): those correct or complete a GRN that was validly
   *  reserved before closure, and must keep working regardless of the head's current closure
   *  state, or a returned/rejected GRN could leave a permanently stuck reservation. */
  async assertSubheadOpen(connection: PoolConnection, budgetId: string, head: string, subHeadInput: string | null) {
    const subHead = normSubHead(subHeadInput);
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT status FROM finance_budget_subhead_closure WHERE budget_id = ? AND head = ? AND sub_head = ?`,
      [budgetId, head, subHead]
    );
    const row = rows[0];
    if (row && String(row.status) === "closed") {
      throw refuse(
        409,
        "BUDGET_SUBHEAD_CLOSED",
        `${head}${subHead ? ` / ${subHead}` : ""} is closed for this month's business case. Request a reopen from the Variance tab before raising a new GRN against it.`
      );
    }
  },
};
