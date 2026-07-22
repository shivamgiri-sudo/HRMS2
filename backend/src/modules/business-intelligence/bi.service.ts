import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { querySource } from '../../db/sourceDb.js';
import { getLegacyPool } from '../../db/legacyDb.js';
import { getIstDateString, getIstMonthStart } from '../../utils/dateUtils.js';
import { getPolicyValue } from '../policy-engine/policy-engine.cache.js';

export interface InterventionFlag {
  type: string;
  severity: 'critical' | 'warning' | 'info';
  detail: string;
  action: string;
}

// ─── 3a: Daily Operations Pulse ──────────────────────────────────────────────

export interface DailyOpsPulse {
  date: string;
  agents_scheduled: number;
  agents_logged_in: number;
  login_adherence_pct: number;
  avg_calls_per_agent: number;
  total_calls: number;
  avg_aht_seconds: number;
  avg_shrinkage_pct: number;
  shrinkage_breakdown: { lunch: number; bio: number; training: number; qa: number; idle: number };
  top_process: { name: string; calls: number; agent_count: number } | null;
  intervention_flags: InterventionFlag[];
}

export async function getDailyOpsPulse(targetDate?: string, branchIds?: string[], processIds?: string[]): Promise<DailyOpsPulse> {
  const date = targetDate || getIstDateString(0);
  // branchIds/processIds accepted for future scoped queries; currently the apr table
  // does not carry branch_id so the main APR aggregation remains org-wide.

  // Query synced apr table for the given date
  const [aprRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(DISTINCT a.UserID) AS agents_logged_in,
       SUM(a.Calls) AS total_calls,
       ROUND(AVG(TIME_TO_SEC(a.AHT)), 0) AS avg_aht_seconds,
       ROUND(AVG(TIME_TO_SEC(IFNULL(a.LUNCH,'00:00:00'))) / NULLIF(TIME_TO_SEC(IFNULL(a.Login_Time,'00:00:00')),0) * 100, 2) AS avg_lunch_pct,
       ROUND(AVG(TIME_TO_SEC(IFNULL(a.BIO,'00:00:00'))) / NULLIF(TIME_TO_SEC(IFNULL(a.Login_Time,'00:00:00')),0) * 100, 2) AS avg_bio_pct,
       ROUND(AVG(TIME_TO_SEC(IFNULL(a.TRAINING,'00:00:00'))) / NULLIF(TIME_TO_SEC(IFNULL(a.Login_Time,'00:00:00')),0) * 100, 2) AS avg_training_pct,
       ROUND(AVG(TIME_TO_SEC(IFNULL(a.QA,'00:00:00'))) / NULLIF(TIME_TO_SEC(IFNULL(a.Login_Time,'00:00:00')),0) * 100, 2) AS avg_qa_pct,
       ROUND(AVG(
         CASE WHEN TIME_TO_SEC(IFNULL(a.Login_Time,'00:00:00')) > 0 THEN
           (TIME_TO_SEC(IFNULL(a.BIO,'00:00:00')) + TIME_TO_SEC(IFNULL(a.LUNCH,'00:00:00')) +
            TIME_TO_SEC(IFNULL(a.QA,'00:00:00')) + TIME_TO_SEC(IFNULL(a.TRAINING,'00:00:00')))
           / TIME_TO_SEC(IFNULL(a.Login_Time,'00:00:00')) * 100
         ELSE 0 END
       ), 2) AS avg_shrinkage_pct
     FROM apr a
     WHERE DATE(a.ReportDate) = ?`,
    [date]
  ).catch(() => [[null]] as any);

  // Scheduled agents from attendance records — scoped to branch/process when provided
  const attendScopeClause = branchIds && branchIds.length > 0
    ? ` AND employee_id IN (SELECT id FROM employees WHERE branch_id IN (${branchIds.map(() => "?").join(",")}) AND active_status = 1)`
    : processIds && processIds.length > 0
    ? ` AND employee_id IN (SELECT id FROM employees WHERE process_id IN (${processIds.map(() => "?").join(",")}) AND active_status = 1)`
    : "";
  const attendScopeParams = branchIds && branchIds.length > 0 ? branchIds : processIds && processIds.length > 0 ? processIds : [];
  const [attendRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT employee_id) AS scheduled
     FROM attendance_daily_record
     WHERE record_date = ?${attendScopeClause}`,
    [date, ...attendScopeParams]
  ).catch(() => [[{ scheduled: 0 }]] as any);

  const aprRow = (aprRows as any[])[0] ?? {};
  const totalCalls = Number(aprRow.total_calls ?? 0);
  const agentsLoggedIn = Number(aprRow.agents_logged_in ?? 0);
  const agentsScheduled = Number((attendRows as any[])[0]?.scheduled ?? agentsLoggedIn);
  const loginAdherence = agentsScheduled > 0 ? parseFloat(((agentsLoggedIn / agentsScheduled) * 100).toFixed(1)) : 0;
  const avgCalls = agentsLoggedIn > 0 ? Math.round(totalCalls / agentsLoggedIn) : 0;
  const avgAht = Number(aprRow.avg_aht_seconds ?? 0);
  const avgShrinkage = parseFloat(String(aprRow.avg_shrinkage_pct ?? 0));
  const lunchPct = parseFloat(String(aprRow.avg_lunch_pct ?? 0));
  const bioPct = parseFloat(String(aprRow.avg_bio_pct ?? 0));
  const trainingPct = parseFloat(String(aprRow.avg_training_pct ?? 0));
  const qaPct = parseFloat(String(aprRow.avg_qa_pct ?? 0));
  const idlePct = Math.max(0, parseFloat((avgShrinkage - lunchPct - bioPct - trainingPct - qaPct).toFixed(2)));

  // Top process by calls
  const [topProcRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(pm.process_name, a.campaign_id) AS name,
            SUM(a.Calls) AS calls,
            COUNT(DISTINCT a.UserID) AS agent_count
     FROM apr a
     LEFT JOIN process_master pm ON pm.process_code = a.campaign_id
     WHERE DATE(a.ReportDate) = ?
     GROUP BY a.campaign_id
     ORDER BY calls DESC
     LIMIT 1`,
    [date]
  ).catch(() => [[null]] as any);
  const topProc = (topProcRows as any[])[0] ?? null;

  // Load thresholds from policy engine
  const [loginCrit, loginWarn, shrinkCrit, shrinkWarn, ahtBench] = await Promise.all([
    getPolicyValue('rta',        'login_adherence', 'critical_threshold_pct', '50'),
    getPolicyValue('rta',        'login_adherence', 'warning_threshold_pct',  '70'),
    getPolicyValue('operations', 'shrinkage',       'critical_threshold_pct', '25'),
    getPolicyValue('operations', 'shrinkage',       'warning_threshold_pct',  '18'),
    getPolicyValue('operations', 'call_quality',    'aht_benchmark_seconds',  '400'),
  ]);
  const T = {
    loginCritical:  Number(loginCrit),
    loginWarning:   Number(loginWarn),
    shrinkCritical: Number(shrinkCrit),
    shrinkWarning:  Number(shrinkWarn),
    ahtBenchmark:   Number(ahtBench),
  };

  // Build intervention flags
  const flags: InterventionFlag[] = [];
  if (loginAdherence < T.loginCritical && agentsScheduled > 0) {
    flags.push({
      type: 'LOW_LOGIN_ADHERENCE', severity: 'critical',
      detail: `Login adherence at ${loginAdherence}% — ${agentsScheduled - agentsLoggedIn} agents scheduled but not logged in`,
      action: 'Floor check required — contact team leads immediately',
    });
  } else if (loginAdherence < T.loginWarning && agentsScheduled > 0) {
    flags.push({
      type: 'LOW_LOGIN_ADHERENCE', severity: 'warning',
      detail: `Login adherence at ${loginAdherence}% — ${agentsScheduled - agentsLoggedIn} agents below expected`,
      action: 'Send login reminders to late arrivals',
    });
  }
  if (avgShrinkage > T.shrinkCritical) {
    flags.push({
      type: 'HIGH_SHRINKAGE', severity: 'critical',
      detail: `Avg shrinkage at ${avgShrinkage}% — exceeds ${T.shrinkCritical}% org threshold`,
      action: 'Review break schedules and bio patterns immediately',
    });
  } else if (avgShrinkage > T.shrinkWarning) {
    flags.push({
      type: 'HIGH_SHRINKAGE', severity: 'warning',
      detail: `Avg shrinkage at ${avgShrinkage}% — above ${T.shrinkWarning}% advisory limit`,
      action: 'Monitor floor — check DISMX/DSTBY codes by campaign',
    });
  }
  if (avgAht > T.ahtBenchmark) {
    flags.push({
      type: 'HIGH_AHT', severity: 'warning',
      detail: `Avg AHT at ${Math.round(avgAht)}s — above ${T.ahtBenchmark}s benchmark`,
      action: 'Pull agent-level AHT breakdown and run QA check',
    });
  }

  return {
    date, agents_scheduled: agentsScheduled, agents_logged_in: agentsLoggedIn,
    login_adherence_pct: loginAdherence, avg_calls_per_agent: avgCalls,
    total_calls: totalCalls, avg_aht_seconds: avgAht, avg_shrinkage_pct: avgShrinkage,
    shrinkage_breakdown: { lunch: lunchPct, bio: bioPct, training: trainingPct, qa: qaPct, idle: idlePct },
    top_process: topProc ? { name: String(topProc.name), calls: Number(topProc.calls), agent_count: Number(topProc.agent_count) } : null,
    intervention_flags: flags,
  };
}

// ─── 3b: Attrition Risk Signal ────────────────────────────────────────────────

export interface AttritionRiskSignal {
  summary: { total_at_risk: number; consecutive_absent: number; pending_resignations: number; high_lms_risk: number; churn_rate_30d: number };
  top_risk_employees: Array<{ employee_code: string; employee_name: string; risk_reasons: string[]; branch?: string; process?: string }>;
  intervention_flags: InterventionFlag[];
}

export async function getAttritionRiskSignal(branchId?: string, processId?: string): Promise<AttritionRiskSignal> {
  const whereParts: string[] = ['e.active_status = 1'];
  const params: unknown[] = [];
  if (branchId) { whereParts.push('e.branch_id = ?'); params.push(branchId); }
  if (processId) { whereParts.push('e.process_id = ?'); params.push(processId); }
  const empWhere = whereParts.join(' AND ');

  const fromDate = getIstDateString(30);
  const toDate = getIstDateString(0);

  // Consecutive 3+ day absentees
  const [absRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code,
            COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
            COUNT(*) AS absent_days,
            bm.branch_name, pm.process_name
     FROM attendance_daily_record adr
     JOIN employees e ON e.id = adr.employee_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     LEFT JOIN process_master pm ON pm.id = e.process_id
     WHERE adr.attendance_status = 'absent'
       AND adr.record_date BETWEEN ? AND ?
       AND ${empWhere}
     GROUP BY e.id, e.employee_code, employee_name, bm.branch_name, pm.process_name
     HAVING absent_days >= 3
     ORDER BY absent_days DESC
     LIMIT 20`,
    [fromDate, toDate, ...params]
  ).catch(() => [[] as any]);

  // Pending resignations
  const [resignRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM exit_request er
     JOIN employees e ON e.id = er.employee_id
     WHERE er.exit_status NOT IN ('completed','cancelled')
       AND ${empWhere}`,
    params
  ).catch(() => [[{ cnt: 0 }]] as any);

  // LMS high risk
  const [lmsRiskRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM lms_learner_progress lp
     JOIN employees e ON e.id = lp.employee_id
     WHERE lp.attrition_risk_signal = 'red' AND lp.ops_handover_ready = 0
       AND ${empWhere}`,
    params
  ).catch(() => [[{ cnt: 0 }]] as any);

  // Churn rate last 30 days
  const [churnRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS exits FROM exit_request er
     JOIN employees e ON e.id = er.employee_id
     WHERE er.exit_status = 'completed'
       AND er.updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       AND ${empWhere}`,
    params
  ).catch(() => [[{ exits: 0 }]] as any);

  const [totalEmpRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM employees e WHERE ${empWhere}`,
    params
  ).catch(() => [[{ total: 1 }]] as any);

  const consecutiveAbsent = (absRows as any[]).length;
  const pendingResignations = Number((resignRows as any[])[0]?.cnt ?? 0);
  const highLmsRisk = Number((lmsRiskRows as any[])[0]?.cnt ?? 0);
  const exits = Number((churnRows as any[])[0]?.exits ?? 0);
  const totalEmp = Math.max(Number((totalEmpRows as any[])[0]?.total ?? 1), 1);
  const churnRate30d = parseFloat(((exits / totalEmp) * 100).toFixed(2));
  const totalAtRisk = new Set([
    ...(absRows as any[]).map((r: any) => r.employee_code),
  ]).size + pendingResignations + highLmsRisk;

  // Build top risk list
  const topRisk = (absRows as any[]).slice(0, 10).map((r: any) => ({
    employee_code: r.employee_code,
    employee_name: r.employee_name,
    risk_reasons: [`${r.absent_days} absences in last 30 days`],
    branch: r.branch_name,
    process: r.process_name,
  }));

  const flags: InterventionFlag[] = [];
  if (churnRate30d > 5) {
    flags.push({
      type: 'HIGH_CHURN', severity: 'critical',
      detail: `${churnRate30d}% churn in last 30 days (${exits} exits)`,
      action: 'Escalate to HR head — retention interviews required',
    });
  }
  if (consecutiveAbsent > 10) {
    flags.push({
      type: 'MASS_ABSENTEEISM', severity: 'warning',
      detail: `${consecutiveAbsent} employees with 3+ consecutive absences`,
      action: 'Team leads to conduct 1-on-1 check-ins this week',
    });
  }
  if (pendingResignations > 5) {
    flags.push({
      type: 'HIGH_RESIGNATION', severity: 'warning',
      detail: `${pendingResignations} active resignations pending discussion`,
      action: 'HR to prioritize exit interviews and counter-offer review',
    });
  }

  return {
    summary: { total_at_risk: totalAtRisk, consecutive_absent: consecutiveAbsent, pending_resignations: pendingResignations, high_lms_risk: highLmsRisk, churn_rate_30d: churnRate30d },
    top_risk_employees: topRisk,
    intervention_flags: flags,
  };
}

