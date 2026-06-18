/**
 * Quality Insights Service
 * AI-powered analytics and predictions for quality metrics
 */

import type { RowDataPacket } from 'mysql2';
import mysql from 'mysql2/promise';
import { env } from '../../config/env.js';

let ciPool: mysql.Pool | null = null;
function getCiPool(): mysql.Pool {
  if (!ciPool) ciPool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: 'Shivamgiri',
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 10000,
  });
  return ciPool;
}

/**
 * Get hour-of-day quality heatmap data
 */
export async function getQualityHeatmap(from: string, to: string) {
  const pool = getCiPool();
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT
      DAYNAME(CallDate) as day_name,
      HOUR(CallDate) as hour,
      COUNT(*) as call_count,
      ROUND(AVG(quality_percentage), 1) as avg_score,
      COUNT(CASE WHEN quality_percentage < 50 THEN 1 END) as critical_calls
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ?
    GROUP BY DAYNAME(CallDate), HOUR(CallDate)
    ORDER BY FIELD(DAYNAME(CallDate), 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'), hour
  `, [from, to]);

  // Transform to heatmap structure
  const heatmap: Record<string, Record<number, { score: number; calls: number; critical: number }>> = {};
  for (const row of rows) {
    if (!heatmap[row.day_name]) heatmap[row.day_name] = {};
    heatmap[row.day_name][row.hour] = {
      score: row.avg_score,
      calls: row.call_count,
      critical: row.critical_calls
    };
  }
  return heatmap;
}

/**
 * Predict agent at-risk status based on quality trends
 */
export async function predictAgentRisk(from: string, to: string) {
  const pool = getCiPool();
  const [rows] = await pool.execute<RowDataPacket[]>(`
    WITH agent_metrics AS (
      SELECT
        User as agent_name,
        COUNT(*) as total_calls,
        AVG(quality_percentage) as overall_avg,
        AVG(CASE WHEN CallDate >= DATE_SUB(?, INTERVAL 7 DAY) THEN quality_percentage END) as week_avg,
        AVG(CASE WHEN CallDate >= DATE_SUB(?, INTERVAL 1 DAY) THEN quality_percentage END) as yesterday_avg,
        STDDEV(quality_percentage) as quality_volatility,
        MIN(quality_percentage) as worst_call,
        MAX(quality_percentage) as best_call,
        SUM(CASE WHEN quality_percentage < 50 THEN 1 ELSE 0 END) as critical_count
      FROM db_audit.call_quality_assessment
      WHERE CallDate BETWEEN ? AND ?
        AND User IS NOT NULL AND User != ''
      GROUP BY User
      HAVING COUNT(*) >= 5
    )
    SELECT
      agent_name,
      total_calls,
      ROUND(overall_avg, 1) as overall_avg,
      ROUND(week_avg, 1) as week_avg,
      ROUND(yesterday_avg, 1) as yesterday_avg,
      ROUND(quality_volatility, 1) as volatility,
      worst_call,
      best_call,
      critical_count,
      ROUND(week_avg - overall_avg, 1) as trend_delta,
      CASE
        WHEN week_avg < overall_avg - 10 THEN 'declining_fast'
        WHEN week_avg < overall_avg - 5 THEN 'declining'
        WHEN week_avg > overall_avg + 5 THEN 'improving'
        WHEN quality_volatility > 25 THEN 'unstable'
        WHEN overall_avg < 60 THEN 'consistently_poor'
        WHEN overall_avg >= 85 THEN 'top_performer'
        ELSE 'stable'
      END as risk_status,
      CASE
        WHEN week_avg < 60 AND quality_volatility > 20 THEN 'Immediate coaching required'
        WHEN week_avg < overall_avg - 10 THEN 'Schedule performance review'
        WHEN critical_count > total_calls * 0.1 THEN 'Too many critical calls - review process knowledge'
        WHEN overall_avg >= 90 THEN 'Consider for mentorship role'
        ELSE 'Continue monitoring'
      END as recommended_action
    FROM agent_metrics
    ORDER BY
      CASE
        WHEN week_avg < overall_avg - 10 THEN 1
        WHEN week_avg < 60 THEN 2
        WHEN quality_volatility > 25 THEN 3
        ELSE 4
      END,
      week_avg ASC
  `, [to, to, from, to]);

  return rows;
}

/**
 * Generate automated insights based on current data patterns
 */
export async function generateInsights(from: string, to: string) {
  const pool = getCiPool();
  const insights: Array<{
    type: 'success' | 'warning' | 'critical' | 'opportunity';
    title: string;
    message: string;
    metric?: number;
    action?: string;
  }> = [];

  // Insight 1: Quality trend
  const [trendData] = await pool.execute<RowDataPacket[]>(`
    SELECT
      AVG(CASE WHEN DATE(CallDate) = CURDATE() THEN quality_percentage END) as today_avg,
      AVG(CASE WHEN DATE(CallDate) = DATE_SUB(CURDATE(), INTERVAL 1 DAY) THEN quality_percentage END) as yesterday_avg,
      AVG(CASE WHEN CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN quality_percentage END) as week_avg,
      AVG(CASE WHEN CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN quality_percentage END) as month_avg
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ?
  `, [from, to]);

  const trend = trendData[0];
  if (trend.today_avg && trend.yesterday_avg) {
    const delta = trend.today_avg - trend.yesterday_avg;
    if (delta > 5) {
      insights.push({
        type: 'success',
        title: 'Quality Improving',
        message: `Today's quality is ${delta.toFixed(1)}% higher than yesterday`,
        metric: trend.today_avg,
        action: 'Identify and replicate successful practices'
      });
    } else if (delta < -5) {
      insights.push({
        type: 'warning',
        title: 'Quality Declining',
        message: `Today's quality dropped ${Math.abs(delta).toFixed(1)}% from yesterday`,
        metric: trend.today_avg,
        action: 'Investigate root cause immediately'
      });
    }
  }

  // Insight 2: Critical agents
  const [criticalAgents] = await pool.execute<RowDataPacket[]>(`
    SELECT User, COUNT(*) as poor_calls
    FROM db_audit.call_quality_assessment
    WHERE CallDate >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      AND quality_percentage < 50
    GROUP BY User
    HAVING COUNT(*) >= 3
    ORDER BY poor_calls DESC
    LIMIT 3
  `, []);

  if (criticalAgents.length > 0) {
    insights.push({
      type: 'critical',
      title: 'Agents Need Immediate Support',
      message: `${criticalAgents.length} agents have 3+ critical calls in last 24 hours`,
      action: `Priority coaching for: ${criticalAgents.map((a: any) => a.User).join(', ')}`
    });
  }

  // Insight 3: Best practices opportunity
  const [topPerformers] = await pool.execute<RowDataPacket[]>(`
    SELECT
      COUNT(DISTINCT User) as top_count,
      AVG(quality_percentage) as top_avg
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ?
      AND quality_percentage >= 90
  `, [from, to]);

  const [bottomPerformers] = await pool.execute<RowDataPacket[]>(`
    SELECT
      COUNT(DISTINCT User) as bottom_count,
      AVG(quality_percentage) as bottom_avg
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ?
      AND quality_percentage < 70
  `, [from, to]);

  if (topPerformers[0].top_count > 0 && bottomPerformers[0].bottom_count > 0) {
    const gap = topPerformers[0].top_avg - bottomPerformers[0].bottom_avg;
    insights.push({
      type: 'opportunity',
      title: 'Performance Gap Opportunity',
      message: `${gap.toFixed(1)}% quality gap between top and bottom performers`,
      action: 'Implement peer mentoring program to close the gap'
    });
  }

  // Insight 4: Peak hour performance
  const [peakHours] = await pool.execute<RowDataPacket[]>(`
    SELECT
      HOUR(CallDate) as hour,
      AVG(quality_percentage) as avg_score,
      COUNT(*) as call_volume
    FROM db_audit.call_quality_assessment
    WHERE CallDate BETWEEN ? AND ?
    GROUP BY HOUR(CallDate)
    ORDER BY avg_score ASC
    LIMIT 1
  `, [from, to]);

  if (peakHours[0]) {
    insights.push({
      type: 'warning',
      title: 'Weakest Hour Identified',
      message: `Quality drops to ${peakHours[0].avg_score.toFixed(1)}% at ${peakHours[0].hour}:00 hrs`,
      metric: peakHours[0].call_volume,
      action: 'Consider additional staffing or breaks during this hour'
    });
  }

  return insights;
}

