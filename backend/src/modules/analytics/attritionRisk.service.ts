/**
 * Attrition Risk & Performance Degradation Analytics Service
 * File: backend/src/modules/analytics/attritionRisk.service.ts
 * Purpose: Expose multi-factor attrition risk analysis via REST API
 * Queries: Performance degradation, absenteeism correlation, compound risk profiles
 */

import { Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { db as pool } from '../../db/mysql.js';

interface AttritionRiskAgent {
  RISK_AGENT: string;
  agent_name: string;
  tenure_months: number;
  avg_quality_score: number;
  attendance_pct: number;
  ATTRITION_RISK_SCORE: number;
  DEGRADATION_RATE: number;
  INTERVENTION_PRIORITY: string;
  designation_name?: string;
  process_name?: string;
  branch_name?: string;
}

interface PerformanceDegradationRecord {
  RISK_AGENT: string;
  agent_name: string;
  week_num: number;
  weekly_avg_quality: number;
  prev_week_avg_quality?: number;
  quality_delta: number;
  performance_trend: string;
  call_count: number;
  tenure_months: number;
}

interface AbsenteeismCorrelation {
  RISK_AGENT: string;
  agent_name: string;
  present_days: number;
  total_days: number;
  DEGRADATION_RATE: number;
  avg_quality_score: number;
  ATTRITION_RISK_SCORE: number;
  INTERVENTION_PRIORITY: string;
  tenure_months: number;
}

interface CompoundRiskProfile {
  RISK_AGENT: string;
  agent_name: string;
  designation_name: string;
  experience_level: string;
  team_size: number;
  team_load_level: string;
  avg_quality: number;
  attendance_pct: number;
  risk_level: string;
  ATTRITION_RISK_SCORE: number;
  DEGRADATION_RATE: number;
  INTERVENTION_PRIORITY: string;
}

interface QualityVelocity {
  RISK_AGENT: string;
  agent_name: string;
  current_week_quality: number;
  delta_week_1: number;
  delta_week_2: number;
  delta_week_3: number;
  trend_pattern: string;
  DEGRADATION_RATE: number;
  INTERVENTION_PRIORITY: string;
}

interface EarlyWarningIndicator {
  RISK_AGENT: string;
  agent_name: string;
  recent_absent_30d: number;
  prior_absent_30d: number;
  recent_audit_count: number;
  prior_audit_count: number;
  ATTRITION_RISK_SCORE: number;
  INTERVENTION_PRIORITY: string;
  recommended_action: string;
}

/**
 * GET /api/analytics/attrition-risk/performance-degradation
 * Detect agents with declining quality (30-day rolling avg)
 * Authorized: HR Admin, WFM Manager, Operations Manager
 */
export async function getPerformanceDegradation(req: Request, res: Response) {
  try {
    const { limit = 50, daysBack = 90 } = req.query;

    const query = `
      SELECT
        e.employee_code as RISK_AGENT,
        CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
        WEEK(cqa.CallDate, 1) as week_num,
        YEAR(cqa.CallDate) as year_num,
        COUNT(DISTINCT cqa.id) as call_count,
        ROUND(AVG(cqa.quality_percentage), 2) as weekly_avg_quality,
        LAG(ROUND(AVG(cqa.quality_percentage), 2))
          OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1)) as prev_week_avg_quality,
        ROUND(AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage))
          OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1)), 2) as quality_delta,
        CASE
          WHEN (AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage))
                OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1))) < -10 THEN 'RISK'
          WHEN (AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage))
                OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1))) < -5 THEN 'WARNING'
          ELSE 'STABLE'
        END as performance_trend,
        ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,
        d.designation_name,
        p.process_name,
        bm.branch_name
      FROM db_audit.call_quality_assessment cqa
      JOIN mas_hrms.employees e ON cqa.User = e.employee_code
      LEFT JOIN mas_hrms.designation_master d ON e.designation_id = d.id
      LEFT JOIN mas_hrms.process_master p ON e.process_id = p.id
      LEFT JOIN mas_hrms.branch_master bm ON e.branch_id = bm.id
      WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND e.employment_status = 'Active'
        AND e.active_status = 1
        AND cqa.quality_percentage IS NOT NULL
      GROUP BY
        e.id,
        YEAR(cqa.CallDate),
        WEEK(cqa.CallDate, 1)
      HAVING COUNT(DISTINCT cqa.id) >= 5
        AND LAG(AVG(cqa.quality_percentage)) OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1)) IS NOT NULL
        AND (AVG(cqa.quality_percentage) - LAG(AVG(cqa.quality_percentage))
             OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1))) < 0
      ORDER BY quality_delta ASC
      LIMIT ?
    `;

    const [rows] = await pool.query<RowDataPacket[]>(query, [parseInt(daysBack as string) || 90, parseInt(limit as string) || 50]);
    res.json({
      success: true,
      analysis_type: 'PERFORMANCE_DEGRADATION',
      count: rows.length,
      data: rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getPerformanceDegradation:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch performance degradation data' });
  }
}

/**
 * GET /api/analytics/attrition-risk/absenteeism-correlation
 * Correlate attendance patterns with quality degradation
 * Authorized: HR Admin, Operations Manager
 */
export async function getAbsenteeismCorrelation(req: Request, res: Response) {
  try {
    const { limit = 50, daysBack = 60 } = req.query;

    const query = `
      SELECT
        e.employee_code as RISK_AGENT,
        CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
        COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) as present_days,
        COUNT(DISTINCT adr.record_date) as total_days,
        ROUND((COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
               COUNT(DISTINCT adr.record_date) * 100), 2) as DEGRADATION_RATE,
        COUNT(DISTINCT CASE WHEN adr.attendance_status = 'absent' THEN adr.record_date END) as absent_days,
        ROUND(AVG(cqa.quality_percentage), 2) as avg_quality_score,
        COUNT(DISTINCT cqa.id) as audited_calls,
        ROUND(
          CASE
            WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
                  COUNT(DISTINCT adr.record_date) * 100) < 75 THEN 30
            WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
                  COUNT(DISTINCT adr.record_date) * 100) < 85 THEN 20
            ELSE 10
          END +
          CASE
            WHEN AVG(cqa.quality_percentage) < 60 THEN 50
            WHEN AVG(cqa.quality_percentage) < 70 THEN 40
            WHEN AVG(cqa.quality_percentage) < 80 THEN 20
            ELSE 5
          END
        , 1) as ATTRITION_RISK_SCORE,
        CASE
          WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
                COUNT(DISTINCT adr.record_date) * 100) < 80
            AND AVG(cqa.quality_percentage) < 75 THEN 'CRITICAL'
          WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
                COUNT(DISTINCT adr.record_date) * 100) < 85
            AND AVG(cqa.quality_percentage) < 80 THEN 'HIGH_PRIORITY'
          ELSE 'MEDIUM_PRIORITY'
        END as INTERVENTION_PRIORITY,
        ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,
        d.designation_name,
        p.process_name
      FROM mas_hrms.attendance_daily_record adr
      JOIN mas_hrms.employees e ON adr.employee_id = e.id
      LEFT JOIN db_audit.call_quality_assessment cqa ON e.employee_code = cqa.User
        AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
      LEFT JOIN mas_hrms.designation_master d ON e.designation_id = d.id
      LEFT JOIN mas_hrms.process_master p ON e.process_id = p.id
      WHERE adr.record_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND e.employment_status = 'Active'
        AND e.active_status = 1
      GROUP BY e.id
      HAVING (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
              COUNT(DISTINCT adr.record_date) * 100) < 90
        OR AVG(cqa.quality_percentage) < 70
      ORDER BY ATTRITION_RISK_SCORE DESC
      LIMIT ?
    `;

    const [rows] = await pool.query<RowDataPacket[]>(query, [
      parseInt(daysBack as string) || 60,
      parseInt(daysBack as string) || 60,
      parseInt(limit as string) || 50
    ]);

    res.json({
      success: true,
      analysis_type: 'ABSENTEEISM_CORRELATION',
      count: rows.length,
      data: rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getAbsenteeismCorrelation:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch absenteeism correlation data' });
  }
}

/**
 * GET /api/analytics/attrition-risk/compound-risk
 * Multi-factor risk assessment (tenure + team size + quality volatility + attendance)
 * Authorized: HR Admin, WFM Manager, Operations Manager
 */
export async function getCompoundRiskProfile(req: Request, res: Response) {
  try {
    const { limit = 50 } = req.query;

    const query = `
      WITH agent_risk_factors AS (
        SELECT
          e.id,
          e.employee_code,
          CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
          DATEDIFF(NOW(), e.date_of_joining) as tenure_days,
          ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,
          CASE
            WHEN DATEDIFF(NOW(), e.date_of_joining) < 90 THEN 'Onboarding (< 3mo)'
            WHEN DATEDIFF(NOW(), e.date_of_joining) < 180 THEN 'Ramp (3-6mo)'
            WHEN DATEDIFF(NOW(), e.date_of_joining) < 365 THEN 'Early Career (6-12mo)'
            ELSE 'Established (> 12mo)'
          END as experience_level,
          (SELECT COUNT(DISTINCT id) FROM mas_hrms.employees e2
           WHERE e2.reporting_manager_id = e.reporting_manager_id
           AND e2.active_status = 1) as team_size,
          ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
          COUNT(DISTINCT cqa.id) as call_audits_count,
          ROUND(STDDEV(cqa.quality_percentage), 2) as quality_volatility,
          ROUND((COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
                 NULLIF(COUNT(DISTINCT adr.record_date), 0) * 100), 2) as attendance_pct,
          d.designation_name,
          p.process_name,
          bm.branch_name
        FROM mas_hrms.employees e
        LEFT JOIN mas_hrms.designation_master d ON e.designation_id = d.id
        LEFT JOIN mas_hrms.process_master p ON e.process_id = p.id
        LEFT JOIN mas_hrms.branch_master bm ON e.branch_id = bm.id
        LEFT JOIN db_audit.call_quality_assessment cqa ON e.employee_code = cqa.User
          AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)
        LEFT JOIN mas_hrms.attendance_daily_record adr ON e.id = adr.employee_id
          AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
        WHERE e.employment_status = 'Active'
          AND e.active_status = 1
        GROUP BY e.id
      )
      SELECT
        employee_code as RISK_AGENT,
        agent_name,
        designation_name,
        process_name,
        branch_name,
        tenure_months,
        experience_level,
        team_size,
        CASE
          WHEN team_size <= 5 THEN 'Lean'
          WHEN team_size <= 10 THEN 'Optimal'
          WHEN team_size <= 15 THEN 'Stretched'
          ELSE 'Overloaded'
        END as team_load_level,
        avg_quality,
        call_audits_count,
        quality_volatility,
        attendance_pct,
        CASE
          WHEN avg_quality < 65 AND attendance_pct < 80 AND tenure_months < 6 AND team_size > 12 THEN 'CRITICAL'
          WHEN avg_quality < 70 AND quality_volatility > 15 THEN 'HIGH'
          WHEN (avg_quality < 75 AND tenure_months < 6) OR (attendance_pct < 85 AND avg_quality < 75) THEN 'MEDIUM'
          ELSE 'LOW'
        END as risk_level,
        ROUND(
          CASE
            WHEN avg_quality < 60 THEN 40
            WHEN avg_quality < 70 THEN 30
            WHEN avg_quality < 75 THEN 15
            ELSE 5
          END +
          CASE
            WHEN attendance_pct < 75 THEN 30
            WHEN attendance_pct < 85 THEN 20
            WHEN attendance_pct < 90 THEN 10
            ELSE 5
          END +
          CASE
            WHEN tenure_months < 3 THEN 15
            WHEN tenure_months < 6 THEN 10
            ELSE 0
          END +
          CASE
            WHEN team_size > 15 THEN 10
            WHEN team_size > 12 THEN 5
            ELSE 0
          END +
          CASE
            WHEN quality_volatility > 20 THEN 10
            WHEN quality_volatility > 15 THEN 5
            ELSE 0
          END
        , 1) as ATTRITION_RISK_SCORE,
        CASE
          WHEN avg_quality < 65 AND attendance_pct < 80 AND tenure_months < 6 AND team_size > 12 THEN 'CRITICAL'
          WHEN avg_quality < 70 AND quality_volatility > 15 THEN 'HIGH_PRIORITY'
          WHEN (avg_quality < 75 AND tenure_months < 6) OR (attendance_pct < 85 AND avg_quality < 75) THEN 'MEDIUM_PRIORITY'
          ELSE 'ROUTINE'
        END as INTERVENTION_PRIORITY,
        ROUND((100 - attendance_pct) + ABS(COALESCE(avg_quality - 75, 0)), 2) as DEGRADATION_RATE
      FROM agent_risk_factors
      WHERE call_audits_count >= 5
      ORDER BY ATTRITION_RISK_SCORE DESC
      LIMIT ?
    `;

    const [rows] = await pool.query<RowDataPacket[]>(query, [parseInt(limit as string) || 50]);

    res.json({
      success: true,
      analysis_type: 'COMPOUND_RISK_PROFILE',
      count: rows.length,
      data: rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getCompoundRiskProfile:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch compound risk data' });
  }
}

/**
 * GET /api/analytics/attrition-risk/quality-velocity
 * Detect rapid quality deterioration (velocity of decline indicator)
 * Authorized: HR Admin, WFM Manager
 */
export async function getQualityVelocity(req: Request, res: Response) {
  try {
    const { limit = 50 } = req.query;

    const query = `
      WITH weekly_quality AS (
        SELECT
          e.employee_code,
          e.first_name,
          e.last_name,
          YEAR(cqa.CallDate) as year_num,
          WEEK(cqa.CallDate, 1) as week_num,
          COUNT(*) as call_count,
          ROUND(AVG(cqa.quality_percentage), 2) as weekly_quality,
          ROW_NUMBER() OVER (PARTITION BY e.id ORDER BY YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1) DESC) as recency_rank
        FROM db_audit.call_quality_assessment cqa
        JOIN mas_hrms.employees e ON cqa.User = e.employee_code
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 120 DAY)
          AND e.employment_status = 'Active'
          AND e.active_status = 1
          AND cqa.quality_percentage IS NOT NULL
        GROUP BY e.id, YEAR(cqa.CallDate), WEEK(cqa.CallDate, 1)
        HAVING call_count >= 3
      )
      SELECT
        wq_current.employee_code as RISK_AGENT,
        CONCAT(wq_current.first_name, ' ', COALESCE(wq_current.last_name, '')) as agent_name,
        wq_current.weekly_quality as current_week_quality,
        wq_prev1.weekly_quality as week_1_ago,
        wq_prev2.weekly_quality as week_2_ago,
        wq_prev3.weekly_quality as week_3_ago,
        ROUND(wq_current.weekly_quality - wq_prev1.weekly_quality, 2) as delta_week_1,
        ROUND(wq_current.weekly_quality - wq_prev2.weekly_quality, 2) as delta_week_2,
        ROUND(wq_current.weekly_quality - wq_prev3.weekly_quality, 2) as delta_week_3,
        CASE
          WHEN (wq_current.weekly_quality - wq_prev1.weekly_quality < -15 OR
                wq_prev1.weekly_quality - wq_prev2.weekly_quality < -15) THEN 'RAPID_DECLINE'
          WHEN ((wq_current.weekly_quality - wq_prev1.weekly_quality +
                 wq_prev1.weekly_quality - wq_prev2.weekly_quality +
                 wq_prev2.weekly_quality - wq_prev3.weekly_quality) / 3) < -8 THEN 'SUSTAINED_DECLINE'
          WHEN ((wq_current.weekly_quality - wq_prev1.weekly_quality +
                 wq_prev1.weekly_quality - wq_prev2.weekly_quality) / 2) < -5 THEN 'RECENT_DECLINE'
          ELSE 'STABLE'
        END as trend_pattern,
        CASE
          WHEN (wq_current.weekly_quality - wq_prev1.weekly_quality < -15 OR
                wq_prev1.weekly_quality - wq_prev2.weekly_quality < -15) THEN 80
          WHEN ((wq_current.weekly_quality - wq_prev1.weekly_quality +
                 wq_prev1.weekly_quality - wq_prev2.weekly_quality +
                 wq_prev2.weekly_quality - wq_prev3.weekly_quality) / 3) < -8 THEN 65
          WHEN ((wq_current.weekly_quality - wq_prev1.weekly_quality +
                 wq_prev1.weekly_quality - wq_prev2.weekly_quality) / 2) < -5 THEN 50
          ELSE 20
        END as DEGRADATION_RATE,
        CASE
          WHEN (wq_current.weekly_quality - wq_prev1.weekly_quality < -15 OR
                wq_prev1.weekly_quality - wq_prev2.weekly_quality < -15) THEN 'CRITICAL'
          WHEN ((wq_current.weekly_quality - wq_prev1.weekly_quality +
                 wq_prev1.weekly_quality - wq_prev2.weekly_quality +
                 wq_prev2.weekly_quality - wq_prev3.weekly_quality) / 3) < -8 THEN 'HIGH_PRIORITY'
          WHEN ((wq_current.weekly_quality - wq_prev1.weekly_quality +
                 wq_prev1.weekly_quality - wq_prev2.weekly_quality) / 2) < -5 THEN 'MEDIUM_PRIORITY'
          ELSE 'ROUTINE'
        END as INTERVENTION_PRIORITY
      FROM weekly_quality wq_current
      LEFT JOIN weekly_quality wq_prev1 ON wq_current.employee_code = wq_prev1.employee_code
        AND wq_prev1.recency_rank = 2
      LEFT JOIN weekly_quality wq_prev2 ON wq_current.employee_code = wq_prev2.employee_code
        AND wq_prev2.recency_rank = 3
      LEFT JOIN weekly_quality wq_prev3 ON wq_current.employee_code = wq_prev3.employee_code
        AND wq_prev3.recency_rank = 4
      WHERE wq_current.recency_rank = 1
        AND (wq_prev1.weekly_quality IS NOT NULL OR wq_prev2.weekly_quality IS NOT NULL)
      ORDER BY DEGRADATION_RATE DESC, current_week_quality ASC
      LIMIT ?
    `;

    const [rows] = await pool.query<RowDataPacket[]>(query, [parseInt(limit as string) || 50]);

    res.json({
      success: true,
      analysis_type: 'QUALITY_VELOCITY',
      count: rows.length,
      data: rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getQualityVelocity:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch quality velocity data' });
  }
}

/**
 * GET /api/analytics/attrition-risk/early-warning
 * Predictive early warning indicators (absence spike, engagement drop, mood swings)
 * Authorized: HR Admin, Operations Manager
 */
export async function getEarlyWarningIndicators(req: Request, res: Response) {
  try {
    const { limit = 50 } = req.query;

    const query = `
      SELECT
        e.employee_code as RISK_AGENT,
        CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
        d.designation_name,
        p.process_name,
        bm.branch_name,
        (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
         WHERE adr.employee_id = e.id AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         AND adr.attendance_status = 'absent') as recent_absent_30d,
        (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
         WHERE adr.employee_id = e.id AND adr.record_date < DATE_SUB(NOW(), INTERVAL 30 DAY)
         AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
         AND adr.attendance_status = 'absent') as prior_absent_30d,
        (SELECT COUNT(*) FROM db_audit.call_quality_assessment cqa
         WHERE cqa.User = e.employee_code AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as recent_audit_count,
        (SELECT COUNT(*) FROM db_audit.call_quality_assessment cqa
         WHERE cqa.User = e.employee_code AND cqa.CallDate < DATE_SUB(NOW(), INTERVAL 30 DAY)
         AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)) as prior_audit_count,
        ROUND((SELECT STDDEV(cqa.quality_percentage) FROM db_audit.call_quality_assessment cqa
         WHERE cqa.User = e.employee_code AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)), 2) as recent_quality_volatility,
        ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,
        ROUND(
          CASE
            WHEN (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
                  WHERE adr.employee_id = e.id AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                  AND adr.attendance_status = 'absent') >
                 (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
                  WHERE adr.employee_id = e.id AND adr.record_date < DATE_SUB(NOW(), INTERVAL 30 DAY)
                  AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
                  AND adr.attendance_status = 'absent') + 2 THEN 30
            ELSE 10
          END +
          CASE
            WHEN (SELECT COUNT(*) FROM db_audit.call_quality_assessment cqa
                  WHERE cqa.User = e.employee_code AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)) <
                 (SELECT COUNT(*) FROM db_audit.call_quality_assessment cqa
                  WHERE cqa.User = e.employee_code AND cqa.CallDate < DATE_SUB(NOW(), INTERVAL 30 DAY)
                  AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)) * 0.7 THEN 25
            ELSE 5
          END +
          CASE
            WHEN (SELECT STDDEV(cqa.quality_percentage) FROM db_audit.call_quality_assessment cqa
                  WHERE cqa.User = e.employee_code AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)) > 20 THEN 20
            WHEN (SELECT STDDEV(cqa.quality_percentage) FROM db_audit.call_quality_assessment cqa
                  WHERE cqa.User = e.employee_code AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)) > 15 THEN 15
            ELSE 0
          END
        , 1) as ATTRITION_RISK_SCORE,
        CASE
          WHEN (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
                WHERE adr.employee_id = e.id AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                AND adr.attendance_status = 'absent') >
               (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
                WHERE adr.employee_id = e.id AND adr.record_date < DATE_SUB(NOW(), INTERVAL 30 DAY)
                AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
                AND adr.attendance_status = 'absent') + 2
          AND (SELECT COUNT(*) FROM db_audit.call_quality_assessment cqa
               WHERE cqa.User = e.employee_code AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)) <
              (SELECT COUNT(*) FROM db_audit.call_quality_assessment cqa
               WHERE cqa.User = e.employee_code AND cqa.CallDate < DATE_SUB(NOW(), INTERVAL 30 DAY)
               AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY)) * 0.7 THEN 'CRITICAL'
          WHEN (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
                WHERE adr.employee_id = e.id AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                AND adr.attendance_status = 'absent') >
               (SELECT COUNT(DISTINCT adr.record_date) FROM mas_hrms.attendance_daily_record adr
                WHERE adr.employee_id = e.id AND adr.record_date < DATE_SUB(NOW(), INTERVAL 30 DAY)
                AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
                AND adr.attendance_status = 'absent') + 1 THEN 'HIGH_PRIORITY'
          ELSE 'MEDIUM_PRIORITY'
        END as INTERVENTION_PRIORITY,
        'Review absence spike + engagement metrics for workload/burnout' as recommended_action
      FROM mas_hrms.employees e
      LEFT JOIN mas_hrms.designation_master d ON e.designation_id = d.id
      LEFT JOIN mas_hrms.process_master p ON e.process_id = p.id
      LEFT JOIN mas_hrms.branch_master bm ON e.branch_id = bm.id
      WHERE e.employment_status = 'Active'
        AND e.active_status = 1
        AND (SELECT COUNT(DISTINCT record_date) FROM mas_hrms.attendance_daily_record adr
             WHERE adr.employee_id = e.id AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)) >= 20
      ORDER BY ATTRITION_RISK_SCORE DESC
      LIMIT ?
    `;

    const [rows] = await pool.query<RowDataPacket[]>(query, [parseInt(limit as string) || 50]);

    res.json({
      success: true,
      analysis_type: 'EARLY_WARNING',
      count: rows.length,
      data: rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getEarlyWarningIndicators:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch early warning indicators' });
  }
}

/**
 * GET /api/analytics/attrition-risk/consolidated
 * High-risk agents summary across all analyses
 * Authorized: HR Admin, WFM Manager, Operations Manager
 */
export async function getConsolidatedRiskReport(req: Request, res: Response) {
  try {
    const { limit = 100 } = req.query;

    const query = `
      SELECT
        e.employee_code as RISK_AGENT,
        CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
        d.designation_name,
        p.process_name,
        bm.branch_name,
        ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,
        ROUND(AVG(cqa.quality_percentage), 2) as current_quality_score,
        COUNT(DISTINCT cqa.id) as total_audits_90d,
        ROUND(STDDEV(cqa.quality_percentage), 2) as quality_volatility,
        ROUND((COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
               NULLIF(COUNT(DISTINCT adr.record_date), 0) * 100), 2) as attendance_pct,
        COUNT(DISTINCT CASE WHEN adr.attendance_status = 'absent' THEN adr.record_date END) as absent_days_60d,
        (SELECT COUNT(DISTINCT id) FROM mas_hrms.employees e2
         WHERE e2.reporting_manager_id = e.reporting_manager_id
         AND e2.active_status = 1) as team_size,
        ROUND(
          CASE WHEN AVG(cqa.quality_percentage) < 60 THEN 40 ELSE 5 END +
          CASE WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
                    NULLIF(COUNT(DISTINCT adr.record_date), 0) * 100) < 85 THEN 25 ELSE 5 END +
          CASE WHEN DATEDIFF(NOW(), e.date_of_joining) < 180 THEN 15 ELSE 0 END +
          CASE WHEN (SELECT COUNT(DISTINCT id) FROM mas_hrms.employees e2
                    WHERE e2.reporting_manager_id = e.reporting_manager_id
                    AND e2.active_status = 1) > 15 THEN 10 ELSE 0 END
        , 1) as ATTRITION_RISK_SCORE,
        CASE
          WHEN AVG(cqa.quality_percentage) < 60 THEN 'CRITICAL'
          WHEN AVG(cqa.quality_percentage) < 70 THEN 'HIGH'
          WHEN AVG(cqa.quality_percentage) < 80 THEN 'MEDIUM'
          ELSE 'LOW'
        END as DEGRADATION_RATE,
        CASE
          WHEN AVG(cqa.quality_percentage) < 60 AND (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
               NULLIF(COUNT(DISTINCT adr.record_date), 0) * 100) < 85 THEN 'CRITICAL - Immediate intervention required'
          WHEN AVG(cqa.quality_percentage) < 70 THEN 'HIGH_PRIORITY - Enhanced monitoring & support'
          WHEN (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
                NULLIF(COUNT(DISTINCT adr.record_date), 0) * 100) < 85 THEN 'MEDIUM_PRIORITY - Attendance follow-up'
          ELSE 'ROUTINE - Standard monitoring'
        END as INTERVENTION_PRIORITY
      FROM mas_hrms.employees e
      LEFT JOIN mas_hrms.designation_master d ON e.designation_id = d.id
      LEFT JOIN mas_hrms.process_master p ON e.process_id = p.id
      LEFT JOIN mas_hrms.branch_master bm ON e.branch_id = bm.id
      LEFT JOIN db_audit.call_quality_assessment cqa ON e.employee_code = cqa.User
        AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      LEFT JOIN mas_hrms.attendance_daily_record adr ON e.id = adr.employee_id
        AND adr.record_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
      WHERE e.employment_status = 'Active'
        AND e.active_status = 1
      GROUP BY e.id
      HAVING COUNT(DISTINCT cqa.id) >= 5 AND COUNT(DISTINCT adr.record_date) >= 20
        AND (AVG(cqa.quality_percentage) < 75 OR (COUNT(DISTINCT CASE WHEN adr.attendance_status = 'present' THEN adr.record_date END) /
             NULLIF(COUNT(DISTINCT adr.record_date), 0) * 100) < 90)
      ORDER BY ATTRITION_RISK_SCORE DESC
      LIMIT ?
    `;

    const [rows] = await pool.query<RowDataPacket[]>(query, [parseInt(limit as string) || 100]);

    res.json({
      success: true,
      analysis_type: 'CONSOLIDATED_RISK_REPORT',
      count: rows.length,
      data: rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getConsolidatedRiskReport:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch consolidated risk report' });
  }
}
