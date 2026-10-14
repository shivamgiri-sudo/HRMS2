/**
 * Quality Aggregation Service
 * Executes quality queries and transforms responses
 */

import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  buildAgentClientsQuery,
  buildAgentTotalsByClientQuery,
  buildAgentWeeklyQuery,
  buildAgentAuditedCallsQuery,
  buildPeerParamTotalsQuery,
  buildCallsReviewQuery,
  buildCallDetailQuery,
  buildTotalCallsCountQuery,
  QUALITY_PARAMS,
  QUALITY_GROUPS,
  CLOVIA_CLIENT_ID,
  CLOVIA_LABEL_OVERRIDES,
  componentKey,
  type QualityParamGroup,
} from '../../lib/query-builders/quality-queries.js';
import { cacheInstance } from '../../lib/cache/quality-cache.js';
import { logger } from '../../logger.js';

export type CQScoreResponse = {
  /** Audited calls for this agent in the requested window; 0 means "nothing audited", not a 0% score. */
  total_calls: number;
  fatal_calls: number;
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
  /** Mydashboards' agent quality band: TQ > 95, MQ > 85, otherwise BQ. */
  band: 'TQ' | 'MQ' | 'BQ' | null;
  last_updated: Date;
};

/** null score = the parameter was never graded for this agent in the window (not a 0%). */
export interface ParameterScore {
  key: string;
  label: string;
  group: QualityParamGroup;
  is_fatal_component: boolean;
  score: number | null;
  peer_avg: number | null;
  graded_calls: number;
  failed_calls: number;
  /** Mydashboards' standard coaching tip for this parameter (null where the site has none). */
  tip: string | null;
  recent_failures: Array<{ call_id: string; date: string; cq_pct: number; feedback: string | null }>;
}

export interface WeaknessArea {
  category: string;
  score: number | null;
  peer_avg: number | null;
  gap: number | null;
  sub_metrics: Array<{ name: string; score: number | null; peer_avg: number | null; calls_weak: number }>;
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
  /** null = no parameter in that group was graded on this call. */
  sub_scores: {
    opening: number | null;
    soft_skills: number | null;
    hold_procedure: number | null;
    resolution: number | null;
    closing: number | null;
  };
  /** Every parameter's result on this call: 1 pass, 0 fail, null not graded. */
  parameters: Array<{ key: string; label: string; group: QualityParamGroup; is_fatal_component: boolean; result: 0 | 1 | null }>;
  recording: { url: string; duration_sec: number };
  transcript: string;
  feedback: string;
  peer_comparison: {
    same_scenario_avg: number | null;
    your_score: number;
    gap: number | null;
  };
}