// ─── 3c: Payroll Exposure Summary ────────────────────────────────────────────

export interface PayrollExposureSummary {
  period: string;
  gross_liability: number;
  net_disbursable: number;
  pending_runs: number;
  outstanding_loan_recovery: number;
  unclaimed_incentives: number;
  ff_pending_amount: number;
  intervention_flags: InterventionFlag[];
}

export async function getPayrollExposureSummary(): Promise<PayrollExposureSummary> {
  const monthStart = getIstMonthStart();

  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(gross_pay),0) AS gross_liability,
            COALESCE(SUM(net_pay),0) AS net_disbursable,
            COUNT(DISTINCT run_id) AS run_count
     FROM salary_prep_line spl
     JOIN salary_prep_run spr ON spr.id = spl.run_id
     WHERE spr.run_month >= ? AND spr.status != 'cancelled'`,
    [monthStart]
  ).catch(() => [[{ gross_liability: 0, net_disbursable: 0, run_count: 0 }]] as any);

  const [incentiveRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(total_amount),0) AS unclaimed FROM incentive_upload_batch WHERE batch_status = 'approved' AND disbursed_at IS NULL`
  ).catch(() => [[{ unclaimed: 0 }]] as any);

  const [ffRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(net_payable_to_employee),0) AS ff_pending FROM ff_settlement WHERE status NOT IN ('paid','cancelled')`
  ).catch(() => [[{ ff_pending: 0 }]] as any);

  // Loan recovery from legacy db_bill (best-effort)
  let loanRecovery = 0;
  try {
    const legacyPool = await getLegacyPool();
    const [loanRows] = await legacyPool.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(PendingAmount),0) AS outstanding FROM LoanMaster WHERE LoanStatus = 'Active'`
    );
    loanRecovery = Number((loanRows as any[])[0]?.outstanding ?? 0);
  } catch { /* legacy DB unavailable */ }

  const rRow = (runRows as any[])[0] ?? {};
  const grossLiability = Number(rRow.gross_liability ?? 0);
  const netDisbursable = Number(rRow.net_disbursable ?? 0);
  const pendingRuns = Number(rRow.run_count ?? 0);
  const unclaimedIncentives = Number((incentiveRows as any[])[0]?.unclaimed ?? 0);
  const ffPending = Number((ffRows as any[])[0]?.ff_pending ?? 0);

  const flags: InterventionFlag[] = [];
  if (pendingRuns === 0) {
    flags.push({
      type: 'NO_PAYROLL_RUN', severity: 'warning',
      detail: 'No payroll runs found for current month',
      action: 'Verify payroll calendar — initiate run if not scheduled',
    });
  }
  if (ffPending > 0) {
    flags.push({
      type: 'FF_PENDING', severity: 'info',
      detail: `₹${ffPending.toLocaleString('en-IN')} in F&F settlements pending disbursement`,
      action: 'Finance to process pending F&F payments',
    });
  }

  return {
    period: monthStart.slice(0, 7),
    gross_liability: grossLiability,
    net_disbursable: netDisbursable,
    pending_runs: pendingRuns,
    outstanding_loan_recovery: loanRecovery,
    unclaimed_incentives: unclaimedIncentives,
    ff_pending_amount: ffPending,
    intervention_flags: flags,
  };
}

