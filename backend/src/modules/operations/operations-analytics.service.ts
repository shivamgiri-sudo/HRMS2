/**
 * Operations Analytics Service — Operations Dashboard Metrics
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

interface OperationsAnalyticsSummary {
  process_health: Array<{ process_id: number; process_name: string; health_score: number; attendance_pct: number; quality_pct: number; kpi_pct: number }>;
  sla_breach_analysis: Array<{ process_name: string; breach_count: number; root_cause: string }>;
  client_escalations: { open: number; closed: number; avg_resolution_hours: number };
  productivity_metrics: { calls_per_agent: number; aht_seconds: number };
  capacity_utilization: { seats_occupied: number; seats_total: number; utilization_pct: number };
  incident_log: Array<{ incident_id: number; priority: string; status: string; age_hours: number }>;
}

export async function getOperationsAnalyticsSummary(): Promise<OperationsAnalyticsSummary> {
  // Process health (composite score)
  const [processHealth] = await db.query<RowDataPacket[]>(
    `SELECT
       p.id as process_id,
       p.name as process_name,
       AVG(CASE WHEN a.status = 'present' THEN 100 ELSE 0 END) as attendance_pct,
       AVG(q.quality_score) as quality_pct,
       AVG(k.achievement_pct) as kpi_pct
     FROM processes p
     LEFT JOIN employees e ON p.id = e.process_id
     LEFT JOIN attendance a ON e.id = a.employee_id AND a.attendance_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     LEFT JOIN quality_audits q ON e.id = q.employee_id AND q.audit_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     LEFT JOIN kpi_scores k ON e.id = k.employee_id AND DATE_FORMAT(k.period, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
     WHERE p.is_active = 1
     GROUP BY p.id, p.name`
  );

  // SLA breach analysis
  const [slaBreach] = await db.query<RowDataPacket[]>(
    `SELECT process_name, COUNT(*) as breach_count, root_cause
     FROM sla_breaches
     WHERE breach_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     GROUP BY process_name, root_cause
     ORDER BY breach_count DESC
     LIMIT 10`
  );

  // Client escalations
  const [escalations] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
       SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count,
       AVG(CASE WHEN status = 'closed' THEN TIMESTAMPDIFF(HOUR, created_at, resolved_at) END) as avg_resolution_hours
     FROM client_escalations`
  );

  // Productivity metrics
  const [productivity] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(c.id) / COUNT(DISTINCT c.agent_id) as calls_per_agent,
       AVG(c.aht_seconds) as avg_aht
     FROM calls c
     WHERE c.call_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`
  );

  // Capacity utilization
  const [capacity] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(DISTINCT e.id) as seats_occupied,
       (SELECT SUM(capacity) FROM branches WHERE is_active = 1) as seats_total
     FROM employees e
     WHERE e.status = 'active'`
  );

  const seatsOccupied = capacity[0]?.seats_occupied ?? 0;
  const seatsTotal = capacity[0]?.seats_total ?? 1;

  // Incident log (open incidents)
  const [incidents] = await db.query<RowDataPacket[]>(
    `SELECT incident_id, priority, status, TIMESTAMPDIFF(HOUR, created_at, COALESCE(resolved_at, NOW())) as age_hours
     FROM incidents
     WHERE status IN ('open', 'in_progress')
     ORDER BY
       CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
       age_hours DESC
     LIMIT 10`
  );

  return {
    process_health: processHealth.map((r) => {
      const att = Number(r.attendance_pct ?? 0);
      const qual = Number(r.quality_pct ?? 0);
      const kpi = Number(r.kpi_pct ?? 0);
      const health = Math.round((att * 0.3 + qual * 0.4 + kpi * 0.3));
      return {
        process_id: r.process_id,
        process_name: r.process_name,
        health_score: health,
        attendance_pct: Math.round(att),
        quality_pct: Math.round(qual),
        kpi_pct: Math.round(kpi),
      };
    }),
    sla_breach_analysis: slaBreach.map((r) => ({
      process_name: r.process_name,
      breach_count: r.breach_count,
      root_cause: r.root_cause ?? "Unknown",
    })),
    client_escalations: {
      open: escalations[0]?.open_count ?? 0,
      closed: escalations[0]?.closed_count ?? 0,
      avg_resolution_hours: Math.round(Number(escalations[0]?.avg_resolution_hours ?? 0)),
    },
    productivity_metrics: {
      calls_per_agent: Math.round(Number(productivity[0]?.calls_per_agent ?? 0)),
      aht_seconds: Math.round(Number(productivity[0]?.avg_aht ?? 0)),
    },
    capacity_utilization: {
      seats_occupied: seatsOccupied,
      seats_total: seatsTotal,
      utilization_pct: Math.round((seatsOccupied / seatsTotal) * 100),
    },
    incident_log: incidents.map((r) => ({
      incident_id: r.incident_id,
      priority: r.priority,
      status: r.status,
      age_hours: r.age_hours,
    })),
  };
}
