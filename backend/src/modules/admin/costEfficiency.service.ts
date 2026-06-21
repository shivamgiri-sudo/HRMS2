/**
 * Cost Efficiency Analysis Service
 * Purpose: Query mas_hrms salary_prep_line + call_quality_assessment
 *          to calculate agent-level and process-level ROI metrics
 *
 * Usage:
 *   import { CostEfficiencyService } from './costEfficiency.service';
 *   const metrics = await CostEfficiencyService.getAgentCostEfficiency();
 */

import { db } from '../../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { logger } from '../../logger';

// ──────────────────────────────────────────────────────────────────────────
// Type Definitions
// ──────────────────────────────────────────────────────────────────────────

export interface AgentCostMetrics extends RowDataPacket {
  employee_code: string;
  agent_name: string;
  monthly_salary: number;
  calls_handled_30d: number;
  avg_quality_pct: number;
  cost_per_call: number;
  cost_per_quality_point: number;
  payroll_investment: number;
  efficiency_rating: 'HIGH_ROI' | 'GOOD_ROI' | 'MEDIUM_ROI' | 'LOW_ROI' | 'NO_CALL_DATA';
  tenure_months: number;
  employment_status: string;
  run_timestamp: Date;
}

export interface ProcessROIMetrics extends RowDataPacket {
  process_name: string;
  total_calls_30d: number;
  agent_count: number;
  avg_process_quality: number;
  worst_call_quality: number;
  best_call_quality: number;
  quality_consistency: number;
  total_process_payroll: number;
  cost_per_call: number;
  cost_per_quality_point: number;
  calls_per_agent_per_day: number;
  quality_tier: number;
  cost_tier: number;
  roi_classification: 'PREMIUM_ROI' | 'GOOD_ROI' | 'ACCEPTABLE_ROI' | 'POOR_ROI';
  run_timestamp: Date;
}

export interface SavingsOpportunity extends RowDataPacket {
  efficiency_rank: number;
  agent_name: string;
  employee_code: string;
  monthly_salary: number;
  call_count: number;
  quality_score: number;
  cost_per_call: number;
  intervention_priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  potential_monthly_savings: number;
  recommended_action: string;
  run_timestamp: Date;
}

export interface SalaryQualityCorrelation extends RowDataPacket {
  salary_bracket: string;
  salary_min: number;
  salary_max: number;
  salary_avg: number;
  agent_count: number;
  avg_quality_in_bracket: number;
  worst_quality: number;
  best_quality: number;
  quality_variance: number;
  excellence_pct: number;
  underperforming_pct: number;
  run_timestamp: Date;
}

export interface AnnualForecast extends RowDataPacket {
  forecast_type: string;
  data_basis: string;
  active_agents: number;
  annual_payroll_at_current_rate: number;
  projected_annual_calls: number;
  avg_quality_maintained: number;
  projected_annual_cost_per_call: number;
  projected_annual_cost_per_quality_point: number;
  model_health: 'Sustainable Model - Scale Recommended' | 'Acceptable Model - Optimize Recommended' | 'At-Risk Model - Urgent Intervention';
  run_timestamp: Date;
}

// ──────────────────────────────────────────────────────────────────────────
// Service Class
// ──────────────────────────────────────────────────────────────────────────

export class CostEfficiencyService {
  private static readonly DEFAULT_DAYS = 30;

  /**
   * Get agent-level cost efficiency metrics
   * Sorted by cost_per_quality_point (best ROI first)
   */
  static async getAgentCostEfficiency(
    daysBack: number = this.DEFAULT_DAYS,
    limit: number = 100,
  ): Promise<AgentCostMetrics[]> {
    try {
      const query = `
        SELECT
          'AGENT_COST_EFFICIENCY' as analysis_type,
          e.employee_code,
          CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
          COALESCE(spl.gross_salary, 0) as monthly_salary,
          COUNT(DISTINCT CASE
            WHEN cqa.id IS NOT NULL THEN cqa.id
          END) as calls_handled_30d,
          ROUND(AVG(COALESCE(cqa.quality_percentage, 0)), 2) as avg_quality_pct,
          ROUND(COALESCE(spl.gross_salary, 0) / NULLIF(COUNT(DISTINCT cqa.id), 0), 2) as cost_per_call,
          ROUND(COALESCE(spl.gross_salary, 0) / NULLIF(AVG(cqa.quality_percentage), 0), 2) as cost_per_quality_point,
          ROUND(COALESCE(spl.gross_salary, 0), 2) as payroll_investment,
          CASE
            WHEN COUNT(DISTINCT cqa.id) = 0 THEN 'NO_CALL_DATA'
            WHEN AVG(cqa.quality_percentage) >= 85 THEN 'HIGH_ROI'
            WHEN AVG(cqa.quality_percentage) >= 75 THEN 'GOOD_ROI'
            WHEN AVG(cqa.quality_percentage) >= 65 THEN 'MEDIUM_ROI'
            ELSE 'LOW_ROI'
          END as efficiency_rating,
          ROUND(DATEDIFF(NOW(), e.date_of_joining) / 30.0, 1) as tenure_months,
          e.employment_status,
          NOW() as run_timestamp
        FROM mas_hrms.employees e
        LEFT JOIN mas_hrms.salary_prep_line spl
          ON spl.employee_id = e.id
          AND spl.status = 'processed'
          AND spl.month = MONTH(NOW())
          AND spl.year = YEAR(NOW())
        LEFT JOIN db_audit.call_quality_assessment cqa
          ON cqa.User = e.employee_code
          AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
        WHERE e.active_status = 1
          AND e.employment_status = 'Active'
        GROUP BY e.id, spl.id
        HAVING calls_handled_30d >= 5 OR spl.gross_salary > 0
        ORDER BY cost_per_quality_point ASC, avg_quality_pct DESC
        LIMIT ?
      `;

      const [results] = await db.query<AgentCostMetrics[]>(query, [daysBack, limit]);
      return results;
    } catch (error) {
      logger.error('Error fetching agent cost efficiency:', error);
      throw error;
    }
  }

