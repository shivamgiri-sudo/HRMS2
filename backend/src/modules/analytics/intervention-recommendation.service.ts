/**
 * Intervention Recommendation Service
 * File: backend/src/modules/analytics/intervention-recommendation.service.ts
 * Purpose: Generate, store and retrieve rule-based retention intervention
 *          recommendations for at-risk employees. Works alongside the
 *          predictive-attrition service — reuses the same risk-score formula
 *          and signal set, then applies ordered rule matching to produce
 *          actionable owner-tagged recommendations.
 *
 * Table: employee_retention_recommendation
 *   id, employee_id, generated_at, risk_tier, prediction_score,
 *   recommendations (JSON), action_taken, action_taken_at, action_taken_by,
 *   outcome, outcome_date
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { db as pool } from '../../db/mysql.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Signals {
  prediction_score: number;
  aon_days: number;
  quality_velocity: number;
  manager_risk_score: number;
  team_30d_exits: number;
  att_pct: number;
  source_normalised: string;
  has_quality_data: boolean;
  active_pip: boolean;
  ctc: number;
  dialer_drop_pct: number;
}

interface Recommendation {
  signal: string;
  priority: string;
  owner: string;
  action: string;
  reason: string;
}

interface SignalsRow extends RowDataPacket {
  prediction_score: number;
  risk_tier: string;
  aon_days: number;
  att_pct: number;
  quality_velocity: number;
  manager_risk_score: number;
  team_30d_exits: number;
  source_normalised: string;
  has_quality_data: number;
  active_pip: number;
  ctc: number;
  dialer_drop_pct: number;
}

interface PendingInterventionRow extends RowDataPacket {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  branch_name: string | null;
  process_name: string | null;
  designation_name: string | null;
  generated_at: string;
  days_since_generated: number;
  risk_tier: string;
  prediction_score: number;
  recommendations: string;
}

interface OutcomeSummaryRow extends RowDataPacket {
  total_generated: number;
  action_taken_count: number;
  retained_count: number;
  exited_count: number;
  pending_count: number;
  avg_days_to_action: number | null;
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

interface Rule {
  condition: (s: Signals) => boolean;
  priority: string;
  owner: string;
  action: string;
  reason: string;
  signal: string;
}

const RULES: Rule[] = [
  {
    condition: (s) => s.prediction_score >= 75 && s.aon_days <= 30,
    priority: 'immediate',
    owner: 'hr_admin',
    action: 'Schedule 1:1 retention conversation within 24h. Review joining experience and commute.',
    reason: 'Critical risk in first 30 days — highest early attrition window',
    signal: 'critical_early_tenure'
  },
  {
    condition: (s) => s.quality_velocity < -15,
    priority: 'within_48h',
    owner: 'manager',
    action: 'Assign quality coach for 2-week intensive support. Review recent audit feedback.',
    reason: 'Rapid quality decline detected',
    signal: 'rapid_quality_decline'
  },
  {
    condition: (s) => s.manager_risk_score > 70 && s.team_30d_exits >= 3,
    priority: 'within_48h',
    owner: 'process_head',
    action: 'Escalate manager effectiveness review to Process Head. Investigate team health.',
    reason: 'High-risk manager with multiple recent exits from same team',
    signal: 'manager_driven_risk'
  },
  {
    condition: (s) => s.att_pct < 75,
    priority: 'within_48h',
    owner: 'manager',
    action: 'Issue attendance warning and schedule counselling. Check for personal circumstances.',
    reason: 'Attendance below 75% — high burnout/resignation signal',
    signal: 'low_attendance'
  },
  {
    condition: (s) =>
      s.source_normalised === 'Walk-in' && s.aon_days <= 30 && !s.has_quality_data,
    priority: 'this_week',
    owner: 'wfm',
    action: 'Confirm biometric enrolment. Assign buddy/mentor. Check transport access.',
    reason: 'New walk-in hire without quality data — likely biometric gap or early quit risk',
    signal: 'walkin_onboarding_risk'
  },
  {
    condition: (s) => s.active_pip && s.quality_velocity < -5,
    priority: 'within_48h',
    owner: 'hr_admin',
    action: 'Review PIP checkpoint urgently. Consider timeline extension or managed exit path.',
    reason: 'PIP active and quality still declining',
    signal: 'pip_with_decline'
  },
  {
    condition: (s) => s.ctc < 12000 && s.aon_days > 90,
    priority: 'this_week',
    owner: 'hr_admin',
    action: 'Flag for compensation review in next salary cycle. Compare to process average CTC.',
    reason: 'Low CTC with tenure past 90 days — salary dissatisfaction signal',
    signal: 'low_ctc_tenure'
  },
  {
    condition: (s) => s.dialer_drop_pct > 25,
    priority: 'this_week',
    owner: 'wfm',
    action: 'Check dialer allocation and schedule compliance. Rule out technical issues.',
    reason: 'Dialer hours dropped >25% vs personal baseline',
    signal: 'dialer_disengagement'
  }
];

// ---------------------------------------------------------------------------
// Signals SQL
// ---------------------------------------------------------------------------

/**
 * Fetches all signals for a single employee in one query.
 * Returns NULL/0 defaults for missing data so rules can always evaluate safely.
 */
