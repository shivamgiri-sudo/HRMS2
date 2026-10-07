/**
 * Manager Analytics Service — Manager Dashboard Metrics
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

interface ManagerAnalyticsSummary {
  team_size: number;
  team_quality_avg: number;
  team_kpi_avg: number;
  one_on_one_completion: {
    scheduled: number;
    completed: number;
    completion_rate: number;
  };
  pip_tracking: {
    active_pips: number;
    completed_this_month: number;
    at_risk_count: number;
  };
  performance_bands: {
    s_rating: number;
    a_rating: number;
    b_rating: number;
    c_rating: number;
    d_rating: number;
  };
  attrition_risk: Array<{
    employee_id: number;
    employee_name: string;
    quality_score: number;
    attendance_pct: number;
    risk_level: string;
  }>;
  team_kpi_by_process: Array<{
    process_id: number;
    process_name: string;
    target: number;
    actual: number;
    achievement_pct: number;
    status: string;
  }>;
  quality_distribution: Array<{
    score_range: string;
    count: number;
  }>;
}

export async function getManagerAnalyticsSummary(
  managerId: number,
): Promise<ManagerAnalyticsSummary> {
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Team size
  const [teamSize] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM employees
     WHERE reporting_manager_id = ?
       AND status = 'active'`,
    [managerId],
  );

  // Team quality average (last 30 days)
  const [qualityAvg] = await db.query<RowDataPacket[]>(
    `SELECT AVG(q.quality_score) as avg_score
     FROM quality_scores q
     INNER JOIN employees e ON q.employee_id = e.id
     WHERE e.reporting_manager_id = ?
       AND q.audit_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
    [managerId],
  );

  // Team KPI average (current month)
  const [kpiAvg] = await db.query<RowDataPacket[]>(
    `SELECT AVG(k.achievement_pct) as avg_achievement
     FROM kpi_scores k
     INNER JOIN employees e ON k.employee_id = e.id
     WHERE e.reporting_manager_id = ?
       AND DATE_FORMAT(k.period, '%Y-%m') = ?`,
    [managerId, currentMonth],
  );

  // 1:1 completion rate
  const [oneOnOne] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) as scheduled,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
     FROM one_on_one_meetings
     WHERE manager_id = ?
       AND DATE_FORMAT(scheduled_date, '%Y-%m') = ?`,
    [managerId, currentMonth],
  );

  const scheduled = oneOnOne[0]?.scheduled ?? 0;
  const completed = oneOnOne[0]?.completed ?? 0;
  const completionRate =
    scheduled > 0 ? Math.round((completed / scheduled) * 100) : 0;

  // PIP tracking
  const [pipStats] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_pips,
       SUM(CASE WHEN status = 'completed' AND DATE_FORMAT(completed_date, '%Y-%m') = ? THEN 1 ELSE 0 END) as completed_month
     FROM performance_improvement_plans p
     INNER JOIN employees e ON p.employee_id = e.id
     WHERE e.reporting_manager_id = ?`,
    [currentMonth, managerId],
  );

  // At-risk employees (quality < 60 OR attendance < 80%)
  const [atRisk] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT e.id) as count
     FROM employees e
     LEFT JOIN (
       SELECT employee_id, AVG(quality_score) as avg_quality
       FROM quality_scores
       WHERE audit_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY employee_id
     ) q ON e.id = q.employee_id
     LEFT JOIN (
       SELECT employee_id, AVG(CASE WHEN status = 'present' THEN 1 ELSE 0 END) * 100 as attendance_pct
       FROM attendance
       WHERE attendance_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY employee_id
     ) a ON e.id = a.employee_id
     WHERE e.reporting_manager_id = ?
       AND e.status = 'active'
       AND (q.avg_quality < 60 OR a.attendance_pct < 80)`,
    [managerId],
  );

  // Performance bands (S/A/B/C/D)
  const [perfBands] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN k.achievement_pct >= 100 THEN 1 ELSE 0 END) as s_rating,
       SUM(CASE WHEN k.achievement_pct >= 90 AND k.achievement_pct < 100 THEN 1 ELSE 0 END) as a_rating,
       SUM(CASE WHEN k.achievement_pct >= 75 AND k.achievement_pct < 90 THEN 1 ELSE 0 END) as b_rating,
       SUM(CASE WHEN k.achievement_pct >= 60 AND k.achievement_pct < 75 THEN 1 ELSE 0 END) as c_rating,
       SUM(CASE WHEN k.achievement_pct < 60 THEN 1 ELSE 0 END) as d_rating
     FROM kpi_scores k
     INNER JOIN employees e ON k.employee_id = e.id
     WHERE e.reporting_manager_id = ?
       AND DATE_FORMAT(k.period, '%Y-%m') = ?`,
    [managerId, currentMonth],
  );

  // Attrition risk employees (top 10)
  const [atRiskEmployees] = await db.query<RowDataPacket[]>(
    `SELECT
       e.id as employee_id,
       e.name as employee_name,
       COALESCE(q.avg_quality, 0) as quality_score,
       COALESCE(a.attendance_pct, 0) as attendance_pct,
       CASE
         WHEN q.avg_quality < 50 OR a.attendance_pct < 70 THEN 'critical'
         WHEN q.avg_quality < 60 OR a.attendance_pct < 80 THEN 'high'
         ELSE 'medium'
       END as risk_level
     FROM employees e
     LEFT JOIN (
       SELECT employee_id, AVG(quality_score) as avg_quality
       FROM quality_scores
       WHERE audit_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY employee_id
     ) q ON e.id = q.employee_id
     LEFT JOIN (
       SELECT employee_id, AVG(CASE WHEN status = 'present' THEN 1 ELSE 0 END) * 100 as attendance_pct
       FROM attendance
       WHERE attendance_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY employee_id
     ) a ON e.id = a.employee_id
     WHERE e.reporting_manager_id = ?
       AND e.status = 'active'
       AND (q.avg_quality < 60 OR a.attendance_pct < 80)
     ORDER BY
       CASE risk_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
       q.avg_quality ASC
     LIMIT 10`,
    [managerId],
  );

  // Team KPI by process
  const [kpiByProcess] = await db.query<RowDataPacket[]>(
    `SELECT
       p.id as process_id,
       p.name as process_name,
       AVG(k.target) as target,
       AVG(k.actual) as actual,
       AVG(k.achievement_pct) as achievement_pct
     FROM kpi_scores k
     INNER JOIN employees e ON k.employee_id = e.id
     INNER JOIN processes p ON e.process_id = p.id
     WHERE e.reporting_manager_id = ?
       AND DATE_FORMAT(k.period, '%Y-%m') = ?
     GROUP BY p.id, p.name
     ORDER BY achievement_pct DESC`,
    [managerId, currentMonth],
  );

  // Quality distribution (histogram)
  const [qualityDist] = await db.query<RowDataPacket[]>(
    `SELECT
       CASE
         WHEN q.quality_score >= 90 THEN '90-100'
         WHEN q.quality_score >= 80 THEN '80-89'
         WHEN q.quality_score >= 70 THEN '70-79'
         WHEN q.quality_score >= 60 THEN '60-69'
         ELSE '<60'
       END as score_range,
       COUNT(*) as count
     FROM quality_scores q
     INNER JOIN employees e ON q.employee_id = e.id
     WHERE e.reporting_manager_id = ?
       AND q.audit_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     GROUP BY score_range
     ORDER BY score_range DESC`,
    [managerId],
  );

  return {
    team_size: teamSize[0]?.count ?? 0,
    team_quality_avg: Math.round(Number(qualityAvg[0]?.avg_score ?? 0)),
    team_kpi_avg: Math.round(Number(kpiAvg[0]?.avg_achievement ?? 0)),
    one_on_one_completion: {
      scheduled,
      completed,
      completion_rate: completionRate,
    },
    pip_tracking: {
      active_pips: pipStats[0]?.active_pips ?? 0,
      completed_this_month: pipStats[0]?.completed_month ?? 0,
      at_risk_count: atRisk[0]?.count ?? 0,
    },
    performance_bands: {
      s_rating: perfBands[0]?.s_rating ?? 0,
      a_rating: perfBands[0]?.a_rating ?? 0,
      b_rating: perfBands[0]?.b_rating ?? 0,
      c_rating: perfBands[0]?.c_rating ?? 0,
      d_rating: perfBands[0]?.d_rating ?? 0,
    },
    attrition_risk: atRiskEmployees.map((r) => ({
      employee_id: r.employee_id,
      employee_name: r.employee_name,
      quality_score: Math.round(Number(r.quality_score)),
      attendance_pct: Math.round(Number(r.attendance_pct)),
      risk_level: r.risk_level,
    })),
    team_kpi_by_process: kpiByProcess.map((r) => {
      const achievement = Number(r.achievement_pct ?? 0);
      return {
        process_id: r.process_id,
        process_name: r.process_name,
        target: Number(r.target ?? 0),
        actual: Number(r.actual ?? 0),
        achievement_pct: Math.round(achievement),
        status:
          achievement >= 90 ? "green" : achievement >= 75 ? "amber" : "red",
      };
    }),
    quality_distribution: qualityDist.map((r) => ({
      score_range: r.score_range,
      count: r.count,
    })),
  };
}
