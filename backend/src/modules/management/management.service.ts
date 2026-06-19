import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { Request } from "express";

export const managementService = {
  async getTeamKpiSummary(filters: { process_id?: string; period?: string; branch_id?: string }) {
    const conds: string[] = ["e.active_status = 1"];
    const params: unknown[] = [];
    if (filters.process_id) { conds.push("e.process_id = ?"); params.push(filters.process_id); }
    if (filters.branch_id)  { conds.push("e.branch_id = ?");  params.push(filters.branch_id); }
    const period = filters.period ?? "2026-05";
    conds.push("mks.period = ?"); params.push(period);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT mks.*, e.employee_code, e.full_name, p.process_name
         FROM management_kpi_summary mks
         JOIN employees e ON e.id = mks.employee_id
         LEFT JOIN process_master p ON p.id = e.process_id
        WHERE ${conds.join(" AND ")}
        ORDER BY mks.rank_position ASC, mks.overall_score DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async listCoachingSessions(filters: { employee_id?: string; coach_user_id?: string; status?: string }) {
    const conds: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filters.employee_id)   { conds.push("cs.employee_id = ?");   params.push(filters.employee_id); }
    if (filters.coach_user_id) { conds.push("cs.coach_user_id = ?"); params.push(filters.coach_user_id); }
    if (filters.status)        { conds.push("cs.status = ?");        params.push(filters.status); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cs.*, e.employee_code, e.full_name FROM coaching_session cs
         JOIN employees e ON e.id = cs.employee_id
        WHERE ${conds.join(" AND ")} ORDER BY cs.session_date DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async createCoachingSession(data: {
    employee_id: string; session_date: string; session_type: string;
    notes?: string; action_items?: Record<string, unknown>[];
  }, coachUserId: string, req?: Request) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO coaching_session (id, employee_id, coach_user_id, session_date, session_type, notes, action_items) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, data.employee_id, coachUserId, data.session_date, data.session_type, data.notes ?? null, data.action_items ? JSON.stringify(data.action_items) : null]
    );
    await logSensitiveAction({ actor_user_id: coachUserId, action_type: "COACHING_SESSION_CREATED", module_key: "MANAGEMENT", entity_type: "employee", entity_id: data.employee_id, req });
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM coaching_session WHERE id = ? LIMIT 1", [id]);
    return (rows as RowDataPacket[])[0];
  },

  async listAlerts(filters: { employee_id?: string; severity?: string; acknowledged?: boolean }) {
    const conds: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filters.employee_id)                { conds.push("pa.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.severity)                   { conds.push("pa.severity = ?");    params.push(filters.severity); }
    if (filters.acknowledged !== undefined) { conds.push("pa.acknowledged = ?"); params.push(filters.acknowledged ? 1 : 0); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT pa.*, e.employee_code, e.full_name FROM performance_alert pa
         JOIN employees e ON e.id = pa.employee_id
        WHERE ${conds.join(" AND ")} ORDER BY pa.created_at DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async acknowledgeAlert(alertId: string, acknowledgedBy: string, req?: Request) {
    await db.execute("UPDATE performance_alert SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = NOW() WHERE id = ?", [acknowledgedBy, alertId]);
    await logSensitiveAction({ actor_user_id: acknowledgedBy, action_type: "ALERT_ACKNOWLEDGED", module_key: "MANAGEMENT", entity_type: "performance_alert", entity_id: alertId, req });
  },

  // ─── TNI (Training Needs Identification) ───────────────────────────────────

  async listTni(filters: { employee_id?: string; status?: string }) {
    const conds: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filters.employee_id) { conds.push("tn.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.status)      { conds.push("tn.status = ?");      params.push(filters.status); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT tn.*, e.employee_code, e.full_name,
              km.metric_name, km.metric_code,
              cs.session_type AS coaching_session_type, cs.session_date
         FROM training_need tn
         JOIN employees e ON e.id = tn.employee_id
         LEFT JOIN kpi_metric_master km ON km.id = tn.metric_id
         LEFT JOIN coaching_session cs ON cs.id = tn.coaching_session_id
        WHERE ${conds.join(" AND ")}
        ORDER BY tn.created_at DESC LIMIT 500`,
      params
    );
    return rows as RowDataPacket[];
  },

  async createTni(data: {
    employee_id: string;
    metric_id?: string;
    need_type: string;
    description?: string;
    priority?: string;
    coaching_session_id?: string;
  }, identifiedBy: string) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO training_need
         (id, employee_id, metric_id, coaching_session_id, need_type, description, priority, identified_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.employee_id,
        data.metric_id ?? null,
        data.coaching_session_id ?? null,
        data.need_type,
        data.description ?? null,
        data.priority ?? "medium",
        identifiedBy,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM training_need WHERE id = ? LIMIT 1", [id]
    );
    return (rows as RowDataPacket[])[0];
  },

  async updateTniStatus(tniId: string, status: string) {
    await db.execute(
      "UPDATE training_need SET status = ? WHERE id = ?",
      [status, tniId]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM training_need WHERE id = ? LIMIT 1", [tniId]
    );
    return (rows as RowDataPacket[])[0];
  },

  async createTniFromCoaching(coachingId: string, overrides: {
    need_type: string;
    description?: string;
    priority?: string;
    metric_id?: string;
  }, identifiedBy: string) {
    const [sessionRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM coaching_session WHERE id = ? LIMIT 1", [coachingId]
    );
    const session = (sessionRows as RowDataPacket[])[0];
    if (!session) throw new Error("Coaching session not found");

    return this.createTni(
      {
        employee_id: session.employee_id as string,
        need_type: overrides.need_type,
        description: overrides.description,
        priority: overrides.priority,
        metric_id: overrides.metric_id,
        coaching_session_id: coachingId,
      },
      identifiedBy
    );
  },

  async getDashboardSummary(processId?: string) {
    const proc = processId ? "AND e.process_id = ?" : "";
    const params: unknown[] = processId ? [processId] : [];

    const [headcountRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS headcount FROM employees e WHERE e.active_status = 1 ${proc}`, params
    );
    const [attritionRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS exits FROM employees e WHERE e.active_status = 0 AND e.date_of_joining >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR) ${proc}`, params
    );
    const [kpiRows] = await db.execute<RowDataPacket[]>(
      `SELECT AVG(mks.overall_score) AS avg_kpi_score FROM management_kpi_summary mks JOIN employees e ON e.id = mks.employee_id WHERE 1=1 ${proc}`, params
    );
    const [ticketRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS open_tickets FROM performance_alert pa JOIN employees e ON e.id = pa.employee_id WHERE pa.acknowledged = 0 ${proc}`, params
    );
    const [leaveRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS pending_leaves FROM leave_request lr JOIN employees e ON e.id = lr.employee_id WHERE lr.status = 'pending' ${proc}`, params
    );
    const [attendanceRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN s.current_status = 'Logged In' THEN 1 ELSE 0 END) AS present FROM wfm_attendance_session s JOIN employees e ON e.id = s.employee_id WHERE s.session_date = CURDATE() ${proc}`, params
    );

    const headcount = Number((headcountRows as any)[0]?.headcount) || 0;
    const exits = Number((attritionRows as any)[0]?.exits) || 0;
    const attrition_rate = headcount > 0 ? Math.round((exits / headcount) * 100 * 10) / 10 : 0;
    const avg_kpi_score = Math.round((Number((kpiRows as any)[0]?.avg_kpi_score) || 0) * 10) / 10;
    const open_tickets = Number((ticketRows as any)[0]?.open_tickets) || 0;
    const pending_leaves = Number((leaveRows as any)[0]?.pending_leaves) || 0;
    const total_att = Number((attendanceRows as any)[0]?.total) || 0;
    const present_att = Number((attendanceRows as any)[0]?.present) || 0;
    const attendance_rate = total_att > 0 ? Math.round((present_att / total_att) * 100 * 10) / 10 : 0;

    return {
      headcount,
      attrition_rate,
      avg_kpi_score,
      open_tickets,
      pending_leaves,
      attendance_rate,
    };
  },
};
