import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

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
  if (!rows[0]) throw new Error("Budget not found");
  return rows[0] as any;
}

/**
 * Whether a Head/Sub-head row blocks submission.
 *
 * A branch is NOT required to budget against every Head/Sub-head, and as of
 * 2026-08-06 it is no longer required to *declare* anything about the ones it
 * skips either. Previously every one of the 59 active Sub-heads needed an
 * explicit decision plus a typed reason for each one left unbudgeted, which is
 * what made submission feel mandatory-everywhere: measured on the live drafts,
 * 26 of 59 and 21 of 59 rows were blocking purely for having no decision
 * recorded. An untouched Sub-head now simply means the branch is not budgeting
 * it.
 *
 * One case still blocks, because it is a contradiction rather than a choice: a
 * Sub-head marked "planned" with no budget line behind it. That marker is a
 * promise the budget does not keep — usually the line was deleted after the
 * decision was recorded — and a branch head reading "planned" would expect an
 * amount. Clearing it means either adding the line or changing the decision.
 *
 * "not planned"/"not applicable" rows are deliberately not checked here: they
 * cannot be recorded against a Sub-head that has a line (saveCoverage refuses
 * it) and a missing reason no longer matters once the decision itself is
 * optional.
 */
export function isInvalidCoverage(item: {
  planning_status: string | null | undefined;
  reason: unknown;
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
            COUNT(l.id) AS budget_line_count,
            COALESCE(SUM(l.gross_amount),0) AS gross_budget_amount,
            COALESCE(SUM(l.pnl_cost_amount),0) AS pnl_budget_amount
       FROM finance_expense_head_master h
       JOIN finance_expense_sub_head_master s
         ON s.head_id = h.id AND s.active_status = 1
       LEFT JOIN finance_budget_subhead_status c
         ON c.budget_id = ? AND c.expense_sub_head_id = s.id
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
               c.reviewed_by, c.reviewed_at
      ORDER BY h.display_order, h.head_name, s.display_order, s.sub_head_name`,
    [budgetId, budgetId]
  );

  const items = rows.map((row) => ({
    ...row,
    planning_status: row.planning_status ?? null,
    reason: (row.reason as string | null) ?? null,
    budget_line_count: Number(row.budget_line_count ?? 0),
    gross_budget_amount: Number(row.gross_budget_amount ?? 0),
    pnl_budget_amount: Number(row.pnl_budget_amount ?? 0),
  }));
  const total = items.length;
  const reviewed = items.filter((item) => item.planning_status).length;
  const planned = items.filter((item) => item.planning_status === "planned").length;
  const notPlanned = items.filter((item) => item.planning_status === "not_planned").length;
  const notApplicable = items.filter((item) => item.planning_status === "not_applicable").length;
  const invalid = items.filter((item) => isInvalidCoverage(item));

  return {
    items,
    summary: {
      total,
      reviewed,
      planned,
      notPlanned,
      notApplicable,
      incomplete: invalid.length,
      completionPct: total ? Math.round((reviewed / total) * 10000) / 100 : 0,
      readyToSubmit: total > 0 && invalid.length === 0,
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
      throw new Error("At least one Head/Sub-head coverage decision is required");
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [budgetRows] = await connection.execute<RowDataPacket[]>(
        "SELECT status FROM finance_budget_header WHERE id = ? FOR UPDATE",
        [budgetId]
      );
      if (!budgetRows[0]) throw new Error("Budget not found");
      if (!["draft", "revision_required"].includes(String(budgetRows[0].status))) {
        throw new Error("Head/Sub-head coverage can only be changed on an editable budget");
      }

      const seen = new Set<string>();
      for (const [index, entry] of entries.entries()) {
        if (!entry.expenseHeadId || !entry.expenseSubHeadId) {
          throw new Error(`Coverage row ${index + 1}: Head and Sub-head are required`);
        }
        if (!("planned,not_planned,not_applicable".split(",")).includes(entry.planningStatus)) {
          throw new Error(`Coverage row ${index + 1}: invalid planning status`);
        }
        if (seen.has(entry.expenseSubHeadId)) {
          throw new Error(`Coverage row ${index + 1}: duplicate Sub-head decision`);
        }
        seen.add(entry.expenseSubHeadId);
        if (entry.planningStatus !== "planned" && !entry.reason?.trim()) {
          throw new Error(
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
          throw new Error(`Coverage row ${index + 1}: active Head/Sub-head mapping was not found`);
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
            throw new Error(
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
      if (!budgetRows[0]) throw new Error("Budget not found");
      if (String(budgetRows[0].status) !== "draft") {
        throw new Error("Only a draft budget can be submitted");
      }

      const [coverageRows] = await connection.execute<RowDataPacket[]>(
        `SELECT h.head_name, s.sub_head_name, c.planning_status, c.reason,
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
          GROUP BY h.id, h.head_name, s.id, s.sub_head_name,
                   c.planning_status, c.reason
          ORDER BY h.display_order, s.display_order`,
        [budgetId, budgetId]
      );
      if (!coverageRows.length) {
        throw new Error("No active Finance Head/Sub-head master is configured");
      }

      // A budget still has to contain something. saveDraft already refuses to save
      // a budget with no lines, so this only catches a draft whose lines were
      // removed by another route or session between save and submit.
      const [lineCountRows] = await connection.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM finance_budget_line WHERE budget_id = ?",
        [budgetId]
      );
      if (Number(lineCountRows[0]?.total ?? 0) <= 0) {
        throw new Error("Add at least one budget line before submitting");
      }

      const failures = coverageRows.filter((row) =>
        isInvalidCoverage({
          planning_status: row.planning_status ? String(row.planning_status) : null,
          reason: row.reason,
          budget_line_count: Number(row.budget_line_count ?? 0),
        })
      );
      if (failures.length) {
        const labels = failures.slice(0, 6).map(
          (row) => `${row.head_name} / ${row.sub_head_name}`
        );
        throw new Error(
          `These Sub-heads are marked "planned" but have no budget line. Add the line, or change the decision: ${labels.join(", ")}${failures.length > labels.length ? ` and ${failures.length - labels.length} more` : ""}`
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE finance_budget_header
            SET status = 'submitted', submitted_by = ?, submitted_at = NOW()
          WHERE id = ? AND status = 'draft'`,
        [actorUserId, budgetId]
      );
      if (result.affectedRows !== 1) {
        throw new Error("Budget status changed before submission; refresh and retry");
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
          // Was "completeness 100%", which is meaningless now that a decision is not
          // required on every Sub-head. The reviewer needs to know how much of the
          // catalogue this budget actually covers, so record that instead.
          `${coverageRows.filter((row) => Number(row.budget_line_count ?? 0) > 0).length}` +
            ` of ${coverageRows.length} active Sub-heads budgeted` +
            `; ${coverageRows.filter((row) => !row.planning_status).length} left undeclared`,
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
