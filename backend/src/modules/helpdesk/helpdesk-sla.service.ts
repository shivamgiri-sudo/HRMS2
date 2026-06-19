import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ── SLA windows (hours) by priority × category ───────────────────────────────
const SLA_HOURS_DEFAULT: Record<string, number> = {
  urgent: 2,
  high:   24,
  medium: 48,
  low:    72,
};

const SLA_CATEGORY_OVERRIDE: Record<string, Record<string, number>> = {
  it:         { urgent: 2,  high: 8,  medium: 24, low: 48 },
  payroll:    { urgent: 4,  high: 24, medium: 48, low: 72 },
  attendance: { urgent: 4,  high: 24, medium: 48, low: 72 },
  hr:         { urgent: 4,  high: 24, medium: 48, low: 72 },
};

export function calculateSlaDueAt(
  priority: string,
  category: string,
  createdAt: Date
): Date {
  const prio = priority in SLA_HOURS_DEFAULT ? priority : "medium";
  const categoryHours = SLA_CATEGORY_OVERRIDE[category];
  const hours = categoryHours
    ? (categoryHours[prio] ?? SLA_HOURS_DEFAULT[prio])
    : SLA_HOURS_DEFAULT[prio];
  const due = new Date(createdAt.getTime() + hours * 60 * 60 * 1000);
  return due;
}

// ── Dashboard stats ───────────────────────────────────────────────────────────
export async function getHelpdeskDashboard(filters: {
  branch_id?: string;
  process_id?: string;
  department_id?: string;
  category?: string;
  priority?: string;
  status?: string;
  assigned_to?: string;
  from?: string;
  to?: string;
}) {
  const conds: string[] = [];
  const params: unknown[] = [];

  if (filters.from)       { conds.push("t.created_at >= ?");    params.push(filters.from + " 00:00:00"); }
  if (filters.to)         { conds.push("t.created_at <= ?");    params.push(filters.to   + " 23:59:59"); }
  if (filters.category)   { conds.push("t.category = ?");       params.push(filters.category); }
  if (filters.priority)   { conds.push("t.priority = ?");       params.push(filters.priority); }
  if (filters.status)     { conds.push("t.status = ?");         params.push(filters.status); }
  if (filters.assigned_to){ conds.push("t.assigned_to = ?");    params.push(filters.assigned_to); }
  if (filters.branch_id)  { conds.push("e.branch_id = ?");      params.push(filters.branch_id); }
  if (filters.process_id) { conds.push("e.process_id = ?");     params.push(filters.process_id); }
  if (filters.department_id){ conds.push("e.department_id = ?");params.push(filters.department_id); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const joinClause = (filters.branch_id || filters.process_id || filters.department_id)
    ? "JOIN employees e ON e.id = t.employee_id"
    : "LEFT JOIN employees e ON e.id = t.employee_id";

  const [statsRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)                                                                         AS total_tickets,
       SUM(t.status NOT IN ('resolved','closed','cancelled'))                           AS open_tickets,
       SUM(t.priority = 'urgent' AND t.status NOT IN ('resolved','closed','cancelled')) AS urgent_tickets,
       SUM(t.sla_breached = 1 AND t.status NOT IN ('resolved','closed','cancelled'))    AS breached_tickets,
       SUM(t.sla_due_at IS NOT NULL AND t.sla_due_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 4 HOUR)
           AND t.status NOT IN ('resolved','closed','cancelled'))                       AS nearing_breach,
       ROUND(AVG(CASE WHEN t.resolved_at IS NOT NULL
                      THEN TIMESTAMPDIFF(MINUTE, t.created_at, t.resolved_at) END), 0) AS avg_resolution_minutes,
       SUM(t.reopened_count > 0)                                                        AS reopened_count,
       SUM(t.assigned_to IS NULL AND t.status NOT IN ('resolved','closed','cancelled')) AS unassigned_count,
       ROUND(AVG(NULLIF(t.closure_rating, 0)), 2)                                       AS avg_csat
     FROM helpdesk_ticket t
     ${joinClause}
     ${where}`,
    params
  );

  return { stats: statsRows[0] ?? {} };
}

export async function getHelpdeskSlaSummary(filters: {
  from?: string; to?: string; branch_id?: string; process_id?: string;
}) {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filters.from) { conds.push("t.created_at >= ?"); params.push(filters.from + " 00:00:00"); }
  if (filters.to)   { conds.push("t.created_at <= ?"); params.push(filters.to   + " 23:59:59"); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       t.priority,
       COUNT(*) AS total,
       SUM(t.sla_breached = 1) AS breached,
       SUM(t.sla_breached = 0 AND t.status IN ('resolved','closed')) AS resolved_on_time,
       ROUND(AVG(CASE WHEN t.resolved_at IS NOT NULL
                      THEN TIMESTAMPDIFF(MINUTE, t.created_at, t.resolved_at) END), 0) AS avg_resolution_minutes
     FROM helpdesk_ticket t ${where}
     GROUP BY t.priority`,
    params
  );
  return { data: rows };
}

