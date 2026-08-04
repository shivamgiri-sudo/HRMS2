import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface ApprovalRequest {
  id: string;
  workflow_id: string;
  module_key: string;
  entity_type: string;
  entity_id: string;
  current_step: number;
  status: "pending" | "approved" | "rejected" | "withdrawn" | "cancelled";
  requested_by: string;
  summary_text: string | null;
  created_at: string;
  updated_at: string;
}

export const workflowService = {
  async listWorkflows() {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT w.id, w.workflow_name AS name, w.workflow_code AS code,
              w.active_status AS is_active, w.created_at,
              JSON_ARRAYAGG(JSON_OBJECT(
                'step_order', s.step_order, 'step_name', s.step_name,
                'approver_role', s.approver_role, 'sla_hours', s.sla_hours
              )) AS steps
       FROM approval_workflow_master w
       LEFT JOIN approval_workflow_step s ON s.workflow_id = w.id AND s.active_status = 1
       WHERE w.active_status = 1
       GROUP BY w.id
       ORDER BY w.workflow_name`
    );
    return rows as RowDataPacket[];
  },

  async getWorkflowByCode(code: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM approval_workflow_master WHERE workflow_code = ? AND active_status = 1 LIMIT 1",
      [code]
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },

  async createRequest(data: {
    workflow_code: string;
    module_key: string;
    entity_type: string;
    entity_id: string;
    requested_by: string;
    summary_text?: string;
  }): Promise<ApprovalRequest> {
    const workflow = await this.getWorkflowByCode(data.workflow_code);
    if (!workflow) throw Object.assign(new Error(`Workflow not found: ${data.workflow_code}`), { statusCode: 404 });

    const id = randomUUID();
    await db.execute(
      `INSERT INTO approval_request (id, workflow_id, module_key, entity_type, entity_id, requested_by, summary_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, workflow.id, data.module_key, data.entity_type, data.entity_id, data.requested_by, data.summary_text ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM approval_request WHERE id = ? LIMIT 1", [id]
    );
    return (rows as RowDataPacket[])[0] as ApprovalRequest;
  },

  async listRequestsForEntity(entityType: string, entityId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.*, w.workflow_name, w.workflow_code
       FROM approval_request r
       JOIN approval_workflow_master w ON w.id = r.workflow_id
       WHERE r.entity_type = ? AND r.entity_id = ?
       ORDER BY r.created_at DESC`,
      [entityType, entityId]
    );
    return rows as RowDataPacket[];
  },

  async listPendingForRole(roleKey: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.*, r.summary_text AS summary, w.workflow_name, w.workflow_code, s.step_name, s.approver_role, s.sla_hours,
              COALESCE(
                NULLIF(e.full_name, ''),
                NULLIF(TRIM(CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,''))), ''),
                au.email
              ) AS requested_by_name
       FROM approval_request r
       JOIN approval_workflow_master w ON w.id = r.workflow_id
       JOIN approval_workflow_step s ON s.workflow_id = w.id AND s.step_order = r.current_step AND s.active_status = 1
       LEFT JOIN auth_user au ON au.id = r.requested_by
       LEFT JOIN employees e ON e.user_id = au.id AND e.active_status = 1
       WHERE r.status = 'pending' AND s.approver_role = ?
       ORDER BY r.created_at ASC`,
      [roleKey]
    );
    return rows as RowDataPacket[];
  },

  async listRequestsByUser(userId: string, filters?: { status?: string; page?: number; limit?: number }) {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 25;
    const offset = (page - 1) * limit;
    const conditions = ['r.requested_by = ?'];
    const params: unknown[] = [userId];
    if (filters?.status) { conditions.push('r.status = ?'); params.push(filters.status); }
    const where = conditions.join(' AND ');
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.*, r.summary_text AS summary, w.workflow_name, w.workflow_code
       FROM approval_request r
       JOIN approval_workflow_master w ON w.id = r.workflow_id
       WHERE ${where}
       ORDER BY r.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    return rows as RowDataPacket[];
  },

  async listAllRequests(filters?: { status?: string; entity_type?: string; requested_by?: string; page?: number; limit?: number }) {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 25;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters?.status) { conditions.push('r.status = ?'); params.push(filters.status); }
    if (filters?.entity_type) { conditions.push('r.entity_type = ?'); params.push(filters.entity_type); }
    if (filters?.requested_by) { conditions.push('r.requested_by = ?'); params.push(filters.requested_by); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.*, r.summary_text AS summary, w.workflow_name, w.workflow_code,
              COALESCE(
                NULLIF(e.full_name, ''),
                NULLIF(TRIM(CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,''))), ''),
                au.email
              ) AS requested_by_name
       FROM approval_request r
       JOIN approval_workflow_master w ON w.id = r.workflow_id
       LEFT JOIN auth_user au ON au.id = r.requested_by
       LEFT JOIN employees e ON e.user_id = au.id AND e.active_status = 1
       ${where}
       ORDER BY r.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    return rows as RowDataPacket[];
  },

  async getRequestActions(requestId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT al.*,
              COALESCE(
                NULLIF(e.full_name, ''),
                NULLIF(TRIM(CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,''))), ''),
                au.email
              ) AS actor_name
       FROM approval_action_log al
       LEFT JOIN auth_user au ON au.id = al.actor_user_id
       LEFT JOIN employees e ON e.user_id = au.id AND e.active_status = 1
       WHERE al.request_id = ?
       -- approval_action_log records acted_at, not created_at, so ordering the
       -- approval trail by it raised ER_BAD_FIELD_ERROR and the history could
       -- never be read.
       ORDER BY al.acted_at ASC`,
      [requestId]
    );
    return rows as RowDataPacket[];
  },

  async act(requestId: string, actorUserId: string, action: "approved" | "rejected" | "withdrawn", remarks?: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM approval_request WHERE id = ? LIMIT 1", [requestId]
    );
    const req = (rows as RowDataPacket[])[0];
    if (!req) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    if (req.status !== "pending") throw Object.assign(new Error(`Request is already ${req.status}`), { statusCode: 409 });

    // Log the action
    await db.execute(
      "INSERT INTO approval_action_log (id, request_id, step_order, actor_user_id, action, remarks) VALUES (?, ?, ?, ?, ?, ?)",
      [randomUUID(), requestId, req.current_step, actorUserId, action, remarks ?? null]
    );

    if (action === "approved") {
      // Check if there are more steps
      const [stepRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM approval_workflow_step
         WHERE workflow_id = ? AND step_order > ? AND active_status = 1`,
        [req.workflow_id, req.current_step]
      );
      const hasMore = (stepRows as RowDataPacket[])[0].total > 0;

      if (hasMore) {
        await db.execute(
          "UPDATE approval_request SET current_step = current_step + 1, updated_at = NOW() WHERE id = ?",
          [requestId]
        );
      } else {
        await db.execute(
          "UPDATE approval_request SET status = 'approved', updated_at = NOW() WHERE id = ?",
          [requestId]
        );
      }
    } else {
      const newStatus = action === "rejected" ? "rejected" : "withdrawn";
      await db.execute(
        "UPDATE approval_request SET status = ?, updated_at = NOW() WHERE id = ?",
        [newStatus, requestId]
      );
    }

    const [updated] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM approval_request WHERE id = ? LIMIT 1", [requestId]
    );
    return (updated as RowDataPacket[])[0] as ApprovalRequest;
  },
};
