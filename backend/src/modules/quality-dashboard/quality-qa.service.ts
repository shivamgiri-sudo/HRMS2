import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { logger } from '../../logger.js';

export interface ProcessQualityMetrics {
  process: string;
  avg_quality: number;
  call_count: number;
  agent_count: number;
  quality_distribution: { excellent: number; good: number; average: number; poor: number };
  anomalies: string[];
  risk_level: 'Low' | 'Medium' | 'High';
}

export interface AnomalyDetail {
  type: 'quality_drop' | 'high_error_rate' | 'outlier_performance';
  severity: 'Low' | 'Medium' | 'High';
  agent_code: string;
  agent_name: string;
  description: string;
  metric_value: number;
  expected_value: number;
  deviation_pct: number;
}

export interface QualityAuditResponse {
  summary: {
    total_calls_audited: number;
    avg_quality_score: number;
    compliance_rate: number;
    audit_period: { start_date: string; end_date: string };
  };
  process_metrics: ProcessQualityMetrics[];
  anomalies: AnomalyDetail[];
  risk_matrix: {
    high_risk_count: number;
    medium_risk_count: number;
    low_risk_count: number;
  };
}

type DbPoolLike = { getConnection: () => Promise<PoolConnection> };

export class QualityQAService {
  constructor(private db: DbPoolLike) {}