  /**
   * Get process-level ROI analysis
   * Sorted by cost_per_quality_point (best ROI first)
   */
  static async getProcessROI(
    daysBack: number = this.DEFAULT_DAYS,
    limit: number = 50,
  ): Promise<ProcessROIMetrics[]> {
    try {
      const query = `
        SELECT
          'PROCESS_COST_ROI' as analysis_type,
          cqa.Campaign as process_name,
          COUNT(DISTINCT cqa.id) as total_calls_30d,
          COUNT(DISTINCT cqa.User) as agent_count,
          ROUND(AVG(cqa.quality_percentage), 2) as avg_process_quality,
          ROUND(MIN(cqa.quality_percentage), 1) as worst_call_quality,
          ROUND(MAX(cqa.quality_percentage), 1) as best_call_quality,
          ROUND(STDDEV(cqa.quality_percentage), 2) as quality_consistency,
          COALESCE(ROUND(SUM(spl.gross_salary), 2), 0) as total_process_payroll,
          ROUND(COALESCE(SUM(spl.gross_salary), 0) / NULLIF(COUNT(DISTINCT cqa.id), 0), 2) as cost_per_call,
          ROUND(COALESCE(SUM(spl.gross_salary), 0) / NULLIF(AVG(cqa.quality_percentage), 0), 2) as cost_per_quality_point,
          ROUND(COUNT(DISTINCT cqa.id) / NULLIF(COUNT(DISTINCT cqa.User), 0), 1) as calls_per_agent_per_day,
          CASE
            WHEN AVG(cqa.quality_percentage) >= 80 THEN 1
            WHEN AVG(cqa.quality_percentage) >= 70 THEN 2
            WHEN AVG(cqa.quality_percentage) >= 60 THEN 3
            ELSE 4
          END as quality_tier,
          CASE
            WHEN ROUND(COALESCE(SUM(spl.gross_salary), 0) / NULLIF(COUNT(DISTINCT cqa.id), 0), 2) < 50 THEN 1
            WHEN ROUND(COALESCE(SUM(spl.gross_salary), 0) / NULLIF(COUNT(DISTINCT cqa.id), 0), 2) < 100 THEN 2
            ELSE 3
          END as cost_tier,
          CASE
            WHEN AVG(cqa.quality_percentage) >= 80 AND ROUND(COALESCE(SUM(spl.gross_salary), 0) / NULLIF(COUNT(DISTINCT cqa.id), 0), 2) < 80 THEN 'PREMIUM_ROI'
            WHEN AVG(cqa.quality_percentage) >= 75 THEN 'GOOD_ROI'
            WHEN AVG(cqa.quality_percentage) >= 65 THEN 'ACCEPTABLE_ROI'
            ELSE 'POOR_ROI'
          END as roi_classification,
          NOW() as run_timestamp
        FROM db_audit.call_quality_assessment cqa
        LEFT JOIN mas_hrms.employees e ON cqa.User = e.employee_code
        LEFT JOIN mas_hrms.salary_prep_line spl
          ON spl.employee_id = e.id
          AND spl.status = 'processed'
          AND spl.month = MONTH(NOW())
          AND spl.year = YEAR(NOW())
        WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
          AND cqa.quality_percentage IS NOT NULL
        GROUP BY cqa.Campaign
        ORDER BY cost_per_quality_point ASC, avg_process_quality DESC
        LIMIT ?
      `;

      const [results] = await db.query<ProcessROIMetrics[]>(query, [daysBack, limit]);
      return results;
    } catch (error) {
      logger.error('Error fetching process ROI:', error);
      throw error;
    }
  }

