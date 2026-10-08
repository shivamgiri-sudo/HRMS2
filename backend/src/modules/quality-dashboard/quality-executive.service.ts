import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { logger } from '../../logger.js';
import { TtlCache } from '../../shared/ttlCache.js';

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

// The audit table is wide (92 columns) and every statement below aggregates a trailing window of it,
// so each one costs a scan of the window. The summary is identical for every viewer, and both
// /quality-summary and /quality-summary/process-breakdown call it (the CEO and Super Admin layouts
// load both at once), so one computation per `daysBack` is shared for 60s, including by callers that
// arrive while it is still running. Failures are never cached.
const EXECUTIVE_SUMMARY_TTL_MS = 60_000;

export class QualityExecutiveService {
  private readonly summaryCache = new TtlCache<ExecutiveSummaryResponse>({
    maxEntries: 32,
    defaultTtlMs: EXECUTIVE_SUMMARY_TTL_MS,
    // ~18s cold against the audit database; serve the previous result while it refreshes.
    defaultStaleMs: 30 * 60_000,
  });

  constructor(private db: DbPoolLike) {}

  async getExecutiveSummary(daysBack: number = 30): Promise<ExecutiveSummaryResponse> {
    const { value } = await this.summaryCache.getOrCompute(String(daysBack), () => this.computeExecutiveSummary(daysBack));
    return value;
  }

  /** Runs one statement on its own pooled connection so the aggregates below can overlap. */
  private async withConnection<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.db.getConnection();
    try {
      return await fn(conn);
    } finally {
      conn.release();
    }
  }

  private async computeExecutiveSummary(daysBack: number): Promise<ExecutiveSummaryResponse> {
    {
      // Five independent aggregates over the audit table (they used to be eight statements awaited one
      // after another on a single connection). Each runs on its own connection, in this order:
      //   [0] current/7-day/30-day window averages   [1] top performers   [2] bottom performers
      //   [3] per-process performance                [4] per-agent scores + org benchmarks
      const [
        [windowMetrics],
        [topPerformers],
        [bottomPerformers],
        [processMetrics],
        [agentQualityRows],
      ] = await Promise.all([
        // Current period, 7-day and 30-day averages in ONE pass. They were three separate scans of
        // overlapping windows; NOW() is evaluated once per statement, and AVG ignores the NULLs the
        // CASE produces outside each window, so each figure equals its old standalone query.
        this.withConnection((conn) => conn.execute<RowDataPacket[]>(
          `SELECT
             ROUND(AVG(CASE WHEN cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
                            THEN cqa.quality_percentage END), 2) as current_quality,
             COUNT(CASE WHEN cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN 1 END) as total_calls,
             COUNT(DISTINCT CASE WHEN cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
                                 THEN cqa.User END) as unique_agents,
             ROUND(AVG(CASE WHEN cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                            THEN cqa.quality_percentage END), 2) as avg_quality_7d,
             ROUND(AVG(CASE WHEN cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                            THEN cqa.quality_percentage END), 2) as avg_quality_30d
           FROM db_audit.call_quality_assessment cqa
           WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
          [daysBack, daysBack, daysBack, Math.max(daysBack, 30)]
        )),
        this.withConnection((conn) => conn.execute<RowDataPacket[]>(
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
        )),
        this.withConnection((conn) => conn.execute<RowDataPacket[]>(
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
        )),
        // Process performance.
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
        this.withConnection((conn) => conn.execute<RowDataPacket[]>(
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
        )),
        // Per-agent averages AND the organisation benchmarks from one grouped pass: the benchmark
        // AVG/STDDEV are taken over exactly these per-agent rows (previously a second statement
        // that recomputed the same GROUP BY as a derived table). STDDEV/AVG as window functions
        // are the same population aggregates the standalone query used.
        this.withConnection((conn) => conn.execute<RowDataPacket[]>(
          `SELECT
             user_stats.agent_code,
             user_stats.avg_quality,
             ROUND(AVG(user_stats.avg_quality) OVER (), 2) as bench_avg_quality,
             ROUND(STDDEV(user_stats.avg_quality) OVER (), 2) as bench_std_dev
           FROM (
             SELECT
               cqa.User as agent_code,
               ROUND(AVG(cqa.quality_percentage), 2) as avg_quality
             FROM db_audit.call_quality_assessment cqa
             WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
             GROUP BY cqa.User
           ) AS user_stats`,
          [daysBack]
        )),
      ]);

      const currentRow = windowMetrics?.[0] as any;
      // ROUND(AVG(...), 2) is a MySQL DECIMAL, and mysql2 hands DECIMALs back as *strings*
      // ("73.45", not 73.45) — the same defect class as the frontend .toFixed() crash on
      // /quality-dashboard earlier this session. Number(...) here, not `|| 0` alone: `|| 0`
      // only guards a missing row, it does nothing about the value still being a string.
      const currentQuality = Number(currentRow?.current_quality) || 0;

      // 7-day and 30-day averages come from the same single-pass window query above.
      const sevenDayQuality = Number(currentRow?.avg_quality_7d) || currentQuality;

      const thirtyDayQuality = Number(currentRow?.avg_quality_30d) || currentQuality;

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

      // Organisation benchmarks ride on every per-agent row (identical on each); none when there are no rows.
      const benchmarkRow = (agentQualityRows?.[0] ?? null) as any;

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
          avg_quality: benchmarkRow?.bench_avg_quality || 0,
          median_quality: medianQuality,
          std_deviation: benchmarkRow?.bench_std_dev || 0
        }
      };
    }
  }
}
