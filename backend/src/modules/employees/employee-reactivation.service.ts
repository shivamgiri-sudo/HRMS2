import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { writeAuditLog, writeSensitiveActionLog } from "../../shared/auditLog.js";
import { getUserAssignmentScopes, hasAnyRole } from "../../shared/scopeAccess.js";
import { notificationService } from "../../services/notification.service.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InitiateReactivationPayload {
  proposed_joining_date: string;       // YYYY-MM-DD
  reinstatement_reason: string;
  new_branch_id?: string | null;
  new_process_id?: string | null;
  new_cost_centre_id?: string | null;
}

export interface BranchHeadActionPayload {
  action: "approved" | "rejected";
  remarks: string;
}

export interface HrFinalActionPayload {
  action: "confirmed" | "rejected";
  remarks: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function getEmployeeDetail(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name,
            e.employment_status, e.active_status, e.date_of_exit,
            e.branch_id, e.process_id, e.cost_centre_id,
            e.rehire_eligible, e.reactivation_count,
            b.name AS branch_name,
            cc.name AS cost_centre_name
       FROM employees e
       LEFT JOIN branch_master b  ON b.id = e.branch_id
       LEFT JOIN cost_centre   cc ON cc.id = e.cost_centre_id
      WHERE e.id = ?
      LIMIT 1`,
    [employeeId]
  );
  return (rows[0] as any) ?? null;
}

async function getExitRequest(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.id, er.exit_sub_type, er.status,
            ffc.status AS ff_status
       FROM exit_request er
       LEFT JOIN full_final_calculation ffc ON ffc.employee_id = er.employee_id
      WHERE er.employee_id = ?
      ORDER BY er.created_at DESC
      LIMIT 1`,
    [employeeId]
  );
  return (rows[0] as any) ?? null;
}

async function getPayrollHeads(): Promise<{ id: string; email: string; name: string }[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT au.id, au.email, CONCAT(au.first_name, ' ', au.last_name) AS name
       FROM auth_user au
       JOIN user_roles ur ON ur.user_id = au.id AND ur.active_status = 1
      WHERE ur.role_key = 'payroll_head' AND au.active_status = 1`
  );
  return rows as any[];
}

async function getBranchHeadsForBranch(branchId: string): Promise<{ id: string; email: string; name: string }[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT au.id, au.email, CONCAT(au.first_name, ' ', au.last_name) AS name
       FROM auth_user au
       JOIN user_roles ur ON ur.user_id = au.id AND ur.active_status = 1
       JOIN user_assignment_scope uas ON uas.user_id = au.id
         AND uas.role_key = 'branch_head'
         AND uas.active_status = 1
         AND (uas.branch_id = ? OR uas.scope_type = 'all')
      WHERE ur.role_key = 'branch_head' AND au.active_status = 1
      GROUP BY au.id`,
    [branchId]
  );
  return rows as any[];
}

