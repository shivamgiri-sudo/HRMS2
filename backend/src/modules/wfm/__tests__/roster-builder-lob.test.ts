/** getRosterGrid LOB filter + name lookup. All DB calls mocked. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecute, calls } = vi.hoisted(() => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const mockExecute = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params: params ?? [] });
    if (sql.includes('FROM lob_master')) return [[{ id: '11111111-1111-1111-1111-111111111111', lob_name: 'Sales' }]];
    return [[{ employee_id: 'e1', employee_name: 'A', lob_id: '11111111-1111-1111-1111-111111111111', roster_date: '2026-09-01', is_week_off: 0 }]];
  });
  return { mockExecute, calls };
});
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mockExecute } }));

import { getRosterGrid } from '../roster-builder.service.js';
import { parseLobFilterParam } from '../../../shared/lobFilter.js';

const UUID = '11111111-1111-1111-1111-111111111111';

describe('getRosterGrid LOB', () => {
  beforeEach(() => { calls.length = 0; });

  it('adds no LOB fragment without a filter', async () => {
    await getRosterGrid({ cycleId: 'c1', branchId: 'b1' });
    expect(calls[0].sql).not.toContain('lob_id =');
    expect(calls[0].sql).not.toContain('lob_id IS NULL');
    expect(calls[0].params).toEqual(['c1', 'b1']);
  });

  it('appends the uuid condition after existing params and resolves the name', async () => {
    const rows = await getRosterGrid({ cycleId: 'c1', employeeSearch: 'x', lob: parseLobFilterParam(UUID) });
    expect(calls[0].sql).toContain('e.lob_id = ?');
    expect(calls[0].params).toEqual(['c1', '%x%', '%x%', UUID]);
    expect(rows[0].lobName).toBe('Sales');
  });

  it('supports the unassigned sentinel', async () => {
    await getRosterGrid({ cycleId: 'c1', lob: parseLobFilterParam('__none__') });
    expect(calls[0].sql).toContain('e.lob_id IS NULL');
    expect(calls[0].params).toEqual(['c1']);
  });

  it('rejects a malformed lobId', () => {
    expect(() => parseLobFilterParam('nope')).toThrow();
  });
});
