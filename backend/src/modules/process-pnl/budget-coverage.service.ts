import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

import { refuse } from "./finance-error.js";
export type BudgetPlanningStatus = "planned" | "not_planned" | "not_applicable";

export interface BudgetCoverageInput {
  expenseHeadId: string;
  expenseSubHeadId: string;
  planningStatus: BudgetPlanningStatus;
  reason?: string | null;
}

async function getBudgetOrThrow(budgetId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM finance_budget_header WHERE id = ? LIMIT 1",
    [budgetId]
  );
  if (!rows[0]) throw refuse(404, "BUDGET_NOT_FOUND", "Budget not found");
  return rows[0] as any;
}

/**
 * A Sub-head marked "planned" that has no budget line behind it.
 *
 * ADVISORY ONLY — this does not block submission and must not be made to. Head/
 * Sub-head coverage stopped gating submission on 2026-08-06: a branch is not
 * required to budget against every Head/Sub-head, nor to declare anything about
 * the ones it skips, nor to resolve a leftover "planned" marker. Submission asks
 * for one thing only, that the budget contains at least one line.
 *
 * The marker is still surfaced in the coverage summary because it is usually a
 * leftover — the line was deleted after the decision was recorded — and a branch
 * head reading "planned" with no amount is reading something stale. Measured on
 * the live drafts when this became advisory: 3 rows across 3 budgets.
 */
export function isStalePlannedMarker(item: {
  planning_status: string | null | undefined;
  budget_line_count: number;
}) {
  return item.planning_status === "planned" && item.budget_line_count <= 0;
}

