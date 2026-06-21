/**
 * ROI and Efficiency Analysis Service
 *
 * Provides process-level efficiency metrics combining operational,
 * financial, and quality KPIs to calculate ROI and efficiency rankings.
 *
 * Purpose: Enable CFO/COO visibility into process economics and
 *          operational efficiency trends for strategic planning.
 */

import { Router, Request, Response } from 'express';
import db from '../db';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ProcessEfficiencyMetrics {
  process: string;
  lob: string;
  activeAgents: number;
  callVolume: number;
  avgTalkTimeSec: number;
  avgCostPerAgentMonthly: number;
  costPerCall: number;
  qualityScorePct: number;
  conversionRatePct: number;
  adherencePct: number;
  callsPerDay: number;
  roiIndex: number;
}

export interface LOBEfficiencyMetrics {
  lob: string;
  processCount: number;
  totalAgents: number;
  totalCalls90d: number;
  payrollCostK: number;
  avgCostPerCall: number;
  avgTalkTimeSec: number;
  avgQualityScore: number;
  callsPerAgentPerDay: number;
  efficiencyTier: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ProcessROIAnalysis {
  process: string;
  lob: string;
  callVolume: number;
  qualityScorePct: number;
  totalPayroll90d: number;
  costPerCall: number;
  productivityIndex: number;
  roiEfficiencyScore: number;
  efficiencyRank: number;
}

export interface PerformanceCategory {
  category: 'TOP_PERFORMER' | 'IMPROVEMENT_TARGET';
  process: string;
  agents: number;
  roiScore: number;
  costPerCall: number;
  qualityPct: number;
  action: string;
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

class ROIEfficiencyService {
  /**
   * Fetch process efficiency matrix (90-day rolling window)
   * @returns Array of process-level efficiency metrics
   */
  async getProcessEfficiencyMatrix(): Promise<ProcessEfficiencyMetrics[]> {
    const query = `
      SELECT
        pm.process_name AS \`PROCESS\`,
        pm.business_lob AS \`LOB\`,
        COUNT(DISTINCT e.id) AS \`ACTIVE_AGENTS\`,
        COALESCE(SUM(icd.total_calls), 0) AS \`CALL_VOLUME\`,
        ROUND(
          AVG(
            CASE WHEN icd.total_calls > 0
              THEN (icd.talk_minutes * 60 / icd.total_calls)
              ELSE NULL
            END
          ),
          0
        ) AS \`AVG_TALK_TIME_SEC\`,
        ROUND(
          COALESCE(SUM(spl.gross_salary), 0) /
          NULLIF(COUNT(DISTINCT e.id), 0) / 3,
          2
        ) AS \`AVG_COST_PER_AGENT_MONTHLY\`,
        ROUND(
          COALESCE(SUM(spl.gross_salary), 0) /
          NULLIF(SUM(icd.total_calls), 0),
          2
        ) AS \`COST_PER_CALL\`,
        ROUND(
          COALESCE(AVG(kda_quality.actual_value), 0),
          2
        ) AS \`QUALITY_SCORE_PCT\`,
        ROUND(
          COALESCE(AVG(kda_conversion.actual_value), 0),
          2
        ) AS \`CONVERSION_RATE_PCT\`,
        ROUND(
          COALESCE(AVG(kda_adherence.actual_value), 0),
          2
        ) AS \`ADHERENCE_PCT\`,
        ROUND(
          SUM(icd.total_calls) /
          NULLIF(DATEDIFF(MAX(icd.activity_date), MIN(icd.activity_date)) + 1, 0),
          0
        ) AS \`CALLS_PER_DAY\`,
        ROUND(
          (COALESCE(AVG(kda_quality.actual_value), 50) / 100) *
          NULLIF(
            (SUM(icd.total_calls) / 100) /
            NULLIF(SUM(spl.gross_salary) / 10000, 0),
            0
          ),
          2
        ) AS \`ROI_INDEX\`
      FROM
        process_master pm
        LEFT JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
        LEFT JOIN integration_call_daily icd
          ON icd.process_name = pm.process_name
          AND icd.activity_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        LEFT JOIN salary_prep_line spl
          ON spl.employee_id = e.id
        LEFT JOIN salary_prep_run spr
          ON spr.id = spl.run_id
          AND spr.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 90 DAY), '%Y-%m')
        LEFT JOIN kpi_daily_actual kda_quality
          ON kda_quality.employee_id = e.id
          AND kda_quality.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
          AND kda_quality.metric_id = (
            SELECT id FROM kpi_metric_master
            WHERE metric_code = 'QUALITY_SCORE' AND active_status = 1
            LIMIT 1
          )
        LEFT JOIN kpi_daily_actual kda_conversion
          ON kda_conversion.employee_id = e.id
          AND kda_conversion.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
          AND kda_conversion.metric_id = (
            SELECT id FROM kpi_metric_master
            WHERE metric_code = 'CONVERSION_RATE' AND active_status = 1
            LIMIT 1
          )
        LEFT JOIN kpi_daily_actual kda_adherence
          ON kda_adherence.employee_id = e.id
          AND kda_adherence.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
          AND kda_adherence.metric_id = (
            SELECT id FROM kpi_metric_master
            WHERE metric_code = 'ADHERENCE' AND active_status = 1
            LIMIT 1
          )
      WHERE
        pm.active_status = 1
      GROUP BY
        pm.id, pm.process_name, pm.business_lob
      ORDER BY
        ROI_INDEX DESC,
        CALL_VOLUME DESC
    `;

    const [rows] = await db.query(query);
    return this.mapQueryResults<ProcessEfficiencyMetrics>(rows);
  }

