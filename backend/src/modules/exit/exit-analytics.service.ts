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

// exit_request is the real table (there is no exit_requests), and it has no resignation_date,
// lwd or clearance_completed_at columns — every query below raised ER_NO_SUCH_TABLE.
// Mapped onto the columns and statuses the exit journey actually writes:
//   resignation date  -> submitted_at (created_at for rows written before it existed)
//   last working day  -> the confirmed LWD, else the proposed one
//   clearance done    -> the last task's cleared_at, once no task is still open
//   "resignation"     -> exit_type 'voluntary' (the only two values are voluntary/involuntary)
//   "cancelled"       -> revoked / withdrawn / rejected (the FSM's non-exit terminals)
//   F&F pending       -> clearance_pending / fnf_pending (the FSM's pre-settlement states)
const RESIGNED_ON = "COALESCE(er.submitted_at, er.created_at)";
const LWD = "COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed)";
const NOT_AN_EXIT = "'revoked', 'withdrawn', 'rejected'";
const FF_PENDING = "'clearance_pending', 'fnf_pending'";

export async function getExitAnalyticsSummary(
  scope: { sql: string; params: unknown[] } = { sql: "1=1", params: [] },
): Promise<ExitAnalyticsSummary> {
  // Branch scoping (owner ruling 2026-10-01): every aggregate below is restricted to the caller's
  // scope (er.employee_id IN (...)); org-wide callers pass 1=1.
  const SC = `AND (${scope.sql})`;
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM
  const currentYear = now.getFullYear();

  // Resignations this month
  const [resignationsThisMonth] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM exit_request er
     WHERE DATE_FORMAT(${RESIGNED_ON}, '%Y-%m') = ?
       AND er.exit_type = 'voluntary'
       AND er.status NOT IN (${NOT_AN_EXIT}) ${SC}`,
    [currentMonth, ...scope.params]
  );

  // Resignations YTD
  const [resignationsYtd] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM exit_request er
     WHERE YEAR(${RESIGNED_ON}) = ?
       AND er.exit_type = 'voluntary'
       AND er.status NOT IN (${NOT_AN_EXIT}) ${SC}`,
    [currentYear, ...scope.params]
  );

  // Avg notice period (resignation date to LWD)
  const [noticeAvg] = await db.query<RowDataPacket[]>(
    `SELECT AVG(DATEDIFF(${LWD}, ${RESIGNED_ON})) as avg_days
     FROM exit_request er
     WHERE er.exit_type = 'voluntary'
       AND ${LWD} IS NOT NULL
       AND er.status NOT IN (${NOT_AN_EXIT})
       AND YEAR(${RESIGNED_ON}) = ? ${SC}`,
    [currentYear, ...scope.params]
  );

  // F&F pending count
  const [ffPending] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM exit_request er
     WHERE er.status IN (${FF_PENDING})
       AND ${LWD} < CURDATE() ${SC}`,
    scope.params
  );

  // F&F pending > 45 days
  const [ffOverdue] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM exit_request er
     WHERE er.status IN (${FF_PENDING})
       AND ${LWD} < DATE_SUB(CURDATE(), INTERVAL 45 DAY) ${SC}`,
    scope.params
  );

  // Avg clearance TAT (LWD to the last clearance task being cleared)
  const [clearanceTat] = await db.query<RowDataPacket[]>(
    `SELECT AVG(DATEDIFF(c.completed_at, ${LWD})) as avg_days
     FROM exit_request er
     JOIN (
       SELECT exit_request_id, MAX(cleared_at) AS completed_at
         FROM exit_clearance_task
        GROUP BY exit_request_id
       HAVING SUM(CASE WHEN status IN ('cleared', 'waived') THEN 0 ELSE 1 END) = 0
     ) c ON c.exit_request_id = er.id
     WHERE c.completed_at IS NOT NULL
       AND ${LWD} IS NOT NULL
       AND YEAR(${LWD}) = ? ${SC}`,
    [currentYear, ...scope.params]
  );

  // Exits by month (last 12 months)
  const [exitsByMonth] = await db.query<RowDataPacket[]>(
    `SELECT
       DATE_FORMAT(${LWD}, '%Y-%m') as month,
       COUNT(*) as count
     FROM exit_request er
     WHERE ${LWD} >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
       AND er.status NOT IN (${NOT_AN_EXIT}) ${SC}
     GROUP BY month
     ORDER BY month ASC`,
    scope.params
  );

  // F&F aging buckets
  const [ffAging] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN DATEDIFF(CURDATE(), ${LWD}) < 30 THEN 1 ELSE 0 END) as under_30,
       SUM(CASE WHEN DATEDIFF(CURDATE(), ${LWD}) BETWEEN 30 AND 45 THEN 1 ELSE 0 END) as bucket_30_45,
       SUM(CASE WHEN DATEDIFF(CURDATE(), ${LWD}) > 45 THEN 1 ELSE 0 END) as over_45
     FROM exit_request er
     WHERE er.status IN (${FF_PENDING})
       AND ${LWD} < CURDATE() ${SC}`,
    scope.params
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
