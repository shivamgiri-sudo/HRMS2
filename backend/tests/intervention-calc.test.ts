import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/mysql.js', () => ({ db: { query: vi.fn() } }));
vi.mock('../src/shared/auditLog.js', () => ({ writeAuditLog: vi.fn() }));

import {
  clampLimit, isValidDateOnly, normalizeBucket, normalizeOwner, normalizeTier, pctDelta, pctOf, slaHoursFor, tierFromScore,
} from '../src/modules/analytics/intervention-calc.js';
import { buildCasesQuery, bucketWhere } from '../src/modules/analytics/intervention-cases.service.js';

describe('intervention-calc', () => {
  it('tier thresholds match predictive-attrition (75/55/35)', () => {
    expect(tierFromScore(75)).toBe('CRITICAL');
    expect(tierFromScore(74)).toBe('HIGH');
    expect(tierFromScore(55)).toBe('HIGH');
    expect(tierFromScore(54)).toBe('MEDIUM');
    expect(tierFromScore(35)).toBe('MEDIUM');
    expect(tierFromScore(34)).toBe('LOW');
    expect(tierFromScore(NaN)).toBe('LOW');
  });
  it('pctOf returns null on zero denominator, rounds to 1dp', () => {
    expect(pctOf(0, 0)).toBeNull();
    expect(pctOf(1, 3)).toBe(33.3);
    expect(pctOf(3, 3)).toBe(100);
  });
  it('pctDelta never yields Infinity/NaN', () => {
    expect(pctDelta(5, 0)).toBeNull();
    expect(pctDelta(6, 4)).toBe(50);
    expect(pctDelta(2, 4)).toBe(-50);
  });
  it('SLA picks most urgent priority', () => {
    expect(slaHoursFor(['this_week', 'immediate'])).toBe(24);
    expect(slaHoursFor(['within_48h'])).toBe(48);
    expect(slaHoursFor([])).toBe(168);
  });
  it('validators', () => {
    expect(normalizeOwner('wfm')).toBe('wfm');
    expect(normalizeOwner('%')).toBeNull();
    expect(normalizeTier('high')).toBe('HIGH');
    expect(normalizeTier('x')).toBeNull();
    expect(normalizeBucket('nope')).toBe('open');
    expect(clampLimit('abc')).toBe(50);
    expect(clampLimit('9999')).toBe(200);
    expect(isValidDateOnly('2026-02-30')).toBe(false);
    expect(isValidDateOnly('2026-09-30')).toBe(true);
  });
});

describe('buildCasesQuery', () => {
  const emp = { sql: 'AND e.branch_id = ?', params: ['b1'] };
  it('binds params in placeholder order and dedupes open cases', () => {
    const { sql, params } = buildCasesQuery({ bucket: 'open', tier: 'HIGH', owner: 'manager', limit: 25, emp });
    expect(params).toEqual(['HIGH', 'manager', 'b1', 25]);
    expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain(`employment_status = 'Active'`);
  });
  it('weekStart adds two ordered params before emp params', () => {
    const { sql, params } = buildCasesQuery({ bucket: 'all', tier: null, owner: null, limit: 10, weekStart: '2026-09-28', emp });
    expect(params).toEqual(['2026-09-28', '2026-09-28', 'b1', 10]);
    expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
  });
  it('resolved buckets do not apply the active/latest filter', () => {
    expect(bucketWhere('retained')).not.toContain('NOT EXISTS');
    expect(bucketWhere('overdue')).toContain('TIMESTAMPDIFF');
  });
});
