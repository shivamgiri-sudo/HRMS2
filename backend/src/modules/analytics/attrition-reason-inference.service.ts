/**
 * Attrition Reason Inference Service
 * File: backend/src/modules/analytics/attrition-reason-inference.service.ts
 * Purpose: Infer the likely reason an employee left (or would leave) from pre-exit
 *          behavioral signals. Exit reason is only captured for ~0.4% of exits, so
 *          we derive it from quality trends, attendance, PIP status, manager churn, etc.
 */

import { Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { db as pool } from '../../db/mysql.js';

type ReasonCode =
  | 'PERFORMANCE_EXIT'
  | 'BURNOUT'
  | 'MANAGER_DRIVEN'
  | 'BETTER_OFFER'
  | 'EARLY_ATTRITION'
  | 'TRAINING_DIFFICULTY'
  | 'SALARY_DISSATISFACTION'
  | 'WORK_LIFE'
  | 'UNKNOWN';

type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

interface InferenceResult {
  employee_code: string;
  employee_name: string;
  inferred_reason: ReasonCode;
  confidence: ConfidenceLevel;
  triggered_signals: string[];
  comparable_exits: number;
  aon_days: number;
  avg_quality: number | null;
  attendance_pct: number | null;
  late_marks_30d: number;
  ctc: number | null;
  is_on_pip: boolean;
  quality_declining: boolean;
  mode: string;
}

/**
 * Apply inference rules in priority order and return reason + confidence + signals.
 */
function applyInferenceRules(signals: {
  isOnPip: boolean;
  avgQuality: number | null;
  qualityDeclining: boolean;
  gradualDecline4w: boolean;
  attendancePct: number | null;
  aonDays: number;
  managerExitCount: number;
  qualityVolatility: number;
  isWalkIn: boolean;
  auditCount: number;
  ctc: number | null;
  lateMarks30d: number;
}): { reason: ReasonCode; confidence: ConfidenceLevel; triggered: string[] } {
  const {
    isOnPip, avgQuality, qualityDeclining, gradualDecline4w,
    attendancePct, aonDays, managerExitCount, qualityVolatility,
    isWalkIn, auditCount, ctc, lateMarks30d
  } = signals;

  // Rule 1 — PERFORMANCE_EXIT (HIGH): active PIP + quality < 65 + quality declining
  if (isOnPip && avgQuality !== null && avgQuality < 65 && qualityDeclining) {
    return {
      reason: 'PERFORMANCE_EXIT',
      confidence: 'HIGH',
      triggered: ['ACTIVE_PIP', 'QUALITY_BELOW_65', 'QUALITY_DECLINING']
    };
  }

  // Rule 2 — BURNOUT (HIGH): gradual quality decline 4+ weeks, avg < 75, attendance < 85, aon > 60
  if (gradualDecline4w && avgQuality !== null && avgQuality < 75
    && attendancePct !== null && attendancePct < 85 && aonDays > 60) {
    return {
      reason: 'BURNOUT',
      confidence: 'HIGH',
      triggered: ['GRADUAL_QUALITY_DECLINE_4W', 'AVG_QUALITY_BELOW_75', 'ATTENDANCE_BELOW_85', 'AON_ABOVE_60']
    };
  }

  // Rule 3 — MANAGER_DRIVEN (HIGH): manager had >= 3 exits in last 30 days
  if (managerExitCount >= 3) {
    return {
      reason: 'MANAGER_DRIVEN',
      confidence: 'HIGH',
      triggered: [`MANAGER_EXIT_COUNT_${managerExitCount}`]
    };
  }

  // Rule 4 — BETTER_OFFER (HIGH): stable quality (volatility < 10), good attendance (> 85%), aon > 90
  if (qualityVolatility < 10 && attendancePct !== null && attendancePct > 85 && aonDays > 90) {
    return {
      reason: 'BETTER_OFFER',
      confidence: 'HIGH',
      triggered: ['STABLE_QUALITY', 'GOOD_ATTENDANCE', 'AON_ABOVE_90']
    };
  }

  // Rule 5 — EARLY_ATTRITION (MEDIUM): walk-in source + aon <= 30 + attendance < 90
  if (isWalkIn && aonDays <= 30 && attendancePct !== null && attendancePct < 90) {
    return {
      reason: 'EARLY_ATTRITION',
      confidence: 'MEDIUM',
      triggered: ['WALK_IN_SOURCE', 'AON_BELOW_30', 'ATTENDANCE_BELOW_90']
    };
  }

  // Rule 6 — TRAINING_DIFFICULTY (MEDIUM): aon 31-90 + no quality data or avg < 70
  if (aonDays >= 31 && aonDays <= 90 && (auditCount === 0 || (avgQuality !== null && avgQuality < 70))) {
    const triggered = ['AON_31_TO_90'];
    if (auditCount === 0) triggered.push('NO_QUALITY_DATA');
    else triggered.push('LOW_QUALITY_BELOW_70');
    return { reason: 'TRAINING_DIFFICULTY', confidence: 'MEDIUM', triggered };
  }

  // Rule 7 — SALARY_DISSATISFACTION (MEDIUM): ctc < 12000 + aon > 90 + quality declining (not catastrophic)
  if (ctc !== null && ctc < 12000 && aonDays > 90 && qualityDeclining) {
    return {
      reason: 'SALARY_DISSATISFACTION',
      confidence: 'MEDIUM',
      triggered: ['CTC_BELOW_12000', 'AON_ABOVE_90', 'QUALITY_DECLINING']
    };
  }

  // Rule 8 — WORK_LIFE (MEDIUM): late_marks > 5 + quality declining + attendance < 90
  if (lateMarks30d > 5 && qualityDeclining && attendancePct !== null && attendancePct < 90) {
    return {
      reason: 'WORK_LIFE',
      confidence: 'MEDIUM',
      triggered: [`LATE_MARKS_${lateMarks30d}`, 'QUALITY_DECLINING', 'ATTENDANCE_BELOW_90']
    };
  }

  return { reason: 'UNKNOWN', confidence: 'LOW', triggered: [] };
}

/**
 * GET /api/analytics/attrition-reason-inference
 * Infer attrition reason for a single employee.
 * Query params: employeeId (id or employee_code), mode (realtime | historical)
 */
export async function inferAttritionReason(req: Request, res: Response) {
  try {
    const { employeeId, mode = 'realtime' } = req.query;
    if (!employeeId) {
      return res.status(400).json({ success: false, error: 'employeeId is required' });
    }

    // Base employee record
    const [empRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         e.id,
         e.employee_code,
         CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
         DATEDIFF(COALESCE(e.date_of_exit, NOW()), e.date_of_joining) AS aon_days,
         e.date_of_joining,
         e.date_of_exit,
         e.reporting_manager_id,
         COALESCE(e.gross_salary, e.ctc, 0) AS ctc,
         COALESCE(e.source_of_hire, '') AS source_of_hire,
         e.employment_status
       FROM employees e
       WHERE e.id = ? OR e.employee_code = ?
       LIMIT 1`,
      [employeeId, employeeId]
    );

    if (!empRows.length) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    const emp = empRows[0] as any;
    const isHistorical = mode === 'historical' && emp.date_of_exit != null;
    const referenceDate: Date = isHistorical ? new Date(emp.date_of_exit) : new Date();

    // Attendance signals (60-day window ending at referenceDate)
    const [attRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         ROUND(
           COUNT(DISTINCT CASE WHEN adr.attendance_status IN ('present', 'half_day') THEN adr.record_date END) /
           NULLIF(COUNT(DISTINCT adr.record_date), 0) * 100
         , 2) AS attendance_pct,
         COUNT(DISTINCT CASE
           WHEN adr.is_late = 1 AND adr.record_date >= DATE_SUB(?, INTERVAL 30 DAY)
           THEN adr.record_date
         END) AS late_marks_30d
       FROM attendance_daily_record adr
       WHERE adr.employee_id = ?
         AND adr.record_date BETWEEN DATE_SUB(?, INTERVAL 60 DAY) AND ?`,
      [referenceDate, emp.id, referenceDate, referenceDate]
    );

    const attData = (attRows[0] || {}) as any;
    const attendancePct: number | null = attData.attendance_pct != null ? Number(attData.attendance_pct) : null;
    const lateMarks30d: number = Number(attData.late_marks_30d ?? 0);

    // Quality signals (60-day window ending at referenceDate)
    const [qualRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         ROUND(AVG(cqa.quality_percentage), 2) AS avg_quality,
         ROUND(STDDEV(cqa.quality_percentage), 2) AS quality_volatility,
         COUNT(DISTINCT cqa.id) AS audit_count,
         ROUND(AVG(CASE WHEN cqa.CallDate >= DATE_SUB(?, INTERVAL 28 DAY) THEN cqa.quality_percentage END), 2) AS recent_quality,
         ROUND(AVG(CASE WHEN cqa.CallDate <  DATE_SUB(?, INTERVAL 28 DAY) THEN cqa.quality_percentage END), 2) AS prior_quality
       FROM db_audit.call_quality_assessment cqa
       WHERE cqa.User = ?
         AND cqa.CallDate BETWEEN DATE_SUB(?, INTERVAL 60 DAY) AND ?`,
      [referenceDate, referenceDate, emp.employee_code, referenceDate, referenceDate]
    );

    const qualData = (qualRows[0] || {}) as any;
    const avgQuality: number | null = qualData.avg_quality != null ? Number(qualData.avg_quality) : null;
    const qualityVolatility: number = Number(qualData.quality_volatility ?? 0);
    const auditCount: number = Number(qualData.audit_count ?? 0);
    const recentQ: number | null = qualData.recent_quality != null ? Number(qualData.recent_quality) : null;
    const priorQ: number | null = qualData.prior_quality != null ? Number(qualData.prior_quality) : null;
    const qualityDeclining = recentQ !== null && priorQ !== null && recentQ < priorQ;

    // Weekly quality trend for gradual-decline check (4+ week streak)
    const [weeklyRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         WEEK(cqa.CallDate, 1) AS week_num,
         YEAR(cqa.CallDate) AS year_num,
         ROUND(AVG(cqa.quality_percentage), 2) AS weekly_avg
       FROM db_audit.call_quality_assessment cqa
       WHERE cqa.User = ?
         AND cqa.CallDate BETWEEN DATE_SUB(?, INTERVAL 60 DAY) AND ?
       GROUP BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1)
       ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1)`,
      [emp.employee_code, referenceDate, referenceDate]
    );

    let gradualDecline4w = false;
    if (weeklyRows.length >= 4) {
      const weekAverages = weeklyRows.map(r => Number((r as any).weekly_avg));
      let streak = 0;
      for (let i = 1; i < weekAverages.length; i++) {
        if (weekAverages[i] < weekAverages[i - 1]) {
          streak++;
          if (streak >= 3) { gradualDecline4w = true; break; }
        } else {
          streak = 0;
        }
      }
    }

    // PIP check
    const [pipRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM pip_action_plan
       WHERE employee_id = ?
         AND status NOT IN ('closed', 'cancelled', 'completed')`,
      [emp.id]
    );
    const isOnPip = Number((pipRows[0] as any)?.cnt ?? 0) > 0;

    // Manager team exits in last 30 days (from NOW, not referenceDate, for realtime accuracy)
    const [mgrRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM employees
       WHERE reporting_manager_id = ?
         AND id != ?
         AND date_of_exit >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [emp.reporting_manager_id, emp.id]
    );
    const managerExitCount = Number((mgrRows[0] as any)?.cnt ?? 0);

    // Comparable exits: count of historical exits with same employment status
    const [compRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM employees WHERE date_of_exit IS NOT NULL AND id != ?`,
      [emp.id]
    );
    const comparableExits = Number((compRows[0] as any)?.cnt ?? 0);

    const aonDays = Number(emp.aon_days ?? 0);
    const ctc = emp.ctc ? Number(emp.ctc) : null;
    const srcHire = (emp.source_of_hire || '').toLowerCase();
    const isWalkIn = srcHire.includes('walk') || srcHire.includes('walkin');

    const { reason, confidence, triggered } = applyInferenceRules({
      isOnPip,
      avgQuality,
      qualityDeclining,
      gradualDecline4w,
      attendancePct,
      aonDays,
      managerExitCount,
      qualityVolatility,
      isWalkIn,
      auditCount,
      ctc,
      lateMarks30d
    });

    const result: InferenceResult = {
      employee_code: emp.employee_code,
      employee_name: emp.employee_name,
      inferred_reason: reason,
      confidence,
      triggered_signals: triggered,
      comparable_exits: comparableExits,
      aon_days: aonDays,
      avg_quality: avgQuality,
      attendance_pct: attendancePct,
      late_marks_30d: lateMarks30d,
      ctc,
      is_on_pip: isOnPip,
      quality_declining: qualityDeclining,
      mode: mode as string
    };

    res.json({
      success: true,
      analysis_type: 'ATTRITION_REASON_INFERENCE',
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in inferAttritionReason:', error);
    res.status(500).json({ success: false, error: 'Failed to infer attrition reason' });
  }
}

/**
 * GET /api/analytics/attrition-reason-inference/breakdown
 * Org-level breakdown of inferred attrition reasons for a given period.
 * Query params: period (YYYY-MM), branchId
 */
export async function getInferredReasonBreakdown(req: Request, res: Response) {
  try {
    const { period, branchId } = req.query;

    let periodStart: string;
    let periodEnd: string;

    if (period && typeof period === 'string' && /^\d{4}-\d{2}$/.test(period)) {
      const [yr, mo] = period.split('-').map(Number);
      periodStart = `${period}-01`;
      periodEnd = new Date(yr, mo, 0).toISOString().slice(0, 10);
    } else {
      const now = new Date();
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    }

    const branchClause = branchId ? 'AND e.branch_id = ?' : '';
    const baseParams: unknown[] = branchId
      ? [periodStart, periodEnd, branchId]
      : [periodStart, periodEnd];

    // Fetch all exited employees in period with pre-computed signal data
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
         e.id,
         e.employee_code,
         e.reporting_manager_id,
         DATEDIFF(e.date_of_exit, e.date_of_joining) AS aon_days,
         COALESCE(e.gross_salary, e.ctc, 0) AS ctc,
         COALESCE(e.source_of_hire, '') AS source_of_hire,
         e.date_of_exit,
         /* Attendance 60d pre-exit */
         ROUND(
           (SELECT COUNT(DISTINCT a1.record_date)
              FROM attendance_daily_record a1
             WHERE a1.employee_id = e.id
               AND a1.record_date BETWEEN DATE_SUB(e.date_of_exit, INTERVAL 60 DAY) AND e.date_of_exit
               AND a1.attendance_status IN ('present', 'half_day'))
           / NULLIF(
               (SELECT COUNT(DISTINCT a2.record_date)
                  FROM attendance_daily_record a2
                 WHERE a2.employee_id = e.id
                   AND a2.record_date BETWEEN DATE_SUB(e.date_of_exit, INTERVAL 60 DAY) AND e.date_of_exit)
             , 0) * 100
         , 2) AS attendance_pct,
         /* Late marks 30d pre-exit */
         (SELECT COUNT(DISTINCT a3.record_date)
            FROM attendance_daily_record a3
           WHERE a3.employee_id = e.id
             AND a3.is_late = 1
             AND a3.record_date BETWEEN DATE_SUB(e.date_of_exit, INTERVAL 30 DAY) AND e.date_of_exit
         ) AS late_marks_30d,
         /* Avg quality 60d pre-exit */
         (SELECT ROUND(AVG(cq1.quality_percentage), 2)
            FROM db_audit.call_quality_assessment cq1
           WHERE cq1.User = e.employee_code
             AND cq1.CallDate BETWEEN DATE_SUB(e.date_of_exit, INTERVAL 60 DAY) AND e.date_of_exit
         ) AS avg_quality,
         /* Quality volatility 60d pre-exit */
         (SELECT ROUND(STDDEV(cq2.quality_percentage), 2)
            FROM db_audit.call_quality_assessment cq2
           WHERE cq2.User = e.employee_code
             AND cq2.CallDate BETWEEN DATE_SUB(e.date_of_exit, INTERVAL 60 DAY) AND e.date_of_exit
         ) AS quality_volatility,
         /* Quality declining: recent 28d avg < prior 32d avg */
         CASE WHEN
           COALESCE(
             (SELECT ROUND(AVG(cq3.quality_percentage), 2)
                FROM db_audit.call_quality_assessment cq3
               WHERE cq3.User = e.employee_code
                 AND cq3.CallDate BETWEEN DATE_SUB(e.date_of_exit, INTERVAL 28 DAY) AND e.date_of_exit)
           , 999) <
           COALESCE(
             (SELECT ROUND(AVG(cq4.quality_percentage), 2)
                FROM db_audit.call_quality_assessment cq4
               WHERE cq4.User = e.employee_code
                 AND cq4.CallDate BETWEEN DATE_SUB(e.date_of_exit, INTERVAL 60 DAY)
                                     AND DATE_SUB(e.date_of_exit, INTERVAL 28 DAY))
           , 0)
         AND
           (SELECT COUNT(DISTINCT cq3b.id)
              FROM db_audit.call_quality_assessment cq3b
             WHERE cq3b.User = e.employee_code
               AND cq3b.CallDate BETWEEN DATE_SUB(e.date_of_exit, INTERVAL 28 DAY) AND e.date_of_exit) > 0
         THEN 1 ELSE 0 END AS quality_declining,
         /* Audit count 60d pre-exit */
         (SELECT COUNT(DISTINCT cq5.id)
            FROM db_audit.call_quality_assessment cq5
           WHERE cq5.User = e.employee_code
             AND cq5.CallDate BETWEEN DATE_SUB(e.date_of_exit, INTERVAL 60 DAY) AND e.date_of_exit
         ) AS audit_count,
         /* Active PIP at time of exit */
         (SELECT COUNT(*)
            FROM pip_action_plan pip
           WHERE pip.employee_id = e.id
             AND pip.status NOT IN ('closed', 'cancelled', 'completed')
             AND pip.created_at <= e.date_of_exit
         ) AS has_pip,
         /* Manager team exits in 30d before this employee's exit */
         (SELECT COUNT(*)
            FROM employees em2
           WHERE em2.reporting_manager_id = e.reporting_manager_id
             AND em2.id != e.id
             AND em2.date_of_exit BETWEEN DATE_SUB(e.date_of_exit, INTERVAL 30 DAY) AND e.date_of_exit
         ) AS manager_exit_count
       FROM employees e
       WHERE e.date_of_exit BETWEEN ? AND ?
         ${branchClause}
       ORDER BY e.date_of_exit`,
      baseParams
    );

    // Accumulate counts by inferred reason
    const reasonCounts: Record<ReasonCode, number> = {
      PERFORMANCE_EXIT: 0,
      BURNOUT: 0,
      MANAGER_DRIVEN: 0,
      BETTER_OFFER: 0,
      EARLY_ATTRITION: 0,
      TRAINING_DIFFICULTY: 0,
      SALARY_DISSATISFACTION: 0,
      WORK_LIFE: 0,
      UNKNOWN: 0
    };

    for (const emp of rows) {
      const r = emp as any;
      const aonDays = Number(r.aon_days ?? 0);
      const ctc = r.ctc ? Number(r.ctc) : null;
      const srcHire = (r.source_of_hire || '').toLowerCase();
      const isWalkIn = srcHire.includes('walk') || srcHire.includes('walkin');
      const attendancePct: number | null = r.attendance_pct != null ? Number(r.attendance_pct) : null;
      const avgQuality: number | null = r.avg_quality != null ? Number(r.avg_quality) : null;
      const qualityVolatility: number = Number(r.quality_volatility ?? 0);
      const qualityDeclining = Number(r.quality_declining) === 1;
      const auditCount = Number(r.audit_count ?? 0);
      const isOnPip = Number(r.has_pip) > 0;
      const managerExitCount = Number(r.manager_exit_count ?? 0);
      const lateMarks30d = Number(r.late_marks_30d ?? 0);

      // For bulk mode: approximate gradual decline as qualityDeclining (no per-employee week queries)
      const { reason } = applyInferenceRules({
        isOnPip,
        avgQuality,
        qualityDeclining,
        gradualDecline4w: qualityDeclining && avgQuality !== null && avgQuality < 75,
        attendancePct,
        aonDays,
        managerExitCount,
        qualityVolatility,
        isWalkIn,
        auditCount,
        ctc,
        lateMarks30d
      });

      reasonCounts[reason]++;
    }

    const totalExits = rows.length;
    const breakdown = (Object.entries(reasonCounts) as [ReasonCode, number][])
      .map(([inferred_reason, count]) => ({
        inferred_reason,
        count,
        pct: totalExits > 0 ? Math.round((count / totalExits) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      analysis_type: 'INFERRED_REASON_BREAKDOWN',
      period: { start: periodStart, end: periodEnd },
      total_exits: totalExits,
      breakdown,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getInferredReasonBreakdown:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch inferred reason breakdown' });
  }
}
