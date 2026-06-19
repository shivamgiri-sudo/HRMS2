import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { calculateSlaDueAt } from "./helpdesk-sla.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

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

// ── Audit logging ─────────────────────────────────────────────────────────────
export async function writeSensitiveAuditLog(params: {
  actorUserId: string;
  actionType: string;
  moduleKey: string;
  entityType: string;
  entityId: string;
  changeSummary: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string | string[];
}) {
  await logSensitiveAction({
    actor_user_id: params.actorUserId,
    action_type: params.actionType,
    module_key: params.moduleKey,
    entity_type: params.entityType,
    entity_id: params.entityId,
    change_summary: params.changeSummary,
    ip_address: params.ipAddress,
    user_agent: params.userAgent,
  });
}

// ── Ticket helpers ────────────────────────────────────────────────────────────
const TICKET_SELECT = `SELECT t.*,
       t.ticket_code AS ticket_number,
       e.employee_code,
       e.full_name,
       b.branch_name,
       p.process_name,
       COALESCE(NULLIF(u.full_name,''), u.email) AS assigned_name
  FROM helpdesk_ticket t
  JOIN employees e ON e.id = t.employee_id
  LEFT JOIN branch_master b ON b.id = e.branch_id
  LEFT JOIN process_master p ON p.id = e.process_id
  LEFT JOIN auth_user u ON u.id = t.assigned_to`;

