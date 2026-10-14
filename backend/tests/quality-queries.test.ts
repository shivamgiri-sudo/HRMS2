/**
 * Quality query builders (src/lib/query-builders/quality-queries.ts).
 *
 * Rewritten for the call-centre KPI port (tausif-mis 12588927b): the CQ formula is now computed per
 * call from the graded parameters (blank excluded) instead of trusting the stored quality_percentage,
 * and the old buildCQScoreQuery / buildWeaknessDetailQuery were replaced by agent-scoped builders.
 *
 * Covers: result shape, parameter binding (user input never reaches the SQL text), the owner check on
 * call detail, sorting, clamping of LIMIT/OFFSET and the shared CQ / fatal expressions.
 */
import { describe, it, expect } from 'vitest';
import {
  CQ_PARAM_COLS,
  CQ_SCORE_SQL,
  FATAL_SQL,
  QUALITY_GROUPS,
  QUALITY_PARAMS,
  buildAgentAuditedCallsQuery,
  buildAgentClientsQuery,
  buildAgentTotalsByClientQuery,
  buildAgentWeeklyQuery,
  buildCallDetailQuery,
  buildCallsReviewQuery,
  buildPeerParamTotalsQuery,
  buildTotalCallsCountQuery,
} from '../src/lib/query-builders/quality-queries.js';

const EMP = 'MAS60429';

describe('CQ expressions', () => {
  it('score is graded-parameters-passed over graded, so a blank parameter is excluded from both sides', () => {
    expect(CQ_SCORE_SQL).toContain('q.ClientId');
    for (const col of CQ_PARAM_COLS) expect(CQ_SCORE_SQL).toContain(col);
    expect(CQ_SCORE_SQL).toContain('NULLIF');
  });

  it('fatal means every fatal parameter explicitly failed (= 0), not merely blank', () => {
    expect(FATAL_SQL).toContain('= 0');
    expect(FATAL_SQL).toContain(' AND ');
  });

  it('every parameter belongs to one of the five groups', () => {
    for (const p of QUALITY_PARAMS) expect(QUALITY_GROUPS).toContain(p.group);
  });
});

describe('agent-scoped builders', () => {
  it('weekly: binds the agent code, reads the audit table, groups by weekday', () => {
    const r = buildAgentWeeklyQuery(EMP, 7);
    expect(r.params).toEqual([EMP]);
    expect(r.query).toContain('db_audit.call_quality_assessment');
    expect(r.query).toContain('DAYNAME');
    expect(r.query).toContain('INTERVAL 7 DAY');
    expect(r.query).not.toContain(EMP);
  });

  it('weekly: clamps the look-back to 1..90 days', () => {
    expect(buildAgentWeeklyQuery(EMP, 5000).query).toContain('INTERVAL 90 DAY');
    expect(buildAgentWeeklyQuery(EMP, -3).query).toContain('INTERVAL 1 DAY');
    expect(buildAgentWeeklyQuery(EMP, NaN as unknown as number).query).toContain('INTERVAL 7 DAY');
  });

  it('clients: distinct client ids the agent was audited in, at least a 30 day look-back', () => {
    const r = buildAgentClientsQuery(EMP, 7);
    expect(r.params).toEqual([EMP]);
    expect(r.query).toContain('DISTINCT ClientId');
    expect(r.query).toContain('INTERVAL 30 DAY');
  });

  it('totals-by-client: one placeholder per client id, ids are bound not inlined', () => {
    const r = buildAgentTotalsByClientQuery(['101', '468'], 7);
    expect(r.params).toEqual(['101', '468']);
    expect(r.query).toContain('IN (?,?)');
    expect(r.query).not.toContain("'101'");
  });

  it('audited-calls: every parameter column present, newest first, bounded', () => {
    const r = buildAgentAuditedCallsQuery(EMP, 7);
    expect(r.params).toEqual([EMP]);
    for (const p of QUALITY_PARAMS) expect(r.query).toContain(p.col);
    expect(r.query).toContain('ORDER BY q.CallDate DESC');
    expect(r.query).toContain('LIMIT 2000');
  });

  it('peer totals: a hit and an n column per parameter', () => {
    const r = buildPeerParamTotalsQuery(['101'], 7);
    for (const p of QUALITY_PARAMS) {
      expect(r.query).toContain(`${p.col}__hit`);
      expect(r.query).toContain(`${p.col}__n`);
    }
  });
});

describe('call review / detail / count', () => {
  it('review: employee code is bound; LIMIT/OFFSET are validated and inlined', () => {
    const r = buildCallsReviewQuery(EMP, 10, 5, 'date');
    expect(r.params).toEqual([EMP]);
    expect(r.query).toContain('LIMIT 10 OFFSET 5');
    expect(r.query).toContain('db_audit.call_quality_assessment');
  });

  it('review: sorts by date, score or fatal', () => {
    expect(buildCallsReviewQuery(EMP, 10, 0, 'date').query).toContain('ORDER BY q.CallDate DESC');
    expect(buildCallsReviewQuery(EMP, 10, 0, 'cq').query).toMatch(/ORDER BY .*ASC, q\.CallDate DESC/);
    expect(buildCallsReviewQuery(EMP, 10, 0, 'fatal').query).toMatch(/ORDER BY .*DESC, q\.CallDate DESC/);
  });

  it('review: an unknown sort falls back to date and cannot inject', () => {
    const r = buildCallsReviewQuery(EMP, 10, 0, "date; DROP TABLE x" as unknown as 'date');
    expect(r.query).not.toContain('DROP TABLE');
    expect(r.query).toContain('ORDER BY q.CallDate DESC');
  });

  it('review: limit and offset are coerced to safe integers', () => {
    const r = buildCallsReviewQuery(EMP, "10; DROP TABLE x" as unknown as number, -4, 'date');
    expect(r.query).not.toContain('DROP');
    expect(r.query).toMatch(/LIMIT \d+ OFFSET \d+/);
  });

  it('detail: the owner check stops one agent reading another agent\'s call by changing the id', () => {
    const r = buildCallDetailQuery('684407', EMP);
    expect(r.params).toEqual(['684407', EMP]);
    expect(r.query).toContain('q.id = ?');
    expect(r.query).toContain('q.User = ?');
    expect(r.query).not.toContain('684407');
    expect(r.query).toContain('recording_url');
    expect(r.query).toContain('transcript_text');
  });

  it('count: bound employee code over the same window and gate as the review list', () => {
    const r = buildTotalCallsCountQuery(EMP);
    expect(r.params).toEqual([EMP]);
    expect(r.query).toContain('COUNT(*)');
    expect(r.query).toContain('INTERVAL 30 DAY');
  });
});

describe('parameter safety', () => {
  it('no builder puts the agent code or a hostile string into the SQL text', () => {
    const hostile = "MAS1' OR '1'='1";
    const built = [
      buildAgentWeeklyQuery(hostile, 7),
      buildAgentClientsQuery(hostile, 7),
      buildAgentAuditedCallsQuery(hostile, 7),
      buildCallsReviewQuery(hostile, 10, 0, 'date'),
      buildCallDetailQuery('1', hostile),
      buildTotalCallsCountQuery(hostile),
    ];
    for (const q of built) {
      expect(typeof q.query).toBe('string');
      expect(Array.isArray(q.params)).toBe(true);
      expect(q.query).not.toContain("OR '1'='1");
      expect(q.params).toContain(hostile);
    }
  });
});