const SIGNALS_QUERY = `
  WITH
  -- Attendance percentage over last 60 days
  att_cte AS (
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
      , 2) AS att_pct
    FROM mas_hrms.attendance_daily_record
    WHERE record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
      AND employee_id = ?
    GROUP BY employee_id
  ),
  -- Quality velocity and has_quality_data flag
  quality_cte AS (
    SELECT
      ei.id AS employee_id,
      ROUND(
        AVG(CASE WHEN cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                 THEN cqa.quality_percentage END)
        -
        AVG(CASE WHEN cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)
                      AND cqa.CallDate <  DATE_SUB(NOW(), INTERVAL 30 DAY)
                 THEN cqa.quality_percentage END)
      , 2) AS quality_velocity,
      COUNT(cqa.id) AS quality_row_count
    FROM mas_hrms.employees ei
    JOIN db_audit.call_quality_assessment cqa ON ei.employee_code = cqa.User
    WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)
      AND ei.id = ?
    GROUP BY ei.id
  ),
  -- Dialer drop percentage vs personal baseline (prior 30d vs recent 30d)
  dialer_cte AS (
    SELECT
      employee_id,
      AVG(CASE WHEN session_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
               THEN duration_minutes END) AS recent_avg,
      AVG(CASE WHEN session_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
                    AND session_date < DATE_SUB(NOW(), INTERVAL 30 DAY)
               THEN duration_minutes END) AS prior_avg
    FROM mas_hrms.dialer_session_log
    WHERE session_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
      AND employee_id = ?
    GROUP BY employee_id
  ),
  -- Team exits in last 30 days (teammates sharing the same reporting_manager_id)
  team_exit_cte AS (
    SELECT COUNT(*) AS team_30d_exits
    FROM mas_hrms.employees ex_emp
    JOIN mas_hrms.employees base ON base.id = ?
                                AND base.reporting_manager_id IS NOT NULL
                                AND ex_emp.reporting_manager_id = base.reporting_manager_id
                                AND ex_emp.id <> base.id
    WHERE ex_emp.date_of_exit >= DATE_SUB(NOW(), INTERVAL 30 DAY)
  ),
  -- Manager risk score (shrinkage×0.3 + attrition×0.4 + quality×0.2 + load×0.1)
  -- Shrinkage proxy: avg absence rate of direct reports; attrition: exit count ratio;
  -- quality: avg quality of direct reports; load: direct report headcount / 10
  manager_risk_cte AS (
    SELECT
      GREATEST(0, LEAST(100,
        -- Attendance/shrinkage factor (0–30): higher absence = higher risk
        COALESCE(
          (1 - AVG(
            CASE
              WHEN dr.att_pct IS NOT NULL THEN dr.att_pct / 100.0
              ELSE 0.95
            END
          )) * 100 * 0.3
        , 0)
        -- Attrition factor (0–40): exits in last 30d / total reports
        + COALESCE(
          (SUM(CASE WHEN rpts.date_of_exit >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END)
           / NULLIF(COUNT(rpts.id), 0)) * 100 * 0.4
        , 0)
        -- Quality factor (0–20): inverted avg quality
        + COALESCE(
          (1 - AVG(COALESCE(qm.avg_quality, 70)) / 100.0) * 100 * 0.2
        , 0)
        -- Load factor (0–10): headcount / 10
        + LEAST(10, COUNT(rpts.id) / 10.0 * 10) * 0.1
      )) AS manager_risk_score
    FROM mas_hrms.employees base
    JOIN mas_hrms.employees rpts
      ON rpts.reporting_manager_id = base.reporting_manager_id
      AND rpts.employment_status = 'Active'
      AND rpts.active_status = 1
    LEFT JOIN (
      SELECT
        adr.employee_id,
        ROUND(
          SUM(CASE WHEN adr.attendance_status = 'present' THEN 1.0
                   WHEN adr.attendance_status = 'half_day' THEN 0.5
                   ELSE 0 END)
          / NULLIF(COUNT(adr.record_date), 0) * 100
        , 2) AS att_pct
      FROM mas_hrms.attendance_daily_record adr
      WHERE adr.record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY adr.employee_id
    ) dr ON dr.employee_id = rpts.id
    LEFT JOIN (
      SELECT
        ei.id AS employee_id,
        AVG(cqa.quality_percentage) AS avg_quality
      FROM mas_hrms.employees ei
      JOIN db_audit.call_quality_assessment cqa ON ei.employee_code = cqa.User
      WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY ei.id
    ) qm ON qm.employee_id = rpts.id
    WHERE base.id = ?
  )
  SELECT
    -- Core employee attributes
    DATEDIFF(NOW(), e.date_of_joining)   AS aon_days,
    e.ctc,
    CASE
      WHEN UPPER(REPLACE(TRIM(COALESCE(e.source, '')), ' ', ''))
           IN ('WALKIN','WALKIIN','WALKINN')
      THEN 'Walk-in'
      ELSE COALESCE(e.source, '')
    END AS source_normalised,
    -- Attendance
    COALESCE(att.att_pct, 100)           AS att_pct,
    -- Quality signals
    COALESCE(q.quality_velocity, 0)      AS quality_velocity,
    CASE WHEN COALESCE(q.quality_row_count, 0) > 0 THEN 1 ELSE 0 END
                                         AS has_quality_data,
    -- Manager risk
    COALESCE(mr.manager_risk_score, 0)   AS manager_risk_score,
    -- Team exits
    COALESCE(te.team_30d_exits, 0)       AS team_30d_exits,
    -- PIP
    CASE
      WHEN EXISTS (
        SELECT 1 FROM mas_hrms.pip_record pr
        WHERE pr.employee_id = e.id AND pr.status = 'active'
      ) THEN 1 ELSE 0
    END AS active_pip,
    -- Dialer drop
    ROUND(
      (COALESCE(d.prior_avg, 0) - COALESCE(d.recent_avg, 0))
      / NULLIF(d.prior_avg, 0) * 100
    , 2) AS dialer_drop_pct,
    -- Pre-computed risk score (mirrors predictive-attrition.service.ts formula)
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
          WHEN COALESCE(q.quality_velocity, 0) < -15 THEN 20
          WHEN COALESCE(q.quality_velocity, 0) < -8  THEN 12
          WHEN COALESCE(q.quality_row_count, 0) > 0
               AND (SELECT AVG(cqa2.quality_percentage)
                    FROM db_audit.call_quality_assessment cqa2
                    JOIN mas_hrms.employees ei2 ON ei2.employee_code = cqa2.User
                    WHERE ei2.id = e.id
                      AND cqa2.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)) < 65
               THEN 15
          WHEN COALESCE(q.quality_row_count, 0) > 0
               AND (SELECT AVG(cqa2.quality_percentage)
                    FROM db_audit.call_quality_assessment cqa2
                    JOIN mas_hrms.employees ei2 ON ei2.employee_code = cqa2.User
                    WHERE ei2.id = e.id
                      AND cqa2.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)) < 75
               THEN 8
          ELSE 0
        END
      + CASE
          WHEN UPPER(REPLACE(TRIM(COALESCE(e.source, '')), ' ', ''))
               IN ('WALKIN','WALKIIN','WALKINN')
               AND DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 10
          ELSE 0
        END
      + CASE
          WHEN COALESCE(e.ctc, 99999) < 12000 THEN 8
          WHEN COALESCE(e.ctc, 99999) < 15000 THEN 4
          ELSE 0
        END
      + CASE
          WHEN (SELECT SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END)
                FROM mas_hrms.attendance_daily_record
                WHERE employee_id = e.id
                  AND record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)) > 8 THEN 7
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
               AND COALESCE(
                 (SELECT AVG(cqa2.quality_percentage)
                  FROM db_audit.call_quality_assessment cqa2
                  JOIN mas_hrms.employees ei2 ON ei2.employee_code = cqa2.User
                  WHERE ei2.id = e.id
                    AND cqa2.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY))
               , 0) > 80
          THEN 10
          ELSE 0
        END
    )) AS prediction_score,
    CASE
      WHEN GREATEST(0, LEAST(100,
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
            WHEN COALESCE(q.quality_velocity, 0) < -15 THEN 20
            WHEN COALESCE(q.quality_velocity, 0) < -8  THEN 12
            ELSE 0
          END
        + CASE
            WHEN UPPER(REPLACE(TRIM(COALESCE(e.source, '')), ' ', ''))
                 IN ('WALKIN','WALKIIN','WALKINN')
                 AND DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 10
            ELSE 0
          END
        + CASE
            WHEN COALESCE(e.ctc, 99999) < 12000 THEN 8
            WHEN COALESCE(e.ctc, 99999) < 15000 THEN 4
            ELSE 0
          END
        + CASE
            WHEN EXISTS (
              SELECT 1 FROM mas_hrms.pip_record pr
              WHERE pr.employee_id = e.id AND pr.status = 'active'
            ) THEN 5
            ELSE 0
          END
      )) >= 75 THEN 'CRITICAL'
      WHEN GREATEST(0, LEAST(100,
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
            WHEN COALESCE(q.quality_velocity, 0) < -15 THEN 20
            WHEN COALESCE(q.quality_velocity, 0) < -8  THEN 12
            ELSE 0
          END
        + CASE
            WHEN UPPER(REPLACE(TRIM(COALESCE(e.source, '')), ' ', ''))
                 IN ('WALKIN','WALKIIN','WALKINN')
                 AND DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 10
            ELSE 0
          END
        + CASE
            WHEN COALESCE(e.ctc, 99999) < 12000 THEN 8
            WHEN COALESCE(e.ctc, 99999) < 15000 THEN 4
            ELSE 0
          END
        + CASE
            WHEN EXISTS (
              SELECT 1 FROM mas_hrms.pip_record pr
              WHERE pr.employee_id = e.id AND pr.status = 'active'
            ) THEN 5
            ELSE 0
          END
      )) >= 55 THEN 'HIGH'
      WHEN GREATEST(0, LEAST(100,
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
            WHEN COALESCE(q.quality_velocity, 0) < -15 THEN 20
            WHEN COALESCE(q.quality_velocity, 0) < -8  THEN 12
            ELSE 0
          END
        + CASE
            WHEN UPPER(REPLACE(TRIM(COALESCE(e.source, '')), ' ', ''))
                 IN ('WALKIN','WALKIIN','WALKINN')
                 AND DATEDIFF(NOW(), e.date_of_joining) <= 30 THEN 10
            ELSE 0
          END
        + CASE
            WHEN COALESCE(e.ctc, 99999) < 12000 THEN 8
            WHEN COALESCE(e.ctc, 99999) < 15000 THEN 4
            ELSE 0
          END
        + CASE
            WHEN EXISTS (
              SELECT 1 FROM mas_hrms.pip_record pr
              WHERE pr.employee_id = e.id AND pr.status = 'active'
            ) THEN 5
            ELSE 0
          END
      )) >= 35 THEN 'MEDIUM'
      ELSE 'LOW'
    END AS risk_tier
  FROM mas_hrms.employees e
  LEFT JOIN att_cte att         ON att.employee_id = e.id
  LEFT JOIN quality_cte q       ON q.employee_id   = e.id
  LEFT JOIN dialer_cte d        ON d.employee_id   = e.id
  LEFT JOIN team_exit_cte te    ON 1 = 1
  LEFT JOIN manager_risk_cte mr ON 1 = 1
  WHERE e.id = ?
    AND e.employment_status = 'Active'
    AND e.active_status = 1
  LIMIT 1
`;