type DbPoolLike = { getConnection: () => Promise<PoolConnection> };

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export class QualityAggregationService {
  constructor(private db: DbPoolLike) {}

  private async getAgentClients(conn: PoolConnection, employeeCode: string, daysBack: number): Promise<string[]> {
    const q = buildAgentClientsQuery(employeeCode, daysBack);
    const [rows] = await conn.execute<RowDataPacket[]>(q.query, q.params);
    return rows.map((r) => String(r.ClientId));
  }

  async getCQScore(employeeCode: string, daysBack: number = 7): Promise<CQScoreResponse> {
    const cacheKey = `quality:cq_score:v3:${employeeCode}:${daysBack}d`;

    return cacheInstance.getOrSet(cacheKey, async () => {
      const conn = await this.db.getConnection();

      try {
        const clients = await this.getAgentClients(conn, employeeCode, daysBack);
        if (clients.length === 0) return this.getEmptyCQScore();

        const totals = buildAgentTotalsByClientQuery(clients, daysBack);
        const weeklyQ = buildAgentWeeklyQuery(employeeCode, daysBack);
        const [agentRows] = await conn.execute<RowDataPacket[]>(totals.query, totals.params);
        const [weeklyRows] = await conn.execute<RowDataPacket[]>(weeklyQ.query, weeklyQ.params);

        const pct = (s: unknown, n: unknown) => (Number(n) > 0 ? Math.round((10000 * Number(s)) / Number(n)) / 100 : null);
        const me = agentRows.find((r) => String(r.masid).toUpperCase() === employeeCode.toUpperCase());
        const totalCalls = Number(me?.n_all_win) || 0;
        if (!me || totalCalls === 0) return this.getEmptyCQScore();

        const ranked = agentRows
          .filter((r) => Number(r.n_win) > 0)
          .map((r) => ({ masid: String(r.masid).toUpperCase(), avg: Number(r.s_win) / Number(r.n_win) }))
          .sort((a, b) => b.avg - a.avg);
        const position = ranked.findIndex((r) => r.masid === employeeCode.toUpperCase()) + 1;
        const peerS = agentRows.reduce((a, r) => a + (Number(r.s_win) || 0), 0);
        const peerN = agentRows.reduce((a, r) => a + (Number(r.n_win) || 0), 0);

        const current = pct(me.s_win, me.n_win) ?? 0;
        const d7 = pct(me.s_7, me.n_7) ?? 0;
        const d30 = pct(me.s_30, me.n_30) ?? 0;
        const weekly = weeklyRows.map((w) => ({ day: String(w.day), avg: Number(w.avg) || 0, calls: Number(w.calls) || 0 }));
        return {
          total_calls: totalCalls,
          fatal_calls: Number(me.fatal_win) || 0,
          cq_score_current: current,
          cq_score_7day_avg: d7,
          cq_score_30day_avg: d30,
          // CQ already excludes fatal calls (site definition); "clean" is the same figure.
          cq_score_clean: current,
          rank: { position, total_agents: ranked.length },
          peer_avg: pct(peerS, peerN) ?? 0,
          target: 90,
          gap_pct: Math.round((90 - current) * 10) / 10,
          trend_7day: {
            direction: d7 > d30 ? '↗' : d7 < d30 ? '↘' : '→',
            change_pct: Math.round((d7 - d30) * 10) / 10,
          },
          trend_30day: {
            direction: '→',
            change_pct: 0,
          },
          weekly,
          status: this.getStatus(current),
          band: Number(me.n_win) > 0 ? (current > 95 ? 'TQ' : current > 85 ? 'MQ' : 'BQ') : null,
          last_updated: new Date(),
        };
      } finally {
        conn.release();
      }
    }, 300); // 5 min TTL
  }

  async getWeaknessDetail(employeeCode: string) {
    const cacheKey = `quality:weakness:v4:${employeeCode}`;

    return cacheInstance.getOrSet(cacheKey, async () => {
      const own = buildAgentAuditedCallsQuery(employeeCode, 7);
      const conn = await this.db.getConnection();

      try {
        const [calls] = await conn.execute<RowDataPacket[]>(own.query, own.params);
        const clients = await this.getAgentClients(conn, employeeCode, 7);
        let peerRow: RowDataPacket | Record<string, never> = {};
        if (clients.length > 0) {
          const peer = buildPeerParamTotalsQuery(clients, 7);
          const [peerRows] = await conn.execute<RowDataPacket[]>(peer.query, peer.params);
          peerRow = peerRows?.[0] ?? {};
        }
        const pct = (hit: number, n: number) => (n > 0 ? Math.round((1000 * hit) / n) / 10 : null);
        const allClovia = calls.length > 0 && calls.every((c) => String(c.client_id) === CLOVIA_CLIENT_ID);

        // Parameter level: pooled passes / graded, no dropped-call exemption — same as the site's
        // Quality Parameters table (paramScorePct).
        const parameters: ParameterScore[] = QUALITY_PARAMS.map((p) => {
          const graded = calls.filter((c) => c[p.col] !== null && c[p.col] !== undefined);
          const failed = graded.filter((c) => Number(c[p.col]) !== 1);
          return {
            key: p.col,
            label: allClovia ? (CLOVIA_LABEL_OVERRIDES[p.col] ?? p.label) : p.label,
            group: p.group,
            is_fatal_component: p.fatal,
            score: pct(graded.length - failed.length, graded.length),
            peer_avg: pct(Number(peerRow[`${p.col}__hit`]) || 0, Number(peerRow[`${p.col}__n`]) || 0),
            graded_calls: graded.length,
            failed_calls: failed.length,
            tip: p.tip,
            recent_failures: failed.slice(0, 5).map((c) => ({
              call_id: String(c.call_id),
              date: c.date,
              cq_pct: Number(c.cq_pct) || 0,
              feedback: c.feedback ?? null,
            })),
          };
        }).filter((p) => p.graded_calls > 0 || p.key !== 'express_empathy');

        // Component level: average of the per-call component score (dropped/blank calls = 100%),
        // exactly as the site's Score Components cards.
        const weakness_areas: WeaknessArea[] = QUALITY_GROUPS.map((g: QualityParamGroup) => {
          const field = `comp_${componentKey(g)}`;
          const vals = calls.map((c) => c[field]).filter((v) => v !== null && v !== undefined).map(Number);
          const score = vals.length ? Math.round((1000 * vals.reduce((a, v) => a + v, 0)) / vals.length) / 10 : null;
          const peerRaw = peerRow[field];
          const peer_avg = peerRaw === null || peerRaw === undefined ? null : Math.round(Number(peerRaw) * 1000) / 10;
          const ps = parameters.filter((p) => p.group === g);
          return {
            category: g,
            score,
            peer_avg,
            gap: score === null || peer_avg === null ? null : Math.round((peer_avg - score) * 10) / 10,
            sub_metrics: ps.map((p) => ({ name: p.label, score: p.score, peer_avg: p.peer_avg, calls_weak: p.failed_calls })),
            related_calls: calls
              .filter((c) => c[field] !== null && c[field] !== undefined && Number(c[field]) < 1)
              .slice(0, 5)
              .map((c) => ({ call_id: String(c.call_id), date: c.date, cq_pct: Number(c.cq_pct) || 0 })),
          };
        });

        return {
          audited_calls: calls.length,
          weakness_areas,
          parameters,
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

  async getCallDetail(callId: string, ownerEmployeeCode: string): Promise<CallDetail> {
    const { query, params } = buildCallDetailQuery(callId, ownerEmployeeCode);
    const conn = await this.db.getConnection();

    try {
      const [rows] = await conn.execute<RowDataPacket[]>(query, params);

      if (!rows || rows.length === 0) {
        throw new Error(`Call ${callId} not found for agent`);
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
          opening: num(row.opening_score),
          soft_skills: num(row.soft_skills_score),
          hold_procedure: num(row.hold_procedure_score),
          resolution: num(row.resolution_score),
          closing: num(row.closing_score),
        },
        parameters: QUALITY_PARAMS
          .filter((p) => (row[p.col] !== null && row[p.col] !== undefined) || p.col !== 'express_empathy')
          .map((p) => ({
            key: p.col,
            label: p.label,
            group: p.group,
            is_fatal_component: p.fatal,
            result: row[p.col] === null || row[p.col] === undefined ? null : (Number(row[p.col]) === 1 ? 1 : 0),
          })),
        recording: {
          url: row.recording_url,
          duration_sec: row.duration_sec || 0,
        },
        transcript: row.transcript_text,
        feedback: row.feedback,
        peer_comparison: {
          same_scenario_avg: null,
          your_score: row.cq_pct || 0,
          gap: null,
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
      total_calls: 0,
      fatal_calls: 0,
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
      band: null,
      last_updated: new Date(),
    };
  }
}