export const helpdeskService = {
  async listTickets(filters: {
    employee_id?: string;
    status?: string;
    category?: string;
    assigned_to?: string;
    priority?: string;
    branch_id?: string;
    process_id?: string;
    from?: string;
    to?: string;
  }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.employee_id) { conds.push("t.employee_id = ?");  params.push(filters.employee_id); }
    if (filters.status)      { conds.push("t.status = ?");        params.push(filters.status); }
    if (filters.category)    { conds.push("t.category = ?");      params.push(filters.category); }
    if (filters.assigned_to) { conds.push("t.assigned_to = ?");   params.push(filters.assigned_to); }
    if (filters.priority)    { conds.push("t.priority = ?");      params.push(filters.priority); }
    if (filters.branch_id)   { conds.push("e.branch_id = ?");     params.push(filters.branch_id); }
    if (filters.process_id)  { conds.push("e.process_id = ?");    params.push(filters.process_id); }
    if (filters.from)        { conds.push("t.created_at >= ?");   params.push(filters.from + " 00:00:00"); }
    if (filters.to)          { conds.push("t.created_at <= ?");   params.push(filters.to   + " 23:59:59"); }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `${TICKET_SELECT} ${where} ORDER BY t.created_at DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async getTicket(id: string): Promise<(RowDataPacket & { employee_id: string; comments: RowDataPacket[] }) | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `${TICKET_SELECT} WHERE t.id = ? LIMIT 1`, [id]
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
         LEFT JOIN auth_user u ON u.id = c.author_user_id
        WHERE c.ticket_id = ?
        ORDER BY c.created_at ASC`, [id]
    );
    return { ...ticket, employee_id: ticket.employee_id as string, comments: comments as RowDataPacket[] };
  },

  async createTicket(data: {
    employee_id: string;
    category: string;
    subject: string;
    description: string;
    priority?: string;
  }) {
    const id = randomUUID();
    const priority = data.priority ?? "medium";
    const slaDueAt = calculateSlaDueAt(priority, data.category, new Date());

    await db.execute(
      `INSERT INTO helpdesk_ticket
         (id, ticket_code, employee_id, category, subject, description, priority, sla_due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, ticketCode(), data.employee_id, data.category, data.subject, data.description, priority, slaDueAt]
    );
    return this.getTicket(id);
  },

  async updateTicket(id: string, data: {
    status?: string;
    assigned_to?: string;
    resolution_note?: string;
    priority?: string;
    root_cause?: string;
    closure_rating?: number;
    escalation_level?: number;
    impact_type?: string;
    employee_blocked?: boolean;
    productivity_impact?: boolean;
    payroll_impact?: boolean;
  }) {
    // Recalculate SLA if priority changes
    let slaDueAt: Date | null = null;
    if (data.priority) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT category, created_at FROM helpdesk_ticket WHERE id = ? LIMIT 1`, [id]
      );
      const t = rows[0];
      if (t) slaDueAt = calculateSlaDueAt(data.priority, String(t.category), new Date(t.created_at as string));
    }

    const isClosingStatus = data.status === "resolved" || data.status === "closed";

    await db.execute(
      `UPDATE helpdesk_ticket SET
         status              = COALESCE(?, status),
         assigned_to         = COALESCE(?, assigned_to),
         resolution_note     = COALESCE(?, resolution_note),
         priority            = COALESCE(?, priority),
         root_cause          = COALESCE(?, root_cause),
         closure_rating      = COALESCE(?, closure_rating),
         escalation_level    = COALESCE(?, escalation_level),
         impact_type         = COALESCE(?, impact_type),
         employee_blocked    = COALESCE(?, employee_blocked),
         productivity_impact = COALESCE(?, productivity_impact),
         payroll_impact      = COALESCE(?, payroll_impact),
         ${slaDueAt ? "sla_due_at = ?," : ""}
         resolved_at         = IF(? IN ('resolved','closed'), COALESCE(resolved_at, NOW()), resolved_at),
         updated_at          = NOW()
       WHERE id = ?`,
      [
        data.status ?? null,
        data.assigned_to ?? null,
        data.resolution_note ?? null,
        data.priority ?? null,
        data.root_cause ?? null,
        data.closure_rating ?? null,
        data.escalation_level ?? null,
        data.impact_type ?? null,
        data.employee_blocked != null ? (data.employee_blocked ? 1 : 0) : null,
        data.productivity_impact != null ? (data.productivity_impact ? 1 : 0) : null,
        data.payroll_impact != null ? (data.payroll_impact ? 1 : 0) : null,
        ...(slaDueAt ? [slaDueAt] : []),
        isClosingStatus ? (data.status ?? "") : "",
        id,
      ]
    );
    return this.getTicket(id);
  },

  async reopenTicket(id: string, actorUserId: string) {
    await db.execute(
      `UPDATE helpdesk_ticket
          SET status = 'open',
              reopened_count = reopened_count + 1,
              resolved_at = NULL,
              updated_at = NOW()
        WHERE id = ?`,
      [id]
    );
    await writeSensitiveAuditLog({
      actorUserId,
      actionType: "TICKET_REOPENED",
      moduleKey: "HELPDESK",
      entityType: "helpdesk_ticket",
      entityId: id,
      changeSummary: { action: "reopen" },
    });
    return this.getTicket(id);
  },

  async rateTicket(id: string, rating: number, employeeId: string) {
    if (rating < 1 || rating > 5) throw new Error("Rating must be 1–5");
    await db.execute(
      `UPDATE helpdesk_ticket SET closure_rating = ?, updated_at = NOW()
        WHERE id = ? AND employee_id = ?`,
      [rating, id, employeeId]
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

  async ownerWorkload(_filters: Record<string, unknown> = {}) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(t.assigned_to, 'unassigned') AS owner_user_id,
              COALESCE(NULLIF(u.full_name,''), u.email, 'Unassigned') AS owner_name,
              COUNT(*) AS open_count,
              SUM(t.priority = 'urgent') AS urgent_count
         FROM helpdesk_ticket t
         LEFT JOIN auth_user u ON u.id = t.assigned_to
        WHERE t.status NOT IN ('resolved','closed','cancelled')
        GROUP BY COALESCE(t.assigned_to, 'unassigned'), owner_name
        ORDER BY open_count DESC
        LIMIT 50`
    );
    return rows;
  },

  async aging(_filters: Record<string, unknown> = {}) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(TIMESTAMPDIFF(DAY, created_at, NOW()) BETWEEN 0 AND 1) AS bucket_0_1,
         SUM(TIMESTAMPDIFF(DAY, created_at, NOW()) BETWEEN 2 AND 3) AS bucket_2_3,
         SUM(TIMESTAMPDIFF(DAY, created_at, NOW()) BETWEEN 4 AND 7) AS bucket_4_7,
         SUM(TIMESTAMPDIFF(DAY, created_at, NOW()) > 7) AS bucket_7_plus
       FROM helpdesk_ticket
       WHERE status NOT IN ('resolved','closed','cancelled')`
    );
    return rows[0] ?? {};
  },

  async rootCauses(_filters: Record<string, unknown> = {}) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(root_cause, category, 'Unclassified') AS label, COUNT(*) AS value
         FROM helpdesk_ticket
        GROUP BY COALESCE(root_cause, category, 'Unclassified')
        ORDER BY value DESC
        LIMIT 20`
    );
    return rows;
  },

  // ── Grievances ─────────────────────────────────────────────────────────────

  async listGrievances(filters: {
    status?: string;
    assigned_to?: string;
    employee_id?: string;
    severity?: string;
    from?: string;
    to?: string;
  }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.status)      { conds.push("status = ?");      params.push(filters.status); }
    if (filters.assigned_to) { conds.push("assigned_to = ?"); params.push(filters.assigned_to); }
    if (filters.employee_id) { conds.push("employee_id = ?"); params.push(filters.employee_id); }
    if (filters.severity)    { conds.push("severity = ?");    params.push(filters.severity); }
    if (filters.from)        { conds.push("created_at >= ?"); params.push(filters.from + " 00:00:00"); }
    if (filters.to)          { conds.push("created_at <= ?"); params.push(filters.to   + " 23:59:59"); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id,
              grievance_code,
              category,
              category AS grievance_type,
              severity,
              escalation_level,
              evidence_count,
              confidentiality_level,
              anti_retaliation_flag,
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
              assigned_committee,
              due_date,
              created_at,
              updated_at,
              IF(is_anonymous = 0, employee_id, NULL) AS employee_id
         FROM grievance ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async getGrievance(id: string, requestorRoles: string[]) {
    const isPrivileged = requestorRoles.some(r => ["admin", "hr", "super_admin"].includes(r));
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT g.*,
              CASE
                WHEN LOCATE('\n\n', g.description) > 0 THEN SUBSTRING_INDEX(g.description, '\n\n', 1)
                ELSE g.category
              END AS subject,
              CASE
                WHEN LOCATE('\n\n', g.description) > 0 THEN SUBSTRING(g.description, LOCATE('\n\n', g.description) + 2)
                ELSE g.description
              END AS description_clean,
              IF(g.is_anonymous = 0 OR ? = 1, g.employee_id, NULL) AS safe_employee_id,
              IF(g.is_anonymous = 0 OR ? = 1, e.full_name, 'Anonymous') AS employee_name
         FROM grievance g
         LEFT JOIN employees e ON e.id = g.employee_id
        WHERE g.id = ? LIMIT 1`,
      [isPrivileged ? 1 : 0, isPrivileged ? 1 : 0, id]
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },

  async createGrievance(data: {
    employee_id: string;
    category?: string;
    grievance_type?: string;
    subject?: string;
    description: string;
    is_anonymous?: boolean;
    severity?: string;
    confidentiality_level?: string;
    anti_retaliation_flag?: boolean;
  }) {
    const id = randomUUID();
    const category = data.grievance_type ?? data.category ?? "workplace";
    await db.execute(
      `INSERT INTO grievance
         (id, grievance_code, employee_id, category, description, is_anonymous,
          severity, confidentiality_level, anti_retaliation_flag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, grievanceCode(), data.employee_id, category,
        packedGrievanceDescription(data),
        data.is_anonymous ? 1 : 0,
        data.severity ?? "medium",
        data.confidentiality_level ?? "standard",
        data.anti_retaliation_flag ? 1 : 0,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, grievance_code, category, category AS grievance_type,
              severity, confidentiality_level, is_anonymous, status, created_at
         FROM grievance WHERE id = ? LIMIT 1`, [id]
    );
    return (rows as RowDataPacket[])[0];
  },

  async updateGrievance(id: string, data: {
    status?: string;
    assigned_to?: string;
    resolution_note?: string;
    severity?: string;
    escalation_level?: number;
    assigned_committee?: string;
    due_date?: string;
    investigation_notes?: string;
    confidentiality_level?: string;
    anti_retaliation_flag?: boolean;
  }) {
    await db.execute(
      `UPDATE grievance SET
         status                = COALESCE(?, status),
         assigned_to           = COALESCE(?, assigned_to),
         resolution_note       = COALESCE(?, resolution_note),
         severity              = COALESCE(?, severity),
         escalation_level      = COALESCE(?, escalation_level),
         assigned_committee    = COALESCE(?, assigned_committee),
         due_date              = COALESCE(?, due_date),
         investigation_notes   = COALESCE(?, investigation_notes),
         confidentiality_level = COALESCE(?, confidentiality_level),
         anti_retaliation_flag = COALESCE(?, anti_retaliation_flag),
         resolved_at           = IF(? IN ('resolved','closed'), COALESCE(resolved_at, NOW()), resolved_at),
         closed_at             = IF(? = 'closed', COALESCE(closed_at, NOW()), closed_at),
         updated_at            = NOW()
       WHERE id = ?`,
      [
        data.status ?? null,
        data.assigned_to ?? null,
        data.resolution_note ?? null,
        data.severity ?? null,
        data.escalation_level ?? null,
        data.assigned_committee ?? null,
        data.due_date ?? null,
        data.investigation_notes ?? null,
        data.confidentiality_level ?? null,
        data.anti_retaliation_flag != null ? (data.anti_retaliation_flag ? 1 : 0) : null,
        data.status ?? "",
        data.status ?? "",
        id,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, grievance_code, category, severity, status, assigned_to,
              resolution_note, escalation_level, assigned_committee, due_date,
              investigation_notes, closed_at, updated_at
         FROM grievance WHERE id = ? LIMIT 1`,
      [id]
    );
    return (rows as RowDataPacket[])[0];
  },

  async addEvidenceMetadata(grievanceId: string, actorUserId: string, metadata: {
    file_name: string;
    file_type?: string;
    description?: string;
  }) {
    await db.execute(
      `UPDATE grievance SET evidence_count = evidence_count + 1, updated_at = NOW() WHERE id = ?`,
      [grievanceId]
    );
    await writeSensitiveAuditLog({
      actorUserId,
      actionType: "GRIEVANCE_EVIDENCE_ADDED",
      moduleKey: "PEOPLE_EXPERIENCE",
      entityType: "grievance",
      entityId: grievanceId,
      changeSummary: metadata,
    });
    return { grievance_id: grievanceId, evidence_count_incremented: true };
  },

  async escalateGrievance(id: string, reason?: string | null) {
    await db.execute(
      `UPDATE grievance
          SET status = 'escalated',
              escalation_level = COALESCE(escalation_level, 0) + 1,
              updated_at = NOW()
        WHERE id = ?`,
      [id]
    );
    if (reason) {
      await writeSensitiveAuditLog({
        actorUserId: "system",
        actionType: "GRIEVANCE_ESCALATED",
        moduleKey: "PEOPLE_EXPERIENCE",
        entityType: "grievance",
        entityId: id,
        changeSummary: { reason },
      });
    }
    return this.updateGrievance(id, {});
  },

  async addGrievanceInvestigationNote(id: string, actorUserId: string, note: string) {
    await writeSensitiveAuditLog({
      actorUserId,
      actionType: "GRIEVANCE_INVESTIGATION_NOTE",
      moduleKey: "PEOPLE_EXPERIENCE",
      entityType: "grievance",
      entityId: id,
      changeSummary: { note_length: note.length },
    });
    return this.updateGrievance(id, { investigation_notes: note, status: "under_review" });
  },

  async addGrievanceEvidence(id: string, evidence: Record<string, unknown>) {
    const fileName = String(evidence.file_name ?? evidence.name ?? "metadata");
    return this.addEvidenceMetadata(id, "system", {
      file_name: fileName,
      file_type: evidence.file_type ? String(evidence.file_type) : undefined,
      description: evidence.description ? String(evidence.description) : undefined,
    });
  },
};