// ─── 3d: Training Readiness Pulse ────────────────────────────────────────────

export interface TrainingReadinessPulse {
  summary: { total_learners: number; certified_pct: number; at_risk_count: number; avg_completion_pct: number; avg_score: number; overdue_count: number };
  by_process: Array<{ process: string; total: number; certified: number; certified_pct: number; at_risk: number; avg_score: number }>;
  critical_agents: Array<{ employee_code: string; employee_name: string; risk_level: string; completion_pct: number; last_active?: string }>;
  intervention_flags: InterventionFlag[];
}

export async function getTrainingReadinessPulse(branchId?: string, processId?: string): Promise<TrainingReadinessPulse> {
  const whereParts: string[] = ['e.active_status = 1'];
  const params: unknown[] = [];
  if (branchId) { whereParts.push('e.branch_id = ?'); params.push(branchId); }
  if (processId) { whereParts.push('e.process_id = ?'); params.push(processId); }
  const empWhere = whereParts.join(' AND ');

  const [summaryRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(DISTINCT lp.employee_id) AS total_learners,
       ROUND(SUM(CASE WHEN lp.certification_status = 'Certified' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*),0), 1) AS certified_pct,
       SUM(CASE WHEN lp.attrition_risk_signal = 'red' THEN 1 ELSE 0 END) AS at_risk_count,
       ROUND(AVG(lp.completion_pct), 1) AS avg_completion_pct,
       ROUND(AVG(lp.mcq_best_score), 1) AS avg_score,
       SUM(CASE WHEN lp.last_updated < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS overdue_count
     FROM lms_learner_progress lp
     JOIN employees e ON e.id = lp.employee_id
     WHERE ${empWhere}`,
    params
  ).catch(() => [[null]] as any);

  const [byProcessRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(pm.process_name, 'Unknown') AS process,
            COUNT(DISTINCT lp.employee_id) AS total,
            SUM(CASE WHEN lp.certification_status = 'Certified' THEN 1 ELSE 0 END) AS certified,
            ROUND(SUM(CASE WHEN lp.certification_status = 'Certified' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*),0), 1) AS certified_pct,
            SUM(CASE WHEN lp.attrition_risk_signal = 'red' THEN 1 ELSE 0 END) AS at_risk,
            ROUND(AVG(lp.mcq_best_score), 1) AS avg_score
     FROM lms_learner_progress lp
     JOIN employees e ON e.id = lp.employee_id
     LEFT JOIN process_master pm ON pm.id = e.process_id
     WHERE ${empWhere}
     GROUP BY e.process_id
     ORDER BY total DESC
     LIMIT 20`,
    params
  ).catch(() => [[] as any]);

  const [criticalRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code,
            COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
            lp.attrition_risk_signal AS risk_level,
            COALESCE(lp.completion_pct, 0) AS completion_pct,
            DATE_FORMAT(lp.last_updated, '%Y-%m-%d') AS last_active
     FROM lms_learner_progress lp
     JOIN employees e ON e.id = lp.employee_id
     WHERE lp.attrition_risk_signal IN ('red','amber')
       AND lp.certification_status != 'Certified'
       AND ${empWhere}
     ORDER BY lp.attrition_risk_signal DESC, lp.completion_pct ASC
     LIMIT 15`,
    params
  ).catch(() => [[] as any]);

  const s = (summaryRows as any[])[0] ?? {};
  const certifiedPct = Number(s.certified_pct ?? 0);
  const atRisk = Number(s.at_risk_count ?? 0);

  const flags: InterventionFlag[] = [];
  if (certifiedPct < 60) {
    flags.push({
      type: 'LOW_CERTIFICATION', severity: 'critical',
      detail: `Only ${certifiedPct}% of learners certified — below 60% threshold`,
      action: 'Trainer to review curriculum bottleneck and MCQ pass rates',
    });
  }
  if (atRisk > 5) {
    flags.push({
      type: 'HIGH_LMS_RISK', severity: 'warning',
      detail: `${atRisk} learners flagged red attrition risk by LMS`,
      action: 'Assign dedicated trainer support to flagged learners',
    });
  }

  return {
    summary: {
      total_learners: Number(s.total_learners ?? 0),
      certified_pct: certifiedPct,
      at_risk_count: atRisk,
      avg_completion_pct: Number(s.avg_completion_pct ?? 0),
      avg_score: Number(s.avg_score ?? 0),
      overdue_count: Number(s.overdue_count ?? 0),
    },
    by_process: (byProcessRows as any[]).map((r: any) => ({
      process: r.process, total: Number(r.total), certified: Number(r.certified),
      certified_pct: Number(r.certified_pct), at_risk: Number(r.at_risk), avg_score: Number(r.avg_score),
    })),
    critical_agents: (criticalRows as any[]).map((r: any) => ({
      employee_code: r.employee_code, employee_name: r.employee_name,
      risk_level: r.risk_level, completion_pct: Number(r.completion_pct), last_active: r.last_active,
    })),
    intervention_flags: flags,
  };
}

// ─── 3e: Revenue at Risk ──────────────────────────────────────────────────────

export interface RevenueAtRisk {
  period: string;
  target: number;
  actual: number;
  gap: number;
  gap_pct: number;
  days_elapsed: number;
  days_remaining: number;
  daily_run_rate: number;
  projected_eom: number;
  by_process: Array<{ process: string; target: number; actual: number; gap: number; gap_pct: number }>;
  intervention_flags: InterventionFlag[];
}

export async function getRevenueAtRisk(): Promise<RevenueAtRisk> {
  const today = getIstDateString(0);
  const monthStart = getIstMonthStart();
  const [y, m] = monthStart.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const dayOfMonth = parseInt(today.slice(8), 10);
  const daysElapsed = dayOfMonth;
  const daysRemaining = daysInMonth - dayOfMonth;

  let target = 0, actual = 0;
  const byProcess: RevenueAtRisk['by_process'] = [];

  try {
    const legacyPool = await getLegacyPool();

    // Monthly target
    const [targetRows] = await legacyPool.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(TargetRevenue),0) AS total_target
       FROM dashboard_target_revenue
       WHERE YEAR(TargetMonth) = ? AND MONTH(TargetMonth) = ?`,
      [y, m]
    );
    target = Number((targetRows as any[])[0]?.total_target ?? 0);

    // MTD actual
    const [actualRows] = await legacyPool.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(ActualRevenue),0) AS total_actual
       FROM dashboard_data_revenue
       WHERE RevenueDate BETWEEN ? AND ?`,
      [monthStart, today]
    );
    actual = Number((actualRows as any[])[0]?.total_actual ?? 0);

    // By process
    const [processRows] = await legacyPool.execute<RowDataPacket[]>(
      `SELECT t.ProcessName AS process,
              COALESCE(SUM(t.TargetRevenue),0) AS target,
              COALESCE(SUM(a.ActualRevenue),0) AS actual
       FROM dashboard_target_revenue t
       LEFT JOIN dashboard_data_revenue a
         ON a.ProcessName = t.ProcessName
         AND a.RevenueDate BETWEEN ? AND ?
       WHERE YEAR(t.TargetMonth) = ? AND MONTH(t.TargetMonth) = ?
       GROUP BY t.ProcessName
       ORDER BY target DESC
       LIMIT 10`,
      [monthStart, today, y, m]
    );
    for (const r of processRows as any[]) {
      const tgt = Number(r.target), act = Number(r.actual);
      const gap = act - tgt;
      byProcess.push({ process: r.process, target: tgt, actual: act, gap, gap_pct: tgt > 0 ? parseFloat(((gap / tgt) * 100).toFixed(1)) : 0 });
    }
  } catch { /* legacy DB unavailable — return zeroes */ }

  const gap = actual - target;
  const gapPct = target > 0 ? parseFloat(((gap / target) * 100).toFixed(1)) : 0;
  const dailyRunRate = daysElapsed > 0 ? Math.round(actual / daysElapsed) : 0;
  const projectedEom = dailyRunRate * daysInMonth;

  const flags: InterventionFlag[] = [];
  if (gapPct < -15) {
    flags.push({
      type: 'REVENUE_DEFICIT', severity: 'critical',
      detail: `${Math.abs(gapPct)}% below MTD target — projected shortfall ${((projectedEom - target) / 1000).toFixed(0)}K`,
      action: 'Ops + Sales review required — escalate high-gap processes',
    });
  } else if (gapPct < -5) {
    flags.push({
      type: 'REVENUE_BELOW_TARGET', severity: 'warning',
      detail: `MTD revenue ${Math.abs(gapPct)}% below target`,
      action: 'Focus on high-revenue processes to recover gap this week',
    });
  }

  return {
    period: monthStart.slice(0, 7), target, actual, gap, gap_pct: gapPct,
    days_elapsed: daysElapsed, days_remaining: daysRemaining,
    daily_run_rate: dailyRunRate, projected_eom: projectedEom,
    by_process: byProcess, intervention_flags: flags,
  };
}

// ─── 3f: Quality Intervention ────────────────────────────────────────────────

export interface QualityIntervention {
  summary: { avg_quality_score: number; agents_below_threshold: number; processes_declining: number };
  critical_agents: Array<{ agent_code: string; agent_name: string; call_count: number; quality_score: number; campaign: string }>;
  process_rag: Array<{ process: string; avg_score: number; rag: 'red' | 'amber' | 'green'; wow_change: number }>;
  intervention_flags: InterventionFlag[];
}

function auditRag(score: number): 'red' | 'amber' | 'green' {
  if (score >= 90) return 'green';
  if (score >= 85) return 'amber';
  return 'red';
}

export async function getQualityIntervention(branchId?: string, processId?: string): Promise<QualityIntervention> {
  const fromDate = getIstDateString(7);
  const toDate = getIstDateString(0);
  const prevFromDate = getIstDateString(14);
  const prevToDate = getIstDateString(8);

  // ── Overall summary from db_audit.call_quality_assessment ────────────────
  interface SummaryRow { avg_score: number; total_agents: number; below_threshold: number }
  const summaryRows = await querySource<SummaryRow>(`
    SELECT
      ROUND(AVG(quality_percentage), 1)                                              AS avg_score,
      COUNT(DISTINCT User)                                                            AS total_agents,
      COUNT(DISTINCT CASE WHEN avg_per_agent < 85 THEN agent END)                   AS below_threshold
    FROM (
      SELECT User AS agent, ROUND(AVG(quality_percentage), 1) AS avg_per_agent
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ?
        AND quality_percentage IS NOT NULL
      GROUP BY User
      HAVING COUNT(*) >= 2
    ) t
    CROSS JOIN (
      SELECT ROUND(AVG(quality_percentage), 1) AS avg_score
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ?
        AND quality_percentage IS NOT NULL
    ) g
  `, [fromDate, toDate, fromDate, toDate]).catch(() => [] as SummaryRow[]);

  const avgScore = Number(summaryRows[0]?.avg_score ?? 0);
  const belowThreshold = Number(summaryRows[0]?.below_threshold ?? 0);

  // ── Bottom agents (min 3 audits, ordered by lowest quality_percentage) ───
  interface AgentRow { agent_code: string; agent_name: string; call_count: number; avg_score: number; client_id: string }
  const agentRows = await querySource<AgentRow>(`
    SELECT
      q.User                                                 AS agent_code,
      COALESCE(am.AgentName, q.User)                        AS agent_name,
      COUNT(*)                                               AS call_count,
      ROUND(AVG(q.quality_percentage), 1)                   AS avg_score,
      q.ClientId                                             AS client_id
    FROM db_audit.call_quality_assessment q
    LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
    WHERE q.CallDate BETWEEN ? AND ?
      AND q.quality_percentage IS NOT NULL
      AND q.User IS NOT NULL AND TRIM(q.User) != ''
    GROUP BY q.User, am.AgentName, q.ClientId
    HAVING call_count >= 3
    ORDER BY avg_score ASC
    LIMIT 10
  `, [fromDate, toDate]).catch(() => [] as AgentRow[]);

  // ── Per-client/process RAG with WoW change ────────────────────────────────
  interface ProcRow { process: string; avg_score: number }
  const [currProcRows, prevProcRows] = await Promise.all([
    querySource<ProcRow>(`
      SELECT
        q.ClientId                           AS process,
        ROUND(AVG(q.quality_percentage), 1)  AS avg_score
      FROM db_audit.call_quality_assessment q
      WHERE q.CallDate BETWEEN ? AND ?
        AND q.quality_percentage IS NOT NULL
      GROUP BY q.ClientId
      ORDER BY avg_score ASC
      LIMIT 15
    `, [fromDate, toDate]).catch(() => [] as ProcRow[]),
    querySource<ProcRow>(`
      SELECT
        q.ClientId                           AS process,
        ROUND(AVG(q.quality_percentage), 1)  AS avg_score
      FROM db_audit.call_quality_assessment q
      WHERE q.CallDate BETWEEN ? AND ?
        AND q.quality_percentage IS NOT NULL
      GROUP BY q.ClientId
      ORDER BY avg_score ASC
      LIMIT 15
    `, [prevFromDate, prevToDate]).catch(() => [] as ProcRow[]),
  ]);

  const prevMap = new Map(prevProcRows.map(r => [String(r.process), Number(r.avg_score)]));
  const processRag = currProcRows.map(r => {
    const score = Number(r.avg_score);
    const prev = prevMap.get(String(r.process)) ?? score;
    return {
      process: String(r.process),
      avg_score: score,
      rag: auditRag(score),
      wow_change: parseFloat((score - prev).toFixed(1)),
    };
  });

  const redProcesses = processRag.filter(p => p.rag === 'red').length;
  const decliningProcesses = processRag.filter(p => p.wow_change < -2).length;

  const flags: InterventionFlag[] = [];
  if (avgScore > 0 && avgScore < 85) {
    flags.push({
      type: 'LOW_ORG_QUALITY', severity: 'critical',
      detail: `Org-wide quality at ${avgScore}% — below 85% threshold`,
      action: 'QA team to prioritise coaching queue immediately',
    });
  }
  if (redProcesses > 2) {
    flags.push({
      type: 'MULTI_PROCESS_QUALITY_DROP', severity: 'critical',
      detail: `${redProcesses} client processes in RED quality zone (<85%)`,
      action: 'QA review call — assign TL coaching this week',
    });
  }
  if (belowThreshold > 5) {
    flags.push({
      type: 'AGENTS_BELOW_THRESHOLD', severity: 'warning',
      detail: `${belowThreshold} agents with avg quality below 85%`,
      action: 'Schedule targeted coaching sessions for flagged agents',
    });
  }

  return {
    summary: {
      avg_quality_score: avgScore,
      agents_below_threshold: belowThreshold,
      processes_declining: decliningProcesses,
    },
    critical_agents: agentRows.map(r => ({
      agent_code: String(r.agent_code),
      agent_name: String(r.agent_name),
      call_count: Number(r.call_count),
      quality_score: Number(r.avg_score),
      campaign: String(r.client_id),
    })),
    process_rag: processRag,
    intervention_flags: flags,
  };
}
