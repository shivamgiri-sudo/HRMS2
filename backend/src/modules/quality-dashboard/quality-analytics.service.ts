/**
 * Quality Analytics Service — Quality Dashboard Metrics
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

interface QualityAnalyticsSummary {
  defect_breakdown: Array<{ category: string; count: number; pct: number }>;
  calibration_status: { scheduled: number; held: number; irr_score: number };
  fatal_trend: Array<{ date: string; count: number }>;
  agent_bands: { s: number; a: number; b: number; c: number; d: number };
  tni_summary: Array<{ employee_id: number; employee_name: string; defect_pattern: string; tni_count: number }>;
  audit_coverage: Array<{ process_name: string; calls_audited: number; total_calls: number; coverage_pct: number }>;
}

export async function getQualityAnalyticsSummary(): Promise<QualityAnalyticsSummary> {
  // Defect breakdown (top 5 categories)
  const [defects] = await db.query<RowDataPacket[]>(
    `SELECT defect_category, COUNT(*) as count
     FROM quality_audits
     WHERE audit_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       AND defect_category IS NOT NULL
     GROUP BY defect_category
     ORDER BY count DESC
     LIMIT 5`
  );
  const totalDefects = defects.reduce((sum, r) => sum + Number(r.count), 0);

  // Calibration status
  const [calibration] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) as scheduled,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as held,
       AVG(irr_score) as avg_irr
     FROM calibration_sessions
     WHERE DATE_FORMAT(scheduled_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
  );

  // Fatal error trend (last 30 days)
  const [fatalTrend] = await db.query<RowDataPacket[]>(
    `SELECT DATE(audit_date) as date, COUNT(*) as count
     FROM quality_audits
     WHERE audit_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       AND is_fatal = 1
     GROUP BY DATE(audit_date)
     ORDER BY date ASC`
  );

  // Agent quality bands
  const [bands] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN avg_score >= 100 THEN 1 ELSE 0 END) as s_rating,
       SUM(CASE WHEN avg_score >= 90 AND avg_score < 100 THEN 1 ELSE 0 END) as a_rating,
       SUM(CASE WHEN avg_score >= 75 AND avg_score < 90 THEN 1 ELSE 0 END) as b_rating,
       SUM(CASE WHEN avg_score >= 60 AND avg_score < 75 THEN 1 ELSE 0 END) as c_rating,
       SUM(CASE WHEN avg_score < 60 THEN 1 ELSE 0 END) as d_rating
     FROM (
       SELECT employee_id, AVG(quality_score) as avg_score
       FROM quality_audits
       WHERE audit_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY employee_id
     ) scores`
  );

  // TNI summary (top 10 agents needing training)
  const [tni] = await db.query<RowDataPacket[]>(
    `SELECT
       q.employee_id,
       e.name as employee_name,
       GROUP_CONCAT(DISTINCT q.defect_category) as defect_pattern,
       COUNT(*) as tni_count
     FROM quality_audits q
     INNER JOIN employees e ON q.employee_id = e.id
     WHERE q.audit_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       AND q.defect_category IS NOT NULL
     GROUP BY q.employee_id, e.name
     ORDER BY tni_count DESC
     LIMIT 10`
  );

  // Audit coverage by process
  const [coverage] = await db.query<RowDataPacket[]>(
    `SELECT
       p.name as process_name,
       COUNT(DISTINCT q.call_id) as calls_audited,
       COUNT(DISTINCT c.id) as total_calls
     FROM processes p
     LEFT JOIN quality_audits q ON p.id = q.process_id
       AND q.audit_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     LEFT JOIN calls c ON p.id = c.process_id
       AND c.call_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     WHERE p.is_active = 1
     GROUP BY p.id, p.name
     ORDER BY p.name`
  );

  return {
    defect_breakdown: defects.map((r) => ({
      category: r.defect_category,
      count: r.count,
      pct: totalDefects > 0 ? Math.round((Number(r.count) / totalDefects) * 100) : 0,
    })),
    calibration_status: {
      scheduled: calibration[0]?.scheduled ?? 0,
      held: calibration[0]?.held ?? 0,
      irr_score: Math.round(Number(calibration[0]?.avg_irr ?? 0)),
    },
    fatal_trend: fatalTrend.map((r) => ({ date: r.date, count: r.count })),
    agent_bands: {
      s: bands[0]?.s_rating ?? 0,
      a: bands[0]?.a_rating ?? 0,
      b: bands[0]?.b_rating ?? 0,
      c: bands[0]?.c_rating ?? 0,
      d: bands[0]?.d_rating ?? 0,
    },
    tni_summary: tni.map((r) => ({
      employee_id: r.employee_id,
      employee_name: r.employee_name,
      defect_pattern: r.defect_pattern ?? "Multiple",
      tni_count: r.tni_count,
    })),
    audit_coverage: coverage.map((r) => {
      const audited = Number(r.calls_audited ?? 0);
      const total = Number(r.total_calls ?? 0);
      return {
        process_name: r.process_name,
        calls_audited: audited,
        total_calls: total,
        coverage_pct: total > 0 ? Math.round((audited / total) * 100) : 0,
      };
    }),
  };
}