  /**
   * Fetch LOB-level efficiency breakdown
   * @returns Array of LOB efficiency metrics
   */
  async getLOBEfficiencyBreakdown(): Promise<LOBEfficiencyMetrics[]> {
    const query = `
      SELECT
        COALESCE(pm.business_lob, 'UNASSIGNED') AS \`LOB\`,
        COUNT(DISTINCT pm.id) AS \`PROCESS_COUNT\`,
        COUNT(DISTINCT e.id) AS \`TOTAL_AGENTS\`,
        COALESCE(SUM(icd.total_calls), 0) AS \`TOTAL_CALLS_90D\`,
        ROUND(COALESCE(SUM(spl.gross_salary) / 1000, 0), 0) AS \`PAYROLL_COST_K\`,
        ROUND(
          COALESCE(SUM(spl.gross_salary), 0) /
          NULLIF(SUM(icd.total_calls), 0),
          2
        ) AS \`AVG_COST_PER_CALL\`,
        ROUND(
          AVG(
            CASE WHEN icd.total_calls > 0
              THEN (icd.talk_minutes * 60 / icd.total_calls)
              ELSE NULL
            END
          ),
          0
        ) AS \`AVG_TALK_TIME_SEC\`,
        ROUND(
          COALESCE(AVG(kda_quality.actual_value), 0),
          2
        ) AS \`AVG_QUALITY_SCORE\`,
        ROUND(
          (SUM(icd.total_calls) / NULLIF(COUNT(DISTINCT e.id), 0)) / 90,
          1
        ) AS \`CALLS_PER_AGENT_PER_DAY\`,
        CASE
          WHEN (SUM(spl.gross_salary) / NULLIF(SUM(icd.total_calls), 0)) < 10 THEN 'HIGH'
          WHEN (SUM(spl.gross_salary) / NULLIF(SUM(icd.total_calls), 0)) < 20 THEN 'MEDIUM'
          ELSE 'LOW'
        END AS \`EFFICIENCY_TIER\`
      FROM
        process_master pm
        LEFT JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
        LEFT JOIN integration_call_daily icd
          ON icd.process_name = pm.process_name
          AND icd.activity_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        LEFT JOIN salary_prep_line spl
          ON spl.employee_id = e.id
        LEFT JOIN salary_prep_run spr
          ON spr.id = spl.run_id
          AND spr.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 90 DAY), '%Y-%m')
        LEFT JOIN kpi_daily_actual kda_quality
          ON kda_quality.employee_id = e.id
          AND kda_quality.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
          AND kda_quality.metric_id = (
            SELECT id FROM kpi_metric_master
            WHERE metric_code = 'QUALITY_SCORE' AND active_status = 1
            LIMIT 1
          )
      WHERE
        pm.active_status = 1
      GROUP BY
        pm.business_lob
      ORDER BY
        AVG_COST_PER_CALL ASC,
        TOTAL_CALLS_90D DESC
    `;

    const [rows] = await db.query(query);
    return this.mapQueryResults<LOBEfficiencyMetrics>(rows);
  }

