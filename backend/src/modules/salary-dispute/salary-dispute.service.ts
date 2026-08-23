// backend/src/modules/salary-dispute/salary-dispute.service.ts
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { createWorkItem } from "../work-inbox/work-inbox.service.js";

export type DisputeType =
  | "MISSING_OT" | "INCORRECT_ATTENDANCE" | "REGULARIZATION_NOT_APPLIED"
  | "LEAVE_NOT_ASSIGNED" | "INCENTIVE_MISSING" | "WRONG_DEDUCTION"
  | "WRONG_COMPONENT_AMOUNT" | "SHIFT_ALLOWANCE_MISSING"
  | "DOUBLE_DEDUCTION" | "WRONG_LWP_COUNT" | "OTHER";

export type DisputeStatus =
  | "draft" | "pending_wfm" | "pending_payroll_head"
  | "approved" | "rejected" | "closed";

export interface SalaryDispute {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name?: string;
  run_month: string;
  dispute_type: DisputeType;
  affected_dates: string[];
  description: string;
  status: DisputeStatus;
  manager_id: string | null;
  branch_id: string;
  process_id: string | null;
  wfm_corrective_json: object | null;
  differential_amount: number | null;
  differential_basis: string | null;
  wfm_remarks: string | null;
  wfm_reviewed_at: string | null;
  wfm_reviewed_by: string | null;
  payroll_head_remarks: string | null;
  payroll_head_reviewed_at: string | null;
  payroll_head_reviewed_by: string | null;
  arrear_run_month: string | null;
  arrear_line_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RaiseDisputeParams {
  employeeId: string;
  runMonth: string;
  disputeType: DisputeType;
  affectedDates: string[];
  description: string;
}

export interface WfmReviewPayload {
  action: "approve" | "reject";
  remarks: string;
  correctiveJson?: object;
  differentialAmount?: number;
  differentialBasis?: string;
}

export interface PHReviewPayload {
  action: "approve" | "reject";
  remarks: string;
}

function mapRow(row: Record<string, unknown>): SalaryDispute {
  return {
    ...row,
    affected_dates: typeof row.affected_dates === "string"
      ? JSON.parse(row.affected_dates) : (row.affected_dates as string[]) ?? [],
    wfm_corrective_json: typeof row.wfm_corrective_json === "string"
      ? JSON.parse(row.wfm_corrective_json) : row.wfm_corrective_json as object | null,
    differential_amount: row.differential_amount != null ? Number(row.differential_amount) : null,
  } as SalaryDispute;
}

async function getById(id: string): Promise<SalaryDispute | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT sd.*, e.full_name AS employee_name
       FROM salary_dispute sd
       JOIN employees e ON e.id = sd.employee_id
      WHERE sd.id = ? LIMIT 1`,
    [id]
  );
  if (!rows[0]) return null;
  return mapRow(rows[0] as Record<string, unknown>);
}

async function notifyRoles(
  roles: string[],
  itemType: string,
  title: string,
  description: string,
  entityId: string
): Promise<void> {
  const placeholders = roles.map(() => "?").join(",");
  const [users] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT ur.user_id FROM user_roles ur WHERE ur.active_status=1 AND ur.role_key IN (${placeholders})`,
    roles
  );
  await Promise.allSettled(
    (users as RowDataPacket[]).map((u) =>
      createWorkItem({
        itemType,
        title,
        description,
        moduleCode: "SALARY_DISPUTE",
        entityType: "salary_dispute",
        entityId,
        assignedToUserId: String(u.user_id),
        priority: "high",
      })
    )
  );
}

