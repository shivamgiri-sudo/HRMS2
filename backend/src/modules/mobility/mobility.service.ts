import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

interface TransferFilters {
  employee_id?: string;
  status?: string;
}

interface PromotionFilters {
  employee_id?: string;
  status?: string;
}

interface CreateTransfer {
  employee_id: string;
  transfer_type: string;
  from_value: string;
  to_value: string;
  effective_date: string;
  reason?: string;
  initiated_by: string;
}

interface CreatePromotion {
  employee_id: string;
  from_designation?: string;
  to_designation: string;
  from_grade?: string;
  to_grade?: string;
  effective_date: string;
  salary_revision?: number;
  reason?: string;
  initiated_by: string;
}

interface ApproveRejectData {
  action: "approved" | "rejected";
  remarks?: string;
  approved_by: string;
}

export const mobilityService = {
  // ── Transfers ────────────────────────────────────────────────────────────

  async listTransfers(filters: TransferFilters) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.employee_id) { conds.push("t.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.status)      { conds.push("t.status = ?");      params.push(filters.status); }
    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT t.*, e.full_name AS employee_name, e.employee_code
       FROM transfer_record t
       LEFT JOIN employees e ON e.id = t.employee_id
       ${where}
       ORDER BY t.created_at DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async createTransfer(data: CreateTransfer) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO transfer_record
         (id, employee_id, transfer_type, from_value, to_value, effective_date, reason, initiated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.employee_id,
        data.transfer_type,
        data.from_value,
        data.to_value,
        data.effective_date,
        data.reason ?? null,
        data.initiated_by,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM transfer_record WHERE id = ? LIMIT 1",
      [id]
    );
    return (rows as RowDataPacket[])[0];
  },

  async updateTransfer(id: string, data: ApproveRejectData) {
    const finalStatus = data.action === "approved" ? "completed" : "rejected";

    await db.execute(
      `UPDATE transfer_record SET status = ?, approved_by = ?, updated_at = NOW() WHERE id = ?`,
      [finalStatus, data.approved_by, id]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM transfer_record WHERE id = ? LIMIT 1",
      [id]
    );
    const record = (rows as RowDataPacket[])[0] ?? null;

    if (data.action === "approved" && record) {
      const { employee_id, transfer_type, from_value, to_value } = record as {
        employee_id: string;
        transfer_type: string;
        from_value: string;
        to_value: string;
      };

      if (transfer_type === "branch") {
        await db.execute(
          `UPDATE employees SET branch_id = (SELECT id FROM branch_master WHERE branch_name COLLATE utf8mb4_unicode_ci = ? LIMIT 1) WHERE id = ?`,
          [to_value, employee_id]
        );
      } else if (transfer_type === "department") {
        await db.execute(
          `UPDATE employees SET department_id = (SELECT id FROM department_master WHERE dept_name COLLATE utf8mb4_unicode_ci = ? LIMIT 1) WHERE id = ?`,
          [to_value, employee_id]
        );
      } else if (transfer_type === "designation") {
        await db.execute(
          `UPDATE employees SET designation_id = (SELECT id FROM designation_master WHERE designation_name COLLATE utf8mb4_unicode_ci = ? LIMIT 1) WHERE id = ?`,
          [to_value, employee_id]
        );
      } else if (transfer_type === "process") {
        await db.execute(
          `UPDATE employees SET process_id = (SELECT id FROM process_master WHERE process_name COLLATE utf8mb4_unicode_ci = ? LIMIT 1) WHERE id = ?`,
          [to_value, employee_id]
        );
      }

      await db.execute(
        `INSERT INTO employee_journey_log
           (id, employee_id, event_type, event_date, description, module, triggered_by, metadata)
         VALUES (?, ?, 'transfer', CURDATE(), ?, 'MOBILITY', ?, ?)`,
        [
          randomUUID(),
          employee_id,
          `Transfer: ${from_value} → ${to_value}`,
          data.approved_by,
          JSON.stringify({ transfer_id: id, transfer_type, from_value, to_value }),
        ]
      );

      await logSensitiveAction({
        actor_user_id: data.approved_by,
        action_type: "TRANSFER_APPROVED",
        module_key: "MOBILITY",
        entity_type: "employee",
        entity_id: employee_id,
        change_summary: { transfer_type, from_value, to_value },
      });
    }

    // Re-fetch updated record
    const [updated] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM transfer_record WHERE id = ? LIMIT 1",
      [id]
    );
    return (updated as RowDataPacket[])[0] ?? null;
  },

  // ── Promotions ───────────────────────────────────────────────────────────

  async listPromotions(filters: PromotionFilters) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.employee_id) { conds.push("p.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.status)      { conds.push("p.status = ?");      params.push(filters.status); }
    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT p.*, e.full_name AS employee_name, e.employee_code
       FROM promotion_record p
       LEFT JOIN employees e ON e.id = p.employee_id
       ${where}
       ORDER BY p.created_at DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async createPromotion(data: CreatePromotion) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO promotion_record
         (id, employee_id, from_designation, to_designation, from_grade, to_grade,
          effective_date, salary_revision, reason, initiated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.employee_id,
        data.from_designation ?? null,
        data.to_designation,
        data.from_grade ?? null,
        data.to_grade ?? null,
        data.effective_date,
        data.salary_revision ?? null,
        data.reason ?? null,
        data.initiated_by,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM promotion_record WHERE id = ? LIMIT 1",
      [id]
    );
    return (rows as RowDataPacket[])[0];
  },

  async updatePromotion(id: string, data: ApproveRejectData) {
    const finalStatus = data.action === "approved" ? "completed" : "rejected";

    await db.execute(
      `UPDATE promotion_record SET status = ?, approved_by = ?, updated_at = NOW() WHERE id = ?`,
      [finalStatus, data.approved_by, id]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM promotion_record WHERE id = ? LIMIT 1",
      [id]
    );
    const record = (rows as RowDataPacket[])[0] ?? null;

    if (data.action === "approved" && record) {
      const { employee_id, from_designation, to_designation, salary_revision } = record as {
        employee_id: string;
        from_designation: string | null;
        to_designation: string;
        salary_revision: number | null;
      };

      await db.execute(
        `UPDATE employees
         SET designation_id = (SELECT id FROM designation_master WHERE designation_name COLLATE utf8mb4_unicode_ci = ? LIMIT 1)
         WHERE id = ?`,
        [to_designation, employee_id]
      );

      if (salary_revision != null && salary_revision > 0) {
        // This INSERT could never succeed: it wrote ctc / effective_date / created_by, none
        // of which exist — the columns are ctc_annual / effective_from / assigned_by. Every
        // approved promotion carrying a salary revision threw ER_BAD_FIELD_ERROR here, after
        // the designation UPDATE above had already committed. The employee was promoted, the
        // record marked completed, and the new CTC was never recorded.
        //
        // structure_id is NOT NULL with no default, and a promotion does not choose a new
        // salary structure — it carries the current one forward. Read it from the active
        // assignment rather than inventing a value.
        const [currentRows] = await db.execute<RowDataPacket[]>(
          `SELECT structure_id
             FROM employee_salary_assignment
            WHERE employee_id = ? AND active_status = 1
            ORDER BY effective_from DESC
            LIMIT 1`,
          [employee_id]
        );
        const structureId = (currentRows as RowDataPacket[])[0]?.structure_id as string | undefined;

        if (!structureId) {
          // Loudly, not silently: without an existing structure there is nothing to carry
          // forward, and quietly skipping is how a missing salary revision goes unnoticed.
          console.error(
            `[mobility] promotion ${id}: employee ${employee_id} has no active salary assignment, ` +
              `so the revision to ${salary_revision} was NOT recorded. Assign a salary structure first.`
          );
        } else {
          // One active assignment per employee is the invariant — 0 of 29,927 employees have
          // more than one. Supersede the current row before inserting, matching
          // employee.service.ts. ON DUPLICATE KEY is deliberately absent: the only unique key
          // is PRIMARY(id) and every insert supplies a fresh UUID, so the clause could never
          // have fired, and appending is correct for an effective-dated history table.
          await db.execute(
            `UPDATE employee_salary_assignment
                SET active_status = 0, effective_to = CURDATE()
              WHERE employee_id = ? AND active_status = 1`,
            [employee_id]
          );
          await db.execute(
            `INSERT INTO employee_salary_assignment
               (id, employee_id, structure_id, ctc_annual, effective_from, assigned_by, assignment_reason)
             VALUES (?, ?, ?, ?, CURDATE(), ?, ?)`,
            [
              randomUUID(),
              employee_id,
              structureId,
              salary_revision,
              data.approved_by,
              `Promotion: ${from_designation ?? "–"} → ${to_designation}`,
            ]
          );
        }
      }

      await db.execute(
        `INSERT INTO employee_journey_log
           (id, employee_id, event_type, event_date, description, module, triggered_by, metadata)
         VALUES (?, ?, 'promotion', CURDATE(), ?, 'MOBILITY', ?, ?)`,
        [
          randomUUID(),
          employee_id,
          `Promotion: ${from_designation ?? "–"} → ${to_designation}`,
          data.approved_by,
          JSON.stringify({ promotion_id: id, from_designation, to_designation, salary_revision }),
        ]
      );

      await logSensitiveAction({
        actor_user_id: data.approved_by,
        action_type: "PROMOTION_APPROVED",
        module_key: "MOBILITY",
        entity_type: "employee",
        entity_id: employee_id,
        change_summary: { from_designation, to_designation, salary_revision },
      });
    }

    const [updated] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM promotion_record WHERE id = ? LIMIT 1",
      [id]
    );
    return (updated as RowDataPacket[])[0] ?? null;
  },
};
