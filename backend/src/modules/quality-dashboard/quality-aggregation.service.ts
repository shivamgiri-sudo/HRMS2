/**
 * Quality Aggregation Service
 * Executes quality queries and transforms responses
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import {
  buildCQScoreQuery,
  buildWeaknessDetailQuery,
  buildCallsReviewQuery,
  buildCallDetailQuery,
  buildTotalCallsCountQuery,
} from '../../lib/query-builders/quality-queries';
import { cacheInstance } from '../../lib/cache/quality-cache';
import { logger } from '../../logger';

export interface CQScoreResponse {
  cq_score_current: number;
  cq_score_7day_avg: number;
  cq_score_30day_avg: number;
  cq_score_clean: number;
  rank: { position: number; total_agents: number };
  peer_avg: number;
  target: number;
  gap_pct: number;
  trend_7day: { direction: string; change_pct: number };
  trend_30day: { direction: string; change_pct: number };
  weekly: Array<{ day: string; avg: number; calls: number }>;
  status: 'On Track' | 'Below Target' | 'Risk';
  last_updated: Date;
}

export interface WeaknessArea {
  category: string;
  score: number;
  peer_avg: number;
  gap: number;
  sub_metrics: Array<{ name: string; score: number; peer_avg: number; calls_weak: number }>;
  related_calls: Array<{ call_id: string; date: string; cq_pct: number }>;
}

export interface CallReview {
  total_calls: number;
  page: { limit: number; offset: number; has_next: boolean };
  calls: Array<{
    call_id: string;
    date: string;
    lead_id: string;
    lead_name: string;
    scenario: string;
    cq_pct: number;
    has_fatal: boolean;
    fatal_reason?: string;
    duration_sec: number;
  }>;
  last_updated: Date;
}

export interface CallDetail {
  call_id: string;
  date: string;
  lead: { id: string; name: string };
  scenario: string;
  cq_pct: number;
  has_fatal: boolean;
  duration_sec: number;
  sub_scores: {
    opening: number;
    soft_skills: number;
    hold_procedure: number;
    resolution: number;
    closing: number;
  };
  recording: { url: string; duration_sec: number };
  transcript: string;
  feedback: string;
  peer_comparison: {
    same_scenario_avg: number;
    your_score: number;
    gap: number;
  };
}

export class QualityAggregationService {
  constructor(private db: Pool) {}

  async getCQScore(employeeCode: string, daysBack: number = 7): Promise<CQScoreResponse> {
    const cacheKey = `quality:cq_score:${employeeCode}:${daysBack}d`;

    return cacheInstance.getOrSet(cacheKey, async () => {
      const { query, params } = buildCQScoreQuery(employeeCode, daysBack);
      const conn = await this.db.getConnection();

      try {
        const [rows] = await conn.execute<RowDataPacket[]>(query, params);

        if (!rows || rows.length === 0) {
          logger.warn(`No CQ score data for ${employeeCode}`);
          return this.getEmptyCQScore();
        }

        const row = rows[0];
        return {
          cq_score_current: row.cq_current || 0,
          cq_score_7day_avg: row.cq_7day_avg || 0,
          cq_score_30day_avg: row.cq_30day_avg || 0,
          cq_score_clean: row.cq_clean || 0,
          rank: { position: row.rank_position || 0, total_agents: row.total_agents || 0 },
          peer_avg: row.peer_avg || 0,
          target: 90,
          gap_pct: (90 - (row.cq_current || 0)),
          trend_7day: {
            direction: (row.cq_7day_avg || 0) > (row.cq_30day_avg || 0) ? '↗' : (row.cq_7day_avg || 0) < (row.cq_30day_avg || 0) ? '↘' : '→',
            change_pct: Math.round(((row.cq_7day_avg || 0) - (row.cq_current || 0)) * 10) / 10,
          },
          trend_30day: {
            direction: (row.cq_30day_avg || 0) > ((row.cq_current || 0) - 3) ? '↗' : '↘',
            change_pct: -1, // TODO: calculate from 60d vs 30d
          },
          weekly: row.weekly_breakdown ? JSON.parse(row.weekly_breakdown) : [],
          status: this.getStatus(row.cq_current),
          last_updated: new Date(),
        };
      } finally {
        conn.release();
      }
    }, 300); // 5 min TTL
  }

  async getWeaknessDetail(employeeCode: string) {
    const cacheKey = `quality:weakness:${employeeCode}`;

    return cacheInstance.getOrSet(cacheKey, async () => {
      const { query, params } = buildWeaknessDetailQuery(employeeCode);
      const conn = await this.db.getConnection();

      try {
        const [rows] = await conn.execute<RowDataPacket[]>(query, params);

        return {
          weakness_areas: (rows || [])
            .map((row) => ({
              category: row.category,
              score: row.score || 0,
              peer_avg: row.peer_avg || 0,
              gap: (row.peer_avg || 0) - (row.score || 0),
              sub_metrics: this.getSubMetricsForCategory(row.category),
              related_calls: row.related_calls ? JSON.parse(row.related_calls) : [],
            }))
            .sort((a, b) => (b.gap || 0) - (a.gap || 0))
            .slice(0, 5),
          last_updated: new Date(),
        };
      } finally {
        conn.release();
      }
    }, 600); // 10 min TTL
  }

  async getCallsReview(employeeCode: string, limit: number = 10, offset: number = 0, sort: 'date' | 'cq' | 'fatal' = 'date'): Promise<CallReview> {
    const cacheKey = `quality:calls_review:${employeeCode}:${sort}:${limit}:${offset}`;

    return cacheInstance.getOrSet(cacheKey, async () => {
      const { query, params } = buildCallsReviewQuery(employeeCode, limit, offset, sort);
      const countQuery = buildTotalCallsCountQuery(employeeCode);

      const conn = await this.db.getConnection();

      try {
        const [rows] = await conn.execute<RowDataPacket[]>(query, params);
        const [countRows] = await conn.execute<RowDataPacket[]>(countQuery.query, countQuery.params);

        const totalCalls = countRows?.[0]?.total || 0;

        return {
          total_calls: totalCalls,
          page: {
            limit,
            offset,
            has_next: offset + limit < totalCalls,
          },
          calls: (rows || []).map((row) => ({
            call_id: row.call_id,
            date: row.date,
            lead_id: row.lead_id,
            lead_name: row.lead_name,
            scenario: row.scenario,
            cq_pct: row.cq_pct || 0,
            has_fatal: row.has_fatal === 1,
            fatal_reason: row.fatal_reason,
            duration_sec: row.duration_sec || 0,
          })),
          last_updated: new Date(),
        };
      } finally {
        conn.release();
      }
    }, 120); // 2 min TTL
  }

  async getCallDetail(callId: string): Promise<CallDetail> {
    const { query, params } = buildCallDetailQuery(callId);
    const conn = await this.db.getConnection();

    try {
      const [rows] = await conn.execute<RowDataPacket[]>(query, params);

      if (!rows || rows.length === 0) {
        throw new Error(`Call ${callId} not found`);
      }

      const row = rows[0];

      return {
        call_id: row.call_id,
        date: row.date,
        lead: { id: row.lead_id, name: row.lead_name },
        scenario: row.scenario,
        cq_pct: row.cq_pct || 0,
        has_fatal: row.has_fatal === 1,
        duration_sec: row.duration_sec || 0,
        sub_scores: {
          opening: row.opening_score || 0,
          soft_skills: row.soft_skills_score || 0,
          hold_procedure: row.hold_procedure_score || 0,
          resolution: row.resolution_score || 0,
          closing: row.closing_score || 0,
        },
        recording: {
          url: row.recording_url,
          duration_sec: row.duration_sec || 0,
        },
        transcript: row.transcript_text,
        feedback: row.feedback,
        peer_comparison: {
          same_scenario_avg: row.peer_scenario_avg || 0,
          your_score: row.cq_pct || 0,
          gap: (row.peer_scenario_avg || 0) - (row.cq_pct || 0),
        },
      };
    } finally {
      conn.release();
    }
  }

  private getStatus(score: number): 'On Track' | 'Below Target' | 'Risk' {
    if (score >= 80) return 'On Track';
    if (score >= 70) return 'Below Target';
    return 'Risk';
  }

  private getEmptyCQScore(): CQScoreResponse {
    return {
      cq_score_current: 0,
      cq_score_7day_avg: 0,
      cq_score_30day_avg: 0,
      cq_score_clean: 0,
      rank: { position: 0, total_agents: 0 },
      peer_avg: 0,
      target: 90,
      gap_pct: 90,
      trend_7day: { direction: '→', change_pct: 0 },
      trend_30day: { direction: '→', change_pct: 0 },
      weekly: [],
      status: 'Risk',
      last_updated: new Date(),
    };
  }

  private getSubMetricsForCategory(category: string) {
    const subMetrics: Record<string, Array<{ name: string }>> = {
      'Soft Skills': [
        { name: 'Empathy (Active Listening)' },
        { name: 'Professionalism' },
        { name: 'Enthusiasm' },
      ],
      Opening: [{ name: 'Answer Within 5 Sec' }],
      'Hold Procedure': [{ name: 'Proper Hold' }, { name: 'No Dead Air' }],
      Resolution: [{ name: 'Accurate Probing' }, { name: 'Grammar' }],
      Closing: [{ name: 'Proper Closure' }, { name: 'Further Assistance' }],
    };
    return (subMetrics[category] || []).map(sm => ({ ...sm, score: 0, peer_avg: 0, calls_weak: 0 }));
  }
}