export async function getCategoryBreakdown(filters: { from?: string; to?: string }) {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filters.from) { conds.push("created_at >= ?"); params.push(filters.from + " 00:00:00"); }
  if (filters.to)   { conds.push("created_at <= ?"); params.push(filters.to   + " 23:59:59"); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT category,
            COUNT(*) AS total,
            SUM(status NOT IN ('resolved','closed','cancelled')) AS open,
            SUM(sla_breached = 1) AS breached,
            ROUND(AVG(CASE WHEN resolved_at IS NOT NULL
                           THEN TIMESTAMPDIFF(MINUTE, created_at, resolved_at) END), 0) AS avg_resolution_minutes
       FROM helpdesk_ticket ${where}
       GROUP BY category ORDER BY total DESC`,
    params
  );
  return { data: rows };
}

export async function getOwnerWorkload() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.assigned_to,
            COALESCE(NULLIF(u.full_name,''), u.email, 'Unassigned') AS owner_name,
            COUNT(*) AS total,
            SUM(t.status NOT IN ('resolved','closed','cancelled')) AS open,
            SUM(t.priority = 'urgent' AND t.status NOT IN ('resolved','closed','cancelled')) AS urgent_open,
            SUM(t.sla_breached = 1 AND t.status NOT IN ('resolved','closed','cancelled')) AS breached,
            ROUND(AVG(CASE WHEN t.resolved_at IS NOT NULL
                           THEN TIMESTAMPDIFF(MINUTE, t.created_at, t.resolved_at) END), 0) AS avg_resolution_minutes
       FROM helpdesk_ticket t
       LEFT JOIN auth_user u ON u.id = t.assigned_to
      WHERE t.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY t.assigned_to
      ORDER BY open DESC
      LIMIT 50`
  );
  return { data: rows };
}

export async function getAgingBuckets(filters: { branch_id?: string; process_id?: string }) {
  const conds: string[] = ["t.status NOT IN ('resolved','closed','cancelled')"];
  const params: unknown[] = [];
  if (filters.branch_id)  { conds.push("e.branch_id = ?");  params.push(filters.branch_id); }
  if (filters.process_id) { conds.push("e.process_id = ?"); params.push(filters.process_id); }
  const where = `WHERE ${conds.join(" AND ")}`;
  const joinClause = (filters.branch_id || filters.process_id)
    ? "JOIN employees e ON e.id = t.employee_id"
    : "LEFT JOIN employees e ON e.id = t.employee_id";

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(TIMESTAMPDIFF(HOUR, t.created_at, NOW()) BETWEEN 0  AND  4)  AS bucket_0_4h,
       SUM(TIMESTAMPDIFF(HOUR, t.created_at, NOW()) BETWEEN 4  AND 24)  AS bucket_4_24h,
       SUM(TIMESTAMPDIFF(HOUR, t.created_at, NOW()) BETWEEN 24 AND 72)  AS bucket_1_3d,
       SUM(TIMESTAMPDIFF(HOUR, t.created_at, NOW()) BETWEEN 72 AND 168) AS bucket_3_7d,
       SUM(TIMESTAMPDIFF(HOUR, t.created_at, NOW()) > 168)              AS bucket_over_7d
     FROM helpdesk_ticket t ${joinClause} ${where}`,
    params
  );
  return { data: rows[0] ?? {} };
}

export async function getRootCauses(filters: { from?: string; to?: string }) {
  const conds: string[] = ["root_cause IS NOT NULL"];
  const params: unknown[] = [];
  if (filters.from) { conds.push("created_at >= ?"); params.push(filters.from + " 00:00:00"); }
  if (filters.to)   { conds.push("created_at <= ?"); params.push(filters.to   + " 23:59:59"); }
  const where = `WHERE ${conds.join(" AND ")}`;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT root_cause, COUNT(*) AS total FROM helpdesk_ticket ${where}
       GROUP BY root_cause ORDER BY total DESC LIMIT 20`,
    params
  );
  return { data: rows };
}