/**
 * Calculate ROI of quality improvements
 */
export async function calculateQualityROI(from: string, to: string) {
  const pool = getCiPool();

  // Get quality and sales correlation
  const [data] = await pool.execute<RowDataPacket[]>(`
    SELECT
      AVG(qc.quality_percentage) as avg_quality,
      COUNT(DISTINCT qc.User) as agent_count,
      COUNT(*) as total_calls,
      SUM(CASE WHEN cd.SaleDone IN ('Yes', '1') THEN 1 ELSE 0 END) as sales_count
    FROM db_audit.call_quality_assessment qc
    LEFT JOIN db_external.CallDetails cd ON cd.CallDate = qc.CallDate
      AND cd.AgentName = qc.User
    WHERE qc.CallDate BETWEEN ? AND ?
  `, [from, to]);

  const current = data[0];
  const conversionRate = (current.sales_count / current.total_calls) * 100;

  // Projections based on quality improvements
  const projections = [
    { improvement: 5, label: '+5% Quality' },
    { improvement: 10, label: '+10% Quality' },
    { improvement: 15, label: '+15% Quality' }
  ].map(proj => {
    // Empirical: 1% quality improvement = 0.3% conversion improvement
    const newConversion = conversionRate * (1 + (proj.improvement * 0.003));
    const additionalSales = (current.total_calls * (newConversion - conversionRate) / 100);
    const avgDealValue = 500; // $ - would come from config
    const additionalRevenue = additionalSales * avgDealValue;

    return {
      ...proj,
      current_quality: current.avg_quality,
      projected_quality: current.avg_quality + proj.improvement,
      current_conversion: conversionRate.toFixed(2),
      projected_conversion: newConversion.toFixed(2),
      additional_sales: Math.round(additionalSales),
      additional_revenue: Math.round(additionalRevenue),
      roi_multiple: (additionalRevenue / (proj.improvement * 1000)).toFixed(1) // Assumes $1k per % improvement cost
    };
  });

  return {
    current_metrics: {
      quality: current.avg_quality,
      conversion: conversionRate,
      total_calls: current.total_calls,
      total_sales: current.sales_count
    },
    projections
  };
}

export const qualityInsightsService = {
  getQualityHeatmap,
  predictAgentRisk,
  generateInsights,
  calculateQualityROI
};