  /**
   * Get top N savings opportunities
   * Ranked by potential monthly savings (highest first)
   */
  static async getSavingsOpportunities(
    topN: number = 20,
    daysBack: number = this.DEFAULT_DAYS,
  ): Promise<SavingsOpportunity[]> {
    try {
      const query = `
        WITH efficiency_ranked AS (
          SELECT
            e.employee_code,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
            spl.gross_salary,
            COUNT(DISTINCT cqa.id) as call_count,
            ROUND(AVG(cqa.quality_percentage), 1) as quality_score,
            ROUND(spl.gross_salary / NULLIF(COUNT(DISTINCT cqa.id), 0), 2) as cost_per_call,
            ROW_NUMBER() OVER (
              ORDER BY (spl.gross_salary / NULLIF(AVG(cqa.quality_percentage), 0)) DESC
            ) as efficiency_rank,
            CASE
              WHEN AVG(cqa.quality_percentage) < 60 THEN 'CRITICAL'
              WHEN AVG(cqa.quality_percentage) < 70 THEN 'HIGH'
              WHEN AVG(cqa.quality_percentage) < 75 THEN 'MEDIUM'
              ELSE 'LOW'
            END as intervention_priority
          FROM mas_hrms.employees e
          LEFT JOIN mas_hrms.salary_prep_line spl
            ON spl.employee_id = e.id
            AND spl.status = 'processed'
            AND spl.month = MONTH(NOW())
          LEFT JOIN db_audit.call_quality_assessment cqa
            ON cqa.User = e.employee_code
            AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
          WHERE e.active_status = 1
            AND e.employment_status = 'Active'
            AND spl.gross_salary > 0
          GROUP BY e.id, spl.id
          HAVING call_count >= 10
        )
        SELECT
          'SAVINGS_OPPORTUNITY' as opportunity_type,
          efficiency_rank,
          agent_name,
          employee_code,
          ROUND(gross_salary, 2) as monthly_salary,
          call_count,
          quality_score,
          cost_per_call,
          intervention_priority,
          CASE
            WHEN quality_score < 60 AND cost_per_call > 150 THEN ROUND(gross_salary * 0.30, 2)
            WHEN quality_score < 70 AND cost_per_call > 120 THEN ROUND(gross_salary * 0.15, 2)
            WHEN quality_score < 75 AND cost_per_call > 100 THEN ROUND(gross_salary * 0.10, 2)
            ELSE 0
          END as potential_monthly_savings,
          CASE
            WHEN quality_score < 60 THEN 'Reskill or replace'
            WHEN quality_score < 70 THEN 'Targeted coaching'
            WHEN quality_score < 75 THEN 'Performance plan'
            ELSE 'Monitor'
          END as recommended_action,
          NOW() as run_timestamp
        FROM efficiency_ranked
        WHERE efficiency_rank <= ? AND potential_monthly_savings > 0
        ORDER BY potential_monthly_savings DESC
      `;

      const [results] = await db.query<SavingsOpportunity[]>(query, [daysBack, topN]);
      return results;
    } catch (error) {
      logger.error('Error fetching savings opportunities:', error);
      throw error;
    }
  }

  /**
   * Get salary-quality correlation analysis by quartile
   */
  static async getSalaryQualityCorrelation(
    daysBack: number = this.DEFAULT_DAYS,
  ): Promise<SalaryQualityCorrelation[]> {
    try {
      const query = `
        WITH salary_quartiles AS (
          SELECT
            e.employee_code,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as agent_name,
            spl.gross_salary,
            ROUND(AVG(cqa.quality_percentage), 1) as avg_quality,
            COUNT(DISTINCT cqa.id) as call_count,
            NTILE(4) OVER (ORDER BY spl.gross_salary) as salary_quartile
          FROM mas_hrms.employees e
          LEFT JOIN mas_hrms.salary_prep_line spl
            ON spl.employee_id = e.id
            AND spl.status = 'processed'
            AND spl.month = MONTH(NOW())
          LEFT JOIN db_audit.call_quality_assessment cqa
            ON cqa.User = e.employee_code
            AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
          WHERE e.active_status = 1
            AND e.employment_status = 'Active'
          GROUP BY e.id, spl.id
          HAVING call_count >= 5
        )
        SELECT
          'SALARY_QUALITY_CORRELATION' as analysis_type,
          CASE
            WHEN salary_quartile = 1 THEN 'Q1_Lowest25pct'
            WHEN salary_quartile = 2 THEN 'Q2_Mid_Low'
            WHEN salary_quartile = 3 THEN 'Q3_Mid_High'
            WHEN salary_quartile = 4 THEN 'Q4_Highest25pct'
          END as salary_bracket,
          ROUND(MIN(gross_salary), 2) as salary_min,
          ROUND(MAX(gross_salary), 2) as salary_max,
          ROUND(AVG(gross_salary), 2) as salary_avg,
          COUNT(*) as agent_count,
          ROUND(AVG(avg_quality), 2) as avg_quality_in_bracket,
          ROUND(MIN(avg_quality), 1) as worst_quality,
          ROUND(MAX(avg_quality), 1) as best_quality,
          ROUND(STDDEV(avg_quality), 2) as quality_variance,
          ROUND(COUNT(CASE WHEN avg_quality >= 80 THEN 1 END) * 100.0 / COUNT(*), 1) as excellence_pct,
          ROUND(COUNT(CASE WHEN avg_quality < 70 THEN 1 END) * 100.0 / COUNT(*), 1) as underperforming_pct,
          NOW() as run_timestamp
        FROM salary_quartiles
        GROUP BY salary_quartile
        ORDER BY salary_quartile ASC
      `;

      const [results] = await db.query<SalaryQualityCorrelation[]>(query, [daysBack]);
      return results;
    } catch (error) {
      logger.error('Error fetching salary-quality correlation:', error);
      throw error;
    }
  }

