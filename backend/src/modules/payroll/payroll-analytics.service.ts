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

// Every query here used to name a table that does not exist (salary_disputes,
// reimbursement_claims, attendance, cosec_sync_log, roster, tds_deadlines, tds_filings,
// tds_projections, exit_requests) and the endpoint raised ER_NO_SUCH_TABLE. Mapped onto the
// tables the modules actually write:
//
//   salary disputes     -> salary_dispute. Its status is the two-stage review FSM, not
//                          open/in_review/resolved:
//                            open      = pending_wfm            (waiting for the first reviewer)
//                            in_review = pending_payroll_head   (WFM done, payroll head deciding)
//                            resolved  = approved / rejected / closed / arrear_pending
//                          'draft' is not raised yet and is not counted. There is no
//                          resolved_date column; the decision time is the payroll head's
//                          review, else the WFM review (a WFM rejection ends there).
//                          Resolved figures cover the last 12 payroll months (run_month).
//   reimbursements      -> employee_reimbursement_claim (the payroll claim flow; reimbursement_claim
//                          is the separate benefits module). Pending = submitted / manager_approved /
//                          branch_head_approved, aged from submitted_at.
//   payroll readiness   -> the current calendar month, as a share of active employees:
//                            attendance = has attendance_daily_record rows this month (up to
//                                         yesterday) and none still unreconciled / missing_punch
//                            cosec      = at least one of those days carries biometric minutes,
//                                         i.e. the COSEC feed reached the attendance record
//                                         (there is no per-employee sync log)
//                            roster     = has a published wfm_roster_assignment row this month
//                                         (published is the locked state; draft is editable)
//   TDS filed / due     -> quarterly_return_obligation (Form 24Q / 138 per quarter)
//   TDS projections     -> tax_declaration.tds_projected for the current financial year
//   gratuity accrued    -> gratuity_accrual_ledger, cumulative_accrual at the latest accrual month
//   gratuity eligible   -> active employees with five or more years since date_of_joining
//   F&F                 -> exit_request, same definitions as exit-analytics.service.ts
//
// Nothing in this summary is empty by design: every field reads a real table. Tables that
// hold no rows yet simply report 0 / null / false.
const DISPUTE_RESOLVED = "'approved', 'rejected', 'closed', 'arrear_pending'";
const DISPUTE_DECIDED_AT = "COALESCE(payroll_head_reviewed_at, wfm_reviewed_at, updated_at)";
const CLAIM_PENDING = "'submitted', 'manager_approved', 'branch_head_approved'";
const CLAIM_AGE = "DATEDIFF(CURDATE(), COALESCE(submitted_at, created_at))";
const ATTENDANCE_OPEN = "'unreconciled', 'missing_punch'";
const ROSTER_PUBLISHED = "'published', 'approved_final'";
const MONTH_START = "DATE_FORMAT(CURDATE(), '%Y-%m-01')";
const LWD = "COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed)";
const FF_PENDING = "'clearance_pending', 'fnf_pending'";

const num = (value: unknown): number => Number(value ?? 0) || 0;
const pct = (part: unknown, whole: unknown): number =>
  num(whole) > 0 ? Math.round((num(part) / num(whole)) * 100) : 0;

/** India's financial year starts on 1 April; tax_declaration stores it as 'YYYY-YYYY' or 'YYYY-YY'. */
function currentFinancialYearAliases(now: Date): [string, string] {
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return [`${start}-${start + 1}`, `${start}-${String(start + 1).slice(-2)}`];
}

