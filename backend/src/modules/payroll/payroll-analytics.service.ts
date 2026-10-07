/**
 * Payroll Analytics Service — Payroll Dashboard Metrics
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

interface PayrollAnalyticsSummary {
  salary_disputes: {
    open: number;
    in_review: number;
    resolved: number;
    avg_resolution_days: number;
  };
  reimbursement_backlog: {
    total_pending: number;
    under_7_days: number;
    "7_to_15_days": number;
    over_15_days: number;
  };
  payroll_readiness: {
    attendance_finalized_pct: number;
    cosec_synced_pct: number;
    roster_locked_pct: number;
    overall_readiness_pct: number;
  };
  tds_status: {
    last_filed_quarter: string | null;
    next_deadline: string | null;
    projections_ready: boolean;
  };
  gratuity_liability: {
    total_accrued: number;
    employees_eligible_this_year: number;
  };
  ff_settlement: {
    pending_count: number;
    avg_tat_days: number;
    overdue_count: number;
  };
}

export async function getPayrollAnalyticsSummary(): Promise<PayrollAnalyticsSummary> {
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Salary disputes
  const [disputes] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
       SUM(CASE WHEN status = 'in_review' THEN 1 ELSE 0 END) as in_review,
       SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
       AVG(CASE WHEN status = 'resolved' THEN DATEDIFF(resolved_date, created_date) END) as avg_resolution_days
     FROM salary_disputes`,
  );

  // Reimbursement backlog
  const [reimbursement] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) as total_pending,
       SUM(CASE WHEN DATEDIFF(CURDATE(), submission_date) < 7 THEN 1 ELSE 0 END) as under_7,
       SUM(CASE WHEN DATEDIFF(CURDATE(), submission_date) BETWEEN 7 AND 15 THEN 1 ELSE 0 END) as between_7_15,
       SUM(CASE WHEN DATEDIFF(CURDATE(), submission_date) > 15 THEN 1 ELSE 0 END) as over_15
     FROM reimbursement_claims
     WHERE status IN ('pending', 'submitted')`,
  );

  // Payroll readiness (current month)
  const [readiness] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(DISTINCT CASE WHEN a.status IS NOT NULL THEN e.id END) * 100.0 / COUNT(DISTINCT e.id) as attendance_finalized_pct,
       COUNT(DISTINCT CASE WHEN c.synced_at IS NOT NULL THEN e.id END) * 100.0 / COUNT(DISTINCT e.id) as cosec_synced_pct,
       COUNT(DISTINCT CASE WHEN r.lock_status = 'locked' THEN e.id END) * 100.0 / COUNT(DISTINCT e.id) as roster_locked_pct
     FROM employees e
     LEFT JOIN attendance a ON e.id = a.employee_id
       AND DATE_FORMAT(a.attendance_date, '%Y-%m') = ?
     LEFT JOIN cosec_sync_log c ON e.id = c.employee_id
       AND DATE_FORMAT(c.synced_at, '%Y-%m') = ?
     LEFT JOIN roster r ON e.id = r.employee_id
       AND DATE_FORMAT(r.roster_date, '%Y-%m') = ?
       AND r.status = 'published'
     WHERE e.status = 'active'`,
    [currentMonth, currentMonth, currentMonth],
  );

  const attendanceFinalized = readiness[0]?.attendance_finalized_pct ?? 0;
  const cosecSynced = readiness[0]?.cosec_synced_pct ?? 0;
  const rosterLocked = readiness[0]?.roster_locked_pct ?? 0;
  const overallReadiness = Math.round(
    (attendanceFinalized + cosecSynced + rosterLocked) / 3,
  );

  // TDS status
  const [tds] = await db.query<RowDataPacket[]>(
    `SELECT
       MAX(quarter) as last_filed_quarter,
       (SELECT deadline FROM tds_deadlines WHERE deadline > CURDATE() ORDER BY deadline ASC LIMIT 1) as next_deadline
     FROM tds_filings
     WHERE status = 'filed'`,
  );

  const [tdsProjections] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count
     FROM tds_projections
     WHERE financial_year = YEAR(CURDATE())`,
  );

  // Gratuity liability
  const [gratuity] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(gratuity_accrued) as total_accrued,
       COUNT(*) as eligible_count
     FROM employees
     WHERE status = 'active'
       AND DATEDIFF(CURDATE(), date_of_joining) / 365 >= 5`,
  );

  // F&F settlement
  const [ffSettlement] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) as pending_count,
       AVG(DATEDIFF(CURDATE(), e.lwd)) as avg_tat_days,
       SUM(CASE WHEN DATEDIFF(CURDATE(), e.lwd) > 45 THEN 1 ELSE 0 END) as overdue_count
     FROM exit_requests e
     WHERE e.status IN ('clearance_pending', 'clearance_in_progress', 'f&f_pending')`,
  );

  return {
    salary_disputes: {
      open: disputes[0]?.open_count ?? 0,
      in_review: disputes[0]?.in_review ?? 0,
      resolved: disputes[0]?.resolved ?? 0,
      avg_resolution_days: Math.round(
        Number(disputes[0]?.avg_resolution_days ?? 0),
      ),
    },
    reimbursement_backlog: {
      total_pending: reimbursement[0]?.total_pending ?? 0,
      under_7_days: reimbursement[0]?.under_7 ?? 0,
      "7_to_15_days": reimbursement[0]?.between_7_15 ?? 0,
      over_15_days: reimbursement[0]?.over_15 ?? 0,
    },
    payroll_readiness: {
      attendance_finalized_pct: Math.round(attendanceFinalized),
      cosec_synced_pct: Math.round(cosecSynced),
      roster_locked_pct: Math.round(rosterLocked),
      overall_readiness_pct: overallReadiness,
    },
    tds_status: {
      last_filed_quarter: tds[0]?.last_filed_quarter ?? null,
      next_deadline: tds[0]?.next_deadline ?? null,
      projections_ready: (tdsProjections[0]?.count ?? 0) > 0,
    },
    gratuity_liability: {
      total_accrued: Number(gratuity[0]?.total_accrued ?? 0),
      employees_eligible_this_year: gratuity[0]?.eligible_count ?? 0,
    },
    ff_settlement: {
      pending_count: ffSettlement[0]?.pending_count ?? 0,
      avg_tat_days: Math.round(Number(ffSettlement[0]?.avg_tat_days ?? 0)),
      overdue_count: ffSettlement[0]?.overdue_count ?? 0,
    },
  };
}