  /**
   * Get annual cost forecast based on current 30-day trend
   */
  static async getAnnualForecast(
    daysBack: number = this.DEFAULT_DAYS,
  ): Promise<AnnualForecast[]> {
    try {
      const query = `
        SELECT
          'ANNUAL_FORECAST' as forecast_type,
          'Based on Last 30 Days' as data_basis,
          COUNT(DISTINCT e.id) as active_agents,
          ROUND(SUM(spl.gross_salary) * 12, 2) as annual_payroll_at_current_rate,
          ROUND(COUNT(DISTINCT cqa.id) * 12, 0) as projected_annual_calls,
          ROUND(AVG(cqa.quality_percentage), 2) as avg_quality_maintained,
          ROUND((SUM(spl.gross_salary) * 12) / NULLIF(COUNT(DISTINCT cqa.id) * 12, 0), 2) as projected_annual_cost_per_call,
          ROUND((SUM(spl.gross_salary) * 12) / NULLIF(AVG(cqa.quality_percentage) * 12, 0), 2) as projected_annual_cost_per_quality_point,
          CASE
            WHEN AVG(cqa.quality_percentage) >= 80 THEN 'Sustainable Model - Scale Recommended'
            WHEN AVG(cqa.quality_percentage) >= 70 THEN 'Acceptable Model - Optimize Recommended'
            ELSE 'At-Risk Model - Urgent Intervention'
          END as model_health,
          NOW() as run_timestamp
        FROM mas_hrms.employees e
        LEFT JOIN mas_hrms.salary_prep_line spl
          ON spl.employee_id = e.id
          AND spl.status = 'processed'
          AND spl.month = MONTH(NOW())
        LEFT JOIN db_audit.call_quality_assessment cqa
          ON cqa.User = e.employee_code
          AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
        WHERE e.active_status = 1
          AND e.employment_status = 'Active'
          AND spl.gross_salary > 0
      `;

      const [results] = await db.query<AnnualForecast[]>(query, [daysBack]);
      return results;
    } catch (error) {
      logger.error('Error fetching annual forecast:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive cost efficiency dashboard (all metrics in one call)
   */
  static async getDashboard(daysBack: number = this.DEFAULT_DAYS) {
    try {
      const [agentMetrics, processROI, opportunities, salary_quality, forecast] = await Promise.all([
        this.getAgentCostEfficiency(daysBack, 50),
        this.getProcessROI(daysBack, 30),
        this.getSavingsOpportunities(10, daysBack),
        this.getSalaryQualityCorrelation(daysBack),
        this.getAnnualForecast(daysBack),
      ]);

      return {
        summary: {
          total_active_agents: agentMetrics.length,
          high_roi_agents: agentMetrics.filter((a) => a.efficiency_rating === 'HIGH_ROI').length,
          low_roi_agents: agentMetrics.filter((a) => a.efficiency_rating === 'LOW_ROI').length,
          premium_roi_processes: processROI.filter((p) => p.roi_classification === 'PREMIUM_ROI').length,
          total_monthly_savings_opportunity: opportunities.reduce((sum, o) => sum + (o.potential_monthly_savings || 0), 0),
        },
        agentMetrics,
        processROI,
        opportunities,
        salaryQualityCorrelation: salary_quality,
        annualForecast: forecast[0] || null,
      };
    } catch (error) {
      logger.error('Error building cost efficiency dashboard:', error);
      throw error;
    }
  }
}

export default CostEfficiencyService;
