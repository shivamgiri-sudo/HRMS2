import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { ExitRequest, ExitStats, PaginatedResult } from "./exit.types.js";
import { createDefaultClearanceTasks, createExitHealthSnapshot } from "./exit-intelligence.service.js";

async function notifyManagerOfResignation(employeeId: string, exitRequestId: string) {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.first_name, e.last_name, e.email AS emp_email,
              m.first_name AS mgr_first, m.last_name AS mgr_last, m.email AS mgr_email
         FROM employees e
         LEFT JOIN employees m ON m.id = e.reporting_manager_id
        WHERE e.id = ? LIMIT 1`,
      [employeeId]
    );
    const emp = (rows as RowDataPacket[])[0];
    if (!emp?.mgr_email) return; // no manager email — skip silently

    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    await transporter.sendMail({
      from: `"MAS HRMS" <${process.env.SMTP_USER ?? 'noreply@teammas.in'}>`,
      to: emp.mgr_email,
      subject: `Resignation Notice — ${emp.first_name} ${emp.last_name}`,
      html: `<p>Dear ${emp.mgr_first ?? 'Manager'},</p>
             <p><strong>${emp.first_name} ${emp.last_name}</strong> has submitted a resignation request.</p>
             <p>Please log in to HRMS to review and action this request.</p>
             <p style="color:#888;font-size:12px">Exit Request ID: ${exitRequestId}</p>`,
    });
  } catch (err) {
    console.error('[exit] manager notification email failed:', err instanceof Error ? err.message : err);
  }
}

function normalizeStatus(status: string) {
  return status === "exit_confirmed" ? "exited" : status;
}

export const exitService = {
  async listExitRequests(filters: {
    status?: string;
    employeeId?: string;
    branchId?: string;
    processId?: string;
    search?: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<ExitRequest>> {
    const { page, limit, status, employeeId, branchId, processId, search } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const params: unknown[] = [];

    if (employeeId) { conds.push("er.employee_id = ?"); params.push(employeeId); }
    if (status)     { conds.push("er.status = ?");      params.push(normalizeStatus(status)); }
    if (branchId)   { conds.push("e.branch_id = ?");    params.push(branchId); }
    if (processId)  { conds.push("e.process_id = ?");   params.push(processId); }
    if (search) {
      conds.push("(e.employee_code LIKE ? OR e.full_name LIKE ? OR er.resignation_reason LIKE ? OR er.exit_reason_category LIKE ?)");
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT er.*,
              e.employee_code,
              CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
              b.branch_name,
              p.process_name,
              hs.engagement_score,
              hs.regrettable_exit,
              hs.risk_label,
              COALESCE(clearance.total_tasks, 0) AS clearance_total,
              COALESCE(clearance.cleared_tasks, 0) AS clearance_cleared
         FROM exit_request er
         LEFT JOIN employees e ON e.id = er.employee_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN process_master p ON p.id = e.process_id
         LEFT JOIN exit_employee_health_snapshot hs ON hs.exit_request_id = er.id
         LEFT JOIN (
           SELECT exit_request_id,
                  COUNT(*) AS total_tasks,
                  SUM(CASE WHEN status IN ('cleared','waived') THEN 1 ELSE 0 END) AS cleared_tasks
             FROM exit_clearance_task GROUP BY exit_request_id
         ) clearance ON clearance.exit_request_id = er.id
         ${where}
        ORDER BY er.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM exit_request er LEFT JOIN employees e ON e.id = er.employee_id ${where}`,
      params
    );

    return {
      data: rows as ExitRequest[],
      total: Number((countRows as { total: number }[])[0]?.total ?? 0),
      page,
      limit,
    };
  },

  async getExitRequest(id: string): Promise<ExitRequest> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT er.*,
              e.employee_code,
              CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
              b.branch_name,
              p.process_name
         FROM exit_request er
         LEFT JOIN employees e ON e.id = er.employee_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN process_master p ON p.id = e.process_id
        WHERE er.id = ? LIMIT 1`,
      [id]
    );
    const rec = (rows as ExitRequest[])[0];
    if (!rec) throw new Error("Exit request not found");
    return rec;
  },

  async createExitRequest(
    input: {
      employeeId: string;
      exitDate: string;
      exitType: string;
      exitSubType?: string | null;
      exitReasonCategory?: string | null;
      reason?: string | null;
      noticePeriodDays?: number;
    },
    userId: string
  ): Promise<ExitRequest> {
    const [openRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM exit_request
        WHERE employee_id = ? AND status NOT IN ('rejected','revoked','exited')
        LIMIT 1`,
      [input.employeeId]
    );
    if (openRows.length) throw new Error("An active exit request already exists for this employee");

    const id = randomUUID();
    await db.execute(
      `INSERT INTO exit_request
         (id, employee_id, initiated_by, initiated_by_user_id, exit_type, exit_sub_type,
          exit_reason_category, last_working_day_proposed, resignation_reason, notice_period_days, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.employeeId,
        "employee",
        userId,
        input.exitType,
        input.exitSubType ?? "resignation",
        input.exitReasonCategory ?? null,
        input.exitDate,
        input.reason ?? null,
        input.noticePeriodDays ?? 0,
        "submitted",
      ]
    );

    await createExitHealthSnapshot(id).catch(() => null);

    // Fire-and-forget: notify manager of resignation
    notifyManagerOfResignation(input.employeeId, id).catch(() => null);

    return this.getExitRequest(id);
  },

  async updateExitStatus(
    id: string,
    status: string,
    remarks: string,
    userId: string
  ): Promise<ExitRequest> {
    const existing = await this.getExitRequest(id);
    const nextStatus = normalizeStatus(status);

    const stageMap: Record<string, string> = {
      manager_review: "manager_actioned_at",
      hr_review: "hr_actioned_at",
      admin_review: "admin_actioned_at",
      exited: "exit_confirmed_at",
    };

    const timestampCol = stageMap[nextStatus];
    const tsClause = timestampCol ? `, ${timestampCol} = NOW()` : "";

    await db.execute(
      `UPDATE exit_request SET status = ?${tsClause}, updated_at = NOW() WHERE id = ?`,
      [nextStatus, id]
    );

    await db.execute(
      `INSERT INTO exit_approval_log (id, exit_request_id, stage, action, action_by, discussion_remarks)
       VALUES (UUID(), ?, ?, ?, ?, ?)`,
      [id, nextStatus, "status_update", userId, remarks]
    );

    if (["accepted", "notice_serving"].includes(nextStatus)) {
      await createDefaultClearanceTasks(id, (existing as any).employee_id).catch(() => null);
    }

    if (nextStatus === "exited") {
      await db.execute(
        `UPDATE employees SET employment_status = 'inactive', updated_at = NOW() WHERE id = ?`,
        [(existing as any).employee_id]
      ).catch(() => null);

      // Create a pending F&F record so payroll team is alerted to process settlement
      await db.execute(
        `INSERT IGNORE INTO full_final_calculation
           (id, exit_request_id, employee_id, calculation_date,
            notice_period_days, notice_shortfall_days, notice_recovery,
            earned_leave_encashment, gratuity_amount, salary_hold,
            advances_recovery, net_payable, status, is_ff_provisional, prepared_by)
         VALUES (UUID(), ?, ?, CURDATE(), 0, 0, 0, 0, 0, 0, 0, 0, 'draft', 1, ?)`,
        [id, (existing as any).employee_id, userId]
      ).catch((err: unknown) => console.warn('[exit] F&F record creation failed:', err instanceof Error ? err.message : err));

      // Fire IT exit provisioning tasks — fire-and-forget, must not throw
      const exitRec = existing as any;
      import('../it-provisioning/it-provisioning.service.js').then(({ dispatchExitProvisioningTasks }) => {
        dispatchExitProvisioningTasks({
          employeeId:     exitRec.employee_id,
          employeeCode:   exitRec.employee_code  ?? '',
          employeeName:   exitRec.employee_name  ?? exitRec.employee_id,
          branchId:       exitRec.branch_id      ?? null,
          lastWorkingDay: exitRec.last_working_day_proposed ?? null,
          exitRequestId:  id,
          actorUserId:    userId,
        }).catch((err: unknown) => console.error('[it-provisioning] exit dispatch failed:', err));
      }).catch((err: unknown) => console.error('[it-provisioning] module load failed:', err));
    }

    return this.getExitRequest(id);
  },

  async getExitStats(): Promise<ExitStats & Record<string, number>> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status, COUNT(*) AS cnt FROM exit_request GROUP BY status`
    );

    const counts: Record<string, number> = {};
    for (const row of rows as { status: string; cnt: number }[]) {
      counts[row.status] = Number(row.cnt);
    }

    const statuses = [
      "draft", "submitted", "manager_review", "hr_review", "admin_review",
      "accepted", "rejected", "revoked", "notice_serving", "exited",
    ];
    const detailed = Object.fromEntries(statuses.map((s) => [s, counts[s] ?? 0])) as Record<string, number>;
    const total = Object.values(detailed).reduce((a, b) => a + b, 0);
    const pending = (detailed.submitted ?? 0) + (detailed.manager_review ?? 0) + (detailed.hr_review ?? 0) + (detailed.admin_review ?? 0);
    const completed = detailed.exited ?? 0;

    return {
      ...detailed,
      total,
      pending,
      completed,
      active_notice: (detailed.accepted ?? 0) + (detailed.notice_serving ?? 0),
    } as unknown as ExitStats & Record<string, number>;
  },
};
