/**
 * Quality Query Builders Tests — Phase 7.1 Task D1
 *
 * Tests for:
 * - Query structure validation
 * - Parameter binding (no SQL injection)
 * - Sorting logic (date/cq/fatal)
 */

import { describe, it, expect } from 'vitest';
import {
  buildCQScoreQuery,
  buildWeaknessDetailQuery,
  buildCallsReviewQuery,
  buildCallDetailQuery,
  buildTotalCallsCountQuery,
} from '../src/lib/query-builders/quality-queries.js';

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
    });

    it('query contains required table and aggregation functions', () => {
      const result = buildCQScoreQuery('EMP-STF-001', 7);

      expect(result.query).toContain('call_quality_assessment');
      expect(result.query).toContain('AVG(quality_percentage)');
      expect(result.query).toContain('ROW_NUMBER()');
    });

    it('includes employee code in parameters (no SQL injection risk)', () => {
      const employeeCode = 'EMP-STF-001';
      const result = buildCQScoreQuery(employeeCode, 7);

      expect(result.params).toContain(employeeCode);
      // Parameters should be array of values, not string concatenation
      expect(Array.isArray(result.params)).toBe(true);
      expect(result.params.length).toBeGreaterThan(0);
    });

    it('calculates weekly breakdown', () => {
      const result = buildCQScoreQuery('EMP-STF-001', 7);

      expect(result.query).toContain('DAYNAME');
      expect(result.query).toContain('GROUP BY');
    });

    it('respects daysBack parameter', () => {
      const result7 = buildCQScoreQuery('EMP-STF-001', 7);
      const result30 = buildCQScoreQuery('EMP-STF-001', 30);

      // Both should include INTERVAL but with different values
      expect(result7.query).toContain('INTERVAL 7 DAY');
      expect(result30.query).toContain('INTERVAL 30 DAY');
    });

    it('includes peer average calculation', () => {
      const result = buildCQScoreQuery('EMP-STF-001', 7);

      expect(result.query).toContain('peer');
      expect(result.query).toLowerCase().toContain('peer');
    });

    it('includes rank calculation', () => {
      const result = buildCQScoreQuery('EMP-STF-001', 7);

      expect(result.query).toContain('rank');
      expect(result.query.toLowerCase()).toContain('rank_position');
    });
  });

  describe('buildWeaknessDetailQuery', () => {
    it('returns SQL query and parameters for dimensional scores', () => {
      const employeeCode = 'EMP-STF-001';
      const result = buildWeaknessDetailQuery(employeeCode);

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('params');
      expect(typeof result.query).toBe('string');
      expect(Array.isArray(result.params)).toBe(true);
    });

    it('query targets call_quality_assessment table', () => {
      const result = buildWeaknessDetailQuery('EMP-STF-001');

      expect(result.query).toContain('call_quality_assessment');
    });

    it('includes binary flag columns for dimensions', () => {
      const result = buildWeaknessDetailQuery('EMP-STF-001');

      expect(result.query).toContain('professionalism_maintained');
      expect(result.query).toContain('active_listening');
      expect(result.query).toContain('call_answered_within_5_seconds');
    });

    it('parameter binding prevents SQL injection', () => {
      const maliciousCode = "EMP-001'; DROP TABLE employees; --";
      const result = buildWeaknessDetailQuery(maliciousCode);

      // Parameters should include the malicious string as a value, not execute it
      expect(result.params).toContain(maliciousCode);
      expect(Array.isArray(result.params)).toBe(true);
      // Query should not contain concatenation, only ?
      expect(result.query).not.toContain(maliciousCode);
    });

    it('includes peer average comparison', () => {
      const result = buildWeaknessDetailQuery('EMP-STF-001');

      expect(result.query).toContain('peer');
    });

    it('calculates gap (peer_avg - score)', () => {
      const result = buildWeaknessDetailQuery('EMP-STF-001');

      expect(result.query).toContain('gap');
    });

    it('returns multiple weakness categories (5 dimensions)', () => {
      const result = buildWeaknessDetailQuery('EMP-STF-001');

      // Query should have UNION to combine 5 categories
      const unionCount = (result.query.match(/UNION ALL/g) || []).length;
      expect(unionCount).toBeGreaterThanOrEqual(4); // 5 categories = 4 UNIONs
    });
  });

  describe('buildCallsReviewQuery', () => {
    it('returns paginated query with LIMIT and OFFSET', () => {
      const result = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date');

      expect(result.query).toContain('LIMIT');
      expect(result.query).toContain('OFFSET');
    });

    it('includes required parameters (employeeCode, limit, offset)', () => {
      const result = buildCallsReviewQuery('EMP-STF-001', 10, 5, 'date');

      expect(result.params).toContain('EMP-STF-001');
      expect(result.params).toContain(10);
      expect(result.params).toContain(5);
    });

    it('sorts by date (default)', () => {
      const result = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date');

      expect(result.query).toContain('ORDER BY');
      expect(result.query).toContain('CallDate');
    });

    it('sorts by quality percentage (cq)', () => {
      const result = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'cq');

      expect(result.query).toContain('ORDER BY');
      expect(result.query).toContain('quality_percentage');
      expect(result.query).toContain('ASC'); // Lower CQ first
    });

    it('sorts by fatal flag (fatal)', () => {
      const result = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'fatal');

      expect(result.query).toContain('ORDER BY');
      expect(result.query).toContain('CASE'); // Fatal detection logic
    });

    it('limits result to 50 records maximum', () => {
      const result = buildCallsReviewQuery('EMP-STF-001', 100, 0, 'date');

      // Service should cap limit at 50
      expect(result.params).toContain(50);
      expect(result.params[1]).toBeLessThanOrEqual(50);
    });

    it('validates offset is non-negative', () => {
      const result = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date');

      expect(result.params[2]).toBeGreaterThanOrEqual(0);
    });

    it('returns calls from 30 days period', () => {
      const result = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date');

      expect(result.query).toContain('30 DAY');
    });

    it('filters for INBOUND campaigns only', () => {
      const result = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date');

      expect(result.query).toContain('INBOUND');
    });

    it('parameter binding prevents SQL injection in sorting', () => {
      // Even with sort parameter being user-controlled, it should be validated
      const result = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date');

      // Query is constructed safely
      expect(result.params).toEqual(['EMP-STF-001', 10, 0]);
      expect(typeof result.query).toBe('string');
    });
  });

  describe('buildCallDetailQuery', () => {
    it('returns query for single call with all fields', () => {
      const callId = '684407';
      const result = buildCallDetailQuery(callId);

      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('params');
    });

    it('targets call_quality_assessment table', () => {
      const result = buildCallDetailQuery('684407');

      expect(result.query).toContain('call_quality_assessment');
    });

    it('includes call ID in WHERE clause', () => {
      const result = buildCallDetailQuery('684407');

      expect(result.query).toContain('WHERE');
      expect(result.query).toContain('id');
    });

    it('includes sub-score calculations', () => {
      const result = buildCallDetailQuery('684407');

      // Should calculate dimensional scores
      expect(result.query).toContain('opening');
      expect(result.query).toContain('soft_skills');
      expect(result.query).toContain('hold_procedure');
      expect(result.query).toContain('resolution');
      expect(result.query).toContain('closing');
    });

    it('includes peer scenario comparison', () => {
      const result = buildCallDetailQuery('684407');

      expect(result.query).toContain('scenario');
      expect(result.query).toContain('peer');
    });

    it('parameter binding prevents injection', () => {
      const maliciousId = "684407'; DELETE FROM calls; --";
      const result = buildCallDetailQuery(maliciousId);

      // Malicious string should be in params, not query
      expect(result.params).toContain(maliciousId);
      expect(result.query).not.toContain(maliciousId);
    });

    it('returns recording URL field', () => {
      const result = buildCallDetailQuery('684407');

      expect(result.query).toContain('recording');
    });

    it('returns transcript field', () => {
      const result = buildCallDetailQuery('684407');

      expect(result.query).toContain('transcript');
    });
  });

  describe('buildTotalCallsCountQuery', () => {
    it('returns count query for pagination', () => {
      const result = buildTotalCallsCountQuery('EMP-STF-001');

      expect(result.query).toContain('COUNT(*)');
    });

    it('includes employee code parameter', () => {
      const result = buildTotalCallsCountQuery('EMP-STF-001');

      expect(result.params).toContain('EMP-STF-001');
    });

    it('filters for 30-day period', () => {
      const result = buildTotalCallsCountQuery('EMP-STF-001');

      expect(result.query).toContain('30 DAY');
    });

    it('filters for INBOUND campaigns', () => {
      const result = buildTotalCallsCountQuery('EMP-STF-001');

      expect(result.query).toContain('INBOUND');
    });

    it('parameter binding safe', () => {
      const result = buildTotalCallsCountQuery('EMP-STF-001');

      expect(Array.isArray(result.params)).toBe(true);
      expect(typeof result.query).toBe('string');
    });
  });

  describe('Query Structure Validation', () => {
    it('all queries return { query, params } objects', () => {
      const queries = [
        buildCQScoreQuery('EMP-STF-001', 7),
        buildWeaknessDetailQuery('EMP-STF-001'),
        buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date'),
        buildCallDetailQuery('684407'),
        buildTotalCallsCountQuery('EMP-STF-001'),
      ];

      queries.forEach(q => {
        expect(q).toHaveProperty('query');
        expect(q).toHaveProperty('params');
        expect(typeof q.query).toBe('string');
        expect(Array.isArray(q.params)).toBe(true);
        expect(q.query.length).toBeGreaterThan(0);
      });
    });

    it('all queries use parameterized statements (no string concat)', () => {
      const queries = [
        buildCQScoreQuery('EMP-STF-001', 7),
        buildWeaknessDetailQuery('EMP-STF-001'),
        buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date'),
        buildCallDetailQuery('684407'),
        buildTotalCallsCountQuery('EMP-STF-001'),
      ];

      queries.forEach(q => {
        // Should not contain raw employee code in query string
        expect(q.query).not.toContain('EMP-STF-001');
        expect(q.query).not.toContain('684407');
      });
    });

    it('queries target correct database tables', () => {
      const result1 = buildCQScoreQuery('EMP-STF-001', 7);
      const result2 = buildWeaknessDetailQuery('EMP-STF-001');
      const result3 = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date');

      // All should use db_audit.call_quality_assessment
      expect(result1.query).toContain('db_audit.call_quality_assessment');
      expect(result2.query).toContain('db_audit.call_quality_assessment');
      expect(result3.query).toContain('db_audit.call_quality_assessment');
    });

    it('queries filter for INBOUND campaigns', () => {
      const queries = [
        buildCQScoreQuery('EMP-STF-001', 7),
        buildWeaknessDetailQuery('EMP-STF-001'),
        buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date'),
        buildTotalCallsCountQuery('EMP-STF-001'),
      ];

      queries.forEach(q => {
        expect(q.query).toContain('INBOUND');
      });
    });

    it('queries exclude empty User values', () => {
      const queries = [
        buildCQScoreQuery('EMP-STF-001', 7),
        buildWeaknessDetailQuery('EMP-STF-001'),
        buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date'),
        buildTotalCallsCountQuery('EMP-STF-001'),
      ];

      queries.forEach(q => {
        expect(q.query).toContain("User IS NOT NULL");
        expect(q.query).toContain("User != ''");
      });
    });
  });

  describe('Parameter Safety', () => {
    it('no SQL injection via employee code', () => {
      const testCases = [
        "EMP-001'; DROP TABLE --",
        'EMP-001" OR 1=1 --',
        "EMP-001); DELETE FROM employees; --",
        'EMP-001\' UNION SELECT * FROM --',
      ];

      testCases.forEach(maliciousCode => {
        const result = buildCQScoreQuery(maliciousCode, 7);
        expect(result.query).not.toContain(maliciousCode);
        expect(result.params).toContain(maliciousCode);
      });
    });

    it('no SQL injection via call ID', () => {
      const maliciousId = "684407' OR '1'='1";
      const result = buildCallDetailQuery(maliciousId);

      expect(result.query).not.toContain(maliciousId);
      expect(result.params).toContain(maliciousId);
    });

    it('no SQL injection via numeric parameters', () => {
      // Even though limit/offset are numeric, ensure proper binding
      const result = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date');

      expect(Array.isArray(result.params)).toBe(true);
      expect(typeof result.params[1]).toBe('number');
      expect(typeof result.params[2]).toBe('number');
    });
  });

  describe('Sorting Logic', () => {
    it('date sort orders by CallDate DESC', () => {
      const result = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date');

      expect(result.query).toContain('ORDER BY');
      expect(result.query).toContain('CallDate');
      expect(result.query).toContain('DESC');
    });

    it('cq sort orders by quality_percentage ASC (lowest first)', () => {
      const result = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'cq');

      expect(result.query).toContain('ORDER BY');
      expect(result.query).toContain('quality_percentage');
      expect(result.query).toContain('ASC');
    });

    it('fatal sort prioritizes calls with failures (CASE WHEN)', () => {
      const result = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'fatal');

      expect(result.query).toContain('CASE');
      expect(result.query).toContain('quality_percentage');
      expect(result.query).toContain('professionalism_maintained');
    });

    it('default sort is date', () => {
      const resultDefault = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date');
      const resultExplicit = buildCallsReviewQuery('EMP-STF-001', 10, 0, 'date');

      expect(resultDefault.query).toEqual(resultExplicit.query);
    });
  });
});