export async function getPayrollAnalyticsSummary(): Promise<PayrollAnalyticsSummary> {
  // Salary disputes — the open queue (status index), whatever its age
  const [disputeQueue] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(status = 'pending_wfm') as open_count,
       SUM(status = 'pending_payroll_head') as in_review
     FROM salary_dispute
     WHERE status IN ('pending_wfm', 'pending_payroll_head')`
  );

  // Salary disputes — decided, for the last 12 payroll months (run_month index)
  const [disputeResolved] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) as resolved,
       AVG(DATEDIFF(${DISPUTE_DECIDED_AT}, created_at)) as avg_resolution_days
     FROM salary_dispute
     WHERE run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m')
       AND status IN (${DISPUTE_RESOLVED})`
  );

  // Reimbursement backlog
  const [reimbursement] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) as total_pending,
       SUM(CASE WHEN ${CLAIM_AGE} < 7 THEN 1 ELSE 0 END) as under_7,
       SUM(CASE WHEN ${CLAIM_AGE} BETWEEN 7 AND 15 THEN 1 ELSE 0 END) as between_7_15,
       SUM(CASE WHEN ${CLAIM_AGE} > 15 THEN 1 ELSE 0 END) as over_15
     FROM employee_reimbursement_claim
     WHERE status IN (${CLAIM_PENDING})`
  );

  // Payroll readiness (current month). Both hot tables are read once, for this month only,
  // through their date indexes, and collapsed to one row per employee before the join.
  const [readiness] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) as active_employees,
       SUM(CASE WHEN a.employee_id IS NOT NULL AND a.open_days = 0 THEN 1 ELSE 0 END) as attendance_finalized,
       SUM(CASE WHEN a.cosec_days > 0 THEN 1 ELSE 0 END) as cosec_synced,
       SUM(CASE WHEN r.employee_id IS NOT NULL THEN 1 ELSE 0 END) as roster_locked
     FROM employees e
     LEFT JOIN (
       SELECT employee_id,
              SUM(attendance_status IN (${ATTENDANCE_OPEN})) AS open_days,
              SUM(biometric_minutes > 0) AS cosec_days
         FROM attendance_daily_record
        WHERE record_date >= ${MONTH_START}
          AND record_date < CURDATE()
        GROUP BY employee_id
     ) a ON a.employee_id = e.id
     LEFT JOIN (
       SELECT DISTINCT employee_id
         FROM wfm_roster_assignment
        WHERE roster_date >= ${MONTH_START}
          AND roster_date < DATE_ADD(${MONTH_START}, INTERVAL 1 MONTH)
          AND publish_status IN (${ROSTER_PUBLISHED})
     ) r ON r.employee_id = e.id
     WHERE e.active_status = 1`
  );

  const activeEmployees = readiness[0]?.active_employees;
  const attendanceFinalized = pct(readiness[0]?.attendance_finalized, activeEmployees);
  const cosecSynced = pct(readiness[0]?.cosec_synced, activeEmployees);
  const rosterLocked = pct(readiness[0]?.roster_locked, activeEmployees);
  const overallReadiness = Math.round((attendanceFinalized + cosecSynced + rosterLocked) / 3);

  // TDS status — quarterly returns
  const [tdsFiled] = await db.query<RowDataPacket[]>(
    `SELECT financial_year_start, quarter
     FROM quarterly_return_obligation
     WHERE status = 'filed'
     ORDER BY financial_year_start DESC, quarter DESC
     LIMIT 1`
  );

  const [tdsDue] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(MIN(due_date), '%Y-%m-%d') as next_deadline
     FROM quarterly_return_obligation
     WHERE status = 'pending'
       AND due_date >= CURDATE()`
  );

  const [tdsProjections] = await db.query<RowDataPacket[]>(
    `SELECT 1 as ready
     FROM tax_declaration
     WHERE financial_year IN (?, ?)
     LIMIT 1`,
    currentFinancialYearAliases(new Date())
  );

  const filed = tdsFiled[0];
  const lastFiledQuarter = filed
    ? `${filed.quarter} FY ${num(filed.financial_year_start)}-${String(num(filed.financial_year_start) + 1).slice(-2)}`
    : null;

  // Gratuity liability — cumulative accrual as at the latest accrual month in the ledger
  const [gratuityAccrued] = await db.query<RowDataPacket[]>(
    `SELECT SUM(g.cumulative_accrual) as total_accrued
     FROM gratuity_accrual_ledger g
     WHERE g.accrual_month = (SELECT MAX(accrual_month) FROM gratuity_accrual_ledger)`
  );

  const [gratuityEligible] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as eligible_count
     FROM employees
     WHERE active_status = 1
       AND date_of_joining <= DATE_SUB(CURDATE(), INTERVAL 5 YEAR)`
  );

  // F&F settlement
  const [ffSettlement] = await db.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) as pending_count,
       AVG(DATEDIFF(CURDATE(), ${LWD})) as avg_tat_days,
       SUM(CASE WHEN DATEDIFF(CURDATE(), ${LWD}) > 45 THEN 1 ELSE 0 END) as overdue_count
     FROM exit_request er
     WHERE er.status IN (${FF_PENDING})
       AND ${LWD} < CURDATE()`
  );

  return {
    salary_disputes: {
      open: num(disputeQueue[0]?.open_count),
      in_review: num(disputeQueue[0]?.in_review),
      resolved: num(disputeResolved[0]?.resolved),
      avg_resolution_days: Math.round(num(disputeResolved[0]?.avg_resolution_days)),
    },
    reimbursement_backlog: {
      total_pending: num(reimbursement[0]?.total_pending),
      under_7_days: num(reimbursement[0]?.under_7),
      "7_to_15_days": num(reimbursement[0]?.between_7_15),
      over_15_days: num(reimbursement[0]?.over_15),
    },
    payroll_readiness: {
      attendance_finalized_pct: attendanceFinalized,
      cosec_synced_pct: cosecSynced,
      roster_locked_pct: rosterLocked,
      overall_readiness_pct: overallReadiness,
    },
    tds_status: {
      last_filed_quarter: lastFiledQuarter,
      next_deadline: tdsDue[0]?.next_deadline ?? null,
      projections_ready: tdsProjections.length > 0,
    },
    gratuity_liability: {
      total_accrued: num(gratuityAccrued[0]?.total_accrued),
      employees_eligible_this_year: num(gratuityEligible[0]?.eligible_count),
    },
    ff_settlement: {
      pending_count: num(ffSettlement[0]?.pending_count),
      avg_tat_days: Math.round(num(ffSettlement[0]?.avg_tat_days)),
      overdue_count: num(ffSettlement[0]?.overdue_count),
    },
  };
}