// ---------------------------------------------------------------------------
// Function 1: generateRecommendationsForEmployee (internal)
// ---------------------------------------------------------------------------

/**
 * Gathers signals for a single employee, applies all matching rules, and
 * upserts a recommendation record into employee_retention_recommendation.
 * On duplicate (same employee_id + calendar date), the existing row is
 * refreshed with the latest signal values and recommendations.
 *
 * @param employeeId  UUID / CHAR(36) employee id from mas_hrms.employees.id
 * @returns           The stored recommendation object
 */
export async function generateRecommendationsForEmployee(
  employeeId: string
): Promise<object> {
  // Bind ? in order: att_cte, quality_cte, dialer_cte, team_exit_cte (×2),
  // manager_risk_cte, final WHERE
  const [rows] = await pool.query<SignalsRow[]>(SIGNALS_QUERY, [
    employeeId,  // att_cte
    employeeId,  // quality_cte
    employeeId,  // dialer_cte
    employeeId,  // team_exit_cte base join
    employeeId,  // manager_risk_cte base join
    employeeId   // final WHERE e.id = ?
  ]);

  if (rows.length === 0) {
    throw new Error(`No active employee found with id ${employeeId}`);
  }

  const row = rows[0];

  const signals: Signals = {
    prediction_score:  row.prediction_score ?? 0,
    aon_days:          row.aon_days ?? 0,
    quality_velocity:  row.quality_velocity ?? 0,
    manager_risk_score: row.manager_risk_score ?? 0,
    team_30d_exits:    row.team_30d_exits ?? 0,
    att_pct:           row.att_pct ?? 100,
    source_normalised: row.source_normalised ?? '',
    has_quality_data:  row.has_quality_data === 1,
    active_pip:        row.active_pip === 1,
    ctc:               row.ctc ?? 99999,
    dialer_drop_pct:   row.dialer_drop_pct ?? 0
  };

  // Apply rules in order; all matching rules are included
  const matched: Recommendation[] = RULES
    .filter((rule) => rule.condition(signals))
    .map(({ signal, priority, owner, action, reason }) => ({
      signal,
      priority,
      owner,
      action,
      reason
    }));

  const riskTier = row.risk_tier as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  const recommendationsJson = JSON.stringify(matched);
  const newId = uuidv4();

  // Upsert: if a row already exists for this employee on today's date, refresh it
  const upsertSql = `
    INSERT INTO mas_hrms.employee_retention_recommendation
      (id, employee_id, generated_at, risk_tier, prediction_score, recommendations,
       action_taken, outcome)
    VALUES
      (?, ?, NOW(), ?, ?, ?, 0, 'pending')
    ON DUPLICATE KEY UPDATE
      generated_at      = NOW(),
      risk_tier         = VALUES(risk_tier),
      prediction_score  = VALUES(prediction_score),
      recommendations   = VALUES(recommendations)
  `;

  await pool.query<ResultSetHeader>(upsertSql, [
    newId,
    employeeId,
    riskTier,
    signals.prediction_score,
    recommendationsJson
  ]);

  return {
    employee_id:      employeeId,
    risk_tier:        riskTier,
    prediction_score: signals.prediction_score,
    recommendations:  matched,
    generated_at:     new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// Handler 2: getPendingInterventions
// ---------------------------------------------------------------------------

/**
 * GET /api/analytics/intervention-recommendations/pending
 * Query params: owner (hr_admin|manager|wfm|process_head), limit (default 50)
 *
 * Returns open recommendations (action_taken = 0, outcome = 'pending') where
 * the JSON recommendations array contains at least one entry matching the
 * requested owner.  Joins to employees for display fields.
 */
export async function getPendingInterventions(req: Request, res: Response) {
  try {
    const owner = (req.query.owner as string | undefined)?.trim() ?? null;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    // Build owner filter as a JSON_SEARCH condition when supplied
    const ownerClause = owner
      ? `AND JSON_SEARCH(r.recommendations, 'one', ?, NULL, '$[*].owner') IS NOT NULL`
      : '';
    const params: (string | number)[] = [];
    if (owner) params.push(owner);
    params.push(limit);

    const sql = `
      SELECT
        r.id,
        r.employee_id,
        e.employee_code,
        CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
        COALESCE(bm.branch_name, '')      AS branch_name,
        COALESCE(p.process_name,  '')     AS process_name,
        COALESCE(d.designation_name, '')  AS designation_name,
        r.generated_at,
        DATEDIFF(NOW(), r.generated_at)   AS days_since_generated,
        r.risk_tier,
        r.prediction_score,
        r.recommendations
      FROM mas_hrms.employee_retention_recommendation r
      JOIN mas_hrms.employees e   ON e.id = r.employee_id
      LEFT JOIN mas_hrms.branch_master bm       ON bm.id = e.branch_id
      LEFT JOIN mas_hrms.process_master p       ON p.id  = e.process_id
      LEFT JOIN mas_hrms.designation_master d   ON d.id  = e.designation_id
      WHERE r.action_taken = 0
        AND r.outcome = 'pending'
        ${ownerClause}
      ORDER BY
        FIELD(r.risk_tier, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'),
        r.generated_at ASC
      LIMIT ?
    `;

    const [rows] = await pool.query<PendingInterventionRow[]>(sql, params);

    const data = rows.map((row) => ({
      ...row,
      recommendations: (() => {
        try {
          return typeof row.recommendations === 'string'
            ? JSON.parse(row.recommendations)
            : row.recommendations;
        } catch {
          return [];
        }
      })()
    }));

    res.json({
      success: true,
      count: data.length,
      filters: { owner: owner ?? null, limit },
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getPendingInterventions:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch pending interventions' });
  }
}

// ---------------------------------------------------------------------------
// Handler 3: markInterventionActioned
// ---------------------------------------------------------------------------

/**
 * PATCH /api/analytics/intervention-recommendations/:id
 * Body: { outcome?: 'retained'|'exited'|'pending', outcome_date?: string }
 *
 * Sets action_taken=1, action_taken_at=NOW(), action_taken_by=req.user.id.
 * Optionally updates outcome and outcome_date.
 */
export async function markInterventionActioned(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { outcome, outcome_date } = req.body as {
      outcome?: 'retained' | 'exited' | 'pending';
      outcome_date?: string;
    };

    const actorId = (req as Request & { authUser?: { id: string } }).authUser?.id ?? null;

    if (!id) {
      return res.status(400).json({ success: false, error: 'Missing recommendation id' });
    }

    const validOutcomes = ['retained', 'exited', 'pending'];
    if (outcome && !validOutcomes.includes(outcome)) {
      return res.status(400).json({
        success: false,
        error: `Invalid outcome. Must be one of: ${validOutcomes.join(', ')}`
      });
    }

    const setClauses: string[] = [
      'action_taken    = 1',
      'action_taken_at = NOW()',
      'action_taken_by = ?'
    ];
    const params: (string | null)[] = [actorId];

    if (outcome) {
      setClauses.push('outcome = ?');
      params.push(outcome);
    }
    if (outcome_date) {
      setClauses.push('outcome_date = ?');
      params.push(outcome_date);
    }

    params.push(id);

    const sql = `
      UPDATE mas_hrms.employee_retention_recommendation
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `;

    const [result] = await pool.query<ResultSetHeader>(sql, params);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: `Recommendation not found: ${id}`
      });
    }

    res.json({
      success: true,
      message: 'Intervention marked as actioned',
      id,
      outcome: outcome ?? null,
      outcome_date: outcome_date ?? null,
      actioned_by: actorId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in markInterventionActioned:', error);
    res.status(500).json({ success: false, error: 'Failed to update intervention' });
  }
}

// ---------------------------------------------------------------------------
// Handler 4: getInterventionOutcomes
// ---------------------------------------------------------------------------

/**
 * GET /api/analytics/intervention-recommendations/outcomes
 *
 * Returns aggregate outcome metrics across all stored recommendations:
 * total_generated, action_taken_count, retained_count, exited_count,
 * pending_count, retention_success_rate, avg_days_to_action.
 */
export async function getInterventionOutcomes(req: Request, res: Response) {
  try {
    const sql = `
      SELECT
        COUNT(*)                                               AS total_generated,
        SUM(action_taken)                                      AS action_taken_count,
        SUM(CASE WHEN outcome = 'retained' THEN 1 ELSE 0 END) AS retained_count,
        SUM(CASE WHEN outcome = 'exited'   THEN 1 ELSE 0 END) AS exited_count,
        SUM(CASE WHEN outcome = 'pending'  THEN 1 ELSE 0 END) AS pending_count,
        ROUND(
          AVG(
            CASE
              WHEN action_taken = 1 AND action_taken_at IS NOT NULL
              THEN TIMESTAMPDIFF(DAY, generated_at, action_taken_at)
            END
          )
        , 1) AS avg_days_to_action
      FROM mas_hrms.employee_retention_recommendation
    `;

    const [rows] = await pool.query<OutcomeSummaryRow[]>(sql);
    const row = rows[0];

    const retained = row?.retained_count ?? 0;
    const exited   = row?.exited_count   ?? 0;
    const resolved = retained + exited;
    const retentionSuccessRate = resolved > 0
      ? parseFloat(((retained / resolved) * 100).toFixed(1))
      : null;

    res.json({
      success: true,
      analysis_type: 'INTERVENTION_OUTCOMES',
      data: {
        total_generated:        row?.total_generated       ?? 0,
        action_taken_count:     row?.action_taken_count    ?? 0,
        retained_count:         retained,
        exited_count:           exited,
        pending_count:          row?.pending_count         ?? 0,
        retention_success_rate: retentionSuccessRate,
        avg_days_to_action:     row?.avg_days_to_action    ?? null
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getInterventionOutcomes:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch intervention outcomes' });
  }
}
