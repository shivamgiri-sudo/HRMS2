import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { ExitRequest, ExitStats, PaginatedResult } from "./exit.types.js";

export const exitService = {
  async listExitRequests(filters: {
    status?: string;
    employeeId?: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<ExitRequest>> {
    const { page, limit, status, employeeId } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const params: unknown[] = [];

    if (employeeId) { conds.push("employee_id = ?"); params.push(employeeId); }
    if (status)     { conds.push("status = ?");      params.push(status); }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM exit_request ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM exit_request ${where}`,
      params
    );

    return {
      data: rows as ExitRequest[],
      total: (countRows as { total: number }[])[0]?.total ?? 0,
      page,
      limit,
    };
  },

  async getExitRequest(id: string): Promise<ExitRequest> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM exit_request WHERE id = ? LIMIT 1",
      [id]
    );
    const rec = (rows as ExitRequest[])[0];
    if (!rec) throw new Error("Exit request not found");
    return rec;
  },

  async createExitRequest(
    input: { employeeId: string; exitDate: string; exitType: string; reason?: string | null },
    userId: string
  ): Promise<ExitRequest> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO exit_request
         (id, employee_id, initiated_by, initiated_by_user_id, exit_type, last_working_day_proposed, resignation_reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.employeeId,
        "employee",
        userId,
        input.exitType,
        input.exitDate,
        input.reason ?? null,
        "draft",
      ]
    );
    return this.getExitRequest(id);
  },

  async updateExitStatus(
    id: string,
    status: string,
    remarks: string,
    userId: string
  ): Promise<ExitRequest> {
    await this.getExitRequest(id);

    const stageMap: Record<string, string> = {
      manager_review: "manager_actioned_at",
      hr_review: "hr_actioned_at",
      admin_review: "admin_actioned_at",
      exited: "exit_confirmed_at",
    };

    const timestampCol = stageMap[status];
    const tsClause = timestampCol ? `, ${timestampCol} = NOW()` : "";

    await db.execute(
      `UPDATE exit_request SET status = ?${tsClause}, updated_at = NOW() WHERE id = ?`,
      [status, id]
    );

    await db.execute(
      `INSERT INTO exit_approval_log (id, exit_request_id, stage, action, action_by, discussion_remarks)
       VALUES (UUID(), ?, ?, ?, ?, ?)`,
      [id, status, "status_update", userId, remarks]
    );

    return this.getExitRequest(id);
  },

  async getExitStats(): Promise<ExitStats> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status, COUNT(*) AS cnt FROM exit_request GROUP BY status`
    );

    const counts: Record<string, number> = {};
    for (const row of rows as { status: string; cnt: number }[]) {
      counts[row.status] = row.cnt;
    }

    const statuses = [
      "draft", "submitted", "manager_review", "hr_review", "admin_review",
      "accepted", "rejected", "revoked", "notice_serving", "exited",
    ];

    const stats = Object.fromEntries(statuses.map((s) => [s, counts[s] ?? 0])) as Omit<ExitStats, "total">;
    const total = Object.values(stats).reduce((a, b) => a + b, 0);

    return { ...stats, total };
  },
};
