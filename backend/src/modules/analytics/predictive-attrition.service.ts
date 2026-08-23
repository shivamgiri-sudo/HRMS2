/**
 * Predictive Attrition Analytics Service
 * File: backend/src/modules/analytics/predictive-attrition.service.ts
 * Purpose: Formula-based predictive attrition risk scoring for active employees
 *
 * Risk_Score (0-100):
 *   [Tenure]     CASE WHEN aon_days <= 30 THEN 35 WHEN <= 60 THEN 20 WHEN <= 90 THEN 10 ELSE 0
 *   [Attendance] CASE WHEN att_pct < 75 THEN 25 WHEN < 85 THEN 15 WHEN < 90 THEN 7 ELSE 0
 *   [Quality]    velocity < -15 → 20; velocity < -8 → 12; avg < 65 → 15; avg < 75 → 8; ELSE 0
 *   [Source]     WALKIN/WALKIIN AND aon_days <= 30 → 10; ELSE 0
 *   [CTC]        ctc < 12000 → 8; ctc < 15000 → 4; ELSE 0
 *   [Late marks] late_marks_30d > 8 → 7; ELSE 0
 *   [PIP]        active_pip = 1 → 5; ELSE 0
 *   [Stability]  aon_days > 180 AND att_pct > 90 AND avg_quality > 80 → -10; ELSE 0
 *
 * Risk_Tier: CRITICAL >= 75, HIGH >= 55, MEDIUM >= 35, LOW < 35
 * exit_probability_30d = ROUND(score / 100 * 85, 1)
 */

import { Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { db as pool } from '../../db/mysql.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface AtRiskEmployee extends RowDataPacket {
  employee_code: string;
  employee_name: string;
  designation_name: string | null;
  process_name: string | null;
  branch_name: string | null;
  branch_id: number | null;
  process_id: number | null;
  aon_days: number;
  att_pct: number;
  avg_quality: number;
  quality_velocity: number;
  late_marks_30d: number;
  source: string | null;
  ctc: number | null;
  active_pip: number;
  prediction_score: number;
  risk_tier: string;
  exit_probability_30d: number;
}

interface EmployeeScoreBreakdown extends RowDataPacket {
  employee_code: string;
  employee_name: string;
  designation_name: string | null;
  process_name: string | null;
  branch_name: string | null;
  aon_days: number;
  att_pct: number;
  avg_quality: number;
  quality_velocity: number;
  late_marks_30d: number;
  source: string | null;
  ctc: number | null;
  active_pip: number;
  factor_tenure: number;
  factor_attendance: number;
  factor_quality: number;
  factor_source: number;
  factor_ctc: number;
  factor_late_marks: number;
  factor_pip: number;
  factor_stability: number;
  prediction_score: number;
  risk_tier: string;
  exit_probability_30d: number;
}

interface AttritionSummaryRow extends RowDataPacket {
  risk_tier: string;
  employee_count: number;
}

interface TotalActiveRow extends RowDataPacket {
  total_active: number;
}

// ---------------------------------------------------------------------------
// Shared SQL fragments
// ---------------------------------------------------------------------------

/**
 * FAST CTEs - attendance and late marks only (no cross-database join)
 * Used for summary endpoint where quality data is optional
 */
const FAST_SCORING_CTES = `
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
  late_marks_cte AS (
    SELECT
      employee_id,
      SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END) AS late_marks_30d
    FROM mas_hrms.attendance_daily_record
    WHERE record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY employee_id
  )
`;

/**
 * FULL CTEs - includes quality from db_audit (slower, cross-database)
 * Used for detailed employee views where quality data is needed
 */
