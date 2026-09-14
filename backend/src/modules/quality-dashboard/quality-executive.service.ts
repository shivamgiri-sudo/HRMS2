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
      // ROUND(AVG(...), 2) is a MySQL DECIMAL, and mysql2 hands DECIMALs back as *strings*
      // ("73.45", not 73.45) — the same defect class as the frontend .toFixed() crash on
      // /quality-dashboard earlier this session. Number(...) here, not `|| 0` alone: `|| 0`
      // only guards a missing row, it does nothing about the value still being a string.
      const currentQuality = Number(currentRow?.current_quality) || 0;

      // Get 7-day average for trend
      const [sevenDayMetrics] = await conn.execute<RowDataPacket[]>(
        `SELECT ROUND(AVG(cqa.quality_percentage), 2) as avg_quality
         FROM db_audit.call_quality_assessment cqa
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
      );

      const sevenDayQuality = Number((sevenDayMetrics?.[0] as any)?.avg_quality) || currentQuality;

      // Get 30-day baseline for 30-day trend
      const [thirtyDayMetrics] = await conn.execute<RowDataPacket[]>(
        `SELECT ROUND(AVG(cqa.quality_percentage), 2) as avg_quality
         FROM db_audit.call_quality_assessment cqa
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
      );

      const thirtyDayQuality = Number((thirtyDayMetrics?.[0] as any)?.avg_quality) || currentQuality;

      // Calculate trends.
      //
      // Before the Number() coercions above, `sevenDayQuality > currentQuality` compared two
      // DECIMAL *strings* lexically, not numerically: "9.50" > "73.45" is true (both start
      // with a digit, '9' > '7' lexically), a wrong ↗ for what is actually a steep decline.
      // The bug only ever showed below a 10% value on either side — everything in this
      // dataset's normal range (60-90%) happens to compare the same way lexically as
      // numerically, which is exactly why this went unnoticed: the arrow was right unless
      // quality itself had already collapsed, i.e. right whenever nobody was looking closely.
      // `- currentQuality` and `>= 85` below were never affected: `-` and `>=`-against-a-
      // number-literal both coerce a string operand to a number per the JS spec: only
      // string-vs-string relational comparison (`>`, `<`) stays lexical.
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
           SUBSTRING_INDEX(
             GROUP_CONCAT(DISTINCT COALESCE(ccfg.display_name, CONCAT('Client ', cqa.ClientId))
                          ORDER BY cqa.ClientId),
             ',', 1) as process
         FROM db_audit.call_quality_assessment cqa
         LEFT JOIN mas_hrms.employees e ON e.employee_code = cqa.User
         LEFT JOIN Shivamgiri.portal_client_config ccfg
           ON ccfg.client_id = CAST(cqa.ClientId AS UNSIGNED)
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
           SUBSTRING_INDEX(
             GROUP_CONCAT(DISTINCT COALESCE(ccfg.display_name, CONCAT('Client ', cqa.ClientId))
                          ORDER BY cqa.ClientId),
             ',', 1) as process
         FROM db_audit.call_quality_assessment cqa
         LEFT JOIN mas_hrms.employees e ON e.employee_code = cqa.User
         LEFT JOIN Shivamgiri.portal_client_config ccfg
           ON ccfg.client_id = CAST(cqa.ClientId AS UNSIGNED)
         CROSS JOIN (SELECT @rank := 0) AS init
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY cqa.User, e.first_name, e.last_name
         HAVING calls_handled >= 10
         ORDER BY quality_score ASC
         LIMIT 10`,
        [daysBack]
      );

      // Get process performance.
      //
      // Keyed on ClientId, NOT on Campaign. `Campaign` stopped being written after April
      // 2026: on 2026-08-28 every one of the 14,488 rows in the trailing 30-day window has
      // Campaign IS NULL (COUNT(DISTINCT Campaign) = 0 for the window; 35,150 NULLs overall,
      // all of them from 2026-05 onward). `GROUP BY Campaign` therefore returned exactly ONE
      // row, with a NULL name, blending nine processes spanning 47%-87% into a single 73.6%
      // — which the CEO dashboard rendered as the literal filler string "Process 1".
      //
      // ClientId is populated on 100% of those rows and resolves to 9 processes. The display
      // name comes from Shivamgiri.portal_client_config, the same lookup call-master.service.ts
      // already uses for this table. Campaign is kept as a second-choice label so historic
      // windows (daysBack spanning before May 2026) still read with their original names, and
      // `Client <id>` covers the two live ids that carry no config row (487, 417).
      const [processMetrics] = await conn.execute<RowDataPacket[]>(
        `SELECT
           COALESCE(
             ccfg.display_name,
             NULLIF(MAX(cqa.Campaign), ''),
             CONCAT('Client ', cqa.ClientId),
             'Unattributed'
           ) as process_name,
           ROUND(AVG(cqa.quality_percentage), 2) as avg_quality,
           COUNT(DISTINCT cqa.User) as agent_count,
           COUNT(*) as calls_handled
         FROM db_audit.call_quality_assessment cqa
         LEFT JOIN Shivamgiri.portal_client_config ccfg
           ON ccfg.client_id = CAST(cqa.ClientId AS UNSIGNED)
         WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY cqa.ClientId, ccfg.display_name
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
        // Number() at source, not just in the frontend hook: ROUND(AVG(...)) is a MySQL
        // DECIMAL and mysql2 hands DECIMALs back as strings, the same defect class the
        // trend-direction comparison above was bitten by.
        process_performance: (processMetrics || []).map((row: any) => {
          const avgQuality = Number(row.avg_quality) || 0;
          return {
            process: String(row.process_name ?? 'Unattributed'),
            avg_quality: avgQuality,
            agent_count: Number(row.agent_count) || 0,
            calls_handled: Number(row.calls_handled) || 0,
            status: (avgQuality >= 85 ? 'On Track' : avgQuality >= 75 ? 'At Risk' : 'Critical') as
              'On Track' | 'At Risk' | 'Critical'
          };
        }),
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