  async getQualityAudit(
    daysBack: number = 7,
    process?: string
  ): Promise<QualityAuditResponse> {
    const conn = await this.db.getConnection();

    try {
      // Build process filter
      let processFilter = '';
      let params: any[] = [daysBack];

      if (process) {
        processFilter = ' AND cqa.Campaign LIKE ?';
        params.push(`${process}%`);
      }

      // Get overall metrics
      const [overallMetrics] = await conn.execute<RowDataPacket[]>(
        `SELECT
           COUNT(*) as total_calls,
           ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
           COUNT(CASE WHEN cqa.quality_percentage >= 80 THEN 1 END) as compliant_calls,
           MIN(cqa.CallDate) as earliest_date,
           MAX(cqa.CallDate) as latest_date
         FROM db_audit.call_quality_assessment cqa
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)${processFilter}`,
        params
      );

      const overallRow = overallMetrics?.[0] as any;
      const totalCalls = overallRow?.total_calls || 0;
      const avgQuality = overallRow?.avg_quality || 0;
      const complianceRate = totalCalls > 0 ? Math.round((overallRow?.compliant_calls || 0) / totalCalls * 100) : 0;

      // Get process-level metrics
      const [processMetricsRows] = await conn.execute<RowDataPacket[]>(
        `SELECT
           cqa.Campaign as process_name,
           ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
           COUNT(*) as call_count,
           COUNT(DISTINCT cqa.User) as agent_count,
           COUNT(CASE WHEN cqa.quality_percentage >= 90 THEN 1 END) as excellent_count,
           COUNT(CASE WHEN cqa.quality_percentage >= 80 AND cqa.quality_percentage < 90 THEN 1 END) as good_count,
           COUNT(CASE WHEN cqa.quality_percentage >= 70 AND cqa.quality_percentage < 80 THEN 1 END) as average_count,
           COUNT(CASE WHEN cqa.quality_percentage < 70 THEN 1 END) as poor_count
         FROM db_audit.call_quality_assessment cqa
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)${processFilter}
         GROUP BY cqa.Campaign
         ORDER BY avg_quality DESC`,
        params
      );

      // Identify anomalies - agents with significant quality drop or outliers
      const [anomalyRows] = await conn.execute<RowDataPacket[]>(
        `SELECT
           cqa.User as agent_code,
           e.first_name,
           e.last_name,
           ROUND(AVG(cqa.quality_percentage), 2) as current_quality,
           COUNT(*) as recent_calls,
           COUNT(CASE WHEN cqa.quality_percentage < 60 THEN 1 END) as critical_calls
         FROM db_audit.call_quality_assessment cqa
         LEFT JOIN mas_hrms.employees e ON e.employee_code = cqa.User
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)${processFilter}
         GROUP BY cqa.User, e.first_name, e.last_name
         HAVING recent_calls >= 5 AND (current_quality < 70 OR critical_calls > 0)
         ORDER BY current_quality ASC`,
        params
      );

      // Calculate historical baseline for trend detection
      const [baselineRows] = await conn.execute<RowDataPacket[]>(
        `SELECT
           cqa.User as agent_code,
           ROUND(AVG(cqa.quality_percentage), 2) as baseline_quality
         FROM db_audit.call_quality_assessment cqa
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)${processFilter}
         GROUP BY cqa.User`,
        [...params]
      );

      const baselineMap = new Map((baselineRows || []).map((r: any) => [r.agent_code, r.baseline_quality]));

      // Build anomalies list
      const anomalies: AnomalyDetail[] = [];
      (anomalyRows || []).forEach((row: any) => {
        const baseline = baselineMap.get(row.agent_code) || row.current_quality;
        const deviation = baseline - row.current_quality;
        const deviationPct = baseline > 0 ? Math.round((deviation / baseline) * 100) : 0;

        if (deviation > 5) {
          anomalies.push({
            type: 'quality_drop',
            severity: deviation > 15 ? 'High' : deviation > 10 ? 'Medium' : 'Low',
            agent_code: row.agent_code,
            agent_name: `${row.first_name} ${row.last_name || ''}`.trim(),
            description: `Quality score dropped from ${baseline}% to ${row.current_quality}%`,
            metric_value: row.current_quality,
            expected_value: baseline,
            deviation_pct: deviationPct
          });
        }

        if (row.critical_calls > 3) {
          anomalies.push({
            type: 'high_error_rate',
            severity: row.critical_calls > 5 ? 'High' : 'Medium',
            agent_code: row.agent_code,
            agent_name: `${row.first_name} ${row.last_name || ''}`.trim(),
            description: `${row.critical_calls} calls with critical quality issues (< 60%)`,
            metric_value: row.critical_calls,
            expected_value: 0,
            deviation_pct: 100
          });
        }
      });

      // Build process metrics
      const processMetrics: ProcessQualityMetrics[] = (processMetricsRows || []).map((row: any) => {
        const avgQual = row.avg_quality || 0;
        const processAnomalies: string[] = [];

        if (avgQual < 70) processAnomalies.push('Critical quality level');
        if (row.poor_count > row.call_count * 0.2) processAnomalies.push('High error rate');
        if (row.agent_count < 3) processAnomalies.push('Low agent coverage');

        return {
          process: row.process_name,
          avg_quality: avgQual,
          call_count: row.call_count,
          agent_count: row.agent_count,
          quality_distribution: {
            excellent: row.excellent_count,
            good: row.good_count,
            average: row.average_count,
            poor: row.poor_count
          },
          anomalies: processAnomalies,
          risk_level: avgQual >= 80 ? 'Low' : avgQual >= 70 ? 'Medium' : 'High'
        };
      });

      // Risk matrix summary
      const riskMatrix = {
        high_risk_count: processMetrics.filter(p => p.risk_level === 'High').length,
        medium_risk_count: processMetrics.filter(p => p.risk_level === 'Medium').length,
        low_risk_count: processMetrics.filter(p => p.risk_level === 'Low').length
      };

      return {
        summary: {
          total_calls_audited: totalCalls,
          avg_quality_score: avgQuality,
          compliance_rate: complianceRate,
          audit_period: {
            start_date: overallRow?.earliest_date ? new Date(overallRow.earliest_date).toISOString().split('T')[0] : 'N/A',
            end_date: overallRow?.latest_date ? new Date(overallRow.latest_date).toISOString().split('T')[0] : 'N/A'
          }
        },
        process_metrics: processMetrics,
        anomalies: anomalies,
        risk_matrix: riskMatrix
      };
    } finally {
      conn.release();
    }
  }
}