const FULL_SCORING_CTES = `
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
      AND ei.employment_status = 'Active'
      AND ei.active_status = 1
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

// Legacy alias for backward compatibility
const SCORING_CTES = FULL_SCORING_CTES;

/**
 * FAST score expression - excludes quality factors for quick summary queries.
 * Quality contributes max 20 pts, so fast score has max 80 (adjusted tiers accordingly).
 */
const FAST_SCORE_EXPR = `
  GREATEST(0, LEAST(100,
    -- Tenure factor (35 max)
    CASE
      WHEN DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 35
      WHEN DATEDIFF(NOW(), e.date_of_joining) <= 60 THEN 20
      WHEN DATEDIFF(NOW(), e.date_of_joining) <= 90 THEN 10
      ELSE 0
    END
    -- Attendance factor (25 max)
    + CASE
        WHEN COALESCE(att.att_pct, 100) < 75 THEN 25
        WHEN COALESCE(att.att_pct, 100) < 85 THEN 15
        WHEN COALESCE(att.att_pct, 100) < 90 THEN 7
        ELSE 0
      END
    -- Source factor (10 max)
    + CASE
        WHEN UPPER(REPLACE(TRIM(e.source), ' ', '')) IN ('WALKIN','WALKIIN')
             AND DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 10
        ELSE 0
      END
    -- CTC factor (8 max)
    + CASE
        WHEN e.ctc < 12000 THEN 8
        WHEN e.ctc < 15000 THEN 4
        ELSE 0
      END
    -- Late marks factor (7 max)
    + CASE
        WHEN COALESCE(lm.late_marks_30d, 0) > 8 THEN 7
        ELSE 0
      END
    -- PIP factor (5 max)
    + CASE
        WHEN EXISTS (
          SELECT 1 FROM mas_hrms.pip_record pr
          WHERE pr.employee_id = e.id AND pr.status = 'active'
        ) THEN 5
        ELSE 0
      END
  ))