export async function getSupportCommandCenter(filters: {
  branch_id?: string;
  process_id?: string;
  department_id?: string;
  category?: string;
  priority?: string;
  status?: string;
  assigned_to?: string;
  from?: string;
  to?: string;
}) {
  await refreshSlaBreachFlags();
  const [dashboard, slaSummary, categoryBreakdown, ownerWorkload, aging, rootCauses] = await Promise.all([
    getHelpdeskDashboard(filters),
    getHelpdeskSlaSummary(filters),
    getCategoryBreakdown(filters),
    getOwnerWorkload(),
    getAgingBuckets(filters),
    getRootCauses(filters),
  ]);

  return {
    stats: dashboard.stats,
    sla_summary: slaSummary.data,
    category_breakdown: categoryBreakdown.data,
    owner_workload: ownerWorkload.data,
    aging: aging.data,
    root_causes: rootCauses.data,
  };
}

export async function getGrievanceDashboard(filters: {
  from?: string; to?: string; status?: string; severity?: string;
}) {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filters.from)     { conds.push("created_at >= ?"); params.push(filters.from + " 00:00:00"); }
  if (filters.to)       { conds.push("created_at <= ?"); params.push(filters.to   + " 23:59:59"); }
  if (filters.status)   { conds.push("status = ?");      params.push(filters.status); }
  if (filters.severity) { conds.push("severity = ?");    params.push(filters.severity); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const [stats] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)                                  AS total_grievances,
       SUM(status NOT IN ('resolved','closed'))  AS open_grievances,
       SUM(is_anonymous = 1)                     AS anonymous_count,
       SUM(severity = 'critical')                AS critical_count,
       SUM(escalation_level > 0)                 AS escalated_count,
       SUM(anti_retaliation_flag = 1)            AS anti_retaliation_count,
       ROUND(AVG(CASE WHEN closed_at IS NOT NULL
                      THEN TIMESTAMPDIFF(DAY, created_at, closed_at) END), 1) AS avg_resolution_days
     FROM grievance ${where}`,
    params
  );

  const [categoryRows] = await db.execute<RowDataPacket[]>(
    `SELECT category, COUNT(*) AS total,
            SUM(status NOT IN ('resolved','closed')) AS open
       FROM grievance ${where}
       GROUP BY category ORDER BY total DESC`
    , params
  );

  const [severityRows] = await db.execute<RowDataPacket[]>(
    `SELECT severity, COUNT(*) AS total,
            SUM(status NOT IN ('resolved','closed')) AS open
       FROM grievance ${where}
       GROUP BY severity`
    , params
  );

  const [agingRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(DATEDIFF(NOW(), created_at) BETWEEN 0  AND  7)  AS bucket_0_7d,
       SUM(DATEDIFF(NOW(), created_at) BETWEEN 8  AND 30)  AS bucket_8_30d,
       SUM(DATEDIFF(NOW(), created_at) BETWEEN 31 AND 90)  AS bucket_31_90d,
       SUM(DATEDIFF(NOW(), created_at) > 90)               AS bucket_over_90d
     FROM grievance WHERE status NOT IN ('resolved','closed')`
  );

  return {
    stats: stats[0] ?? {},
    category_breakdown: categoryRows,
    severity_breakdown: severityRows,
    aging: agingRows[0] ?? {},
  };
}

export async function getGrievanceCommandCenter(filters: {
  status?: string;
  assigned_to?: string;
  employee_id?: string;
  severity?: string;
  from?: string;
  to?: string;
}) {
  const [dashboard, cases] = await Promise.all([
    getGrievanceDashboard(filters),
    import("./helpdesk.service.js").then(({ helpdeskService }) => helpdeskService.listGrievances(filters)),
  ]);

  return {
    ...dashboard,
    cases,
  };
}

// Sync sla_breached flag for open tickets (called on dashboard fetch)
export async function refreshSlaBreachFlags() {
  await db.execute(
    `UPDATE helpdesk_ticket
        SET sla_breached = 1
      WHERE sla_due_at IS NOT NULL
        AND sla_due_at < NOW()
        AND status NOT IN ('resolved','closed','cancelled')
        AND sla_breached = 0`
  );
}
