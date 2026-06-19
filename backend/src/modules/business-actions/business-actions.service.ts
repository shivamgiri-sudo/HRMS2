import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { BusinessActionCommentInput, BusinessActionInput } from "./business-actions.types.js";

const OPEN_STATUSES = ["open", "in_progress", "blocked", "escalated", "overdue"];

function normalizeSeverity(value?: string) {
  return ["critical", "high", "medium", "low"].includes(String(value)) ? String(value) : "medium";
}

function defaultDueDate(severity: string) {
  const days = severity === "critical" ? 1 : severity === "high" ? 2 : severity === "medium" ? 5 : 10;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function listWhere(filters: Record<string, unknown> = {}) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const allowed = ["source_module", "risk_type", "severity", "status", "owner_user_id", "owner_role"];

  for (const key of allowed) {
    const value = filters[key];
    if (value && value !== "all") {
      clauses.push(`a.${key} = ?`);
      params.push(value);
    }
  }

  if (filters.due === "overdue") clauses.push("a.due_date < CURDATE() AND a.status NOT IN ('completed','cancelled')");
  if (filters.due === "today") clauses.push("a.due_date = CURDATE() AND a.status NOT IN ('completed','cancelled')");

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export const businessActionsService = {
  async list(filters: Record<string, unknown> = {}) {
    const where = listWhere(filters);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT a.*,
              COALESCE(NULLIF(u.full_name, ''), u.email, a.owner_role, 'Unassigned') AS owner_name,
              CASE WHEN a.due_date < CURDATE() AND a.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END AS is_overdue
         FROM business_action_queue a
         LEFT JOIN users u ON u.id = a.owner_user_id
         ${where.sql}
        ORDER BY FIELD(a.severity, 'critical','high','medium','low'), a.due_date ASC, a.created_at DESC
        LIMIT 300`,
      where.params
    );
    return rows;
  },

  async summary(filters: Record<string, unknown> = {}) {
    const where = listWhere(filters);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN a.status IN ('open','in_progress','blocked','escalated','overdue') THEN 1 ELSE 0 END) AS open_count,
          SUM(CASE WHEN a.severity = 'critical' AND a.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS critical_open,
          SUM(CASE WHEN a.due_date = CURDATE() AND a.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS due_today,
          SUM(CASE WHEN a.due_date < CURDATE() AND a.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS overdue,
          SUM(CASE WHEN a.status = 'escalated' THEN 1 ELSE 0 END) AS escalated,
          SUM(CASE WHEN a.status = 'completed' AND a.completed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS completed_7d
         FROM business_action_queue a
         ${where.sql}`,
      where.params
    );

    const [bySource] = await db.execute<RowDataPacket[]>(
      `SELECT source_module AS label, COUNT(*) AS value
         FROM business_action_queue
        WHERE status IN (${OPEN_STATUSES.map(() => "?").join(",")})
        GROUP BY source_module
        ORDER BY value DESC
        LIMIT 12`,
      OPEN_STATUSES
    );

    const [byOwner] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(u.full_name, ''), u.email, a.owner_role, 'Unassigned') AS label, COUNT(*) AS value
         FROM business_action_queue a
         LEFT JOIN users u ON u.id = a.owner_user_id
        WHERE a.status IN (${OPEN_STATUSES.map(() => "?").join(",")})
        GROUP BY label
        ORDER BY value DESC
        LIMIT 12`,
      OPEN_STATUSES
    );

    return { ...(rows[0] ?? {}), by_source: bySource, by_owner: byOwner, generated_at: new Date().toISOString() };
  },

  async get(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT a.*, COALESCE(NULLIF(u.full_name, ''), u.email, a.owner_role, 'Unassigned') AS owner_name
         FROM business_action_queue a
         LEFT JOIN users u ON u.id = a.owner_user_id
        WHERE a.id = ? LIMIT 1`,
      [id]
    );
    const action = rows[0];
    if (!action) return null;
    const [comments] = await db.execute<RowDataPacket[]>(
      `SELECT c.*, COALESCE(NULLIF(u.full_name, ''), u.email, 'System') AS author_name
         FROM business_action_comment c
         LEFT JOIN users u ON u.id = c.author_user_id
        WHERE c.action_id = ?
        ORDER BY c.created_at ASC`,
      [id]
    );
    return { ...action, comments };
  },

  async create(input: BusinessActionInput, actorUserId: string) {
    if (!input.title || !input.risk_type) {
      throw Object.assign(new Error("title and risk_type are required"), { statusCode: 400 });
    }
    const id = randomUUID();
    const severity = normalizeSeverity(input.severity);
    await db.execute(
      `INSERT INTO business_action_queue
       (id, source_module, source_id, risk_type, severity, title, description, owner_user_id, owner_role, due_date, status, escalation_level, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        id,
        input.source_module ?? "manual",
        input.source_id ?? null,
        input.risk_type,
        severity,
        input.title,
        input.description ?? null,
        input.owner_user_id ?? null,
        input.owner_role ?? null,
        input.due_date ?? defaultDueDate(severity),
        input.status ?? "open",
        actorUserId,
      ]
    );
    await this.log(id, actorUserId, "CREATED", { severity, source_module: input.source_module ?? "manual" });
    return this.get(id);
  },

  async update(id: string, input: Partial<BusinessActionInput>, actorUserId: string) {
    await db.execute(
      `UPDATE business_action_queue SET
          severity = COALESCE(?, severity),
          title = COALESCE(?, title),
          description = COALESCE(?, description),
          owner_user_id = COALESCE(?, owner_user_id),
          owner_role = COALESCE(?, owner_role),
          due_date = COALESCE(?, due_date),
          status = COALESCE(?, status),
          completed_at = CASE WHEN ? = 'completed' THEN NOW() ELSE completed_at END,
          updated_at = NOW()
        WHERE id = ?`,
      [input.severity ?? null, input.title ?? null, input.description ?? null, input.owner_user_id ?? null, input.owner_role ?? null, input.due_date ?? null, input.status ?? null, input.status ?? null, id]
    );
    await this.log(id, actorUserId, "UPDATED", input);
    return this.get(id);
  },

  async assign(id: string, ownerUserId: string | null, ownerRole: string | null, actorUserId: string) {
    await db.execute(
      `UPDATE business_action_queue SET owner_user_id = ?, owner_role = ?, status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, updated_at = NOW() WHERE id = ?`,
      [ownerUserId, ownerRole, id]
    );
    await this.log(id, actorUserId, "ASSIGNED", { ownerUserId, ownerRole });
    return this.get(id);
  },

  async escalate(id: string, reason: string | null, actorUserId: string) {
    await db.execute(
      `UPDATE business_action_queue SET status = 'escalated', escalation_level = COALESCE(escalation_level, 0) + 1, updated_at = NOW() WHERE id = ?`,
      [id]
    );
    await this.log(id, actorUserId, "ESCALATED", { reason });
    return this.get(id);
  },

  async complete(id: string, closureNote: string | null, actorUserId: string) {
    await db.execute(
      `UPDATE business_action_queue SET status = 'completed', closure_note = ?, completed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [closureNote, id]
    );
    await this.log(id, actorUserId, "COMPLETED", { closureNote });
    return this.get(id);
  },

  async comment(id: string, actorUserId: string, input: BusinessActionCommentInput) {
    if (!input.comment_text) throw Object.assign(new Error("comment_text is required"), { statusCode: 400 });
    const commentId = randomUUID();
    await db.execute(
      `INSERT INTO business_action_comment (id, action_id, author_user_id, comment_text, is_internal) VALUES (?, ?, ?, ?, ?)`,
      [commentId, id, actorUserId, input.comment_text, input.is_internal ? 1 : 0]
    );
    await this.log(id, actorUserId, "COMMENTED", { commentId, is_internal: !!input.is_internal });
    return { id: commentId };
  },

  async log(actionId: string, actorUserId: string, activityType: string, payload: unknown) {
    await db.execute(
      `INSERT INTO business_action_activity_log (id, action_id, actor_user_id, activity_type, payload_json) VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), actionId, actorUserId, activityType, JSON.stringify(payload ?? {})]
    );
  },
};
