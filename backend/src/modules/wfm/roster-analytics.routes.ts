/**
 * Roster Analytics Routes — Phase 2
 *
 * APIs for shrinkage intelligence, quality correlation, and cost impact.
 */
import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getWeeklyShrinkageIntelligence,
  getQualityAdherenceCorrelation,
  getCostOfNonAdherence,
  getShrinkageForecast,
} from './roster-analytics.service.js';

const router = Router();

router.use(requireAuth);

const ANALYTICS_ROLES = ['super_admin', 'admin', 'hr', 'wfm', 'branch_head', 'operations_manager', 'ceo', 'coo'];

/**
 * GET /api/roster-analytics/shrinkage-intelligence/:branchId
 * Weekly shrinkage breakdown with cost impact, patterns, and manager ranking
 */
router.get('/shrinkage-intelligence/:branchId', requireRole(...ANALYTICS_ROLES), async (req, res) => {
  try {
    const { branchId } = req.params;

    // Default to start of current week (Monday)
    let weekStart = req.query.weekStart ? String(req.query.weekStart) : undefined;
    if (!weekStart) {
      const d = new Date();
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day);
      weekStart = d.toISOString().slice(0, 10);
    }

    const data = await getWeeklyShrinkageIntelligence(branchId, weekStart);
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-analytics] shrinkage-intelligence error:', msg);
    res.status(500).json({ error: `Failed to get shrinkage intelligence: ${msg}` });
  }
});

/**
 * GET /api/roster-analytics/quality-correlation
 * Correlation between attendance and quality scores
 */
router.get('/quality-correlation', requireRole(...ANALYTICS_ROLES), async (req, res) => {
  try {
    // Default to previous month
    let period = req.query.period ? String(req.query.period) : undefined;
    if (!period) {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const processId = req.query.processId ? String(req.query.processId) : undefined;

    const data = await getQualityAdherenceCorrelation(period, branchId, processId);
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-analytics] quality-correlation error:', msg);
    res.status(500).json({ error: `Failed to get quality correlation: ${msg}` });
  }
});

/**
 * GET /api/roster-analytics/cost-impact
 * Cost of non-adherence with breakdown and projections
 */
router.get('/cost-impact', requireRole(...ANALYTICS_ROLES), async (req, res) => {
  try {
    // Default to previous month
    let period = req.query.period ? String(req.query.period) : undefined;
    if (!period) {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const processId = req.query.processId ? String(req.query.processId) : undefined;

    const data = await getCostOfNonAdherence(period, branchId, processId);
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-analytics] cost-impact error:', msg);
    res.status(500).json({ error: `Failed to get cost impact: ${msg}` });
  }
});

/**
 * GET /api/roster-analytics/forecast/:branchId
 * Shrinkage forecast for next week based on historical patterns
 */
router.get('/forecast/:branchId', requireRole(...ANALYTICS_ROLES), async (req, res) => {
  try {
    const { branchId } = req.params;
    const data = await getShrinkageForecast(branchId);
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-analytics] forecast error:', msg);
    res.status(500).json({ error: `Failed to get forecast: ${msg}` });
  }
});

/**
 * GET /api/roster-analytics/summary
 * High-level summary for dashboard cards
 */
router.get('/summary', requireRole(...ANALYTICS_ROLES), async (req, res) => {
  try {
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;

    // Current week shrinkage
    const d = new Date();
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    const weekStart = d.toISOString().slice(0, 10);

    // Previous month for cost
    const pm = new Date();
    pm.setMonth(pm.getMonth() - 1);
    const period = `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, '0')}`;

    const results: Record<string, unknown> = {};

    if (branchId) {
      const shrinkage = await getWeeklyShrinkageIntelligence(branchId, weekStart);
      results.currentWeekShrinkage = {
        pct: shrinkage.breakdown.total.pct,
        budgetPct: shrinkage.budgetPct,
        variance: shrinkage.varianceFromBudget,
        trend: shrinkage.trendVsPrevWeek,
      };

      const cost = await getCostOfNonAdherence(period, branchId);
      results.monthCostImpact = {
        hoursLost: cost.metrics.hoursLost,
        costINR: cost.metrics.directCostLossINR,
        annualProjection: cost.projectedAnnual.currentTrend,
      };

      const forecast = await getShrinkageForecast(branchId);
      results.nextWeekForecast = {
        predictedPct: forecast.nextWeek.predictedShrinkagePct,
        confidence: forecast.nextWeek.confidence,
        riskDays: forecast.nextWeek.riskDays.length,
      };
    }

    const quality = await getQualityAdherenceCorrelation(period, branchId);
    results.qualityCorrelation = {
      coefficient: quality.correlation.coefficient,
      interpretation: quality.correlation.interpretation,
      insight: quality.correlation.insight,
    };

    res.json(results);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-analytics] summary error:', msg);
    res.status(500).json({ error: `Failed to get summary: ${msg}` });
  }
});