async function getHRUsers(): Promise<{ id: string; email: string; name: string }[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT au.id, au.email, CONCAT(au.first_name, ' ', au.last_name) AS name
       FROM auth_user au
       JOIN user_roles ur ON ur.user_id = au.id AND ur.active_status = 1
      WHERE ur.role_key IN ('hr', 'admin', 'super_admin') AND au.active_status = 1
      GROUP BY au.id`
  );
  return rows as any[];
}

async function getActorEmail(actorId: string): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT email FROM auth_user WHERE id = ? LIMIT 1",
    [actorId]
  );
  return (rows[0] as any)?.email ?? "";
}

function toNotifRecipients(users: { id: string; email: string; name: string }[]) {
  return users.map(u => ({ type: "hr" as const, id: u.id, email: u.email, name: u.name }));
}

// ── Core Functions ────────────────────────────────────────────────────────────

export async function initiateReactivation(
  employeeId: string,
  initiatedBy: string,
  payload: InitiateReactivationPayload
) {
  const emp = await getEmployeeDetail(employeeId);
  if (!emp) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
  if (emp.employment_status === "Active" || emp.active_status === 1) {
    throw Object.assign(new Error("Employee is already active"), { statusCode: 422 });
  }

  // Check no open request
  const [openRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employee_reactivation_request
      WHERE employee_id = ? AND status IN ('pending','branch_head_approved')
      LIMIT 1`,
    [employeeId]
  );
  if ((openRows as any[]).length > 0) {
    throw Object.assign(
      new Error("A reactivation request is already open for this employee"),
      { statusCode: 409 }
    );
  }

  // 31-day gap check
  if (!emp.date_of_exit) {
    throw Object.assign(
      new Error("Employee has no exit date on record. Cannot compute gap."),
      { statusCode: 422 }
    );
  }
  const gapDays = Math.floor(
    (new Date(payload.proposed_joining_date).getTime() - new Date(emp.date_of_exit).getTime()) / 86400000
  );
  if (gapDays < 31) {
    const earliestDate = addDays(emp.date_of_exit, 31);
    throw Object.assign(
      new Error(
        `Minimum 31-day cooling-off period required. Earliest eligible date: ${earliestDate}`
      ),
      { statusCode: 422, earliest_eligible_date: earliestDate }
    );
  }

  const exitRequest = await getExitRequest(employeeId);

  // Termination-for-cause block
  if (exitRequest?.exit_sub_type === "termination" && emp.rehire_eligible !== 1) {
    throw Object.assign(
      new Error("Employee terminated for cause. Set rehire_eligible=true on exit record to proceed."),
      { statusCode: 422 }
    );
  }

  const ffAlreadyPaid = exitRequest?.ff_status === "paid" ? 1 : 0;

  const effectiveBranchId = payload.new_branch_id ?? emp.branch_id;
  const effectiveCostCentreId = payload.new_cost_centre_id ?? emp.cost_centre_id;
  const sameCostCentre = effectiveCostCentreId === emp.cost_centre_id ? 1 : 0;

  const requestId = randomUUID();
  await db.execute(
    `INSERT INTO employee_reactivation_request
       (id, employee_id, initiated_by, exit_request_id,
        old_employment_status, proposed_joining_date,
        new_branch_id, new_process_id, new_cost_centre_id,
        reinstatement_reason, gap_days, same_cost_centre,
        ff_already_paid, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      requestId, employeeId, initiatedBy,
      exitRequest?.id ?? null,
      emp.employment_status,
      payload.proposed_joining_date,
      payload.new_branch_id ?? null,
      payload.new_process_id ?? null,
      payload.new_cost_centre_id ?? null,
      payload.reinstatement_reason,
      gapDays, sameCostCentre,
      ffAlreadyPaid,
    ]
  );

  // Notify branch heads
  const branchHeads = await getBranchHeadsForBranch(effectiveBranchId);
  if (branchHeads.length > 0) {
    await notificationService.send({
      template_code: "REACTIVATION_INITIATED",
      recipients: toNotifRecipients(branchHeads),
      context: {
        employee_name: `${emp.first_name} ${emp.last_name}`,
        employee_code: emp.employee_code,
        exit_sub_type: exitRequest?.exit_sub_type ?? "inactive",
        date_of_exit: emp.date_of_exit,
        proposed_joining_date: payload.proposed_joining_date,
        reinstatement_reason: payload.reinstatement_reason,
        branch_head_name: branchHeads[0]?.name ?? "Branch Head",
      },
    });
  }

  // Notify payroll heads (FYI)
  const payrollHeads = await getPayrollHeads();
  if (payrollHeads.length > 0) {
    await notificationService.send({
      template_code: "REACTIVATION_PAYROLL_NOTIFY",
      recipients: toNotifRecipients(payrollHeads),
      context: {
        employee_name: `${emp.first_name} ${emp.last_name}`,
        employee_code: emp.employee_code,
        proposed_joining_date: payload.proposed_joining_date,
        gap_days: String(gapDays),
        cost_centre_name: emp.cost_centre_name ?? "",
      },
    });
    await db.execute(
      "UPDATE employee_reactivation_request SET payroll_notified_at = NOW() WHERE id = ?",
      [requestId]
    );
  }

  await writeSensitiveActionLog({
    actor_user_id: initiatedBy,
    action_type: "REACTIVATION_INITIATED",
    module_key: "employee_reactivation",
    entity_type: "employee_reactivation_request",
    entity_id: requestId,
    employee_id: employeeId,
    change_summary: { gap_days: gapDays, proposed_joining_date: payload.proposed_joining_date },
  });

  return {
    request_id: requestId,
    gap_days: gapDays,
    ff_already_paid: ffAlreadyPaid === 1,
    status: "pending",
  };
}

export async function branchHeadAction(
  requestId: string,
  actorId: string,
  payload: BranchHeadActionPayload
) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.*, e.first_name, e.last_name, e.employee_code, e.branch_id
       FROM employee_reactivation_request r
       JOIN employees e ON e.id = r.employee_id
      WHERE r.id = ?
      LIMIT 1`,
    [requestId]
  );
  const req = (rows[0] as any);
  if (!req) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
  if (req.status !== "pending") {
    throw Object.assign(new Error(`Request is in '${req.status}' status; branch head action requires 'pending'`), { statusCode: 422 });
  }

  const newStatus = payload.action === "approved" ? "branch_head_approved" : "rejected";

  await db.execute(
    `UPDATE employee_reactivation_request
        SET status = ?, branch_head_user_id = ?, branch_head_remarks = ?,
            branch_head_actioned_at = NOW()
      WHERE id = ?`,
    [newStatus, actorId, payload.remarks, requestId]
  );

  const employeeName = `${req.first_name} ${req.last_name}`;

  if (payload.action === "approved") {
    const hrUsers = await getHRUsers();
    if (hrUsers.length > 0) {
      await notificationService.send({
        template_code: "REACTIVATION_BRANCH_APPROVED",
        recipients: toNotifRecipients(hrUsers),
        context: {
          employee_name: employeeName,
          employee_code: req.employee_code,
          proposed_joining_date: req.proposed_joining_date,
          branch_head_remarks: payload.remarks,
        },
      });
    }
    const payrollHeads = await getPayrollHeads();
    if (payrollHeads.length > 0) {
      await notificationService.send({
        template_code: "REACTIVATION_PAYROLL_NOTIFY",
        recipients: toNotifRecipients(payrollHeads),
        context: {
          employee_name: employeeName,
          employee_code: req.employee_code,
          proposed_joining_date: req.proposed_joining_date,
          gap_days: String(req.gap_days),
          cost_centre_name: "",
        },
      });
    }
  } else {
    const hrUsers = await getHRUsers();
    if (hrUsers.length > 0) {
      await notificationService.send({
        template_code: "REACTIVATION_REJECTED",
        recipients: toNotifRecipients(hrUsers),
        context: {
          employee_name: employeeName,
          employee_code: req.employee_code,
          rejected_by_role: "Branch Head",
          rejection_remarks: payload.remarks,
          recipient_name: "HR Team",
        },
      });
    }
  }

  await writeAuditLog({
    actor_user_id: actorId,
    action_type: `REACTIVATION_BRANCH_HEAD_${payload.action.toUpperCase()}`,
    module_key: "employee_reactivation",
    entity_type: "employee_reactivation_request",
    entity_id: requestId,
    employee_id: req.employee_id,
    metadata: { action: payload.action, remarks: payload.remarks },
  });

  return { request_id: requestId, status: newStatus };
}

