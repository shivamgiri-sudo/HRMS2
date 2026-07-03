import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { logger } from '../../logger.js';

export interface ExecutiveQualityMetrics {
  overall_quality_score: number;
  target_quality_score: number;
  gap_pct: number;
  status: 'On Track' | 'At Risk' | 'Critical';
  trend_7day: { direction: string; change_pct: number };
  trend_30day: { direction: string; change_pct: number };
}

export interface PerformerRank {
  rank: number;
  agent_code: string;
  agent_name: string;
  quality_score: number;
  calls_handled: number;
  process: string;
}

export interface ExecutiveSummaryResponse {
  metrics: ExecutiveQualityMetrics;
  top_performers: PerformerRank[];
  bottom_performers: PerformerRank[];
  process_performance: Array<{
    process: string;
    avg_quality: number;
    agent_count: number;
    calls_handled: number;
    status: 'On Track' | 'At Risk' | 'Critical';
  }>;
  risk_summary: {
    critical_agents_count: number;
    at_risk_agents_count: number;
    coaching_priority_count: number;
  };
  org_benchmarks: {
    avg_quality: number;
    median_quality: number;
    std_deviation: number;
  };
}

type DbPoolLike = { getConnection: () => Promise<PoolConnection> };

export class QualityExecutiveService {
  constructor(private db: DbPoolLike) {}

