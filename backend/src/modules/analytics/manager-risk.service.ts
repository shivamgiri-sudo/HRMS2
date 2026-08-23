/**
 * Manager Risk Service
 * File: backend/src/modules/analytics/manager-risk.service.ts
 * Purpose: Compute team-level risk metrics per reporting manager.
 *
 * Manager Risk Score formula:
 *   ROUND(
 *     COALESCE(team_shrinkage_pct, 0)      * 0.30 +
 *     COALESCE(team_30d_attrition_pct, 0)  * 0.40 +
 *     GREATEST(0, 100 - COALESCE(team_avg_quality, 75)) * 0.20 +
 *     CASE WHEN team_size > 15 THEN 10 WHEN team_size > 12 THEN 5 ELSE 0 END * 0.10
 *   , 1)
 *
 * Risk level: CRITICAL >= 60, HIGH >= 40, MEDIUM >= 20, LOW < 20
 */

import { Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { db as pool } from '../../db/mysql.js';

function resolveRiskLevel(score: number): string {
  if (score >= 60) return 'CRITICAL';
  if (score >= 40) return 'HIGH';
  if (score >= 20) return 'MEDIUM';
  return 'LOW';
}

/**
 * FAST CTE - excludes quality cross-database join for quick response.
 * Used for leaderboard endpoint.
 */
function buildFastManagerMetricsCTE(extraWhere: string): string {
  return `
    WITH manager_metrics AS (
      SELECT
        mgr.id                                                                      AS manager_id,
        mgr.employee_code,
        CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, ''))                   AS manager_name,
        d.designation_name,
        bm.branch_name,
        p.process_name,
        COUNT(DISTINCT team.id)                                                     AS team_size,
        /* Shrinkage: (emp-days - present - half_day - week_off_worked) / emp-days * 100 */
        ROUND(
          (1 -
            COUNT(DISTINCT CASE
              WHEN adr.attendance_status IN ('present', 'half_day', 'week_off_worked')
              THEN CONCAT(team.id, '_', adr.record_date)
            END) /
            NULLIF(COUNT(DISTINCT CONCAT(team.id, '_', adr.record_date)), 0)
          ) * 100
        , 2)                                                                        AS team_shrinkage_pct,
        /* 30-day attrition pct: exits in last 30 days / team size * 100 */
        ROUND(
          COUNT(DISTINCT CASE
            WHEN team.date_of_exit >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN team.id
          END) /
          NULLIF(COUNT(DISTINCT team.id), 0) * 100
        , 2)                                                                        AS team_30d_attrition_pct,
        /* Quality excluded for fast response - use 75 as default (neutral) */
        75.0                                                                        AS team_avg_quality,
        /* Critical members: attendance < 80% in last 60 days (quality excluded) */
        COUNT(DISTINCT CASE
          WHEN (
            (SELECT ROUND(
                     COUNT(DISTINCT CASE WHEN a2.attendance_status IN ('present','half_day') THEN a2.record_date END) /
                     NULLIF(COUNT(DISTINCT a2.record_date), 0) * 100
                   , 2)
               FROM attendance_daily_record a2
              WHERE a2.employee_id = team.id
                AND a2.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)) < 80
          )
          THEN team.id
        END)                                                                        AS critical_employees_count
      FROM employees mgr
      JOIN employees team
        ON  team.reporting_manager_id = mgr.id
        AND team.active_status = 1
        AND team.employment_status = 'Active'
      LEFT JOIN designation_master d  ON mgr.designation_id = d.id
      LEFT JOIN branch_master bm      ON mgr.branch_id = bm.id
      LEFT JOIN process_master p      ON mgr.process_id = p.id
      LEFT JOIN attendance_daily_record adr
        ON  adr.employee_id = team.id
        AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
      WHERE mgr.active_status = 1
        AND mgr.employment_status = 'Active'
        ${extraWhere}
      GROUP BY mgr.id
      HAVING COUNT(DISTINCT team.id) >= 3
    )
  `;
}

/**
 * FULL CTE - includes quality cross-database join for detailed views.
 * Returns a SQL fragment and a params-prefix array.
 * branchClause / processClause are safe `AND field = ?` strings.
 */
function buildManagerMetricsCTE(extraWhere: string): string {
  return `
    WITH manager_metrics AS (
      SELECT
        mgr.id                                                                      AS manager_id,
        mgr.employee_code,
        CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, ''))                   AS manager_name,
        d.designation_name,
        bm.branch_name,
        p.process_name,
        COUNT(DISTINCT team.id)                                                     AS team_size,
        /* Shrinkage: (emp-days - present - half_day - week_off_worked) / emp-days * 100 */
        ROUND(
          (1 -
            COUNT(DISTINCT CASE
              WHEN adr.attendance_status IN ('present', 'half_day', 'week_off_worked')
              THEN CONCAT(team.id, '_', adr.record_date)
            END) /
            NULLIF(COUNT(DISTINCT CONCAT(team.id, '_', adr.record_date)), 0)
          ) * 100
        , 2)                                                                        AS team_shrinkage_pct,
        /* 30-day attrition pct: exits in last 30 days / team size * 100 */
        ROUND(
          COUNT(DISTINCT CASE
            WHEN team.date_of_exit >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN team.id
          END) /
          NULLIF(COUNT(DISTINCT team.id), 0) * 100
        , 2)                                                                        AS team_30d_attrition_pct,
        /* Team average quality (60d, db_audit cross-DB join) */
        ROUND(AVG(cqa.quality_percentage), 2)                                      AS team_avg_quality,
        /* Critical members: attendance < 80% OR avg quality < 65 in last 60 days */
        COUNT(DISTINCT CASE
          WHEN (
            (SELECT ROUND(
                     COUNT(DISTINCT CASE WHEN a2.attendance_status IN ('present','half_day') THEN a2.record_date END) /
                     NULLIF(COUNT(DISTINCT a2.record_date), 0) * 100
                   , 2)
               FROM attendance_daily_record a2
              WHERE a2.employee_id = team.id
                AND a2.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)) < 80
          ) OR (
            (SELECT ROUND(AVG(q2.quality_percentage), 2)
               FROM db_audit.call_quality_assessment q2
              WHERE q2.User = team.employee_code
                AND q2.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)) < 65
          )
          THEN team.id
        END)                                                                        AS critical_employees_count
      FROM employees mgr
      JOIN employees team
        ON  team.reporting_manager_id = mgr.id
        AND team.active_status = 1
        AND team.employment_status = 'Active'
      LEFT JOIN designation_master d  ON mgr.designation_id = d.id
      LEFT JOIN branch_master bm      ON mgr.branch_id = bm.id
      LEFT JOIN process_master p      ON mgr.process_id = p.id
      LEFT JOIN attendance_daily_record adr
        ON  adr.employee_id = team.id
        AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
      LEFT JOIN db_audit.call_quality_assessment cqa
        ON  cqa.User = team.employee_code
        AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)
      WHERE mgr.active_status = 1
        AND mgr.employment_status = 'Active'
        ${extraWhere}
      GROUP BY mgr.id
      HAVING COUNT(DISTINCT team.id) >= 3
    )
  `;
}

const SCORE_EXPR = `
  ROUND(
    COALESCE(team_shrinkage_pct, 0)     * 0.30 +
    COALESCE(team_30d_attrition_pct, 0) * 0.40 +
    GREATEST(0, 100 - COALESCE(team_avg_quality, 75)) * 0.20 +
    CASE WHEN team_size > 15 THEN 10 WHEN team_size > 12 THEN 5 ELSE 0 END * 0.10
  , 1)
`;

const LEVEL_EXPR = `
  CASE
    WHEN ${SCORE_EXPR} >= 60 THEN 'CRITICAL'
    WHEN ${SCORE_EXPR} >= 40 THEN 'HIGH'
    WHEN ${SCORE_EXPR} >= 20 THEN 'MEDIUM'
    ELSE 'LOW'
  END
`;

/**
 * GET /api/analytics/manager-risk/leaderboard
 * All managers with team >= 3, ranked by risk score DESC.
 * Query params: branchId, processId, limit (default 50), riskLevel
 *
 * PERFORMANCE: Uses FAST CTE (no quality cross-db join) for quick response.
 * Quality factor uses default 75 (neutral) - for detailed quality, use /critical endpoint.
 */
export async function getManagerRiskLeaderboard(req: Request, res: Response) {
  try {
    const { branchId, processId, limit = 50, riskLevel } = req.query;
    const callerRoles: string[] = (req as any).authUser?.roles ?? [(req as any).authUser?.role ?? ''];
    const callerId: string | undefined = (req as any).authUser?.id;
    const isManagerOnly = callerRoles.every(r =>
      !['super_admin', 'admin', 'hr'].includes(r)
    ) && callerRoles.some(r => r === 'manager');

    const whereParts: string[] = [];
    const params: unknown[] = [];

    if (branchId) { whereParts.push('AND mgr.branch_id = ?'); params.push(branchId); }
    if (processId) { whereParts.push('AND mgr.process_id = ?'); params.push(processId); }
    // Managers can only see their own row in the leaderboard
    if (isManagerOnly && callerId) {
      whereParts.push('AND mgr.id = ?');
      params.push(callerId);
    }

    const extraWhere = whereParts.join(' ');
    params.push(parseInt(limit as string) || 50);

    const query =
      buildFastManagerMetricsCTE(extraWhere) +
      `SELECT
         manager_id,
         employee_code,
         manager_name,
         designation_name,
         branch_name,
         process_name,
         team_size,
         COALESCE(team_shrinkage_pct, 0)     AS team_shrinkage_pct,
         COALESCE(team_30d_attrition_pct, 0) AS team_30d_attrition_pct,
         COALESCE(team_avg_quality, 75)       AS team_avg_quality,
         critical_employees_count,
         ${SCORE_EXPR} AS manager_risk_score,
         ${LEVEL_EXPR} AS risk_level
       FROM manager_metrics
       ORDER BY manager_risk_score DESC
       LIMIT ?`;

    const [rows] = await pool.query<RowDataPacket[]>(query, params);

    const filtered = riskLevel
      ? rows.filter(r => r.risk_level === (riskLevel as string).toUpperCase())
      : rows;

    res.json({
      success: true,
      analysis_type: 'MANAGER_RISK_LEADERBOARD',
      count: filtered.length,
      data: filtered,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getManagerRiskLeaderboard:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch manager risk leaderboard' });
  }
}

/**
 * GET /api/analytics/manager-risk/critical
 * Managers with CRITICAL or HIGH risk only, no limit.
 */
export async function getCriticalManagers(req: Request, res: Response) {
  try {
    const query =
      buildManagerMetricsCTE('') +
      `SELECT
         manager_id,
         employee_code,
         manager_name,
         designation_name,
         branch_name,
         process_name,
         team_size,
         COALESCE(team_shrinkage_pct, 0)     AS team_shrinkage_pct,
         COALESCE(team_30d_attrition_pct, 0) AS team_30d_attrition_pct,
         COALESCE(team_avg_quality, 75)       AS team_avg_quality,
         critical_employees_count,
         ${SCORE_EXPR} AS manager_risk_score,
         ${LEVEL_EXPR} AS risk_level
       FROM manager_metrics
       HAVING risk_level IN ('CRITICAL', 'HIGH')
       ORDER BY manager_risk_score DESC`;

    const [rows] = await pool.query<RowDataPacket[]>(query);

    res.json({
      success: true,
      analysis_type: 'CRITICAL_MANAGERS',
      count: rows.length,
      data: rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getCriticalManagers:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch critical managers' });
  }
}

/**
 * GET /api/analytics/manager-risk/:managerId
 * Manager summary + team member drilldown (id or employee_code).
 */
export async function getManagerTeamDrilldown(req: Request, res: Response) {
  try {
    const { managerId } = req.params;

    // Manager summary row
    const [mgrRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         mgr.id                                                                    AS manager_id,
         mgr.employee_code,
         CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, ''))                 AS manager_name,
         d.designation_name,
         bm.branch_name,
         p.process_name,
         COUNT(DISTINCT team.id)                                                   AS team_size,
         ROUND(
           (1 -
             COUNT(DISTINCT CASE
               WHEN adr.attendance_status IN ('present','half_day','week_off_worked')
               THEN CONCAT(team.id,'_',adr.record_date)
             END) /
             NULLIF(COUNT(DISTINCT CONCAT(team.id,'_',adr.record_date)), 0)
           ) * 100
         , 2)                                                                      AS team_shrinkage_pct,
         ROUND(
           COUNT(DISTINCT CASE
             WHEN team.date_of_exit >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN team.id
           END) /
           NULLIF(COUNT(DISTINCT team.id), 0) * 100
         , 2)                                                                      AS team_30d_attrition_pct,
         ROUND(AVG(cqa.quality_percentage), 2)                                    AS team_avg_quality,
         ROUND(
           COALESCE(
             (1 -
               COUNT(DISTINCT CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN CONCAT(team.id,'_',adr.record_date) END) /
               NULLIF(COUNT(DISTINCT CONCAT(team.id,'_',adr.record_date)), 0)
             ) * 100
           , 0) * 0.30 +
           COALESCE(
             COUNT(DISTINCT CASE WHEN team.date_of_exit >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN team.id END) /
             NULLIF(COUNT(DISTINCT team.id), 0) * 100
           , 0) * 0.40 +
           GREATEST(0, 100 - COALESCE(AVG(cqa.quality_percentage), 75)) * 0.20 +
           CASE
             WHEN COUNT(DISTINCT team.id) > 15 THEN 10
             WHEN COUNT(DISTINCT team.id) > 12 THEN 5
             ELSE 0
           END * 0.10
         , 1)                                                                      AS manager_risk_score
       FROM employees mgr
       JOIN employees team
         ON  team.reporting_manager_id = mgr.id
         AND team.active_status = 1
         AND team.employment_status = 'Active'
       LEFT JOIN designation_master d  ON mgr.designation_id = d.id
       LEFT JOIN branch_master bm      ON mgr.branch_id = bm.id
       LEFT JOIN process_master p      ON mgr.process_id = p.id
       LEFT JOIN attendance_daily_record adr
         ON  adr.employee_id = team.id
         AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
       LEFT JOIN db_audit.call_quality_assessment cqa
         ON  cqa.User = team.employee_code
         AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)
       WHERE (mgr.id = ? OR mgr.employee_code = ?)
       GROUP BY mgr.id`,
      [managerId, managerId]
    );

    if (!mgrRows.length) {
      return res.status(404).json({ success: false, error: 'Manager not found' });
    }

    const managerSummary = mgrRows[0] as any;

    // Team members drilldown
    const [teamRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         e.employee_code,
         CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))                AS employee_name,
         DATEDIFF(NOW(), e.date_of_joining)                                   AS aon_days,
         d.designation_name,
         /* Attendance 60d */
         ROUND(
           (SELECT COUNT(DISTINCT a1.record_date)
              FROM attendance_daily_record a1
             WHERE a1.employee_id = e.id
               AND a1.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
               AND a1.attendance_status IN ('present', 'half_day'))
           / NULLIF(
               (SELECT COUNT(DISTINCT a2.record_date)
                  FROM attendance_daily_record a2
                 WHERE a2.employee_id = e.id
                   AND a2.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY))
             , 0) * 100
         , 2)                                                                  AS attendance_pct,
         /* Avg quality 60d */
         (SELECT ROUND(AVG(cq1.quality_percentage), 2)
            FROM db_audit.call_quality_assessment cq1
           WHERE cq1.User = e.employee_code
             AND cq1.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)
         )                                                                      AS avg_quality,
         /* Late marks 30d */
         (SELECT COUNT(DISTINCT a3.record_date)
            FROM attendance_daily_record a3
           WHERE a3.employee_id = e.id
             AND a3.is_late = 1
             AND a3.record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         )                                                                      AS late_marks_30d,
         /* Prediction score: compound formula consistent with attritionRisk.service */
         ROUND(
           CASE
             WHEN (SELECT ROUND(AVG(cq2.quality_percentage), 2)
                     FROM db_audit.call_quality_assessment cq2
                    WHERE cq2.User = e.employee_code
                      AND cq2.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)) < 60 THEN 40
             WHEN (SELECT ROUND(AVG(cq2.quality_percentage), 2)
                     FROM db_audit.call_quality_assessment cq2
                    WHERE cq2.User = e.employee_code
                      AND cq2.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)) < 70 THEN 30
             WHEN (SELECT ROUND(AVG(cq2.quality_percentage), 2)
                     FROM db_audit.call_quality_assessment cq2
                    WHERE cq2.User = e.employee_code
                      AND cq2.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)) < 75 THEN 15
             ELSE 5
           END +
           CASE
             WHEN (SELECT ROUND(
                            COUNT(DISTINCT CASE WHEN a4.attendance_status IN ('present','half_day') THEN a4.record_date END) /
                            NULLIF(COUNT(DISTINCT a4.record_date), 0) * 100
                          , 2)
                     FROM attendance_daily_record a4
                    WHERE a4.employee_id = e.id
                      AND a4.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)) < 75 THEN 30
             WHEN (SELECT ROUND(
                            COUNT(DISTINCT CASE WHEN a4.attendance_status IN ('present','half_day') THEN a4.record_date END) /
                            NULLIF(COUNT(DISTINCT a4.record_date), 0) * 100
                          , 2)
                     FROM attendance_daily_record a4
                    WHERE a4.employee_id = e.id
                      AND a4.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)) < 85 THEN 20
             WHEN (SELECT ROUND(
                            COUNT(DISTINCT CASE WHEN a4.attendance_status IN ('present','half_day') THEN a4.record_date END) /
                            NULLIF(COUNT(DISTINCT a4.record_date), 0) * 100
                          , 2)
                     FROM attendance_daily_record a4
                    WHERE a4.employee_id = e.id
                      AND a4.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)) < 90 THEN 10
             ELSE 5
           END +
           CASE
             WHEN DATEDIFF(NOW(), e.date_of_joining) < 90  THEN 15
             WHEN DATEDIFF(NOW(), e.date_of_joining) < 180 THEN 10
             ELSE 0
           END +
           CASE
             WHEN (SELECT COUNT(DISTINCT e3.id) FROM employees e3
                   WHERE e3.reporting_manager_id = e.reporting_manager_id AND e3.active_status = 1) > 15 THEN 10
             WHEN (SELECT COUNT(DISTINCT e3.id) FROM employees e3
                   WHERE e3.reporting_manager_id = e.reporting_manager_id AND e3.active_status = 1) > 12 THEN 5
             ELSE 0
           END
         , 1)                                                                    AS prediction_score
       FROM employees e
       LEFT JOIN designation_master d ON e.designation_id = d.id
       WHERE e.reporting_manager_id = (
               SELECT id FROM employees
               WHERE id = ? OR employee_code = ?
               LIMIT 1)
         AND e.active_status = 1
         AND e.employment_status = 'Active'
       ORDER BY prediction_score DESC`,
      [managerId, managerId]
    );

    const riskScore = Number(managerSummary.manager_risk_score ?? 0);

    res.json({
      success: true,
      analysis_type: 'MANAGER_TEAM_DRILLDOWN',
      manager: {
        ...managerSummary,
        risk_level: resolveRiskLevel(riskScore)
      },
      team_count: teamRows.length,
      team_members: teamRows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getManagerTeamDrilldown:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch manager team drilldown' });
  }
}
