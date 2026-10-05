import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { notifySalaryIncrementLetter } from "./salaryIncrement.notifications.js";

type IncrementStatus =
  | "submitted"
  | "hr_validated"
  | "finance_validated" // legacy only: the Finance step was removed; old rows in this status can still be approved
  | "approved"
  | "rejected"
  | "implemented"
  | "cancelled"
  | "withdrawn";

export type IncrementAction = "hr_validate" | "approve" | "reject" | "implement" | "cancel" | "withdraw";

/**
 * Owner rule 2026-10-05: no Finance sign-off; the Payroll Head is the last approval. HR may raise and validate;
 * only the Payroll Head (or super admin) approves and applies. "finance_validated" survives only as a legacy
 * status on old requests, which can still be approved, rejected or cancelled.
 */
export const INCREMENT_TRANSITIONS: Record<IncrementAction, { from: IncrementStatus[]; to: IncrementStatus; eventType: string; field: string }> = {
  hr_validate: { from: ["submitted"], to: "hr_validated", eventType: "HR_VALIDATED", field: "hr_validated" },
  approve:     { from: ["submitted", "hr_validated", "finance_validated"], to: "approved", eventType: "APPROVED", field: "approved" },
  reject:      { from: ["submitted", "hr_validated", "finance_validated", "approved"], to: "rejected", eventType: "REJECTED", field: "rejected" },
  implement:   { from: ["approved"], to: "implemented", eventType: "IMPLEMENTED", field: "implemented" },
  cancel:      { from: ["submitted", "hr_validated", "finance_validated"], to: "cancelled", eventType: "CANCELLED", field: null as unknown as string },
  withdraw:    { from: ["submitted"], to: "withdrawn", eventType: "WITHDRAWN", field: null as unknown as string },
};

export const INCREMENT_ROLE_GATES: Record<IncrementAction, string[]> = {
  hr_validate: ["admin", "hr", "payroll_head", "super_admin"],
  approve:     ["payroll_head", "super_admin"],
  implement:   ["payroll_head", "super_admin"],
  reject:      ["admin", "hr", "payroll_head", "super_admin"],
  cancel:      ["admin", "hr", "payroll_head", "super_admin"],
  withdraw:    ["admin", "hr", "payroll_head", "super_admin"],
};

export const INCREMENT_VIEW_ROLES = ["admin", "hr", "payroll_head", "super_admin"];