  /**
   * Fetch detailed ROI analysis by process
   * @returns Array of processes ranked by ROI efficiency score
   */
  async getProcessROIAnalysis(): Promise<ProcessROIAnalysis[]> {
    const query = `
      SELECT
        pm.process_name AS \`PROCESS\`,
        pm.business_lob AS \`LOB\`,
        COALESCE(SUM(icd.total_calls), 0) AS \`CALL_VOLUME\`,
        ROUND(
          COALESCE(AVG(kda_quality.actual_value), 75),
          1
        ) AS \`QUALITY_SCORE_PCT\`,
        ROUND(
          COALESCE(SUM(spl.gross_salary), 0),
          2
        ) AS \`TOTAL_PAYROLL_90D\`,
        ROUND(
          COALESCE(SUM(spl.gross_salary), 0) /
          NULLIF(SUM(icd.total_calls), 0),
          4
        ) AS \`COST_PER_CALL\`,
        ROUND(
          (SUM(icd.total_calls) * 100) /
          NULLIF(SUM(spl.gross_salary) / 1000, 0),
          2
        ) AS \`PRODUCTIVITY_INDEX\`,
        ROUND(
          (COALESCE(AVG(kda_quality.actual_value), 75) / 100) *
          NULLIF(
            (SUM(icd.total_calls) * 100) /
            NULLIF(SUM(spl.gross_salary) / 1000, 0),
            0
          ),
          2
        ) AS \`ROI_EFFICIENCY_SCORE\`,
        RANK() OVER (ORDER BY
          (COALESCE(AVG(kda_quality.actual_value), 75) / 100) *
          ((SUM(icd.total_calls) * 100) / NULLIF(SUM(spl.gross_salary) / 1000, 0))
          DESC
        ) AS \`EFFICIENCY_RANK\`
      FROM
        process_master pm
        LEFT JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
        LEFT JOIN integration_call_daily icd
          ON icd.process_name = pm.process_name
          AND icd.activity_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        LEFT JOIN salary_prep_line spl
          ON spl.employee_id = e.id
        LEFT JOIN salary_prep_run spr
          ON spr.id = spl.run_id
          AND spr.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 90 DAY), '%Y-%m')
        LEFT JOIN kpi_daily_actual kda_quality
          ON kda_quality.employee_id = e.id
          AND kda_quality.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
          AND kda_quality.metric_id = (
            SELECT id FROM kpi_metric_master
            WHERE metric_code = 'QUALITY_SCORE' AND active_status = 1
            LIMIT 1
          )
      WHERE
        pm.active_status = 1
      GROUP BY
        pm.id, pm.process_name, pm.business_lob
      HAVING
        SUM(icd.total_calls) > 0 OR SUM(spl.gross_salary) > 0
      ORDER BY
        ROI_EFFICIENCY_SCORE DESC,
        CALL_VOLUME DESC
    `;

    const [rows] = await db.query(query);
    return this.mapQueryResults<ProcessROIAnalysis>(rows);
  }