export async function hrFinalAction(
  requestId: string,
  actorId: string,
  payload: HrFinalActionPayload
) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.*, e.first_name, e.last_name, e.employee_code,
            e.branch_id, e.cost_centre_id,
            b.name AS branch_name, cc.name AS cost_centre_name
       FROM employee_reactivation_request r
       JOIN employees e  ON e.id = r.employee_id
       LEFT JOIN branch_master b  ON b.id = COALESCE(r.new_branch_id, e.branch_id)
       LEFT JOIN cost_centre   cc ON cc.id = COALESCE(r.new_cost_centre_id, e.cost_centre_id)
      WHERE r.id = ?
      LIMIT 1`,
    [requestId]
  );
  const req = (rows[0] as any);
  if (!req) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
  if (req.status !== "branch_head_approved") {
    throw Object.assign(
      new Error(`Request must be in 'branch_head_approved' status for HR action; current: '${req.status}'`),
      { statusCode: 422 }
    );
  }

  if (payload.action === "confirmed") {
    const result = await executeReactivation(req, actorId, payload.remarks);
    return result;
  }

  // HR rejected
  await db.execute(
    `UPDATE employee_reactivation_request
        SET status = 'rejected', hr_final_actioned_by = ?,
            hr_final_remarks = ?, hr_final_actioned_at = NOW()
      WHERE id = ?`,
    [actorId, payload.remarks, requestId]
  );

  const employeeName = `${req.first_name} ${req.last_name}`;
  const hrUsers = await getHRUsers();
  if (hrUsers.length > 0) {
    await notificationService.send({
      template_code: "REACTIVATION_REJECTED",
      recipients: toNotifRecipients(hrUsers),
      context: {
        employee_name: employeeName,
        employee_code: req.employee_code,
        rejected_by_role: "HR",
        rejection_remarks: payload.remarks,
        recipient_name: "HR Team",
      },
    });
  }

  await writeAuditLog({
    actor_user_id: actorId,
    action_type: "REACTIVATION_HR_REJECTED",
    module_key: "employee_reactivation",
    entity_type: "employee_reactivation_request",
    entity_id: requestId,
    employee_id: req.employee_id,
    metadata: { remarks: payload.remarks },
  });

  return { request_id: requestId, status: "rejected" };
}

async function executeReactivation(req: any, actorId: string, hrRemarks: string) {
  const conn = await (db as any).getConnection();
  try {
    await conn.beginTransaction();

    // 1. Snapshot and reactivate employee
    await conn.execute(
      `UPDATE employees
          SET employment_status  = 'Active',
              active_status      = 1,
              previous_exit_date = date_of_exit,
              date_of_exit       = NULL,
              branch_id          = COALESCE(?, branch_id),
              process_id         = COALESCE(?, process_id),
              cost_centre_id     = COALESCE(?, cost_centre_id),
              reactivation_count = reactivation_count + 1,
              date_of_joining    = ?
        WHERE id = ?`,
      [
        req.new_branch_id ?? null,
        req.new_process_id ?? null,
        req.new_cost_centre_id ?? null,
        req.proposed_joining_date,
        req.employee_id,
      ]
    );

    // 2. Close open exit request (if any)
    if (req.exit_request_id) {
      await conn.execute(
        `UPDATE exit_request
            SET status = 'revoked', updated_at = NOW()
          WHERE employee_id = ?
            AND status IN ('draft','submitted','manager_review','hr_review','accepted','notice_serving')`,
        [req.employee_id]
      );
    }

    // 3. Create new salary assignment cloned from most recent
    const [salRows] = await conn.execute(
      `SELECT structure_id, ctc_annual FROM employee_salary_assignment
        WHERE employee_id = ? AND active_status = 1
        ORDER BY effective_from DESC LIMIT 1`,
      [req.employee_id]
    );
    const salaryFound = (salRows as any[]).length > 0;
    if (salaryFound) {
      const sal = (salRows as any[])[0];
      await conn.execute(
        `INSERT INTO employee_salary_assignment
           (id, employee_id, structure_id, ctc_annual, effective_from, active_status)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [randomUUID(), req.employee_id, sal.structure_id, sal.ctc_annual, req.proposed_joining_date]
      );
    }

    // 4. Journey log
    await conn.execute(
      `INSERT INTO employee_journey_log
         (id, employee_id, event_type, old_value, new_value, triggered_by, created_at)
       VALUES (?, ?, 'status_change', ?, 'Active', ?, NOW())`,
      [randomUUID(), req.employee_id, req.old_employment_status, actorId]
    );

    // 5. Update request status
    await conn.execute(
      `UPDATE employee_reactivation_request
          SET status = 'approved', hr_final_actioned_by = ?,
              hr_final_remarks = ?, hr_final_actioned_at = NOW()
        WHERE id = ?`,
      [actorId, hrRemarks, req.id]
    );

    await conn.commit();

    // Fetch updated reactivation_count for notification
    const [updRows] = await db.execute<RowDataPacket[]>(
      "SELECT reactivation_count FROM employees WHERE id = ? LIMIT 1",
      [req.employee_id]
    );
    const reactivationCount = (updRows[0] as any)?.reactivation_count ?? 1;

    const employeeName = `${req.first_name} ${req.last_name}`;
    const hrUsers = await getHRUsers();
    const payrollHeads = await getPayrollHeads();
    const allNotifRecipients = [...toNotifRecipients(hrUsers), ...toNotifRecipients(payrollHeads)];

    if (allNotifRecipients.length > 0) {
      await notificationService.send({
        template_code: "REACTIVATION_FINALISED",
        recipients: allNotifRecipients,
        context: {
          employee_name: employeeName,
          employee_code: req.employee_code,
          proposed_joining_date: req.proposed_joining_date,
          branch_name: req.branch_name ?? "",
          cost_centre_name: req.cost_centre_name ?? "",
          reactivation_count: String(reactivationCount),
          recipient_name: "Team",
        },
      });
    }

    await writeSensitiveActionLog({
      actor_user_id: actorId,
      action_type: "REACTIVATION_EXECUTED",
      module_key: "employee_reactivation",
      entity_type: "employee_reactivation_request",
      entity_id: req.id,
      employee_id: req.employee_id,
      change_summary: {
        old_status: req.old_employment_status,
        new_status: "Active",
        proposed_joining_date: req.proposed_joining_date,
        gap_days: req.gap_days,
        salary_assignment_created: salaryFound,
      },
    });

    return {
      request_id: req.id,
      status: "approved",
      reactivation_count: reactivationCount,
      salary_assignment_created: salaryFound,
      salary_assignment_warning: salaryFound ? null : "No existing salary assignment found — please assign manually.",
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function cancelReactivation(requestId: string, actorId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, status, employee_id FROM employee_reactivation_request WHERE id = ? LIMIT 1",
    [requestId]
  );
  const req = (rows[0] as any);
  if (!req) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
  if (!["pending", "branch_head_approved"].includes(req.status)) {
    throw Object.assign(new Error(`Cannot cancel request with status '${req.status}'`), { statusCode: 422 });
  }
  await db.execute(
    "UPDATE employee_reactivation_request SET status = 'cancelled' WHERE id = ?",
    [requestId]
  );
  await writeAuditLog({
    actor_user_id: actorId,
    action_type: "REACTIVATION_CANCELLED",
    module_key: "employee_reactivation",
    entity_type: "employee_reactivation_request",
    entity_id: requestId,
    employee_id: req.employee_id,
  });
  return { request_id: requestId, status: "cancelled" };
}

