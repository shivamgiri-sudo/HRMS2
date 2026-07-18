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

export const budgetCoverageService = {
  async getCoverage(budgetId: string) {
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
      budget_line_count: Number(row.budget_line_count ?? 0),
      gross_budget_amount: Number(row.gross_budget_amount ?? 0),
      pnl_budget_amount: Number(row.pnl_budget_amount ?? 0),
    }));
    const total = items.length;
    const reviewed = items.filter((item) => item.planning_status).length;
    const planned = items.filter((item) => item.planning_status === "planned").length;
    const notPlanned = items.filter((item) => item.planning_status === "not_planned").length;
    const notApplicable = items.filter((item) => item.planning_status === "not_applicable").length;
    const invalid = items.filter((item) => {
      if (!item.planning_status) return true;
      if (item.planning_status === "planned") return item.budget_line_count <= 0;
      return !String(item.reason ?? "").trim();
    });

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
  },

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
        if (!(["planned", "not_planned", "not_applicable"] as string[]).includes(entry.planningStatus)) {
          throw new Error(`Coverage row ${index + 1}: invalid planning status`);
        }
        if (seen.has(entry.expenseSubHeadId)) {
          throw new Error(`Coverage row ${index + 1}: duplicate Sub-head decision`);
        }
        seen.add(entry.expenseSubHeadId);
        if (entry.planningStatus !== "planned" && !entry.reason?.trim()) {
          throw new Error(`Coverage row ${index + 1}: reason is mandatory for ${entry.planningStatus.replace("_", " ")}`);
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
    return this.getCoverage(budgetId);
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
    return this.getCoverage(budgetId);
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
      const failures = coverageRows.filter((row) => {
        if (!row.planning_status) return true;
        if (String(row.planning_status) === "planned") {
          return Number(row.budget_line_count ?? 0) <= 0;
        }
        return !String(row.reason ?? "").trim();
      });
      if (failures.length) {
        const labels = failures.slice(0, 6).map(
          (row) => `${row.head_name} / ${row.sub_head_name}`
        );
        throw new Error(
          `Complete all Head/Sub-head decisions before submission. Pending: ${labels.join(", ")}${failures.length > labels.length ? ` and ${failures.length - labels.length} more` : ""}`
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
      await connection.execute(
        `INSERT INTO finance_budget_approval_log
         (id, budget_id, action, from_status, to_status,
          actor_user_id, actor_role, remarks)
         VALUES (?,?,'SUBMIT','draft','submitted',?,?,?)`,
        [
          randomUUID(), budgetId, actorUserId, actorRole,
          `${coverageRows.length} active Sub-heads reviewed; completeness 100%`,
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
