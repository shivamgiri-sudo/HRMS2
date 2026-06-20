import { buildCQScoreQuery, buildWeaknessDetailQuery, buildCallsReviewQuery, buildCallDetailQuery } from '../src/lib/query-builders/quality-queries.js';
import { describe, it, expect } from '@jest/globals';

describe('Quality Query Builders', () => {
  describe('buildCQScoreQuery', () => {
    it('returns SQL query string and parameters for agent CQ score', () => {
      const employeeCode = 'EMP-STF-001';
      const daysBack = 7;

      const result = buildCQScoreQuery(employeeCode, daysBack);

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('params');
      expect(typeof result.query).toBe('string');
      expect(Array.isArray(result.params)).toBe(true);
      expect(result.query).toContain('call_quality_assessment');
      expect(result.query).toContain('AVG(quality_percentage)');
      expect(result.query).toContain('ROW_NUMBER()');
      expect(result.params).toContain(employeeCode);
    });

    it('calculates weekly breakdown correctly', () => {
      const employeeCode = 'EMP-STF-001';
      const daysBack = 7;

      const result = buildCQScoreQuery(employeeCode, daysBack);

      expect(result.query).toContain('DAYNAME');
      expect(result.query).toContain('GROUP BY DAYNAME');
    });
  });

  describe('buildWeaknessDetailQuery', () => {
    it('returns SQL for dimensional score breakdown', () => {
      const employeeCode = 'EMP-STF-001';

      const result = buildWeaknessDetailQuery(employeeCode);

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('params');
      expect(result.query).toContain('call_quality_assessment');
      expect(result.query).toContain('professionalism_maintained');
      expect(result.query).toContain('active_listening');
      expect(result.params[0]).toBe(employeeCode);
    });
  });

  describe('buildCallsReviewQuery', () => {
    it('returns paginated, sortable calls list', () => {
      const employeeCode = 'EMP-STF-001';
      const limit = 10;
      const offset = 0;
      const sort = 'date';

      const result = buildCallsReviewQuery(employeeCode, limit, offset, sort);

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('params');
      expect(result.query).toContain('LIMIT');
      expect(result.query).toContain('OFFSET');
      expect(result.query).toContain('CallDate');
      expect(result.params).toContain(employeeCode);
    });

    it('supports sort by cq or fatal', () => {
      const result1 = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'cq');
      const result2 = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'fatal');

      expect(result1.query).toContain('ORDER BY');
      expect(result2.query).toContain('ORDER BY');
    });
  });

  describe('buildCallDetailQuery', () => {
    it('returns single call detail with all fields', () => {
      const callId = '684407';

      const result = buildCallDetailQuery(callId);

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('params');
      expect(result.query).toContain('call_quality_assessment');
      expect(result.query).toContain('quality_percentage');
      expect(result.params[0]).toBe(callId);
    });
  });
});
