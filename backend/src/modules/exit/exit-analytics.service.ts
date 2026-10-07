/**
 * Exit Analytics Service — HR Dashboard Metrics
 *
 * Provides aggregated exit data:
 * - Resignations this month/YTD
 * - F&F pending count + aging
 * - Clearance TAT
 * - Notice period stats
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

interface ExitAnalyticsSummary {
  resignations_this_month: number;
  resignations_ytd: number;
  avg_notice_period_days: number;
  ff_pending_count: number;
  ff_pending_over_45_days: number;
  avg_clearance_tat_days: number;
  exits_by_month: Array<{ month: string; count: number }>;
  ff_aging_buckets: {
    under_30: number;
    "30_to_45": number;
    over_45: number;
  };
}

export async function getExitAnalyticsSummary(): Promise<ExitAnalyticsSummary> {
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM
  const currentYear = now.getFullYear();

  // Resignations this month
  const [resignationsThisMonth] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM exit_requests
     WHERE DATE_FORMAT(resignation_date, '%Y-%m') = ?
       AND exit_type = 'resignation'
       AND status != 'cancelled'`,
    [currentMonth],
  );

  // Resignations YTD
  const [resignationsYtd] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM exit_requests
     WHERE YEAR(resignation_date) = ?
       AND exit_type = 'resignation'
       AND status != 'cancelled'`,
    [currentYear],
  );

  // Avg notice period (resignation_date to LWD)
  const [noticeAvg] = await db.query<RowDataPacket[]>(
    `SELECT AVG(DATEDIFF(lwd, resignation_date)) as avg_days
     FROM exit_requests
     WHERE exit_type = 'resignation'
       AND resignation_date IS NOT NULL
       AND lwd IS NOT NULL
       AND status != 'cancelled'
       AND YEAR(resignation_date) = ?`,
    [currentYear],
  );

  // F&F pending count
  const [ffPending] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM exit_requests
     WHERE status IN ('clearance_pending', 'clearance_in_progress', 'f&f_pending')
       AND lwd < CURDATE()`,
  );

  // F&F pending > 45 days
  const [ffOverdue] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM exit_requests
     WHERE status IN ('clearance_pending', 'clearance_in_progress', 'f&f_pending')
       AND lwd < DATE_SUB(CURDATE(), INTERVAL 45 DAY)`,
  );

  // Avg clearance TAT (LWD to clearance_completed_at)
  const [clearanceTat] = await db.query<RowDataPacket[]>(
    `SELECT AVG(DATEDIFF(clearance_completed_at, lwd)) as avg_days
     FROM exit_requests
     WHERE clearance_completed_at IS NOT NULL
       AND lwd IS NOT NULL
       AND YEAR(lwd) = ?`,
    [currentYear],
  );

  // Exits by month (last 12 months)
  const [exitsByMonth] = await db.query<RowDataPacket[]>(
    `SELECT
       DATE_FORMAT(lwd, '%Y-%m') as month,
       COUNT(*) as count
     FROM exit_requests
     WHERE lwd >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
       AND status != 'cancelled'
     GROUP BY month
     ORDER BY month ASC`,
  );

  // F&F aging buckets
  const [ffAging] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN DATEDIFF(CURDATE(), lwd) < 30 THEN 1 ELSE 0 END) as under_30,
       SUM(CASE WHEN DATEDIFF(CURDATE(), lwd) BETWEEN 30 AND 45 THEN 1 ELSE 0 END) as bucket_30_45,
       SUM(CASE WHEN DATEDIFF(CURDATE(), lwd) > 45 THEN 1 ELSE 0 END) as over_45
     FROM exit_requests
     WHERE status IN ('clearance_pending', 'clearance_in_progress', 'f&f_pending')
       AND lwd < CURDATE()`,
  );

  return {
    resignations_this_month: resignationsThisMonth[0]?.count ?? 0,
    resignations_ytd: resignationsYtd[0]?.count ?? 0,
    avg_notice_period_days: Math.round(noticeAvg[0]?.avg_days ?? 0),
    ff_pending_count: ffPending[0]?.count ?? 0,
    ff_pending_over_45_days: ffOverdue[0]?.count ?? 0,
    avg_clearance_tat_days: Math.round(clearanceTat[0]?.avg_days ?? 0),
    exits_by_month: exitsByMonth.map((r) => ({
      month: r.month,
      count: r.count,
    })),
    ff_aging_buckets: {
      under_30: ffAging[0]?.under_30 ?? 0,
      "30_to_45": ffAging[0]?.bucket_30_45 ?? 0,
      over_45: ffAging[0]?.over_45 ?? 0,
    },
  };
}