async function getCoverage(budgetId: string) {
  await getBudgetOrThrow(budgetId);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT h.id AS expense_head_id, h.head_code, h.head_name,
            h.display_order AS head_display_order,
            s.id AS expense_sub_head_id, s.sub_head_code, s.sub_head_name,
            s.default_unit, s.default_tax_treatment, s.default_gst_rate,
            s.default_gst_type, s.default_recoverable_tax_pct,
            s.default_allocation_driver, s.pnl_treatment,
            s.display_order AS sub_head_display_order,
            c.planning_status, c.reason, c.reviewed_by, c.reviewed_at,
            NULLIF(TRIM(CONCAT_WS(' ', rb.first_name, rb.last_name)), '') AS reviewed_by_name,
            COUNT(l.id) AS budget_line_count,
            COALESCE(SUM(l.gross_amount),0) AS gross_budget_amount,
            COALESCE(SUM(l.pnl_cost_amount),0) AS pnl_budget_amount
       FROM finance_expense_head_master h
       JOIN finance_expense_sub_head_master s
         ON s.head_id = h.id AND s.active_status = 1
       LEFT JOIN finance_budget_subhead_status c
         ON c.budget_id = ? AND c.expense_sub_head_id = s.id
       LEFT JOIN employees rb ON rb.user_id = c.reviewed_by
       LEFT JOIN finance_budget_line l
         ON l.budget_id = ?
        AND l.head = h.head_name
        AND COALESCE(l.sub_head,'') = s.sub_head_name
      WHERE h.active_status = 1
      GROUP BY h.id, h.head_code, h.head_name, h.display_order,
               s.id, s.sub_head_code, s.sub_head_name, s.default_unit,
               s.default_tax_treatment, s.default_gst_rate, s.default_gst_type,
               s.default_recoverable_tax_pct, s.default_allocation_driver,
               s.pnl_treatment, s.display_order, c.planning_status, c.reason,
               c.reviewed_by, c.reviewed_at, rb.first_name, rb.last_name
      ORDER BY h.display_order, h.head_name, s.display_order, s.sub_head_name`,
    [budgetId, budgetId]
  );

  const items = rows.map((row) => ({
    ...row,
    planning_status: row.planning_status ?? null,
    reason: (row.reason as string | null) ?? null,
    reviewed_by_name: (row.reviewed_by_name as string | null) ?? null,
    budget_line_count: Number(row.budget_line_count ?? 0),
    gross_budget_amount: Number(row.gross_budget_amount ?? 0),
    pnl_budget_amount: Number(row.pnl_budget_amount ?? 0),
  }));
  const total = items.length;
  const reviewed = items.filter((item) => item.planning_status).length;
  const planned = items.filter((item) => item.planning_status === "planned").length;
  const notPlanned = items.filter((item) => item.planning_status === "not_planned").length;
  const notApplicable = items.filter((item) => item.planning_status === "not_applicable").length;
  const stalePlanned = items.filter((item) => isStalePlannedMarker(item));
  // Counted straight from the table rather than by summing budget_line_count: those
  // counts come from a join on head/sub-head NAME, so a line whose text does not match
  // the master would be invisible here and a budget that plainly has lines would be
  // reported as having none.
  const [lineRows] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM finance_budget_line WHERE budget_id = ?",
    [budgetId]
  );
  const lineCount = Number(lineRows[0]?.total ?? 0);

  return {
    items,
    summary: {
      total,
      reviewed,
      planned,
      notPlanned,
      notApplicable,
      // Kept under the original key so existing callers keep working, but it no longer
      // means "cannot submit" — it is the advisory stale-marker count.
      incomplete: stalePlanned.length,
      completionPct: total ? Math.round((reviewed / total) * 10000) / 100 : 0,
      // Mirrors the only real submit condition. Coverage decisions do not enter into it.
      readyToSubmit: lineCount > 0,
    },
  };
}

export const budgetCoverageService = {
  getCoverage,

  async saveCoverage(
    budgetId: string,
    entries: BudgetCoverageInput[],
    actorUserId: string
  ) {
    if (!Array.isArray(entries) || !entries.length) {
      throw refuse(400, "COVERAGE_DECISIONS_REQUIRED", "At least one Head/Sub-head coverage decision is required");
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [budgetRows] = await connection.execute<RowDataPacket[]>(
        "SELECT status FROM finance_budget_header WHERE id = ? FOR UPDATE",
        [budgetId]
      );
      if (!budgetRows[0]) throw refuse(404, "BUDGET_NOT_FOUND", "Budget not found");
      if (!["draft", "revision_required"].includes(String(budgetRows[0].status))) {
        throw refuse(409, "BUDGET_NOT_EDITABLE", "Head/Sub-head coverage can only be changed on an editable budget");
      }

      const seen = new Set<string>();
      for (const [index, entry] of entries.entries()) {
        if (!entry.expenseHeadId || !entry.expenseSubHeadId) {
          throw refuse(400, "COVERAGE_ROW_INVALID", `Coverage row ${index + 1}: Head and Sub-head are required`);
        }
        if (!("planned,not_planned,not_applicable".split(",")).includes(entry.planningStatus)) {
          throw refuse(400, "COVERAGE_ROW_INVALID", `Coverage row ${index + 1}: invalid planning status`);
        }
        if (seen.has(entry.expenseSubHeadId)) {
          throw refuse(400, "COVERAGE_ROW_DUPLICATE", `Coverage row ${index + 1}: duplicate Sub-head decision`);
        }
        seen.add(entry.expenseSubHeadId);
        if (entry.planningStatus !== "planned" && !entry.reason?.trim()) {
          throw refuse(400, "COVERAGE_REASON_REQUIRED", 
            `Coverage row ${index + 1}: reason is mandatory for ${entry.planningStatus.replace("_", " ")}`
          );
        }
        const [masterRows] = await connection.execute<RowDataPacket[]>(
          `SELECT s.id
             FROM finance_expense_sub_head_master s
             JOIN finance_expense_head_master h ON h.id = s.head_id
            WHERE s.id = ? AND h.id = ? AND s.active_status = 1 AND h.active_status = 1
            LIMIT 1`,
          [entry.expenseSubHeadId, entry.expenseHeadId]
        );
        if (!masterRows[0]) {
          throw refuse(400, "COVERAGE_MAPPING_NOT_FOUND", `Coverage row ${index + 1}: active Head/Sub-head mapping was not found`);
        }
        if (entry.planningStatus !== "planned") {
          const [lineRows] = await connection.execute<RowDataPacket[]>(
            `SELECT COUNT(*) AS total
               FROM finance_budget_line l
               JOIN finance_expense_head_master h ON h.id = ?
               JOIN finance_expense_sub_head_master s ON s.id = ? AND s.head_id = h.id
              WHERE l.budget_id = ? AND l.head = h.head_name
                AND COALESCE(l.sub_head,'') = s.sub_head_name`,
            [entry.expenseHeadId, entry.expenseSubHeadId, budgetId]
          );
          if (Number(lineRows[0]?.total ?? 0) > 0) {
            throw refuse(409, "COVERAGE_LINE_EXISTS", 
              `Coverage row ${index + 1}: remove the detailed budget line before marking this Sub-head ${entry.planningStatus.replace("_", " ")}`
            );
          }
        }
        await connection.execute(
          `INSERT INTO finance_budget_subhead_status
           (id, budget_id, expense_head_id, expense_sub_head_id,
            planning_status, reason, reviewed_by)
           VALUES (?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             expense_head_id = VALUES(expense_head_id),
             planning_status = VALUES(planning_status),
             reason = VALUES(reason),
             reviewed_by = VALUES(reviewed_by),
             reviewed_at = NOW()`,
          [
            randomUUID(), budgetId, entry.expenseHeadId, entry.expenseSubHeadId,
            entry.planningStatus, entry.reason?.trim() || null, actorUserId,
          ]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return getCoverage(budgetId);
  },

  async syncPlannedFromLines(budgetId: string, actorUserId: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT DISTINCT h.id AS head_id, s.id AS sub_head_id
           FROM finance_budget_line l
           JOIN finance_expense_head_master h
             ON h.head_name = l.head AND h.active_status = 1
           JOIN finance_expense_sub_head_master s
             ON s.head_id = h.id AND s.sub_head_name = COALESCE(l.sub_head,'')
            AND s.active_status = 1
          WHERE l.budget_id = ?`,
        [budgetId]
      );
      for (const row of rows) {
        await connection.execute(
          `INSERT INTO finance_budget_subhead_status
           (id, budget_id, expense_head_id, expense_sub_head_id,
            planning_status, reason, reviewed_by)
           VALUES (?,?,?,?,'planned',NULL,?)
           ON DUPLICATE KEY UPDATE
             planning_status = 'planned', reason = NULL,
             reviewed_by = VALUES(reviewed_by), reviewed_at = NOW()`,
          [randomUUID(), budgetId, row.head_id, row.sub_head_id, actorUserId]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return getCoverage(budgetId);
  },

  async submitBudget(
    budgetId: string,
    actorUserId: string,
    actorRole: string
  ) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [budgetRows] = await connection.execute<RowDataPacket[]>(
        "SELECT status FROM finance_budget_header WHERE id = ? FOR UPDATE",
        [budgetId]
      );
      if (!budgetRows[0]) throw refuse(404, "BUDGET_NOT_FOUND", "Budget not found");
      if (String(budgetRows[0].status) !== "draft") {
        throw refuse(409, "BUDGET_WRONG_STATUS", "Only a draft budget can be submitted");
      }

      // Head/Sub-head coverage does NOT gate submission. There is deliberately no
      // completeness check here: not for undeclared Sub-heads, not for missing
      // reasons, and not for a leftover "planned" marker with no line. A branch
      // budgets what it spends on and submits. The coverage figures below are read
      // only to describe the budget in the approval log.
      //
      // The one condition is that the budget contains something. saveDraft already
      // refuses to save a budget with no lines, so this catches only a draft whose
      // lines were removed by another route or session between save and submit.
      const [lineCountRows] = await connection.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM finance_budget_line WHERE budget_id = ?",
        [budgetId]
      );
      if (Number(lineCountRows[0]?.total ?? 0) <= 0) {
        throw refuse(409, "BUDGET_LINES_REQUIRED", "Add at least one budget line before submitting");
      }

      const [coverageRows] = await connection.execute<RowDataPacket[]>(
        `SELECT h.head_name, s.sub_head_name, c.planning_status,
                COUNT(l.id) AS budget_line_count
           FROM finance_expense_head_master h
           JOIN finance_expense_sub_head_master s
             ON s.head_id = h.id AND s.active_status = 1
           LEFT JOIN finance_budget_subhead_status c
             ON c.budget_id = ? AND c.expense_sub_head_id = s.id
           LEFT JOIN finance_budget_line l
             ON l.budget_id = ? AND l.head = h.head_name
            AND COALESCE(l.sub_head,'') = s.sub_head_name
          WHERE h.active_status = 1
          GROUP BY h.id, h.head_name, s.id, s.sub_head_name, c.planning_status
          ORDER BY h.display_order, s.display_order`,
        [budgetId, budgetId]
      );

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE finance_budget_header
            SET status = 'submitted', submitted_by = ?, submitted_at = NOW()
          WHERE id = ? AND status = 'draft'`,
        [actorUserId, budgetId]
      );
      if (result.affectedRows !== 1) {
        throw refuse(409, "BUDGET_STATUS_CHANGED", "Budget status changed before submission; refresh and retry");
      }
      // Close any correction notes a reviewer raised against this budget's heads/sub-heads. They
      // stay open — and visible on their line — for as long as the branch admin is editing, and
      // are marked resolved only when the budget goes back for review. Rows are kept, not deleted,
      // so repeated round trips stay auditable.
      await connection.execute(
        `UPDATE finance_budget_line_correction
            SET resolved_at = NOW(), resolved_by = ?
          WHERE budget_id = ? AND resolved_at IS NULL`,
        [actorUserId, budgetId]
      );
      await connection.execute(
        `INSERT INTO finance_budget_approval_log
         (id, budget_id, action, from_status, to_status,
          actor_user_id, actor_role, remarks)
         VALUES (?,?,'SUBMIT','draft','submitted',?,?,?)`,
        [
          randomUUID(), budgetId, actorUserId, actorRole,
          // Was "completeness 100%", which is meaningless now that coverage does not
          // gate submission. The reviewer needs to know how much of the catalogue this
          // budget actually covers, and whether any "planned" marker is stale.
          `${coverageRows.filter((row) => Number(row.budget_line_count ?? 0) > 0).length}` +
            ` of ${coverageRows.length} active Sub-heads budgeted` +
            `; ${coverageRows.filter((row) => !row.planning_status).length} left undeclared` +
            (coverageRows.some((row) => isStalePlannedMarker({
              planning_status: row.planning_status ? String(row.planning_status) : null,
              budget_line_count: Number(row.budget_line_count ?? 0),
            }))
              ? `; ${coverageRows.filter((row) => isStalePlannedMarker({
                  planning_status: row.planning_status ? String(row.planning_status) : null,
                  budget_line_count: Number(row.budget_line_count ?? 0),
                })).length} marked planned with no line`
              : ""),
        ]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return getBudgetOrThrow(budgetId);
  },
};