export const salaryDisputeService = {
  async raise(params: RaiseDisputeParams): Promise<SalaryDispute> {
    const { employeeId, runMonth, disputeType, affectedDates, description } = params;

    if (description.trim().length < 20)
      throw new Error("Description must be at least 20 characters.");

    // Get employee details
    const [[emp]] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.full_name, e.branch_id, e.process_id,
              e.reporting_manager_id
         FROM employees e WHERE e.id = ? LIMIT 1`,
      [employeeId]
    );
    if (!emp) throw new Error("Employee not found.");

    // Validate employee has salary for that month
    const [[salaryCheck]] = await db.execute<RowDataPacket[]>(
      `SELECT spl.id, spl.gross_salary, spl.working_days
         FROM salary_prep_line spl
         JOIN salary_prep_run spr ON spr.id = spl.run_id
        WHERE spl.employee_id = ? AND spr.run_month = ?
        LIMIT 1`,
      [employeeId, runMonth]
    );
    if (!salaryCheck) throw new Error(`No salary record found for ${runMonth}. Cannot raise dispute.`);

    // Check for duplicate dispute
    const [[existingDispute]] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM salary_dispute
        WHERE employee_id = ? AND run_month = ? AND status NOT IN ('rejected','closed')
        LIMIT 1`,
      [employeeId, runMonth]
    );
    if (existingDispute) throw new Error(`You already have an open dispute for ${runMonth}.`);

    const id = randomUUID();
    await db.execute(
      `INSERT INTO salary_dispute
         (id, employee_id, employee_code, run_month, dispute_type,
          affected_dates, description, status, manager_id, branch_id, process_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_wfm', ?, ?, ?)`,
      [
        id, employeeId, (emp as any).employee_code, runMonth, disputeType,
        JSON.stringify(affectedDates), description.trim(),
        (emp as any).reporting_manager_id ?? null,
        (emp as any).branch_id, (emp as any).process_id ?? null,
      ]
    );

    const dispute = (await getById(id))!;

    // Notify WFM + Payroll HR of branch
    await notifyRoles(
      ["wfm", "payroll_hr", "payroll"],
      "SALARY_DISPUTE_WFM_PENDING",
      `Salary dispute: ${(emp as any).employee_code} — ${runMonth}`,
      `${(emp as any).full_name} raised a ${disputeType.replace(/_/g, " ")} dispute for ${runMonth}. Validate and enter corrective data.`,
      id
    );

    // Notify manager (view-only)
    if ((emp as any).reporting_manager_id) {
      const [[mgr]] = await db.execute<RowDataPacket[]>(
        `SELECT user_id FROM employees WHERE id = ? LIMIT 1`,
        [(emp as any).reporting_manager_id]
      );
      if (mgr && (mgr as any).user_id) {
        await createWorkItem({
          itemType: "SALARY_DISPUTE_MANAGER_VIEW",
          title: `Your team: ${(emp as any).employee_code} raised a salary dispute`,
          description: `${(emp as any).full_name} raised a ${disputeType.replace(/_/g, " ")} dispute for ${runMonth}. No action needed — for your awareness.`,
          moduleCode: "SALARY_DISPUTE",
          entityType: "salary_dispute",
          entityId: id,
          assignedToUserId: String((mgr as any).user_id),
          priority: "low",
        });
      }
    }

    return dispute;
  },

  async listMine(employeeId: string): Promise<SalaryDispute[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sd.*, e.full_name AS employee_name
         FROM salary_dispute sd
         JOIN employees e ON e.id = sd.employee_id
        WHERE sd.employee_id = ?
        ORDER BY sd.created_at DESC`,
      [employeeId]
    );
    return (rows as Record<string, unknown>[]).map(mapRow);
  },

  get: getById,

  async wfmReview(id: string, actorUserId: string, payload: WfmReviewPayload): Promise<SalaryDispute> {
    const dispute = await getById(id);
    if (!dispute) throw new Error("Dispute not found.");
    if (dispute.status !== "pending_wfm")
      throw new Error(`Cannot review: dispute is in status '${dispute.status}'.`);
    if (payload.remarks.trim().length < 10)
      throw new Error("Remarks must be at least 10 characters.");
    if (payload.action === "approve" && (payload.differentialAmount == null || payload.differentialAmount <= 0))
      throw new Error("Differential amount is required and must be > 0 to approve.");

    const newStatus: DisputeStatus = payload.action === "approve" ? "pending_payroll_head" : "rejected";

    await db.execute(
      `UPDATE salary_dispute SET
         status = ?,
         wfm_corrective_json = ?,
         differential_amount = ?,
         differential_basis = ?,
         wfm_remarks = ?,
         wfm_reviewed_at = NOW(),
         wfm_reviewed_by = ?
       WHERE id = ?`,
      [
        newStatus,
        payload.correctiveJson ? JSON.stringify(payload.correctiveJson) : null,
        payload.differentialAmount ?? null,
        payload.differentialBasis ?? null,
        payload.remarks.trim(),
        actorUserId,
        id,
      ]
    );

    const updated = (await getById(id))!;

    if (payload.action === "approve") {
      // Notify Payroll Head
      await notifyRoles(
        ["payroll_head"],
        "SALARY_DISPUTE_PAYHEAD_PENDING",
        `Salary dispute approved by WFM — ${dispute.employee_code} ${dispute.run_month}`,
        `WFM validated the ${dispute.dispute_type.replace(/_/g, " ")} dispute. Differential: ₹${payload.differentialAmount}. Awaiting your final approval.`,
        id
      );
    } else {
      // Notify employee of rejection
      await salaryDisputeService._notifyEmployee(dispute.employee_id, id,
        `Your salary dispute was rejected`,
        `Your ${dispute.dispute_type.replace(/_/g, " ")} dispute for ${dispute.run_month} was rejected by WFM. Remarks: ${payload.remarks}`
      );
    }

    return updated;
  },

  async payrollHeadReview(id: string, actorUserId: string, payload: PHReviewPayload): Promise<SalaryDispute> {
    const dispute = await getById(id);
    if (!dispute) throw new Error("Dispute not found.");
    if (dispute.status !== "pending_payroll_head")
      throw new Error(`Cannot review: dispute is in status '${dispute.status}'.`);
    if (payload.remarks.trim().length < 10)
      throw new Error("Remarks must be at least 10 characters.");

    const newStatus: DisputeStatus = payload.action === "approve" ? "approved" : "rejected";

    await db.execute(
      `UPDATE salary_dispute SET
         status = ?,
         payroll_head_remarks = ?,
         payroll_head_reviewed_at = NOW(),
         payroll_head_reviewed_by = ?
       WHERE id = ?`,
      [newStatus, payload.remarks.trim(), actorUserId, id]
    );

    const updated = (await getById(id))!;

    if (payload.action === "approve") {
      await salaryDisputeService.applyArrear(id);
    } else {
      await salaryDisputeService._notifyEmployee(dispute.employee_id, id,
        `Your salary dispute was rejected`,
        `Your ${dispute.dispute_type.replace(/_/g, " ")} dispute for ${dispute.run_month} was rejected. Remarks: ${payload.remarks}`
      );
    }

    return updated;
  },

  async applyArrear(disputeId: string): Promise<void> {
    const dispute = await getById(disputeId);
    if (!dispute || !dispute.differential_amount) return;

    // Find next open run that includes this employee (draft or processing, matching branch)
    const [[run]] = await db.execute<RowDataPacket[]>(
      `SELECT spr.id, spr.run_month
         FROM salary_prep_run spr
         JOIN salary_prep_line spl ON spl.run_id = spr.id AND spl.employee_id = ?
        WHERE spr.status IN ('draft','processing')
          AND spr.run_month > ?
        ORDER BY spr.run_month ASC
        LIMIT 1`,
      [dispute.employee_id, dispute.run_month]
    );

    let arrearRunMonth: string | null = null;
    let arrearLineId: string | null = null;

    if (run) {
      arrearRunMonth = String((run as any).run_month);

      // Get the line ID for this employee in that run
      const [[line]] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM salary_prep_line WHERE run_id = ? AND employee_id = ? LIMIT 1`,
        [(run as any).id, dispute.employee_id]
      );

      if (line) {
        arrearLineId = randomUUID();
        await db.execute(
          `INSERT INTO salary_prep_line_component (id, line_id, component_code, component_name, amount, component_type, notes)
           VALUES (?, ?, 'DISPUTE_ARREAR', 'Salary Dispute Arrear', ?, 'earning', ?)`,
          [arrearLineId, (line as any).id, dispute.differential_amount,
           `Dispute #${dispute.id.substring(0, 8)} — ${dispute.dispute_type} for ${dispute.run_month}`]
        );
        // Update line gross/net
        await db.execute(
          `UPDATE salary_prep_line
              SET gross_salary = gross_salary + ?,
                  net_salary   = net_salary   + ?
            WHERE id = ?`,
          [dispute.differential_amount, dispute.differential_amount, (line as any).id]
        );
      }
    }

    // Update dispute with arrear info
    await db.execute(
      `UPDATE salary_dispute SET arrear_run_month = ?, arrear_line_id = ?, status = 'closed' WHERE id = ?`,
      [arrearRunMonth, arrearLineId, disputeId]
    );

    // Notify employee
    await salaryDisputeService._notifyEmployee(
      dispute.employee_id, disputeId,
      `Salary dispute approved — ₹${dispute.differential_amount} arrear`,
      arrearRunMonth && arrearLineId
        ? `Your dispute for ${dispute.run_month} has been approved. ₹${dispute.differential_amount} will be added as arrear in your ${arrearRunMonth} salary.`
        : `Your dispute for ${dispute.run_month} has been approved. ₹${dispute.differential_amount} arrear will be applied when your next salary is processed.`
    );
  },

  async listQueue(role: string, branchId?: string): Promise<SalaryDispute[]> {
    const statusFilter = role === "payroll_head" ? "pending_payroll_head" : "pending_wfm";
    const params: unknown[] = [statusFilter];
    let branchSql = "";
    if (branchId) { branchSql = " AND sd.branch_id = ?"; params.push(branchId); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sd.*, e.full_name AS employee_name
         FROM salary_dispute sd
         JOIN employees e ON e.id = sd.employee_id
        WHERE sd.status = ? ${branchSql}
        ORDER BY sd.created_at ASC`,
      params
    );
    return (rows as Record<string, unknown>[]).map(mapRow);
  },

  async listManagerTeam(managerId: string): Promise<SalaryDispute[]> {
    // First get the manager's employee_id from user_id
    const [[mgrEmp]] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees WHERE user_id = ? LIMIT 1`,
      [managerId]
    );
    if (!mgrEmp) return [];

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sd.*, e.full_name AS employee_name
         FROM salary_dispute sd
         JOIN employees e ON e.id = sd.employee_id
        WHERE e.reporting_manager_id = ?
        ORDER BY sd.created_at DESC
        LIMIT 50`,
      [(mgrEmp as any).id]
    );
    return (rows as Record<string, unknown>[]).map(mapRow);
  },

  async getSalaryDetails(employeeId: string, runMonth: string): Promise<{
    gross: number;
    net: number;
    workingDays: number;
    perDayRate: number;
    components: Array<{ code: string; name: string; amount: number; type: string }>;
  } | null> {
    const [[line]] = await db.execute<RowDataPacket[]>(
      `SELECT spl.id, spl.gross_salary, spl.net_salary, spl.working_days
         FROM salary_prep_line spl
         JOIN salary_prep_run spr ON spr.id = spl.run_id
        WHERE spl.employee_id = ? AND spr.run_month = ?
        LIMIT 1`,
      [employeeId, runMonth]
    );
    if (!line) return null;

    const [components] = await db.execute<RowDataPacket[]>(
      `SELECT component_code AS code, component_name AS name, amount, component_type AS type
         FROM salary_prep_line_component
        WHERE line_id = ?
        ORDER BY component_type, amount DESC`,
      [(line as any).id]
    );

    const gross = Number((line as any).gross_salary) || 0;
    const workingDays = Number((line as any).working_days) || 26;

    return {
      gross,
      net: Number((line as any).net_salary) || 0,
      workingDays,
      perDayRate: Math.round(gross / workingDays),
      components: (components as any[]).map(c => ({
        code: c.code,
        name: c.name,
        amount: Number(c.amount),
        type: c.type,
      })),
    };
  },

  calculateDifferential(perDayRate: number, disputedDays: number): number {
    return Math.round(perDayRate * disputedDays);
  },

  async _notifyEmployee(employeeId: string, disputeId: string, title: string, description: string): Promise<void> {
    const [[eu]] = await db.execute<RowDataPacket[]>(
      `SELECT user_id FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    if (eu && (eu as any).user_id) {
      await createWorkItem({
        itemType: "SALARY_DISPUTE_RESOLVED",
        title,
        description,
        moduleCode: "SALARY_DISPUTE",
        entityType: "salary_dispute",
        entityId: disputeId,
        assignedToUserId: String((eu as any).user_id),
        priority: "high",
      });
    }
  },
};