async function writeAudit(
  requestId: string,
  eventType: string,
  oldStatus: string | null,
  newStatus: string,
  actorUserId: string,
  actorRole: string,
  remarks?: string
) {
  await db.execute(
    `INSERT INTO salary_increment_audit_log
       (id, request_id, event_type, old_status, new_status, actor_user_id, actor_role, remarks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), requestId, eventType, oldStatus ?? null, newStatus, actorUserId, actorRole, remarks ?? null]
  );
}

export const salaryIncrementService = {
  /**
   * One page of requests plus the total, never the whole table. A July 2026 bulk import left 14,467 implemented
   * requests, and returning them all (14 MB) froze the Increment tab for minutes. `status: "pending"` means
   * everything still waiting for an approval step. Search is the typed employee code (prefix) or name.
   */
  async list(filters: {
    employee_id?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
    scope?: { sql: string; params: unknown[] };
  }) {
    const conds: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filters.scope && filters.scope.sql !== "1=1") { conds.push(`(${filters.scope.sql})`); params.push(...filters.scope.params); }
    if (filters.employee_id) { conds.push("sir.employee_id = ?"); params.push(filters.employee_id); }
    // The 14,467 "Legacy Migration" rows (source = 'legacy': created by the system in July 2026 from db_bill history,
    // 0% change, never approved) are records, not increments. They stay out of every working view and are
    // reachable only through the explicit "legacy" filter.
    if (filters.status === "legacy") {
      conds.push("sir.source = 'legacy'");
    } else {
      conds.push("sir.source = 'hrms'");
      if (filters.status === "pending") {
        conds.push("sir.status IN ('submitted','hr_validated','finance_validated')");
      } else if (filters.status) {
        conds.push("sir.status = ?"); params.push(filters.status);
      }
    }
    const term = (filters.search ?? "").trim();
    if (term) {
      conds.push("(e.employee_code LIKE ? OR CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) LIKE ?)");
      params.push(`${term}%`, `%${term}%`);
    }
    // Validated integers interpolated, not bound: a bound LIMIT/OFFSET has failed on this driver before.
    const limit = Math.min(Math.max(Math.trunc(Number(filters.limit) || 25), 1), 200);
    const page = Math.max(Math.trunc(Number(filters.page) || 1), 1);
    const offset = (page - 1) * limit;
    const from = `FROM salary_increment_request sir
       JOIN employees e ON e.id = sir.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
       WHERE ${conds.join(" AND ")}`;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sir.*,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
              e.employee_code,
              b.branch_name,
              d.designation_name
       ${from}
       ORDER BY sir.created_at DESC, sir.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n ${from}`, params);
    return { rows: rows as RowDataPacket[], total: Number((countRows as RowDataPacket[])[0]?.n ?? 0), page, limit };
  },

  async getById(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sir.*,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
              e.employee_code,
              b.branch_name,
              d.designation_name
       FROM salary_increment_request sir
       JOIN employees e ON e.id = sir.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
       WHERE sir.id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  },

  async getAuditLog(requestId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sial.*,
              COALESCE(
                NULLIF(TRIM(CONCAT(COALESCE(ae.first_name, ''), ' ', COALESCE(ae.last_name, ''))), ''),
                au.email,
                au.id
              ) AS actor_name
       FROM salary_increment_audit_log sial
       LEFT JOIN auth_user au ON au.id = sial.actor_user_id
       LEFT JOIN employees ae ON ae.user_id = au.id
       WHERE sial.request_id = ?
       ORDER BY sial.created_at ASC`,
      [requestId]
    );
    return rows;
  },

  async create(input: {
    employee_id: string;
    proposed_ctc: number;
    effective_from: string;
    reason_code?: string;
    reason?: string;
    business_justification?: string;
    requested_by: string;
    requested_role: string;
  }) {
    // Get current active salary assignment
    const [assignRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, ctc_annual FROM employee_salary_assignment
       WHERE employee_id = ? AND active_status = 1 LIMIT 1`,
      [input.employee_id]
    );
    const currentAssignment = assignRows[0] ?? null;
    const currentCtc = Number(currentAssignment?.ctc_annual ?? 0);
    const incrementPct = currentCtc > 0
      ? ((input.proposed_ctc - currentCtc) / currentCtc) * 100
      : 0;

    const id = randomUUID();
    await db.execute(
      `INSERT INTO salary_increment_request
         (id, employee_id, current_assignment_id, current_ctc, proposed_ctc,
          increment_percentage, effective_from, reason_code, reason,
          business_justification, requested_by, requested_role, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
      [
        id,
        input.employee_id,
        currentAssignment?.id ?? null,
        currentCtc,
        input.proposed_ctc,
        Math.round(incrementPct * 10000) / 10000,
        input.effective_from,
        input.reason_code ?? null,
        input.reason ?? null,
        input.business_justification ?? null,
        input.requested_by,
        input.requested_role,
      ]
    );

    await writeAudit(id, "CREATED", null, "submitted", input.requested_by, input.requested_role);
    void logSensitiveAction({
      actor_user_id: input.requested_by,
      action_type: "SALARY_INCREMENT_SUBMITTED",
      module_key: "salary_increment",
      entity_type: "salary_increment_request",
      entity_id: id,
      employee_id: input.employee_id,
      change_summary: { proposed_ctc: input.proposed_ctc, current_ctc: currentCtc, effective_from: input.effective_from },
    });

    return this.getById(id);
  },

  async transition(
    id: string,
    action: IncrementAction,
    actorUserId: string,
    actorRole: string,
    remarks?: string
  ) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM salary_increment_request WHERE id = ? LIMIT 1 FOR UPDATE`,
      [id]
    );
    const req = rows[0];
    if (!req) throw Object.assign(new Error("Increment request not found"), { status: 404 });

    const oldStatus: IncrementStatus = req.status;

    const TRANSITIONS = INCREMENT_TRANSITIONS;

    const t = TRANSITIONS[action];
    if (!t) throw Object.assign(new Error("Unknown action"), { status: 400 });
    if (!t.from.includes(oldStatus)) {
      throw Object.assign(new Error(`Cannot ${action} a request in status '${oldStatus}'`), { status: 422 });
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Build update SQL
      const setClauses: string[] = ["status = ?", "updated_at = NOW()"];
      const setParams: (string | null)[] = [t.to];
      if (t.field) {
        setClauses.push(`${t.field}_by = ?`, `${t.field}_at = NOW()`);
        setParams.push(actorUserId);
      }
      if (remarks) { setClauses.push("remarks = ?"); setParams.push(remarks); }
      setParams.push(id);

      await conn.execute(
        `UPDATE salary_increment_request SET ${setClauses.join(", ")} WHERE id = ?`,
        setParams
      );

      // On implement: deactivate old salary assignment and create new one
      if (action === "implement") {
        // Close the superseded row's validity window as well as deactivating it, so an
        // increment leaves a reconstructible history rather than a row that claims to
        // still be effective. See payroll.service.ts assignSalary for the full note.
        await conn.execute(
          `UPDATE employee_salary_assignment
              SET active_status = 0,
                  effective_to = COALESCE(effective_to, DATE_SUB(?, INTERVAL 1 DAY))
            WHERE employee_id = ? AND active_status = 1`,
          [req.effective_from, req.employee_id]
        );
        const newAssignId = randomUUID();
        // Re-use structure from current assignment if available
        const [structRows] = await conn.execute<RowDataPacket[]>(
          `SELECT structure_id FROM employee_salary_assignment WHERE id = ? LIMIT 1`,
          [req.current_assignment_id ?? ""]
        );
        const structureId = structRows[0]?.structure_id ?? null;
        if (structureId) {
          await conn.execute(
            `INSERT INTO employee_salary_assignment
               (id, employee_id, structure_id, ctc_annual, effective_from, active_status)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [newAssignId, req.employee_id, structureId, req.proposed_ctc, req.effective_from]
          );
          await conn.execute(
            `UPDATE salary_increment_request SET new_assignment_id = ? WHERE id = ?`,
            [newAssignId, id]
          );
        }
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await writeAudit(id, t.eventType, oldStatus, t.to, actorUserId, actorRole, remarks);
    void logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: `SALARY_INCREMENT_${t.eventType}`,
      module_key: "salary_increment",
      entity_type: "salary_increment_request",
      entity_id: id,
      employee_id: req.employee_id,
      change_summary: { old_status: oldStatus, new_status: t.to, remarks: remarks ?? null },
    });

    if (action === "implement") {
      void notifySalaryIncrementLetter(id);
    }

    return this.getById(id);
  },
};