  async getExecutiveSummary(daysBack: number = 30): Promise<ExecutiveSummaryResponse> {
    const conn = await this.db.getConnection();

    try {
      // Get current period overall metrics
      const [currentMetrics] = await conn.execute<RowDataPacket[]>(
        `SELECT
           ROUND(AVG(cqa.quality_percentage), 2) as current_quality,
           COUNT(*) as total_calls,
           COUNT(DISTINCT cqa.User) as unique_agents
         FROM db_audit.call_quality_assessment cqa
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [daysBack]
      );

      const currentRow = currentMetrics?.[0] as any;
      const currentQuality = currentRow?.current_quality || 0;

      // Get 7-day average for trend
      const [sevenDayMetrics] = await conn.execute<RowDataPacket[]>(
        `SELECT ROUND(AVG(cqa.quality_percentage), 2) as avg_quality
         FROM db_audit.call_quality_assessment cqa
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
      );

      const sevenDayQuality = (sevenDayMetrics?.[0] as any)?.avg_quality || currentQuality;

      // Get 30-day baseline for 30-day trend
      const [thirtyDayMetrics] = await conn.execute<RowDataPacket[]>(
        `SELECT ROUND(AVG(cqa.quality_percentage), 2) as avg_quality
         FROM db_audit.call_quality_assessment cqa
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
      );

      const thirtyDayQuality = (thirtyDayMetrics?.[0] as any)?.avg_quality || currentQuality;

      // Calculate trends
      const trend7day = {
        direction: sevenDayQuality > currentQuality ? '↗' : sevenDayQuality < currentQuality ? '↘' : '→',
        change_pct: Math.round((sevenDayQuality - currentQuality) * 100) / 100
      };

      const trend30day = {
        direction: thirtyDayQuality > currentQuality ? '↗' : thirtyDayQuality < currentQuality ? '↘' : '→',
        change_pct: Math.round((thirtyDayQuality - currentQuality) * 100) / 100
      };

      // Executive metrics
      const targetQuality = 85;
      const metrics: ExecutiveQualityMetrics = {
        overall_quality_score: Math.round(currentQuality * 100) / 100,
        target_quality_score: targetQuality,
        gap_pct: Math.round((targetQuality - currentQuality) * 100) / 100,
        status: currentQuality >= 85 ? 'On Track' : currentQuality >= 75 ? 'At Risk' : 'Critical',
        trend_7day: trend7day,
        trend_30day: trend30day
      };

      // Get top 10 performers
      const [topPerformers] = await conn.execute<RowDataPacket[]>(
        `SELECT
           @rank := @rank + 1 as rank_position,
           cqa.User as agent_code,
           e.first_name,
           e.last_name,
           ROUND(AVG(cqa.quality_percentage), 2) as quality_score,
           COUNT(*) as calls_handled,
           SUBSTRING_INDEX(SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT SUBSTRING(cqa.Campaign, 1, 10)), ',', 1), ',', -1) as process
         FROM db_audit.call_quality_assessment cqa
         LEFT JOIN mas_hrms.employees e ON e.employee_code = cqa.User
         CROSS JOIN (SELECT @rank := 0) AS init
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY cqa.User, e.first_name, e.last_name
         HAVING calls_handled >= 10
         ORDER BY quality_score DESC
         LIMIT 10`,
        [daysBack]
      );

      // Get bottom 10 performers
      const [bottomPerformers] = await conn.execute<RowDataPacket[]>(
        `SELECT
           @rank := @rank + 1 as rank_position,
           cqa.User as agent_code,
           e.first_name,
           e.last_name,
           ROUND(AVG(cqa.quality_percentage), 2) as quality_score,
           COUNT(*) as calls_handled,
           SUBSTRING_INDEX(SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT SUBSTRING(cqa.Campaign, 1, 10)), ',', 1), ',', -1) as process
         FROM db_audit.call_quality_assessment cqa
         LEFT JOIN mas_hrms.employees e ON e.employee_code = cqa.User
         CROSS JOIN (SELECT @rank := 0) AS init
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY cqa.User, e.first_name, e.last_name
         HAVING calls_handled >= 10
         ORDER BY quality_score ASC
         LIMIT 10`,
        [daysBack]
      );

      // Get process performance
      const [processMetrics] = await conn.execute<RowDataPacket[]>(
        `SELECT
           cqa.Campaign as process_name,
           ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
           COUNT(DISTINCT cqa.User) as agent_count,
           COUNT(*) as calls_handled
         FROM db_audit.call_quality_assessment cqa
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY cqa.Campaign
         ORDER BY avg_quality DESC`,
        [daysBack]
      );

      const [agentQualityRows] = await conn.execute<RowDataPacket[]>(
        `SELECT
           cqa.User as agent_code,
           ROUND(AVG(cqa.quality_percentage), 2) as avg_quality
         FROM db_audit.call_quality_assessment cqa
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY cqa.User`,
        [daysBack]
      );

      const agentQualityScores = (agentQualityRows || [])
        .map((row: any) => Number(row.avg_quality))
        .filter((score) => Number.isFinite(score));

      const sortedAgentScores = [...agentQualityScores].sort((a, b) => a - b);
      const medianQuality =
        sortedAgentScores.length === 0
          ? 0
          : sortedAgentScores.length % 2 === 1
            ? sortedAgentScores[Math.floor(sortedAgentScores.length / 2)]!
            : Math.round(
                ((sortedAgentScores[sortedAgentScores.length / 2 - 1]! +
                  sortedAgentScores[sortedAgentScores.length / 2]!) /
                  2) *
                  100
              ) / 100;

      // Organization benchmarks
      const [benchmarks] = await conn.execute<RowDataPacket[]>(
        `SELECT
           ROUND(AVG(user_stats.quality_percentage), 2) as avg_quality,
           ROUND(STDDEV(user_stats.quality_percentage), 2) as std_dev
         FROM (
           SELECT ROUND(AVG(cqa.quality_percentage), 2) as quality_percentage
           FROM db_audit.call_quality_assessment cqa
           WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
           GROUP BY cqa.User
         ) AS user_stats`,
        [daysBack]
      );

      const benchmarkRow = benchmarks?.[0] as any;

      return {
        metrics: metrics,
        top_performers: (topPerformers || []).map((row: any) => ({
          rank: row.rank_position,
          agent_code: row.agent_code,
          agent_name: `${row.first_name} ${row.last_name || ''}`.trim(),
          quality_score: row.quality_score,
          calls_handled: row.calls_handled,
          process: row.process || 'N/A'
        })),
        bottom_performers: (bottomPerformers || []).map((row: any) => ({
          rank: row.rank_position,
          agent_code: row.agent_code,
          agent_name: `${row.first_name} ${row.last_name || ''}`.trim(),
          quality_score: row.quality_score,
          calls_handled: row.calls_handled,
          process: row.process || 'N/A'
        })),
        process_performance: (processMetrics || []).map((row: any) => ({
          process: row.process_name,
          avg_quality: row.avg_quality,
          agent_count: row.agent_count,
          calls_handled: row.calls_handled,
          status: row.avg_quality >= 85 ? 'On Track' : row.avg_quality >= 75 ? 'At Risk' : 'Critical'
        })),
        risk_summary: {
          critical_agents_count: agentQualityScores.filter((score) => score < 60).length,
          at_risk_agents_count: agentQualityScores.filter((score) => score >= 60 && score < 70).length,
          coaching_priority_count: agentQualityScores.filter((score) => score >= 70 && score < 80).length
        },
        org_benchmarks: {
          avg_quality: benchmarkRow?.avg_quality || 0,
          median_quality: medianQuality,
          std_deviation: benchmarkRow?.std_dev || 0
        }
      };
    } finally {
      conn.release();
    }
  }
}