export async function listPendingForBranchHead(actorId: string) {
  const isSuperAdmin = await hasAnyRole(actorId, "super_admin");
  let branchFilter = "";
  const params: unknown[] = [];

  if (!isSuperAdmin) {
    const scopes = await getUserAssignmentScopes(actorId, ["branch_head"]);
    const branchIds = scopes.map(s => s.branch_id).filter(Boolean) as string[];
    const hasAll = scopes.some(s => s.scope_type === "all");
    if (!hasAll) {
      if (branchIds.length === 0) return [];
      branchFilter = ` AND e.branch_id IN (${branchIds.map(() => "?").join(",")})`;
      params.push(...branchIds);
    }
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            e.employee_code, e.employment_status AS current_status,
            b.name AS branch_name, cc.name AS cost_centre_name
       FROM employee_reactivation_request r
       JOIN employees e ON e.id = r.employee_id
       LEFT JOIN branch_master b  ON b.id = COALESCE(r.new_branch_id, e.branch_id)
       LEFT JOIN cost_centre   cc ON cc.id = COALESCE(r.new_cost_centre_id, e.cost_centre_id)
      WHERE r.status IN ('pending','branch_head_approved')
        ${branchFilter}
      ORDER BY r.created_at DESC`,
    params
  );
  return rows as any[];
}

export async function listAllReactivations(filters: {
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const offset = (page - 1) * limit;
  const params: unknown[] = [];
  let where = "1=1";
  if (filters.status) {
    where += " AND r.status = ?";
    params.push(filters.status);
  }

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM employee_reactivation_request r
      WHERE ${where}`,
    params
  );
  const total = (countRows[0] as any)?.total ?? 0;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            e.employee_code, e.employment_status AS current_status,
            b.name AS branch_name, cc.name AS cost_centre_name,
            CONCAT(au.first_name, ' ', au.last_name) AS initiated_by_name
       FROM employee_reactivation_request r
       JOIN employees e ON e.id = r.employee_id
       LEFT JOIN branch_master b  ON b.id = COALESCE(r.new_branch_id, e.branch_id)
       LEFT JOIN cost_centre   cc ON cc.id = COALESCE(r.new_cost_centre_id, e.cost_centre_id)
       LEFT JOIN auth_user     au ON au.id = r.initiated_by
      WHERE ${where}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { data: rows as any[], total, page, limit };
}

export async function getReactivationDetail(requestId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.*,
            CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            e.employee_code, e.employment_status AS current_status,
            e.date_of_exit, e.previous_exit_date, e.reactivation_count,
            b.name AS branch_name,
            cc.name AS cost_centre_name,
            CONCAT(au_i.first_name, ' ', au_i.last_name) AS initiated_by_name,
            CONCAT(au_bh.first_name, ' ', au_bh.last_name) AS branch_head_name,
            CONCAT(au_hr.first_name, ' ', au_hr.last_name) AS hr_final_name
       FROM employee_reactivation_request r
       JOIN employees e ON e.id = r.employee_id
       LEFT JOIN branch_master b  ON b.id = COALESCE(r.new_branch_id, e.branch_id)
       LEFT JOIN cost_centre   cc ON cc.id = COALESCE(r.new_cost_centre_id, e.cost_centre_id)
       LEFT JOIN auth_user au_i  ON au_i.id = r.initiated_by
       LEFT JOIN auth_user au_bh ON au_bh.id = r.branch_head_user_id
       LEFT JOIN auth_user au_hr ON au_hr.id = r.hr_final_actioned_by
      WHERE r.id = ?
      LIMIT 1`,
    [requestId]
  );
  return (rows[0] as any) ?? null;
}
