/**
 * Employee 360 Composite Profile Service
 * File: backend/src/modules/analytics/employee-360.service.ts
 * Purpose: Aggregates all available signals for a single employee into a unified 360 profile.
 *
 * Endpoint: GET /:employeeId?period=YYYY-MM
 * All data sections are fetched in parallel via Promise.all.
 * Each section returns null on empty result or query error — never crashes the request.
 */

import { Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { db as pool } from '../../db/mysql.js';

// ---------------------------------------------------------------------------
// Risk scoring fragments — inlined verbatim from predictive-attrition.service.ts
// so this service stays self-contained without importing implementation details.
// ---------------------------------------------------------------------------

const SCORING_CTES = `
  attendance_cte AS (
    SELECT
      employee_id,
      ROUND(
        SUM(
          CASE
            WHEN attendance_status = 'present'  THEN 1.0
            WHEN attendance_status = 'half_day' THEN 0.5
            ELSE 0
          END
        ) / NULLIF(COUNT(record_date), 0) * 100
      , 2) AS att_pct,
      COUNT(record_date) AS total_days_60d
    FROM mas_hrms.attendance_daily_record
    WHERE record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
    GROUP BY employee_id
  ),
  quality_cte AS (
    SELECT
      ei.id AS employee_id,
      ROUND(AVG(cqa.quality_percentage), 2) AS avg_quality,
      ROUND(
        AVG(CASE WHEN cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                 THEN cqa.quality_percentage END)
        -
        AVG(CASE WHEN cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)
                      AND cqa.CallDate <  DATE_SUB(NOW(), INTERVAL 30 DAY)
                 THEN cqa.quality_percentage END)
      , 2) AS quality_velocity
    FROM mas_hrms.employees ei
    JOIN db_audit.call_quality_assessment cqa ON ei.employee_code = cqa.User
    WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)
    GROUP BY ei.id
  ),
  late_marks_cte AS (
    SELECT
      employee_id,
      SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END) AS late_marks_30d
    FROM mas_hrms.attendance_daily_record
    WHERE record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY employee_id
  )
`;

const SCORE_EXPR = `
  GREATEST(0, LEAST(100,
    CASE
      WHEN DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 35
      WHEN DATEDIFF(NOW(), e.date_of_joining) <= 60 THEN 20
      WHEN DATEDIFF(NOW(), e.date_of_joining) <= 90 THEN 10
      ELSE 0
    END
    + CASE
        WHEN COALESCE(att.att_pct, 100) < 75 THEN 25
        WHEN COALESCE(att.att_pct, 100) < 85 THEN 15
        WHEN COALESCE(att.att_pct, 100) < 90 THEN 7
        ELSE 0
      END
    + CASE
        WHEN COALESCE(q.quality_velocity, 0)  < -15 THEN 20
        WHEN COALESCE(q.quality_velocity, 0)  < -8  THEN 12
        WHEN COALESCE(q.avg_quality, 100)     < 65  THEN 15
        WHEN COALESCE(q.avg_quality, 100)     < 75  THEN 8
        ELSE 0
      END
    + CASE
        WHEN UPPER(REPLACE(TRIM(e.source), ' ', '')) IN ('WALKIN','WALKIIN')
             AND DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 10
        ELSE 0
      END
    + CASE
        WHEN e.ctc < 12000 THEN 8
        WHEN e.ctc < 15000 THEN 4
        ELSE 0
      END
    + CASE
        WHEN COALESCE(lm.late_marks_30d, 0) > 8 THEN 7
        ELSE 0
      END
    + CASE
        WHEN EXISTS (
          SELECT 1 FROM mas_hrms.pip_record pr
          WHERE pr.employee_id = e.id AND pr.status = 'active'
        ) THEN 5
        ELSE 0
      END
    - CASE
        WHEN DATEDIFF(NOW(), e.date_of_joining) > 180
             AND COALESCE(att.att_pct, 0) > 90
             AND COALESCE(q.avg_quality, 0) > 80
        THEN 10
        ELSE 0
      END
  ))
`;

// ---------------------------------------------------------------------------
// Safe query helpers — return null / [] instead of throwing
// ---------------------------------------------------------------------------

async function safeOne<T extends RowDataPacket>(
  sql: string,
  params: unknown[]
): Promise<T | null> {
  try {
    const [[row]] = await pool.execute<T[]>(sql, params);
    return row ?? null;
  } catch (err) {
    console.error('[employee-360] safeOne query error:', (err as Error).message);
    return null;
  }
}

async function safeMany<T extends RowDataPacket>(
  sql: string,
  params: unknown[]
): Promise<T[]> {
  try {
    const [rows] = await pool.execute<T[]>(sql, params);
    return rows;
  } catch (err) {
    console.error('[employee-360] safeMany query error:', (err as Error).message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// WFM section: two sequential sub-queries assembled into one object
// ---------------------------------------------------------------------------

async function fetchWfmMetrics(
  employeeId: string,
  periodStart: string,
  periodEnd: string
): Promise<RowDataPacket | null> {
  try {
    const empSubquery = 'SELECT id FROM mas_hrms.employees WHERE id = ? OR employee_code = ? LIMIT 1';

    const sessionSql = `
      SELECT COUNT(*) AS session_count,
        COALESCE(SUM(total_login_minutes), 0) AS total_login_minutes,
        ROUND(COALESCE(SUM(total_login_minutes), 0) / 60, 2) AS total_login_hours
      FROM wfm_attendance_session
      WHERE employee_id = (${empSubquery})
        AND session_date >= ? AND session_date < ?
    `;

    const breakSql = `
      SELECT
        COUNT(*) AS sessions_with_breaks,
        COALESCE(SUM(total_break_min), 0) AS total_break_minutes,
        SUM(CASE WHEN total_break_min > 30 THEN 1 ELSE 0 END) AS over_budget_sessions
      FROM (
        SELECT session_id, SUM(duration_minutes) AS total_break_min
        FROM wfm_break_log
        WHERE employee_id = (${empSubquery})
          AND break_start >= ? AND break_start < ?
        GROUP BY session_id
      ) break_agg
    `;

    const [[sessionRow]] = await pool.execute<RowDataPacket[]>(
      sessionSql,
      [employeeId, employeeId, periodStart, periodEnd]
    );
    const [[breakRow]] = await pool.execute<RowDataPacket[]>(
      breakSql,
      [employeeId, employeeId, periodStart, periodEnd]
    );

    const sessionsWithBreaks = Number(breakRow?.sessions_with_breaks ?? 0);
    const overBudget = Number(breakRow?.over_budget_sessions ?? 0);
    const breakCompliancePct =
      sessionsWithBreaks > 0
        ? Math.round(((sessionsWithBreaks - overBudget) / sessionsWithBreaks) * 100 * 100) / 100
        : null;

    return {
      ...(sessionRow ?? {}),
      ...(breakRow ?? {}),
      break_compliance_pct: breakCompliancePct
    } as RowDataPacket;
  } catch (err) {
    console.error('[employee-360] fetchWfmMetrics error:', (err as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// KPI section: multi-row result with computed summary fields
// ---------------------------------------------------------------------------

async function fetchKpiMetrics(
  employeeId: string,
  period: string
): Promise<{ metrics: RowDataPacket[]; on_target_count: number; below_threshold_count: number } | null> {
  try {
    const sql = `
      SELECT ks.metric_id, km.metric_code, km.metric_name, km.unit,
        ks.actual_value, kpc.target_value,
        ROUND(
          CASE
            WHEN km.direction = 'lower_is_better' AND kpc.target_value > 0
                 THEN LEAST(100, kpc.target_value / NULLIF(ks.actual_value, 0) * 100)
            WHEN kpc.target_value > 0
                 THEN LEAST(100, ks.actual_value / kpc.target_value * 100)
            ELSE NULL
          END
        , 2) AS achievement_pct
      FROM mas_hrms.kpi_score ks
      JOIN mas_hrms.kpi_metric_master km ON km.id = ks.metric_id
      LEFT JOIN mas_hrms.kpi_process_config kpc
        ON kpc.metric_id = ks.metric_id
        AND kpc.process_id = (
          SELECT process_id FROM mas_hrms.employees
          WHERE id = ? OR employee_code = ?
          LIMIT 1
        )
      WHERE ks.employee_id = (
          SELECT id FROM mas_hrms.employees
          WHERE id = ? OR employee_code = ?
          LIMIT 1
        )
        AND ks.period = ?
    `;

    const [rows] = await pool.execute<RowDataPacket[]>(
      sql,
      [employeeId, employeeId, employeeId, employeeId, period]
    );

    const on_target_count = rows.filter(
      (r) => r.achievement_pct !== null && Number(r.achievement_pct) >= 100
    ).length;
    const below_threshold_count = rows.filter(
      (r) => r.achievement_pct !== null && Number(r.achievement_pct) < 60
    ).length;

    return { metrics: rows, on_target_count, below_threshold_count };
  } catch (err) {
    console.error('[employee-360] fetchKpiMetrics error:', (err as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * GET /api/analytics/employee-360/:employeeId?period=YYYY-MM
 *
 * Returns a unified composite profile for one employee.
 * employeeId may be a numeric DB id, a CHAR(36) UUID, or an employee_code string.
 */
export async function getEmployee360Profile(req: Request, res: Response) {
  try {
    const { employeeId } = req.params;
    const rawPeriod = req.query.period as string | undefined;

    // Determine if the caller is a payroll/admin role who may see CTC
    const callerRoles: string[] = (req as any).authUser?.roles ?? [(req as any).authUser?.role ?? ''];
    const canSeeSalary = callerRoles.some(r =>
      ['super_admin', 'admin', 'hr', 'payroll'].includes(r)
    );

    // Default period to current month
    const now = new Date();
    const period =
      rawPeriod && /^\d{4}-\d{2}$/.test(rawPeriod)
        ? rawPeriod
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Derive period window for WFM queries
    const [periodYear, periodMonth] = period.split('-').map(Number);
    const periodStart = `${period}-01`;
    const periodEnd = new Date(periodYear, periodMonth, 1) // 1st of next month
      .toISOString()
      .slice(0, 10);

    // Subquery snippet reused across multiple queries to resolve id from either format
    const EMP_ID_SUB =
      'SELECT id FROM mas_hrms.employees WHERE id = ? OR employee_code = ? LIMIT 1';
    const EMP_CODE_SUB =
      'SELECT employee_code FROM mas_hrms.employees WHERE id = ? OR employee_code = ? LIMIT 1';

    // -----------------------------------------------------------------------
    // Fire all sections in parallel
    // -----------------------------------------------------------------------

    const [
      employee,
      attendanceMetrics,
      wfmMetrics,
      qualityMetricsRaw,
      kpiMetrics,
      dialerMetricsRaw,
      riskMetrics,
      pipStatus,
      openAlerts,
      managerContext
    ] = await Promise.all([

      // 1. Employee core profile
      safeOne<RowDataPacket>(
        `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.designation_id,
           e.date_of_joining, e.date_of_exit, e.active_status, e.employment_status,
           e.branch_id, e.process_id, e.cost_centre_id,
           ${canSeeSalary ? 'e.ctc' : 'NULL AS ctc'},
           e.source, e.reporting_manager_id,
           DATEDIFF(NOW(), e.date_of_joining) AS aon_days,
           CASE WHEN DATEDIFF(NOW(), e.date_of_joining) <= 30  THEN '0-30'
                WHEN DATEDIFF(NOW(), e.date_of_joining) <= 60  THEN '31-60'
                WHEN DATEDIFF(NOW(), e.date_of_joining) <= 90  THEN '61-90'
                ELSE '90+' END AS aon_bucket,
           ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) AS tenure_months,
           CASE WHEN DATEDIFF(NOW(), e.date_of_joining) < 90  THEN 'Onboarding'
                WHEN DATEDIFF(NOW(), e.date_of_joining) < 180 THEN 'Ramp'
                WHEN DATEDIFF(NOW(), e.date_of_joining) < 365 THEN 'Early Career'
                ELSE 'Established' END AS experience_level,
           b.branch_name, p.process_name,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           d.designation_name,
           CONCAT(mgr.first_name, ' ', mgr.last_name) AS manager_name,
           mgr.employee_code AS manager_code
         FROM mas_hrms.employees e
         LEFT JOIN mas_hrms.branch_master b        ON b.id  = e.branch_id
         LEFT JOIN mas_hrms.process_master p       ON p.id  = e.process_id
         LEFT JOIN mas_hrms.cost_centre_master cc  ON cc.id = e.cost_centre_id
         LEFT JOIN mas_hrms.designation_master d   ON d.id  = e.designation_id
         LEFT JOIN mas_hrms.employees mgr          ON mgr.id = e.reporting_manager_id
         WHERE (e.id = ? OR e.employee_code = ?)
         LIMIT 1`,
        [employeeId, employeeId]
      ),

      // 2. Attendance metrics — last 60 days
      safeOne<RowDataPacket>(
        `SELECT
           COUNT(DISTINCT record_date) AS total_days,
           SUM(attendance_status IN ('present','half_day','week_off_worked')) AS worked_days,
           SUM(attendance_status = 'present')        AS present_days,
           SUM(attendance_status = 'half_day')       AS half_days,
           SUM(attendance_status = 'absent')         AS absent_days,
           SUM(attendance_status = 'leave_approved') AS leave_days,
           SUM(attendance_status = 'missing_punch')  AS missing_punch_days,
           SUM(late_mark = 1) AS late_marks,
           ROUND(
             (SUM(attendance_status = 'present') + SUM(attendance_status = 'half_day') * 0.5)
             / NULLIF(COUNT(DISTINCT record_date), 0) * 100
           , 2) AS attendance_pct
         FROM mas_hrms.attendance_daily_record
         WHERE employee_id = (${EMP_ID_SUB})
           AND record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)`,
        [employeeId, employeeId]
      ),

      // 3. WFM metrics — combined session + break compliance (current period)
      fetchWfmMetrics(employeeId, periodStart, periodEnd),

      // 4. Quality metrics — last 90 days from db_audit
      safeOne<RowDataPacket>(
        `SELECT COUNT(*) AS call_count,
           ROUND(AVG(quality_percentage), 2)  AS avg_quality,
           ROUND(STDDEV(quality_percentage), 2) AS quality_volatility,
           ROUND(AVG(CASE WHEN CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             THEN quality_percentage END), 2) AS recent_30d_quality,
           ROUND(AVG(CASE WHEN CallDate < DATE_SUB(NOW(), INTERVAL 30 DAY)
             THEN quality_percentage END), 2) AS prior_30d_quality
         FROM db_audit.call_quality_assessment
         WHERE User = (${EMP_CODE_SUB})
           AND CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
        [employeeId, employeeId]
      ),

      // 5. KPI metrics — for the requested period (handles multi-row + summary)
      fetchKpiMetrics(employeeId, period),

      // 6. Dialer metrics — last 30d vs prior 30d
      safeOne<RowDataPacket>(
        `SELECT
           ROUND(AVG(CASE WHEN session_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             THEN login_minutes END), 1) AS recent_avg_minutes,
           ROUND(AVG(CASE WHEN session_date <  DATE_SUB(NOW(), INTERVAL 30 DAY)
             AND session_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
             THEN login_minutes END), 1) AS prior_avg_minutes,
           ROUND(SUM(CASE WHEN session_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             THEN login_minutes END) / 60, 2) AS recent_total_hours
         FROM mas_hrms.dialer_session_log
         WHERE employee_id = (${EMP_ID_SUB})
           AND session_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)`,
        [employeeId, employeeId]
      ),

      // 7. Risk metrics — inlined predictive-attrition scoring for this single employee
      safeOne<RowDataPacket>(
        `WITH ${SCORING_CTES}
         SELECT
           ${SCORE_EXPR} AS prediction_score,
           CASE
             WHEN ${SCORE_EXPR} >= 75 THEN 'CRITICAL'
             WHEN ${SCORE_EXPR} >= 55 THEN 'HIGH'
             WHEN ${SCORE_EXPR} >= 35 THEN 'MEDIUM'
             ELSE 'LOW'
           END AS risk_tier,
           ROUND(${SCORE_EXPR} / 100.0 * 85, 1) AS exit_probability_30d,
           -- Individual factor contributions
           CASE WHEN DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 35
                WHEN DATEDIFF(NOW(), e.date_of_joining) <= 60 THEN 20
                WHEN DATEDIFF(NOW(), e.date_of_joining) <= 90 THEN 10
                ELSE 0 END AS factor_tenure,
           CASE WHEN COALESCE(att.att_pct, 100) < 75 THEN 25
                WHEN COALESCE(att.att_pct, 100) < 85 THEN 15
                WHEN COALESCE(att.att_pct, 100) < 90 THEN 7
                ELSE 0 END AS factor_attendance,
           CASE WHEN COALESCE(q.quality_velocity, 0) < -15 THEN 20
                WHEN COALESCE(q.quality_velocity, 0) < -8  THEN 12
                WHEN COALESCE(q.avg_quality, 100) < 65 THEN 15
                WHEN COALESCE(q.avg_quality, 100) < 75 THEN 8
                ELSE 0 END AS factor_quality,
           CASE WHEN UPPER(REPLACE(TRIM(e.source), ' ', '')) IN ('WALKIN','WALKIIN')
                     AND DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 10
                ELSE 0 END AS factor_source,
           CASE WHEN e.ctc < 12000 THEN 8
                WHEN e.ctc < 15000 THEN 4
                ELSE 0 END AS factor_ctc,
           CASE WHEN COALESCE(lm.late_marks_30d, 0) > 8 THEN 7
                ELSE 0 END AS factor_late_marks,
           CASE WHEN EXISTS (
                  SELECT 1 FROM mas_hrms.pip_record pr
                  WHERE pr.employee_id = e.id AND pr.status = 'active'
                ) THEN 5 ELSE 0 END AS factor_pip,
           CASE WHEN DATEDIFF(NOW(), e.date_of_joining) > 180
                     AND COALESCE(att.att_pct, 0) > 90
                     AND COALESCE(q.avg_quality, 0) > 80
                THEN -10 ELSE 0 END AS factor_stability
         FROM mas_hrms.employees e
         LEFT JOIN attendance_cte att ON e.id = att.employee_id
         LEFT JOIN quality_cte q      ON e.id = q.employee_id
         LEFT JOIN late_marks_cte lm  ON e.id = lm.employee_id
         WHERE (e.id = ? OR e.employee_code = ?)
         LIMIT 1`,
        [employeeId, employeeId]
      ),

      // 8. Active PIP status (most recent non-closed/cancelled record)
      safeOne<RowDataPacket>(
        `SELECT id, status, start_date, end_date, reason, outcome,
           (SELECT rating FROM mas_hrms.pip_checkpoint
            WHERE pip_id = pip_record.id
            ORDER BY checkpoint_date DESC LIMIT 1) AS latest_checkpoint_rating
         FROM mas_hrms.pip_record
         WHERE employee_id = (${EMP_ID_SUB})
           AND status NOT IN ('closed','cancelled')
         ORDER BY start_date DESC
         LIMIT 1`,
        [employeeId, employeeId]
      ),

      // 9. Open (unacknowledged) performance alerts
      safeMany<RowDataPacket>(
        `SELECT alert_type, severity, message, created_at
         FROM mas_hrms.performance_alert
         WHERE employee_id = (${EMP_ID_SUB})
           AND acknowledged = 0
         ORDER BY created_at DESC
         LIMIT 10`,
        [employeeId, employeeId]
      ),

      // 10. Manager context — team size + 30-day attrition rate for the same manager
      safeOne<RowDataPacket>(
        `SELECT
           COUNT(DISTINCT e.id) AS team_size,
           ROUND(
             (COUNT(DISTINCT CASE
                WHEN e.date_of_exit >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN e.id
              END) /
              NULLIF(COUNT(DISTINCT CASE WHEN e.active_status = 1 THEN e.id END), 0)
             ) * 100
           , 1) AS team_30d_attrition_pct
         FROM mas_hrms.employees e
         WHERE e.reporting_manager_id = (
           SELECT reporting_manager_id FROM mas_hrms.employees
           WHERE id = ? OR employee_code = ?
           LIMIT 1
         )`,
        [employeeId, employeeId]
      )
    ]);

    // -----------------------------------------------------------------------
    // Post-process computed fields
    // -----------------------------------------------------------------------

    // Quality velocity and trend pattern
    let qualityMetrics: RowDataPacket | null = null;
    if (qualityMetricsRaw) {
      const recent = Number(qualityMetricsRaw.recent_30d_quality ?? 0);
      const prior  = Number(qualityMetricsRaw.prior_30d_quality  ?? 0);
      const velocity = recent - prior;

      let trend_pattern: string;
      if (velocity < -15)      trend_pattern = 'RAPID_DECLINE';
      else if (velocity < -8)  trend_pattern = 'SUSTAINED_DECLINE';
      else if (velocity < -3)  trend_pattern = 'RECENT_DECLINE';
      else                     trend_pattern = 'STABLE';

      qualityMetrics = {
        ...qualityMetricsRaw,
        quality_velocity: Math.round(velocity * 100) / 100,
        trend_pattern
      } as RowDataPacket;
    }

    // Dialer drop percentage
    let dialerMetrics: RowDataPacket | null = null;
    if (dialerMetricsRaw) {
      const recent = Number(dialerMetricsRaw.recent_avg_minutes ?? 0);
      const prior  = Number(dialerMetricsRaw.prior_avg_minutes  ?? 0);
      const dialer_drop_pct =
        prior > 0
          ? Math.round(((prior - recent) / prior) * 100 * 100) / 100
          : null;

      dialerMetrics = {
        ...dialerMetricsRaw,
        dialer_drop_pct
      } as RowDataPacket;
    }

    // -----------------------------------------------------------------------
    // Assemble and return
    // -----------------------------------------------------------------------

    res.json({
      success: true,
      employee_id: employeeId,
      period,
      data: {
        employee,
        attendance: attendanceMetrics,
        wfm: wfmMetrics,
        quality: qualityMetrics,
        kpi: kpiMetrics,
        dialer: dialerMetrics,
        risk: riskMetrics,
        pip: pipStatus,
        alerts: openAlerts,
        manager_context: managerContext
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getEmployee360Profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch employee 360 profile'
    });
  }
}
