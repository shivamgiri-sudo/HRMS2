import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

function ticketCode(): string {
  return `TKT-${Date.now().toString(36).toUpperCase()}`;
}

function grievanceCode(): string {
  return `GRV-${Date.now().toString(36).toUpperCase()}`;
}

function packedGrievanceDescription(data: { subject?: string; description: string }) {
  const subject = String(data.subject ?? "").trim();
  const description = String(data.description ?? "").trim();
  return subject ? `${subject}\n\n${description}` : description;
}

export const helpdeskService = {
  async listTickets(filters: { employee_id?: string; status?: string; category?: string; assigned_to?: string }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.employee_id) { conds.push("t.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.status)      { conds.push("t.status = ?");       params.push(filters.status); }
    if (filters.category)    { conds.push("t.category = ?");     params.push(filters.category); }
    if (filters.assigned_to) { conds.push("t.assigned_to = ?"); params.push(filters.assigned_to); }
    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT t.*,
              t.ticket_code AS ticket_number,
              e.employee_code,
              e.full_name
         FROM helpdesk_ticket t
         JOIN employees e ON e.id = t.employee_id ${where}
        ORDER BY t.created_at DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async getTicket(id: string): Promise<(RowDataPacket & { employee_id: string; comments: RowDataPacket[] }) | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT t.*, t.ticket_code AS ticket_number FROM helpdesk_ticket t WHERE t.id = ? LIMIT 1`, [id]
    );
    const ticket = (rows as RowDataPacket[])[0] ?? null;
    if (!ticket) return null;
    const [comments] = await db.execute<RowDataPacket[]>(
      `SELECT c.id,
              c.comment_text AS text,
              c.is_internal,
              c.author_user_id AS created_by,
              COALESCE(NULLIF(u.full_name, ''), u.email, 'Agent') AS author_name,
              c.created_at
         FROM helpdesk_ticket_comment c
         LEFT JOIN users u ON u.id = c.author_user_id
        WHERE c.ticket_id = ?
        ORDER BY c.created_at ASC`, [id]
    );
    return { ...ticket, employee_id: ticket.employee_id as string, comments: comments as RowDataPacket[] };
  },

  async createTicket(data: { employee_id: string; category: string; subject: string; description: string; priority?: string }) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO helpdesk_ticket (id, ticket_code, employee_id, category, subject, description, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, ticketCode(), data.employee_id, data.category, data.subject, data.description, data.priority ?? "medium"]
    );
    return this.getTicket(id);
  },

  async updateTicket(id: string, data: { status?: string; assigned_to?: string; resolution_note?: string; priority?: string }) {
    await db.execute(
      `UPDATE helpdesk_ticket SET
         status = COALESCE(?, status),
         assigned_to = COALESCE(?, assigned_to),
         resolution_note = COALESCE(?, resolution_note),
         priority = COALESCE(?, priority),
         resolved_at = IF(? = 'resolved', NOW(), resolved_at),
         updated_at = NOW()
       WHERE id = ?`,
      [data.status ?? null, data.assigned_to ?? null, data.resolution_note ?? null,
       data.priority ?? null, data.status ?? "", id]
    );
    return this.getTicket(id);
  },

  async addComment(ticketId: string, authorUserId: string, text: string, isInternal = false) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO helpdesk_ticket_comment (id, ticket_id, author_user_id, comment_text, is_internal) VALUES (?, ?, ?, ?, ?)",
      [id, ticketId, authorUserId, text, isInternal ? 1 : 0]
    );
    return id;
  },

  async listGrievances(filters: { status?: string; assigned_to?: string; employee_id?: string }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.status)      { conds.push("status = ?");      params.push(filters.status); }
    if (filters.assigned_to) { conds.push("assigned_to = ?"); params.push(filters.assigned_to); }
    if (filters.employee_id) { conds.push("employee_id = ?"); params.push(filters.employee_id); }
    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id,
              grievance_code,
              category,
              category AS grievance_type,
              CASE
                WHEN LOCATE('\n\n', description) > 0 THEN SUBSTRING_INDEX(description, '\n\n', 1)
                ELSE category
              END AS subject,
              CASE
                WHEN LOCATE('\n\n', description) > 0 THEN SUBSTRING(description, LOCATE('\n\n', description) + 2)
                ELSE description
              END AS description,
              status,
              is_anonymous,
              assigned_to,
              created_at,
              updated_at,
              IF(is_anonymous = 0, employee_id, NULL) AS employee_id
         FROM grievance ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async createGrievance(data: { employee_id: string; category?: string; grievance_type?: string; subject?: string; description: string; is_anonymous?: boolean }) {
    const id = randomUUID();
    const category = data.grievance_type ?? data.category ?? "workplace";
    await db.execute(
      "INSERT INTO grievance (id, grievance_code, employee_id, category, description, is_anonymous) VALUES (?, ?, ?, ?, ?, ?)",
      [id, grievanceCode(), data.employee_id, category, packedGrievanceDescription(data), data.is_anonymous ? 1 : 0]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id,
              grievance_code,
              category,
              category AS grievance_type,
              CASE
                WHEN LOCATE('\n\n', description) > 0 THEN SUBSTRING_INDEX(description, '\n\n', 1)
                ELSE category
              END AS subject,
              CASE
                WHEN LOCATE('\n\n', description) > 0 THEN SUBSTRING(description, LOCATE('\n\n', description) + 2)
                ELSE description
              END AS description,
              status,
              is_anonymous,
              created_at
         FROM grievance WHERE id = ? LIMIT 1`, [id]
    );
    return (rows as RowDataPacket[])[0];
  },

  async updateGrievance(id: string, data: { status?: string; assigned_to?: string; resolution_note?: string }) {
    await db.execute(
      `UPDATE grievance SET
         status = COALESCE(?, status),
         assigned_to = COALESCE(?, assigned_to),
         resolution_note = COALESCE(?, resolution_note),
         resolved_at = IF(? = 'resolved', NOW(), resolved_at),
         updated_at = NOW()
       WHERE id = ?`,
      [data.status ?? null, data.assigned_to ?? null, data.resolution_note ?? null, data.status ?? "", id]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id,
              grievance_code,
              category,
              category AS grievance_type,
              CASE
                WHEN LOCATE('\n\n', description) > 0 THEN SUBSTRING_INDEX(description, '\n\n', 1)
                ELSE category
              END AS subject,
              CASE
                WHEN LOCATE('\n\n', description) > 0 THEN SUBSTRING(description, LOCATE('\n\n', description) + 2)
                ELSE description
              END AS description,
              status,
              assigned_to,
              resolution_note,
              updated_at
         FROM grievance WHERE id = ? LIMIT 1`,
      [id]
    );
    return (rows as RowDataPacket[])[0];
  },
};