  /**
   * Fetch top performers and improvement targets
   * @returns Array combining top 5 and bottom 5 processes
   */
  async getPerformanceCategories(): Promise<PerformanceCategory[]> {
    const query = `
      SELECT
        'TOP_PERFORMER' AS \`CATEGORY\`,
        pm.process_name AS \`PROCESS\`,
        COUNT(DISTINCT e.id) AS \`AGENTS\`,
        ROUND(
          (COALESCE(AVG(kda_quality.actual_value), 75) / 100) *
          NULLIF(
            (SUM(icd.total_calls) * 100) /
            NULLIF(SUM(spl.gross_salary) / 1000, 0),
            0
          ),
          2
        ) AS \`ROI_SCORE\`,
        ROUND(
          SUM(spl.gross_salary) / NULLIF(SUM(icd.total_calls), 0),
          2
        ) AS \`COST_PER_CALL\`,
        ROUND(COALESCE(AVG(kda_quality.actual_value), 75), 1) AS \`QUALITY_PCT\`,
        'Maintain excellence, document best practices' AS \`ACTION\`
      FROM
        process_master pm
        LEFT JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
        LEFT JOIN integration_call_daily icd
          ON icd.process_name = pm.process_name
          AND icd.activity_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        LEFT JOIN salary_prep_line spl
          ON spl.employee_id = e.id
        LEFT JOIN salary_prep_run spr
          ON spr.id = spl.run_id
          AND spr.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 90 DAY), '%Y-%m')
        LEFT JOIN kpi_daily_actual kda_quality
          ON kda_quality.employee_id = e.id
          AND kda_quality.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
          AND kda_quality.metric_id = (
            SELECT id FROM kpi_metric_master
            WHERE metric_code = 'QUALITY_SCORE' AND active_status = 1
            LIMIT 1
          )
      WHERE
        pm.active_status = 1
      GROUP BY
        pm.id, pm.process_name
      HAVING
        SUM(icd.total_calls) > 0
      ORDER BY
        ROI_SCORE DESC
      LIMIT 5

      UNION ALL

      SELECT
        'IMPROVEMENT_TARGET' AS \`CATEGORY\`,
        pm.process_name AS \`PROCESS\`,
        COUNT(DISTINCT e.id) AS \`AGENTS\`,
        ROUND(
          (COALESCE(AVG(kda_quality.actual_value), 75) / 100) *
          NULLIF(
            (SUM(icd.total_calls) * 100) /
            NULLIF(SUM(spl.gross_salary) / 1000, 0),
            0
          ),
          2
        ) AS \`ROI_SCORE\`,
        ROUND(
          SUM(spl.gross_salary) / NULLIF(SUM(icd.total_calls), 0),
          2
        ) AS \`COST_PER_CALL\`,
        ROUND(COALESCE(AVG(kda_quality.actual_value), 75), 1) AS \`QUALITY_PCT\`,
        'Intervention: quality training or process re-design' AS \`ACTION\`
      FROM
        process_master pm
        LEFT JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
        LEFT JOIN integration_call_daily icd
          ON icd.process_name = pm.process_name
          AND icd.activity_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        LEFT JOIN salary_prep_line spl
          ON spl.employee_id = e.id
        LEFT JOIN salary_prep_run spr
          ON spr.id = spl.run_id
          AND spr.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 90 DAY), '%Y-%m')
        LEFT JOIN kpi_daily_actual kda_quality
          ON kda_quality.employee_id = e.id
          AND kda_quality.score_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
          AND kda_quality.metric_id = (
            SELECT id FROM kpi_metric_master
            WHERE metric_code = 'QUALITY_SCORE' AND active_status = 1
            LIMIT 1
          )
      WHERE
        pm.active_status = 1
      GROUP BY
        pm.id, pm.process_name
      HAVING
        SUM(icd.total_calls) > 0
      ORDER BY
        ROI_SCORE ASC
      LIMIT 5
    `;

    const [rows] = await db.query(query);
    return this.mapQueryResults<PerformanceCategory>(rows);
  }

  /**
   * Helper: Map snake_case query results to camelCase
   */
  private mapQueryResults<T>(rows: any[]): T[] {
    return rows.map(row => this.toCamelCase(row));
  }

  /**
   * Convert object keys from snake_case to camelCase
   */
  private toCamelCase(obj: any): any {
    const camelCased: any = {};
    for (const key in obj) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      camelCased[camelKey[0].toLowerCase() + camelKey.slice(1)] = obj[key];
    }
    return camelCased;
  }
}

// ============================================================================
// ROUTER SETUP
// ============================================================================

const router = Router();
const service = new ROIEfficiencyService();

/**
 * GET /api/analytics/roi-efficiency/process-matrix
 * Fetch process efficiency matrix with ROI index
 */
router.get('/process-matrix', async (req: Request, res: Response) => {
  try {
    const metrics = await service.getProcessEfficiencyMatrix();
    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching process efficiency matrix:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch process efficiency metrics',
    });
  }
});

/**
 * GET /api/analytics/roi-efficiency/lob-breakdown
 * Fetch LOB-level efficiency breakdown
 */
router.get('/lob-breakdown', async (req: Request, res: Response) => {
  try {
    const metrics = await service.getLOBEfficiencyBreakdown();
    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching LOB efficiency breakdown:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch LOB efficiency metrics',
    });
  }
});

/**
 * GET /api/analytics/roi-efficiency/process-roi
 * Fetch detailed ROI analysis by process
 */
router.get('/process-roi', async (req: Request, res: Response) => {
  try {
    const metrics = await service.getProcessROIAnalysis();
    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching process ROI analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch ROI analysis',
    });
  }
});

/**
 * GET /api/analytics/roi-efficiency/performance-categories
 * Fetch top performers and improvement targets
 */
router.get('/performance-categories', async (req: Request, res: Response) => {
  try {
    const categories = await service.getPerformanceCategories();
    res.json({
      success: true,
      data: categories,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching performance categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch performance categories',
    });
  }
});

export default router;
export { ROIEfficiencyService };
