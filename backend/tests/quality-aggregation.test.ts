import { QualityAggregationService } from '../src/modules/quality-dashboard/quality-aggregation.service';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * The service is constructed with a stub pool rather than the real one.
 *
 * It previously imported `{ db } from '../src/db'` — a directory, not a module.
 * Node's ESM resolver does not fall back to an index file, so the suite died at
 * load with ERR_MODULE_NOT_FOUND and had never run.
 *
 * Pointing it at the real pool only moved the failure: these tests assert the
 * SHAPE of what getCQScore returns — which keys exist, that a gap is computed —
 * so they need a database that answers deterministically, not one that has to be
 * reachable. Empty result sets exercise the service's own defaults, which is the
 * behaviour under test.
 */
function stubPool(rows: Record<string, unknown>[] = []) {
  const connection = {
    execute: vi.fn().mockResolvedValue([rows, []]),
    query: vi.fn().mockResolvedValue([rows, []]),
    release: vi.fn(),
  };
  return {
    execute: vi.fn().mockResolvedValue([rows, []]),
    query: vi.fn().mockResolvedValue([rows, []]),
    getConnection: vi.fn().mockResolvedValue(connection),
  };
}

describe('QualityAggregationService', () => {
  let service: QualityAggregationService;

  beforeAll(() => {
    service = new QualityAggregationService(stubPool() as never);
  });

  describe('getCQScore', () => {
    it('returns CQ score object with all required fields', async () => {
      const employeeCode = 'EMP-STF-001';

      const result = await service.getCQScore(employeeCode, 7);

      expect(result).toHaveProperty('cq_score_current');
      expect(result).toHaveProperty('cq_score_7day_avg');
      expect(result).toHaveProperty('cq_score_30day_avg');
      expect(result).toHaveProperty('cq_score_clean');
      expect(result).toHaveProperty('rank');
      expect(result).toHaveProperty('peer_avg');
      expect(result).toHaveProperty('target');
      expect(result).toHaveProperty('gap_pct');
      expect(result).toHaveProperty('trend_7day');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('weekly');
      expect(result).toHaveProperty('last_updated');

      expect(typeof result.cq_score_current).toBe('number');
      expect(typeof result.gap_pct).toBe('number');
      expect(Array.isArray(result.weekly)).toBe(true);
    });

    it('calculates gap correctly', async () => {
      const employeeCode = 'EMP-STF-001';

      const result = await service.getCQScore(employeeCode, 7);

      expect(result.gap_pct).toBe(result.target - result.cq_score_current);
    });

    it('sets status based on score', async () => {
      const employeeCode = 'EMP-STF-001';

      const result = await service.getCQScore(employeeCode, 7);

      if (result.cq_score_current >= 80) {
        expect(result.status).toBe('On Track');
      } else if (result.cq_score_current >= 70) {
        expect(result.status).toBe('Below Target');
      } else {
        expect(result.status).toBe('Risk');
      }
    });
  });

  describe('getWeaknessDetail', () => {
    it('returns array of weakness areas', async () => {
      const employeeCode = 'EMP-STF-001';

      const result = await service.getWeaknessDetail(employeeCode);

      expect(Array.isArray(result.weakness_areas)).toBe(true);
      expect(result.weakness_areas.length).toBeLessThanOrEqual(5);

      if (result.weakness_areas.length > 0) {
        const weakness = result.weakness_areas[0];
        expect(weakness).toHaveProperty('category');
        expect(weakness).toHaveProperty('score');
        expect(weakness).toHaveProperty('peer_avg');
        expect(weakness).toHaveProperty('gap');
        expect(weakness).toHaveProperty('sub_metrics');
        expect(weakness).toHaveProperty('related_calls');
        expect(Array.isArray(weakness.related_calls)).toBe(true);
      }
    });
  });

  describe('getCallsReview', () => {
    it('returns paginated calls list', async () => {
      const employeeCode = 'EMP-STF-001';

      const result = await service.getCallsReview(employeeCode, 10, 0, 'date');

      expect(result).toHaveProperty('total_calls');
      expect(result).toHaveProperty('page');
      expect(result).toHaveProperty('calls');
      expect(Array.isArray(result.calls)).toBe(true);
      expect(result.page).toHaveProperty('limit');
      expect(result.page).toHaveProperty('offset');
      expect(result.page).toHaveProperty('has_next');
    });

    it('handles sorting parameter', async () => {
      const employeeCode = 'EMP-STF-001';

      const resultDate = await service.getCallsReview(employeeCode, 10, 0, 'date');
      const resultCQ = await service.getCallsReview(employeeCode, 10, 0, 'cq');
      const resultFatal = await service.getCallsReview(employeeCode, 10, 0, 'fatal');

      expect(Array.isArray(resultDate.calls)).toBe(true);
      expect(Array.isArray(resultCQ.calls)).toBe(true);
      expect(Array.isArray(resultFatal.calls)).toBe(true);
    });
  });

  describe('getCallDetail', () => {
    it('returns single call with sub-scores', async () => {
      const callId = '684407';
      // getCallDetail throws when the lookup finds nothing, so unlike the
      // aggregate methods above it needs a row rather than an empty set.
      const withCall = new QualityAggregationService(stubPool([{
        call_id: callId,
        date: '2026-07-01',
        lead_id: 'lead-1',
        lead_name: 'Test Lead',
        scenario: 'INBOUND',
        cq_pct: 82,
        has_fatal: 0,
        duration_sec: 240,
        opening_score: 9,
        soft_skills_score: 8,
        hold_procedure_score: 7,
        resolution_score: 9,
        closing_score: 8,
        recording_url: 'https://example.invalid/rec/684407',
        transcript_text: null,
        feedback: 'Good call',
        peer_scenario_avg: 80,
      }]) as never);

      const result = await withCall.getCallDetail(callId);

      expect(result).toHaveProperty('call_id');
      expect(result).toHaveProperty('date');
      expect(result).toHaveProperty('cq_pct');
      expect(result).toHaveProperty('sub_scores');
      expect(result.sub_scores).toHaveProperty('opening');
      expect(result.sub_scores).toHaveProperty('soft_skills');
      expect(result.sub_scores).toHaveProperty('hold_procedure');
      expect(result.sub_scores).toHaveProperty('resolution');
      expect(result.sub_scores).toHaveProperty('closing');
      expect(result).toHaveProperty('recording');
      expect(result).toHaveProperty('feedback');
    });
  });
});