`;

/**
 * The FULL composite score expression (includes quality factors).
 * Alias the result as `prediction_score`.
 */
const SCORE_EXPR = `
  GREATEST(0, LEAST(100,
    -- Tenure factor
    CASE
      WHEN DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 35
      WHEN DATEDIFF(NOW(), e.date_of_joining) <= 60 THEN 20
      WHEN DATEDIFF(NOW(), e.date_of_joining) <= 90 THEN 10
      ELSE 0
    END
    -- Attendance factor
    + CASE
        WHEN COALESCE(att.att_pct, 100) < 75 THEN 25
        WHEN COALESCE(att.att_pct, 100) < 85 THEN 15
        WHEN COALESCE(att.att_pct, 100) < 90 THEN 7
        ELSE 0
      END
    -- Quality factor (velocity takes priority, then avg)
    + CASE
        WHEN COALESCE(q.quality_velocity, 0)  < -15 THEN 20
        WHEN COALESCE(q.quality_velocity, 0)  < -8  THEN 12
        WHEN COALESCE(q.avg_quality, 100)     < 65  THEN 15
        WHEN COALESCE(q.avg_quality, 100)     < 75  THEN 8
        ELSE 0
      END
    -- Source factor
    + CASE
        WHEN UPPER(REPLACE(TRIM(e.source), ' ', '')) IN ('WALKIN','WALKIIN')
             AND DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 10
        ELSE 0
      END
    -- CTC factor
    + CASE
        WHEN e.ctc < 12000 THEN 8
        WHEN e.ctc < 15000 THEN 4
        ELSE 0
      END
    -- Late marks factor
    + CASE
        WHEN COALESCE(lm.late_marks_30d, 0) > 8 THEN 7
        ELSE 0
      END
    -- PIP factor
    + CASE
        WHEN EXISTS (
          SELECT 1 FROM mas_hrms.pip_record pr
          WHERE pr.employee_id = e.id AND pr.status = 'active'
        ) THEN 5
        ELSE 0
      END
    -- Stability bonus (negative contribution)
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
// Handler 1: getAtRiskEmployees
// ---------------------------------------------------------------------------

/**
 * GET /api/analytics/predictive-attrition/at-risk
 * Query params: branchId, processId, tier (CRITICAL|HIGH|MEDIUM|LOW), limit (default 50)
 * Returns list of at-risk active employees with signal breakdown, ordered by score desc.
 */
export async function getAtRiskEmployees(req: Request, res: Response) {
  try {
    const {
      branchId,
      processId,
      tier,
      limit = 50
    } = req.query;

    const params: (string | number)[] = [];
    const filterClauses: string[] = [];

    if (branchId) {
      filterClauses.push('e.branch_id = ?');
      params.push(parseInt(branchId as string));
    }

    if (processId) {
      filterClauses.push('e.process_id = ?');
      params.push(parseInt(processId as string));
    }

    const baseWhereClause = filterClauses.length > 0
      ? `AND ${filterClauses.join(' AND ')}`
      : '';

    // Tier filter applied in outer query against the computed score
    let tierHaving = '';
    if (tier) {
      switch ((tier as string).toUpperCase()) {
        case 'CRITICAL': tierHaving = 'HAVING prediction_score >= 75'; break;
        case 'HIGH':     tierHaving = 'HAVING prediction_score >= 55 AND prediction_score < 75'; break;
        case 'MEDIUM':   tierHaving = 'HAVING prediction_score >= 35 AND prediction_score < 55'; break;
        case 'LOW':      tierHaving = 'HAVING prediction_score < 35'; break;
      }
    }

    params.push(parseInt(limit as string) || 50);

    const query = `
      WITH ${SCORING_CTES}
      SELECT
        e.employee_code,
        CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
        COALESCE(d.designation_name, '')  AS designation_name,
        COALESCE(p.process_name, '')      AS process_name,
        COALESCE(bm.branch_name, '')      AS branch_name,
        bm.id                             AS branch_id,
        p.id                              AS process_id,
        DATEDIFF(NOW(), e.date_of_joining)  AS aon_days,
        COALESCE(att.att_pct, 100)          AS att_pct,
        COALESCE(q.avg_quality, 0)          AS avg_quality,
        COALESCE(q.quality_velocity, 0)     AS quality_velocity,
        COALESCE(lm.late_marks_30d, 0)      AS late_marks_30d,
        e.source,
        e.ctc,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM mas_hrms.pip_record pr
            WHERE pr.employee_id = e.id AND pr.status = 'active'
          ) THEN 1 ELSE 0
        END AS active_pip,
        ${SCORE_EXPR} AS prediction_score,
        CASE
          WHEN ${SCORE_EXPR} >= 75 THEN 'CRITICAL'
          WHEN ${SCORE_EXPR} >= 55 THEN 'HIGH'
          WHEN ${SCORE_EXPR} >= 35 THEN 'MEDIUM'
          ELSE 'LOW'
        END AS risk_tier,
        ROUND(${SCORE_EXPR} / 100.0 * 85, 1) AS exit_probability_30d
      FROM mas_hrms.employees e
      LEFT JOIN mas_hrms.designation_master d  ON e.designation_id  = d.id
      LEFT JOIN mas_hrms.process_master p      ON e.process_id      = p.id
      LEFT JOIN mas_hrms.branch_master bm      ON e.branch_id       = bm.id
      LEFT JOIN attendance_cte att             ON e.id              = att.employee_id
      LEFT JOIN quality_cte q                  ON e.id              = q.employee_id
      LEFT JOIN late_marks_cte lm              ON e.id              = lm.employee_id
      WHERE e.employment_status = 'Active'
        AND e.active_status = 1
        ${baseWhereClause}
      ${tierHaving}
      ORDER BY prediction_score DESC
      LIMIT ?
    `;

    const [rows] = await pool.query<AtRiskEmployee[]>(query, params);

    res.json({
      success: true,
      analysis_type: 'PREDICTIVE_AT_RISK',
      count: rows.length,
      filters: { branchId: branchId || null, processId: processId || null, tier: tier || null },
      data: rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getAtRiskEmployees:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch at-risk employees' });
  }
}

// ---------------------------------------------------------------------------
// Handler 2: getPredictiveScoreForEmployee
// ---------------------------------------------------------------------------

/**
 * GET /api/analytics/predictive-attrition/:employeeId
 * Returns a single employee's full prediction breakdown with each factor shown separately.
 */
export async function getPredictiveScoreForEmployee(req: Request, res: Response) {
  try {
    const { employeeId } = req.params;
    const empIdNum = parseInt(employeeId, 10);

    if (isNaN(empIdNum)) {
      return res.status(400).json({ success: false, error: 'Invalid employeeId — must be a numeric employee id' });
    }

    const query = `
      WITH ${SCORING_CTES}
      SELECT
        e.id                                                              AS employee_id,
        e.employee_code,
        CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))             AS employee_name,
        COALESCE(d.designation_name, '')  AS designation_name,
        COALESCE(p.process_name, '')      AS process_name,
        COALESCE(bm.branch_name, '')      AS branch_name,
        DATEDIFF(NOW(), e.date_of_joining)  AS aon_days,
        COALESCE(att.att_pct, 100)          AS att_pct,
        COALESCE(q.avg_quality, 0)          AS avg_quality,
        COALESCE(q.quality_velocity, 0)     AS quality_velocity,
        COALESCE(lm.late_marks_30d, 0)      AS late_marks_30d,
        e.source,
        e.ctc,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM mas_hrms.pip_record pr
            WHERE pr.employee_id = e.id AND pr.status = 'active'
          ) THEN 1 ELSE 0
        END AS active_pip,
        -- Individual factor contributions
        CASE
          WHEN DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 35
          WHEN DATEDIFF(NOW(), e.date_of_joining) <= 60 THEN 20
          WHEN DATEDIFF(NOW(), e.date_of_joining) <= 90 THEN 10
          ELSE 0
        END AS factor_tenure,
        CASE
          WHEN COALESCE(att.att_pct, 100) < 75 THEN 25
          WHEN COALESCE(att.att_pct, 100) < 85 THEN 15
          WHEN COALESCE(att.att_pct, 100) < 90 THEN 7
          ELSE 0
        END AS factor_attendance,
        CASE
          WHEN COALESCE(q.quality_velocity, 0) < -15 THEN 20
          WHEN COALESCE(q.quality_velocity, 0) < -8  THEN 12
          WHEN COALESCE(q.avg_quality, 100)    < 65  THEN 15
          WHEN COALESCE(q.avg_quality, 100)    < 75  THEN 8
          ELSE 0
        END AS factor_quality,
        CASE
          WHEN UPPER(REPLACE(TRIM(e.source), ' ', '')) IN ('WALKIN','WALKIIN')
               AND DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 10
          ELSE 0
        END AS factor_source,
        CASE
          WHEN e.ctc < 12000 THEN 8
          WHEN e.ctc < 15000 THEN 4
          ELSE 0
        END AS factor_ctc,
        CASE
          WHEN COALESCE(lm.late_marks_30d, 0) > 8 THEN 7
          ELSE 0
        END AS factor_late_marks,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM mas_hrms.pip_record pr
            WHERE pr.employee_id = e.id AND pr.status = 'active'
          ) THEN 5
          ELSE 0
        END AS factor_pip,
        CASE
          WHEN DATEDIFF(NOW(), e.date_of_joining) > 180
               AND COALESCE(att.att_pct, 0) > 90
               AND COALESCE(q.avg_quality, 0) > 80
          THEN -10
          ELSE 0
        END AS factor_stability,
        ${SCORE_EXPR} AS prediction_score,
        CASE
          WHEN ${SCORE_EXPR} >= 75 THEN 'CRITICAL'
          WHEN ${SCORE_EXPR} >= 55 THEN 'HIGH'
          WHEN ${SCORE_EXPR} >= 35 THEN 'MEDIUM'
          ELSE 'LOW'
        END AS risk_tier,
        ROUND(${SCORE_EXPR} / 100.0 * 85, 1) AS exit_probability_30d
      FROM mas_hrms.employees e
      LEFT JOIN mas_hrms.designation_master d  ON e.designation_id  = d.id
      LEFT JOIN mas_hrms.process_master p      ON e.process_id      = p.id
      LEFT JOIN mas_hrms.branch_master bm      ON e.branch_id       = bm.id
      LEFT JOIN attendance_cte att             ON e.id              = att.employee_id
      LEFT JOIN quality_cte q                  ON e.id              = q.employee_id
      LEFT JOIN late_marks_cte lm              ON e.id              = lm.employee_id
      WHERE e.id = ?
        AND e.employment_status = 'Active'
        AND e.active_status = 1
      LIMIT 1
    `;

    const [rows] = await pool.query<EmployeeScoreBreakdown[]>(query, [empIdNum]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No active employee found with id ${empIdNum}`
      });
    }

    const record = rows[0];

    res.json({
      success: true,
      analysis_type: 'PREDICTIVE_SCORE_BREAKDOWN',
      data: {
        ...record,
        factor_breakdown: {
          tenure:     record.factor_tenure,
          attendance: record.factor_attendance,
          quality:    record.factor_quality,
          source:     record.factor_source,
          ctc:        record.factor_ctc,
          late_marks: record.factor_late_marks,
          pip:        record.factor_pip,
          stability:  record.factor_stability
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getPredictiveScoreForEmployee:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch predictive score for employee' });
  }
}

// ---------------------------------------------------------------------------
// Handler 3: getAttritionRiskSummary
// ---------------------------------------------------------------------------

/**
 * GET /api/analytics/predictive-attrition/summary
 * Returns org-wide summary: critical_count, high_count, medium_count, low_count,
 * total_active, predicted_exits_30d.
 *
 * PERFORMANCE: ULTRA-FAST direct query without CTEs.
 * Scores are computed using static risk factors only (tenure, source, ctc, pip).
 * Attendance/quality factors require separate lookup.
 * Tiers: CRITICAL >= 55, HIGH >= 40, MEDIUM >= 25, LOW < 25
 */
export async function getAttritionRiskSummary(req: Request, res: Response) {
  try {
    // ULTRA-FAST: Direct single-pass query using employee table columns only
    // Factors: tenure (35 max), source (10), ctc (8) = max 53
    // Note: Attendance, quality, late marks, pip excluded for speed
    const summaryQuery = `
      SELECT
        CASE
          WHEN (
            CASE WHEN DATEDIFF(NOW(), date_of_joining) <= 30 THEN 35
                 WHEN DATEDIFF(NOW(), date_of_joining) <= 60 THEN 20
                 WHEN DATEDIFF(NOW(), date_of_joining) <= 90 THEN 10
                 ELSE 0 END
            + CASE WHEN UPPER(REPLACE(TRIM(source), ' ', '')) IN ('WALKIN','WALKIIN')
                        AND DATEDIFF(NOW(), date_of_joining) <= 30 THEN 10 ELSE 0 END
            + CASE WHEN ctc < 12000 THEN 8 WHEN ctc < 15000 THEN 4 ELSE 0 END
          ) >= 40 THEN 'CRITICAL'
          WHEN (
            CASE WHEN DATEDIFF(NOW(), date_of_joining) <= 30 THEN 35
                 WHEN DATEDIFF(NOW(), date_of_joining) <= 60 THEN 20
                 WHEN DATEDIFF(NOW(), date_of_joining) <= 90 THEN 10
                 ELSE 0 END
            + CASE WHEN UPPER(REPLACE(TRIM(source), ' ', '')) IN ('WALKIN','WALKIIN')
                        AND DATEDIFF(NOW(), date_of_joining) <= 30 THEN 10 ELSE 0 END
            + CASE WHEN ctc < 12000 THEN 8 WHEN ctc < 15000 THEN 4 ELSE 0 END
          ) >= 25 THEN 'HIGH'
          WHEN (
            CASE WHEN DATEDIFF(NOW(), date_of_joining) <= 30 THEN 35
                 WHEN DATEDIFF(NOW(), date_of_joining) <= 60 THEN 20
                 WHEN DATEDIFF(NOW(), date_of_joining) <= 90 THEN 10
                 ELSE 0 END
            + CASE WHEN UPPER(REPLACE(TRIM(source), ' ', '')) IN ('WALKIN','WALKIIN')
                        AND DATEDIFF(NOW(), date_of_joining) <= 30 THEN 10 ELSE 0 END
            + CASE WHEN ctc < 12000 THEN 8 WHEN ctc < 15000 THEN 4 ELSE 0 END
          ) >= 15 THEN 'MEDIUM'
          ELSE 'LOW'
        END AS risk_tier,
        COUNT(*) AS employee_count
      FROM employees
      WHERE employment_status = 'Active'
        AND active_status = 1
      GROUP BY risk_tier
    `;

    const totalActiveQuery = `
      SELECT COUNT(*) AS total_active
      FROM mas_hrms.employees
      WHERE employment_status = 'Active' AND active_status = 1
    `;

    const [[tierRows], [totalRows]] = await Promise.all([
      pool.query<AttritionSummaryRow[]>(summaryQuery),
      pool.query<TotalActiveRow[]>(totalActiveQuery)
    ]);

    // Map tier rows into named counts
    const tierMap: Record<string, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0
    };

    for (const row of tierRows) {
      tierMap[row.risk_tier] = row.employee_count;
    }

    const totalActive = totalRows[0]?.total_active ?? 0;

    // Predicted exits = sum of individual exit_probability_30d estimates
    // Approximation using midpoint scores per tier:
    //   CRITICAL ≈ score 82 → prob 0.697; HIGH ≈ 65 → 0.553;
    //   MEDIUM ≈ 45 → 0.383; LOW ≈ 17 → 0.144
    const predictedExits30d = parseFloat(
      (
        tierMap.CRITICAL * 0.70 +
        tierMap.HIGH      * 0.55 +
        tierMap.MEDIUM    * 0.38 +
        tierMap.LOW       * 0.14
      ).toFixed(1)
    );

    res.json({
      success: true,
      analysis_type: 'ATTRITION_RISK_SUMMARY',
      data: {
        total_active:         totalActive,
        critical_count:       tierMap.CRITICAL,
        high_count:           tierMap.HIGH,
        medium_count:         tierMap.MEDIUM,
        low_count:            tierMap.LOW,
        predicted_exits_30d:  predictedExits30d
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getAttritionRiskSummary:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch attrition risk summary' });
  }
}