// ── Phase 4: Employee Roster Profile ─────────────────────────────────────────

/**
 * GET /api/roster-analytics/employee-profile/:employeeId
 * Individual employee's roster adherence history and patterns
 */
router.get('/employee-profile/:employeeId', requireRole(...ANALYTICS_ROLES, 'manager', 'process_manager'), async (req, res) => {
  try {
    const { employeeId } = req.params;
    const period = req.query.period ? String(req.query.period) : undefined;

    // Get employee basic info
    const { db } = await import('../../db/mysql.js');
    const [empRows] = await db.execute<any[]>(
      `SELECT e.id, e.employee_code, e.full_name,
              COALESCE(dm.designation_name, '') AS designation,
              p.process_name, b.branch_name, e.reporting_manager_id,
              m.full_name AS manager_name, e.date_of_joining,
              DATEDIFF(NOW(), e.date_of_joining) AS aon_days
       FROM employees e
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
       LEFT JOIN process_master p ON e.process_id = p.id
       LEFT JOIN branch_master b ON e.branch_id = b.id
       LEFT JOIN employees m ON e.reporting_manager_id = m.id
       WHERE e.id = ?`,
      [employeeId]
    );

    if (empRows.length === 0) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    const emp = empRows[0];

    // Get current month adherence
    const currentMonth = period || new Date().toISOString().slice(0, 7);
    const [adherenceRows] = await db.execute<any[]>(
      `SELECT
         COUNT(*) AS planned,
         SUM(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') THEN 1 ELSE 0 END) AS present,
         SUM(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') AND adr.late_mark = 0 THEN 1 ELSE 0 END) AS on_time,
         SUM(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') AND adr.late_mark > 0 THEN 1 ELSE 0 END) AS late,
         SUM(CASE WHEN ra.is_week_off = 0 AND COALESCE(adr.attendance_status,'') NOT IN ('present','half_day') THEN 1 ELSE 0 END) AS absent,
         0 AS incomplete
       FROM roster_assignment ra
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       WHERE ra.employee_id = ? AND DATE_FORMAT(ra.roster_date, '%Y-%m') = ?`,
      [employeeId, currentMonth]
    );

    const currentPeriod = {
      month: currentMonth,
      planned: adherenceRows[0]?.planned ?? 0,
      present: adherenceRows[0]?.present ?? 0,
      adherencePct: adherenceRows[0]?.planned > 0
        ? Math.round((adherenceRows[0].present / adherenceRows[0].planned) * 100)
        : 0,
      onTime: adherenceRows[0]?.on_time ?? 0,
      late: adherenceRows[0]?.late ?? 0,
      absent: adherenceRows[0]?.absent ?? 0,
      incomplete: adherenceRows[0]?.incomplete ?? 0,
    };

    // Get 6-month trend
    const [trendRows] = await db.execute<any[]>(
      `SELECT
         DATE_FORMAT(ra.roster_date, '%Y-%m') AS month,
         COUNT(*) AS planned,
         SUM(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') THEN 1 ELSE 0 END) AS present,
         SUM(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') AND adr.late_mark = 0 THEN 1 ELSE 0 END) AS on_time,
         SUM(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') AND adr.late_mark > 0 THEN 1 ELSE 0 END) AS late,
         SUM(CASE WHEN ra.is_week_off = 0 AND COALESCE(adr.attendance_status,'') NOT IN ('present','half_day') THEN 1 ELSE 0 END) AS absent
       FROM roster_assignment ra
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       WHERE ra.employee_id = ?
         AND ra.roster_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(ra.roster_date, '%Y-%m')
       ORDER BY month`,
      [employeeId]
    );

    const trend = trendRows.map((r: any) => ({
      month: r.month,
      adherencePct: r.planned > 0 ? Math.round((r.present / r.planned) * 100) : 0,
      onTimePct: r.present > 0 ? Math.round((r.on_time / r.present) * 100) : 0,
      latePct: r.present > 0 ? Math.round((r.late / r.present) * 100) : 0,
      absentPct: r.planned > 0 ? Math.round((r.absent / r.planned) * 100) : 0,
    }));

    // Day-of-week pattern
    const [dayRows] = await db.execute<any[]>(
      `SELECT
         DAYNAME(ra.roster_date) AS day_name,
         COUNT(*) AS total,
         SUM(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') THEN 1 ELSE 0 END) AS present
       FROM roster_assignment ra
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       WHERE ra.employee_id = ?
         AND ra.roster_date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
       GROUP BY DAYNAME(ra.roster_date), DAYOFWEEK(ra.roster_date)
       ORDER BY DAYOFWEEK(ra.roster_date)`,
      [employeeId]
    );

    const avgAdherence = dayRows.length > 0
      ? dayRows.reduce((s: number, r: any) => s + (r.total > 0 ? (r.present / r.total) * 100 : 0), 0) / dayRows.length
      : 0;

    const dayOfWeekPattern = dayRows.map((r: any) => {
      const adherencePct = r.total > 0 ? Math.round((r.present / r.total) * 100) : 0;
      return {
        day: r.day_name,
        totalRostered: r.total,
        adherencePct,
        isWeakDay: adherencePct < avgAdherence - 5,
      };
    });

    // Shift pattern
    const [shiftRows] = await db.execute<any[]>(
      `SELECT
         sm.shift_name,
         COUNT(*) AS total,
         SUM(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') THEN 1 ELSE 0 END) AS present
       FROM roster_assignment ra
       JOIN wfm_shift_master sm ON ra.shift_template_id = sm.id
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       WHERE ra.employee_id = ?
         AND ra.roster_date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
       GROUP BY sm.id, sm.shift_name`,
      [employeeId]
    );

    const shiftPattern = shiftRows.map((r: any) => ({
      shiftName: r.shift_name,
      totalRostered: r.total,
      adherencePct: r.total > 0 ? Math.round((r.present / r.total) * 100) : 0,
    }));

    // Team and branch comparison
    const [compRows] = await db.execute<any[]>(
      `SELECT
         (SELECT AVG(CASE WHEN adr2.attendance_status IN ('present','half_day') THEN 1 ELSE 0 END) * 100
          FROM attendance_daily_record adr2
          JOIN employees et ON et.id = adr2.employee_id
          WHERE et.reporting_manager_id = ?
            AND DATE_FORMAT(adr2.record_date, '%Y-%m') = ?) AS team_avg,
         (SELECT AVG(CASE WHEN adr3.attendance_status IN ('present','half_day') THEN 1 ELSE 0 END) * 100
          FROM attendance_daily_record adr3
          JOIN employees eb ON eb.id = adr3.employee_id
          WHERE eb.branch_id = (SELECT branch_id FROM employees WHERE id = ?)
            AND DATE_FORMAT(adr3.record_date, '%Y-%m') = ?) AS branch_avg`,
      [emp.reporting_manager_id || employeeId, currentMonth, employeeId, currentMonth]
    );

    const comparison = {
      teamAvg: Math.round(compRows[0]?.team_avg ?? currentPeriod.adherencePct),
      branchAvg: Math.round(compRows[0]?.branch_avg ?? currentPeriod.adherencePct),
      employeePct: currentPeriod.adherencePct,
      vsTeam: currentPeriod.adherencePct - Math.round(compRows[0]?.team_avg ?? currentPeriod.adherencePct),
      vsBranch: currentPeriod.adherencePct - Math.round(compRows[0]?.branch_avg ?? currentPeriod.adherencePct),
    };

    // Risk signals (simplified)
    const riskSignals: { tier: string | null; score: number | null; signals: string[] } = {
      tier: null,
      score: null,
      signals: [],
    };

    if (currentPeriod.adherencePct < 75) {
      riskSignals.signals.push('Low attendance adherence (<75%)');
    }
    if (currentPeriod.late > 5) {
      riskSignals.signals.push(`Frequent late arrivals (${currentPeriod.late} in current month)`);
    }
    if (emp.aon_days <= 30) {
      riskSignals.signals.push('New joiner (< 30 days)');
    }

    if (riskSignals.signals.length >= 2) {
      riskSignals.tier = 'HIGH';
      riskSignals.score = 65;
    } else if (riskSignals.signals.length === 1) {
      riskSignals.tier = 'MEDIUM';
      riskSignals.score = 45;
    }

    // Recent interventions
    const [interventionRows] = await db.execute<any[]>(
      `SELECT id, generated_at AS date,
              JSON_UNQUOTE(JSON_EXTRACT(recommendations, '$[0].action')) AS action,
              outcome
       FROM employee_retention_recommendation
       WHERE employee_id = ?
       ORDER BY generated_at DESC
       LIMIT 5`,
      [employeeId]
    );

    res.json({
      employee: {
        id: emp.id,
        employeeCode: emp.employee_code,
        fullName: emp.full_name,
        designation: emp.designation,
        processName: emp.process_name,
        branchName: emp.branch_name,
        managerId: emp.reporting_manager_id,
        managerName: emp.manager_name,
        dateOfJoining: emp.date_of_joining,
        aonDays: emp.aon_days,
      },
      currentPeriod,
      trend,
      dayOfWeekPattern,
      shiftPattern,
      comparison,
      riskSignals,
      recentInterventions: interventionRows.map((r: any) => ({
        id: r.id,
        date: r.date,
        action: r.action || 'Retention intervention',
        outcome: r.outcome || 'pending',
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-analytics] employee-profile error:', msg);
    res.status(500).json({ error: `Failed to get employee profile: ${msg}` });
  }
});

// ── Phase 5: Shift Effectiveness & Break Compliance ──────────────────────────

/**
 * GET /api/roster-analytics/shift-effectiveness
 * Shift-wise adherence comparison with break compliance
 */
router.get('/shift-effectiveness', requireRole(...ANALYTICS_ROLES), async (req, res) => {
  try {
    const { db } = await import('../../db/mysql.js');
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const processId = req.query.processId ? String(req.query.processId) : undefined;

    let whereClause = 'WHERE ra.roster_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
    const params: string[] = [];

    if (branchId) {
      whereClause += ' AND e.branch_id = ?';
      params.push(branchId);
    }
    if (processId) {
      whereClause += ' AND e.process_id = ?';
      params.push(processId);
    }

    const [rows] = await db.execute<any[]>(
      `SELECT
         sm.id AS shift_id,
         sm.shift_name,
         CONCAT(TIME_FORMAT(sm.start_time, '%H:%i'), ' - ', TIME_FORMAT(sm.end_time, '%H:%i')) AS shift_time,
         CASE WHEN HOUR(sm.start_time) >= 20 OR HOUR(sm.start_time) < 6 THEN 'NIGHT'
              WHEN HOUR(sm.start_time) >= 14 THEN 'EVENING' ELSE 'MORNING' END AS shift_type,
         COUNT(DISTINCT ra.employee_id) AS total_employees,
         AVG(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') THEN 100 ELSE 0 END) AS adherence_pct,
         AVG(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') AND adr.late_mark = 0 THEN 100 ELSE 0 END) AS on_time_pct,
         AVG(COALESCE(qa.quality_percentage, 0)) AS quality_avg,
         30 AS break_budget,
         AVG(COALESCE(wb.total_break_minutes, 30)) AS avg_break_minutes
       FROM roster_assignment ra
       JOIN employees e ON ra.employee_id = e.id
       JOIN wfm_shift_master sm ON ra.shift_template_id = sm.id
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       LEFT JOIN (
         SELECT employee_id, DATE(punch_date) AS d, AVG(quality_percentage) AS quality_percentage
         FROM call_quality_assessment GROUP BY employee_id, DATE(punch_date)
       ) qa ON ra.employee_id = qa.employee_id AND ra.roster_date = qa.d
       LEFT JOIN (
         SELECT employee_id, session_date, SUM(break_duration_minutes) AS total_break_minutes
         FROM wfm_break_log GROUP BY employee_id, session_date
       ) wb ON ra.employee_id = wb.employee_id AND ra.roster_date = wb.session_date
       ${whereClause}
       GROUP BY sm.id, sm.shift_name, sm.start_time, sm.end_time
       ORDER BY adherence_pct DESC`,
      params
    );

    const shifts = rows.map((r: any, i: number) => ({
      shiftId: r.shift_id,
      shiftName: r.shift_name,
      shiftTime: r.shift_time,
      shiftType: r.shift_type || 'MORNING',
      totalEmployees: r.total_employees,
      metrics: {
        adherencePct: Math.round(r.adherence_pct ?? 0),
        onTimePct: Math.round(r.on_time_pct ?? 0),
        qualityAvg: Math.round(r.quality_avg ?? 0),
        breakCompliancePct: r.break_budget > 0
          ? Math.round(Math.min(100, (r.break_budget / Math.max(r.avg_break_minutes, 1)) * 100))
          : 100,
        avgBreakMinutes: Math.round(r.avg_break_minutes ?? r.break_budget ?? 30),
        breakBudget: r.break_budget ?? 30,
        productivityScore: Math.round(((r.adherence_pct ?? 0) * 0.4 + (r.quality_avg ?? 0) * 0.4 + (r.on_time_pct ?? 0) * 0.2)),
      },
      trend: { adherence: 0, quality: 0 },
      rank: i + 1,
      isOptimal: i === 0,
    }));

    res.json({ shifts });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-analytics] shift-effectiveness error:', msg);
    res.status(500).json({ error: `Failed to get shift effectiveness: ${msg}` });
  }
});

/**
 * GET /api/roster-analytics/break-compliance
 * Break compliance tracking
 */
router.get('/break-compliance', requireRole(...ANALYTICS_ROLES), async (req, res) => {
  try {
    const { db } = await import('../../db/mysql.js');
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;

    let branchFilter = '';
    const params: string[] = [];
    if (branchId) {
      branchFilter = 'AND e.branch_id = ?';
      params.push(branchId);
    }

    // Overall break compliance
    const [overallRows] = await db.execute<any[]>(
      `SELECT
         COUNT(*) AS total_sessions,
         AVG(wb.total_break) AS avg_break,
         30 AS budget,
         SUM(CASE WHEN wb.total_break > 30 THEN 1 ELSE 0 END) AS over_break,
         SUM(CASE WHEN wb.total_break < 15 THEN 1 ELSE 0 END) AS under_break
       FROM (
         SELECT employee_id, session_date, SUM(break_duration_minutes) AS total_break
         FROM wfm_break_log WHERE session_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         GROUP BY employee_id, session_date
       ) wb
       JOIN employees e ON wb.employee_id = e.id
       JOIN roster_assignment ra ON wb.employee_id = ra.employee_id AND wb.session_date = ra.roster_date
       WHERE 1=1 ${branchFilter}`,
      params
    );

    const overall = {
      compliancePct: overallRows[0]?.budget > 0
        ? Math.round(Math.min(100, (overallRows[0].budget / Math.max(overallRows[0].avg_break, 1)) * 100))
        : 90,
      avgBreakMinutes: Math.round(overallRows[0]?.avg_break ?? 30),
      budgetMinutes: Math.round(overallRows[0]?.budget ?? 30),
      overBreakCount: overallRows[0]?.over_break ?? 0,
      underBreakCount: overallRows[0]?.under_break ?? 0,
    };

    // By shift
    const [shiftRows] = await db.execute<any[]>(
      `SELECT
         sm.id AS shift_id,
         sm.shift_name,
         AVG(wb.total_break) AS avg_break,
         30 AS budget
       FROM (
         SELECT employee_id, session_date, SUM(break_duration_minutes) AS total_break
         FROM wfm_break_log WHERE session_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         GROUP BY employee_id, session_date
       ) wb
       JOIN employees e ON wb.employee_id = e.id
       JOIN roster_assignment ra ON wb.employee_id = ra.employee_id AND wb.session_date = ra.roster_date
       JOIN wfm_shift_master sm ON ra.shift_template_id = sm.id
       WHERE 1=1 ${branchFilter}
       GROUP BY sm.id, sm.shift_name`,
      params
    );

    const byShift = shiftRows.map((r: any) => ({
      shiftId: r.shift_id,
      shiftName: r.shift_name,
      compliancePct: r.budget > 0 ? Math.round(Math.min(100, (r.budget / Math.max(r.avg_break, 1)) * 100)) : 90,
      avgBreakMinutes: Math.round(r.avg_break ?? r.budget ?? 30),
      budgetMinutes: r.budget ?? 30,
      trend: 0,
    }));

    // Top violators
    const [violatorRows] = await db.execute<any[]>(
      `SELECT
         e.id AS employee_id,
         e.employee_code,
         e.full_name AS employee_name,
         AVG(wb.total_break - 30) AS avg_excess,
         COUNT(*) AS occurrences
       FROM (
         SELECT employee_id, session_date, SUM(break_duration_minutes) AS total_break
         FROM wfm_break_log WHERE session_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         GROUP BY employee_id, session_date
       ) wb
       JOIN employees e ON wb.employee_id = e.id
       JOIN roster_assignment ra ON wb.employee_id = ra.employee_id AND wb.session_date = ra.roster_date
       WHERE wb.total_break > 30 ${branchFilter}
       GROUP BY e.id, e.employee_code, e.full_name
       HAVING AVG(wb.total_break - 30) > 5
       ORDER BY avg_excess DESC
       LIMIT 10`,
      params
    );

    res.json({
      overall,
      byShift,
      byProcess: [],
      topViolators: violatorRows.map((r: any) => ({
        employeeId: r.employee_id,
        employeeCode: r.employee_code,
        employeeName: r.employee_name,
        avgExcessMinutes: Math.round(r.avg_excess),
        occurrences: r.occurrences,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-analytics] break-compliance error:', msg);
    res.status(500).json({ error: `Failed to get break compliance: ${msg}` });
  }
});

/**
 * GET /api/roster-analytics/shift-recommendations
 * Shift change recommendations for employees
 */
router.get('/shift-recommendations', requireRole(...ANALYTICS_ROLES), async (_req, res) => {
  try {
    // Simplified: return empty for now, can be enhanced with ML later
    res.json({ recommendations: [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: `Failed to get recommendations: ${msg}` });
  }
});

// ── Phase 6: Team Comparison ─────────────────────────────────────────────────

/**
 * GET /api/roster-analytics/team-comparison
 * Compare adherence across managers, processes, and branches
 */
router.get('/team-comparison', requireRole(...ANALYTICS_ROLES), async (req, res) => {
  try {
    const { db } = await import('../../db/mysql.js');
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const period = req.query.period ? String(req.query.period) : 'current';

    let dateFilter = 'ra.roster_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
    if (period === 'last') {
      dateFilter = `DATE_FORMAT(ra.roster_date, '%Y-%m') = DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m')`;
    } else if (period === 'quarter') {
      dateFilter = 'ra.roster_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)';
    }

    let branchFilter = '';
    const params: string[] = [];
    if (branchId) {
      branchFilter = 'AND e.branch_id = ?';
      params.push(branchId);
    }

    // Team rankings (by manager)
    const [teamRows] = await db.execute<any[]>(
      `SELECT
         m.id AS manager_id,
         m.full_name AS manager_name,
         p.process_name,
         b.branch_name,
         COUNT(DISTINCT ra.employee_id) AS team_size,
         AVG(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') THEN 100 ELSE 0 END) AS adherence_pct,
         AVG(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') AND adr.late_mark = 0 THEN 100 ELSE 0 END) AS on_time_pct,
         AVG(COALESCE(qa.quality_percentage, 0)) AS quality_avg,
         AVG(CASE WHEN ra.is_week_off = 0 AND COALESCE(adr.attendance_status,'') NOT IN ('present','half_day') THEN 100 ELSE 0 END) AS shrinkage_pct,
         90 AS break_compliance_pct
       FROM roster_assignment ra
       JOIN employees e ON ra.employee_id = e.id
       JOIN employees m ON e.reporting_manager_id = m.id
       LEFT JOIN process_master p ON e.process_id = p.id
       LEFT JOIN branch_master b ON e.branch_id = b.id
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       LEFT JOIN (
         SELECT employee_id, DATE(punch_date) AS d, AVG(quality_percentage) AS quality_percentage
         FROM call_quality_assessment GROUP BY employee_id, DATE(punch_date)
       ) qa ON ra.employee_id = qa.employee_id AND ra.roster_date = qa.d
       WHERE ${dateFilter} ${branchFilter}
       GROUP BY m.id, m.full_name, p.process_name, b.branch_name
       HAVING team_size >= 3
       ORDER BY adherence_pct DESC
       LIMIT 50`,
      params
    );

    const teams = teamRows.map((r: any, i: number) => ({
      managerId: r.manager_id,
      managerName: r.manager_name,
      processName: r.process_name,
      branchName: r.branch_name,
      teamSize: r.team_size,
      metrics: {
        adherencePct: Math.round(r.adherence_pct ?? 0),
        onTimePct: Math.round(r.on_time_pct ?? 0),
        qualityAvg: Math.round(r.quality_avg ?? 0),
        shrinkagePct: Math.round(r.shrinkage_pct ?? 0),
        breakCompliancePct: r.break_compliance_pct ?? 90,
      },
      trend: 0,
      rank: i + 1,
      badge: i === 0 ? 'GOLD' : i === 1 ? 'SILVER' : i === 2 ? 'BRONZE' : null,
    }));

    // Process rankings
    const [processRows] = await db.execute<any[]>(
      `SELECT
         p.id AS process_id,
         p.process_name,
         b.branch_name,
         COUNT(DISTINCT ra.employee_id) AS employee_count,
         AVG(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') THEN 100 ELSE 0 END) AS adherence_pct,
         AVG(COALESCE(qa.quality_percentage, 0)) AS quality_avg,
         AVG(CASE WHEN ra.is_week_off = 0 AND COALESCE(adr.attendance_status,'') NOT IN ('present','half_day') THEN 100 ELSE 0 END) AS shrinkage_pct
       FROM roster_assignment ra
       JOIN employees e ON ra.employee_id = e.id
       JOIN process_master p ON e.process_id = p.id
       LEFT JOIN branch_master b ON e.branch_id = b.id
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       LEFT JOIN (
         SELECT employee_id, DATE(punch_date) AS d, AVG(quality_percentage) AS quality_percentage
         FROM call_quality_assessment GROUP BY employee_id, DATE(punch_date)
       ) qa ON ra.employee_id = qa.employee_id AND ra.roster_date = qa.d
       WHERE ${dateFilter} ${branchFilter}
       GROUP BY p.id, p.process_name, b.branch_name
       ORDER BY adherence_pct DESC`,
      params
    );

    const processes = processRows.map((r: any, i: number) => ({
      processId: r.process_id,
      processName: r.process_name,
      branchName: r.branch_name,
      employeeCount: r.employee_count,
      metrics: {
        adherencePct: Math.round(r.adherence_pct ?? 0),
        qualityAvg: Math.round(r.quality_avg ?? 0),
        shrinkagePct: Math.round(r.shrinkage_pct ?? 0),
      },
      trend: 0,
      rank: i + 1,
    }));

    // Branch rankings
    const [branchRows] = await db.execute<any[]>(
      `SELECT
         b.id AS branch_id,
         b.branch_name,
         COUNT(DISTINCT ra.employee_id) AS employee_count,
         COUNT(DISTINCT e.reporting_manager_id) AS manager_count,
         AVG(CASE WHEN COALESCE(adr.attendance_status,'') IN ('present','half_day') THEN 100 ELSE 0 END) AS adherence_pct,
         AVG(COALESCE(qa.quality_percentage, 0)) AS quality_avg,
         AVG(CASE WHEN ra.is_week_off = 0 AND COALESCE(adr.attendance_status,'') NOT IN ('present','half_day') THEN 100 ELSE 0 END) AS shrinkage_pct
       FROM roster_assignment ra
       JOIN employees e ON ra.employee_id = e.id
       JOIN branch_master b ON e.branch_id = b.id
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       LEFT JOIN (
         SELECT employee_id, DATE(punch_date) AS d, AVG(quality_percentage) AS quality_percentage
         FROM call_quality_assessment GROUP BY employee_id, DATE(punch_date)
       ) qa ON ra.employee_id = qa.employee_id AND ra.roster_date = qa.d
       WHERE ${dateFilter}
       GROUP BY b.id, b.branch_name
       ORDER BY adherence_pct DESC`,
      []
    );

    const branches = branchRows.map((r: any, i: number) => ({
      branchId: r.branch_id,
      branchName: r.branch_name,
      employeeCount: r.employee_count,
      managerCount: r.manager_count,
      metrics: {
        adherencePct: Math.round(r.adherence_pct ?? 0),
        qualityAvg: Math.round(r.quality_avg ?? 0),
        shrinkagePct: Math.round(r.shrinkage_pct ?? 0),
      },
      trend: 0,
      rank: i + 1,
    }));

    res.json({
      teams,
      processes,
      branches,
      insights: teams.length > 0 ? [
        `Top performer ${teams[0]?.managerName} maintains ${teams[0]?.metrics.adherencePct}% adherence`,
        'Consistent on-time arrivals correlate with higher quality scores',
        'Early intervention on attendance patterns prevents attrition',
      ] : [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-analytics] team-comparison error:', msg);
    res.status(500).json({ error: `Failed to get team comparison: ${msg}` });
  }
});

// ── Mobile PWA: Team Status ──────────────────────────────────────────────────

/**
 * GET /api/roster-analytics/team-status-mobile
 * Lightweight endpoint for mobile dashboard — returns team attendance summary
 */
router.get('/team-status-mobile', requireRole(...ANALYTICS_ROLES, 'manager', 'process_manager', 'tl'), async (req, res) => {
  try {
    const { db } = await import('../../db/mysql.js');
    const authReq = req as any;
    const managerId = authReq.authUser?.id;

    if (!managerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    // Get team members under this manager
    const [teamRows] = await db.execute<any[]>(
      `SELECT e.id AS employee_id, e.employee_code, e.full_name AS employee_name,
              sm.shift_name,
              CASE WHEN ra.is_week_off = 1 THEN 'WEEK_OFF' ELSE 'WORKING' END AS roster_status,
              adr.attendance_status,
              adr.clock_in_time AS login_time,
              TIMESTAMPDIFF(MINUTE, CONCAT(?, ' ', sm.start_time), adr.clock_in_time) AS late_minutes,
              wb.on_break
       FROM employees e
       LEFT JOIN roster_assignment ra ON ra.employee_id = e.id AND ra.roster_date = ?
       LEFT JOIN wfm_shift_master sm ON ra.shift_template_id = sm.id
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = e.id AND adr.record_date = ?
       LEFT JOIN (
         SELECT employee_id, 1 AS on_break
         FROM wfm_break_log
         WHERE session_date = ? AND end_time IS NULL
       ) wb ON wb.employee_id = e.id
       WHERE e.reporting_manager_id = ?
         AND e.active_status = 1
         AND e.employment_status = 'Active'
       ORDER BY e.full_name`,
      [today, today, today, today, managerId]
    );

    const members = teamRows.map((r: any) => {
      let status: string = 'pending';
      if (r.roster_status === 'WEEK_OFF') status = 'week_off';
      else if (r.attendance_status === 'on_leave') status = 'on_leave';
      else if (r.attendance_status === 'present') status = r.late_minutes > 5 ? 'late' : 'present';
      else if (r.attendance_status === 'absent') status = 'absent';
      else if (r.attendance_status === 'half_day') status = 'present';

      return {
        employeeId: r.employee_id,
        employeeCode: r.employee_code,
        employeeName: r.employee_name,
        status,
        shiftName: r.shift_name || 'General',
        loginTime: r.login_time ? new Date(r.login_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : undefined,
        lateMinutes: r.late_minutes > 5 ? r.late_minutes : undefined,
        breakStatus: r.on_break ? 'on_break' : 'available',
      };
    });

    const teamSize = members.length;
    const present = members.filter((m: any) => m.status === 'present' || m.status === 'late').length;
    const absent = members.filter((m: any) => m.status === 'absent').length;
    const late = members.filter((m: any) => m.status === 'late').length;
    const onLeave = members.filter((m: any) => m.status === 'on_leave').length;
    const weekOff = members.filter((m: any) => m.status === 'week_off').length;
    const onBreak = members.filter((m: any) => m.breakStatus === 'on_break').length;

    const rostered = teamSize - onLeave - weekOff;
    const adherencePct = rostered > 0 ? Math.round((present / rostered) * 100) : 100;

    res.json({
      date: today,
      teamSize,
      present,
      absent,
      late,
      onLeave,
      weekOff,
      onBreak,
      adherencePct,
      members,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-analytics] team-status-mobile error:', msg);
    res.status(500).json({ error: `Failed to get team status: ${msg}` });
  }
});

export const rosterAnalyticsRouter = router;
