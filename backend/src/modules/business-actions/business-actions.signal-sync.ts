import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { revenueRiskService } from "../revenue-risk/revenue-risk.service.js";
import { tableExists } from "../../shared/dbHelpers.js";

interface PeopleRiskRow extends RowDataPacket {
  employee_id: string;
  engagement_score: number | null;
  risk_label: string | null;
  top_risk_drivers_json: unknown;
  employee_code: string | null;
  full_name: string | null;
  reporting_manager_user_id: string | null;
  manager_name: string | null;
}

interface SupportSlaRow extends RowDataPacket {
  id: string;
  ticket_code: string | null;
  category: string | null;
  priority: string | null;
  subject: string | null;
  assigned_to: string | null;
  employee_id: string | null;
  employee_code: string | null;
  full_name: string | null;
}

interface GrievanceRow extends RowDataPacket {
  id: string;
  grievance_code: string | null;
  category: string | null;
  severity: string | null;
  status: string | null;
  assigned_to: string | null;
  is_anonymous: number | null;
}

interface RevenueRiskRow {
  risk_level?: string | null;
  revenue_at_risk?: number | string | null;
  shortage_hc?: number | string | null;
  revenue_date?: string | null;
  process_id?: string | null;
  process_name?: string | null;
  client_name?: string | null;
  data_confidence_score?: number | string | null;
  reason_json?: unknown[] | null;
}

function dueDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function ensureAction(input: {
  source_module: string;
  source_id: string;
  risk_type: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description?: string | null;
  owner_user_id?: string | null;
  owner_role?: string | null;
  due_date?: string | null;
}, actorUserId: string) {
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM business_action_queue
      WHERE source_module = ?
        AND source_id = ?
        AND risk_type = ?
        AND status NOT IN ('completed','cancelled')
      LIMIT 1`,
    [input.source_module, input.source_id, input.risk_type]
  );
  if (existing.length > 0) return { id: existing[0].id, created: false };

  const id = randomUUID();
  await db.execute(
    `INSERT INTO business_action_queue
      (id, source_module, source_id, risk_type, severity, title, description, owner_user_id, owner_role, due_date, status, escalation_level, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?)`,
    [
      id,
      input.source_module,
      input.source_id,
      input.risk_type,
      input.severity,
      input.title,
      input.description ?? null,
      input.owner_user_id ?? null,
      input.owner_role ?? null,
      input.due_date ?? dueDate(input.severity === "critical" ? 1 : input.severity === "high" ? 2 : 5),
      actorUserId,
    ]
  );
  await db.execute(
    `INSERT INTO business_action_activity_log (id, action_id, actor_user_id, activity_type, payload_json)
     VALUES (?, ?, ?, 'AUTO_CREATED_FROM_SIGNAL', ?)`,
    [randomUUID(), id, actorUserId, JSON.stringify(input)]
  );
  return { id, created: true };
}

export const businessActionSignalSync = {
  async syncAll(actorUserId: string) {
    const results = {
      people_experience: await this.syncPeopleExperience(actorUserId),
      support: await this.syncSupportSla(actorUserId),
      grievance: await this.syncGrievances(actorUserId),
      revenue_risk: await this.syncRevenueRisk(actorUserId),
      generated_at: new Date().toISOString(),
    };
    return results;
  },

  async syncPeopleExperience(actorUserId: string) {
    if (!(await tableExists("people_experience_health_snapshot"))) return { scanned: 0, created: 0, skipped: 0, reason: "people_experience_health_snapshot missing" };
    const [rows] = await db.execute<PeopleRiskRow[]>(
      `SELECT px.employee_id,
              px.engagement_score,
              px.risk_label,
              px.top_risk_drivers_json,
              e.employee_code,
              e.full_name,
              e.reporting_manager_user_id,
              mgr.full_name AS manager_name
         FROM people_experience_health_snapshot px
         JOIN (
           SELECT employee_id, MAX(snapshot_date) AS snapshot_date
           FROM people_experience_health_snapshot
           GROUP BY employee_id
         ) latest ON latest.employee_id = px.employee_id AND latest.snapshot_date = px.snapshot_date
         LEFT JOIN employees e ON e.id = px.employee_id
         LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
        WHERE px.risk_label IN ('attrition_risk','critical_people_risk')
        ORDER BY px.engagement_score ASC
        LIMIT 200`
    );

    let created = 0;
    for (const row of rows) {
      const result = await ensureAction({
        source_module: "people_experience",
        source_id: String(row.employee_id),
        risk_type: "people_risk",
        severity: row.risk_label === "critical_people_risk" ? "critical" : "high",
        title: `${row.full_name ?? "Employee"} is in ${String(row.risk_label).replace(/_/g, " ")}`,
        description: `Engagement score ${row.engagement_score}. Drivers: ${row.top_risk_drivers_json ?? "[]"}`,
        owner_user_id: row.reporting_manager_user_id ?? null,
        owner_role: row.reporting_manager_user_id ? null : "hr",
        due_date: dueDate(row.risk_label === "critical_people_risk" ? 1 : 2),
      }, actorUserId);
      if (result.created) created += 1;
    }
    return { scanned: rows.length, created, skipped: rows.length - created };
  },

  async syncSupportSla(actorUserId: string) {
    if (!(await tableExists("helpdesk_ticket"))) return { scanned: 0, created: 0, skipped: 0, reason: "helpdesk_ticket missing" };
    const [rows] = await db.execute<SupportSlaRow[]>(
      `SELECT t.id,
              t.ticket_code,
              t.category,
              t.priority,
              t.subject,
              t.assigned_to,
              t.employee_id,
              e.employee_code,
              e.full_name
         FROM helpdesk_ticket t
         LEFT JOIN employees e ON e.id = t.employee_id
        WHERE t.status NOT IN ('resolved','closed','cancelled')
          AND (
            (t.sla_due_at IS NOT NULL AND t.sla_due_at < NOW())
            OR (t.sla_due_at IS NULL AND (
              (t.priority = 'urgent' AND TIMESTAMPDIFF(HOUR, t.created_at, NOW()) > 2)
              OR (t.priority = 'high' AND TIMESTAMPDIFF(HOUR, t.created_at, NOW()) > 24)
              OR (t.priority = 'medium' AND TIMESTAMPDIFF(HOUR, t.created_at, NOW()) > 48)
              OR (t.priority = 'low' AND TIMESTAMPDIFF(HOUR, t.created_at, NOW()) > 72)
            ))
          )
        ORDER BY FIELD(t.priority, 'urgent','high','medium','low'), t.created_at ASC
        LIMIT 250`
    );

    let created = 0;
    for (const row of rows) {
      const result = await ensureAction({
        source_module: "support",
        source_id: String(row.id),
        risk_type: "sla_breach",
        severity: row.priority === "urgent" ? "critical" : row.priority === "high" ? "high" : "medium",
        title: `Support SLA breached: ${row.ticket_code ?? row.subject ?? row.id}`,
        description: `Category ${row.category ?? "unknown"}; employee ${row.employee_code ?? "unknown"} ${row.full_name ?? ""}`,
        owner_user_id: row.assigned_to ?? null,
        owner_role: row.assigned_to ? null : "hr",
        due_date: dueDate(row.priority === "urgent" ? 1 : 2),
      }, actorUserId);
      if (result.created) created += 1;
    }
    return { scanned: rows.length, created, skipped: rows.length - created };
  },

  async syncGrievances(actorUserId: string) {
    if (!(await tableExists("grievance"))) return { scanned: 0, created: 0, skipped: 0, reason: "grievance missing" };
    const [rows] = await db.execute<GrievanceRow[]>(
      `SELECT g.id,
              g.grievance_code,
              g.category,
              g.severity,
              g.status,
              g.assigned_to,
              g.is_anonymous
         FROM grievance g
        WHERE g.status NOT IN ('resolved','closed')
          AND (g.severity IN ('critical','high') OR g.category IN ('harassment','safety','security','discrimination') OR g.status = 'escalated')
        ORDER BY FIELD(COALESCE(g.severity, 'medium'), 'critical','high','medium','low'), g.created_at ASC
        LIMIT 200`
    );

    let created = 0;
    for (const row of rows) {
      const critical = row.severity === "critical" || ["harassment", "safety", "security", "discrimination"].includes(String(row.category));
      const result = await ensureAction({
        source_module: "grievance",
        source_id: String(row.id),
        risk_type: "grievance_risk",
        severity: critical ? "critical" : "high",
        title: `Grievance requires action: ${row.grievance_code ?? row.id}`,
        description: `Category ${row.category ?? "unknown"}; status ${row.status}; anonymous ${row.is_anonymous ? "yes" : "no"}`,
        owner_user_id: row.assigned_to ?? null,
        owner_role: row.assigned_to ? null : "hr",
        due_date: dueDate(critical ? 1 : 2),
      }, actorUserId);
      if (result.created) created += 1;
    }
    return { scanned: rows.length, created, skipped: rows.length - created };
  },

  async syncRevenueRisk(actorUserId: string) {
    const snapshot = await revenueRiskService.snapshot();
    const rows = Array.isArray(snapshot.rows) ? snapshot.rows as RevenueRiskRow[] : [];
    const riskRows = rows.filter((row) => ["critical", "high"].includes(String(row.risk_level)) || Number(row.revenue_at_risk ?? 0) > 0 || Number(row.shortage_hc ?? 0) > 0).slice(0, 100);
    let created = 0;
    for (const row of riskRows) {
      const severity = row.risk_level === "critical" ? "critical" : row.risk_level === "high" ? "high" : "medium";
      const result = await ensureAction({
        source_module: "revenue",
        source_id: `${row.revenue_date ?? snapshot.date}:${row.process_id ?? row.process_name ?? "unknown"}`,
        risk_type: "revenue_leakage",
        severity,
        title: `Revenue at risk in ${row.process_name ?? "process"}: ₹${Math.round(Number(row.revenue_at_risk ?? 0)).toLocaleString("en-IN")}`,
        description: `Client ${row.client_name ?? "unknown"}; shortage HC ${row.shortage_hc ?? 0}; confidence ${row.data_confidence_score ?? 0}%; reasons ${(row.reason_json ?? []).join(" | ")}`,
        owner_role: "operations",
        due_date: dueDate(severity === "critical" ? 1 : 2),
      }, actorUserId);
      if (result.created) created += 1;
    }
    return { scanned: riskRows.length, created, skipped: riskRows.length - created };
  },
};
