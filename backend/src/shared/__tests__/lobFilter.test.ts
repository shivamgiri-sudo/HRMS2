import { describe, it, expect, vi } from 'vitest';
import { parseLobFilterParam, lobWhere, lobCondition, readLobFilter } from '../lobFilter';

const U = '123e4567-e89b-12d3-a456-426614174000';

describe('lobFilter', () => {
  it('absent/empty means no filter', () => {
    for (const v of [undefined, null, '', '  ']) expect(parseLobFilterParam(v)).toEqual({ kind: 'none' });
    expect(lobWhere({ kind: 'none' })).toEqual({ sql: '', params: [] });
  });
  it('sentinel means unassigned', () => {
    const f = parseLobFilterParam('__none__');
    expect(f).toEqual({ kind: 'unassigned' });
    expect(lobWhere(f)).toEqual({ sql: 'AND e.lob_id IS NULL', params: [] });
  });
  it('uuid means lob equality with alias', () => {
    const f = parseLobFilterParam(U);
    expect(lobWhere(f)).toEqual({ sql: 'AND e.lob_id = ?', params: [U] });
    expect(lobWhere(f, 'emp').sql).toBe('AND emp.lob_id = ?');
    expect(lobCondition(f)).toEqual({ sql: 'e.lob_id = ?', params: [U] });
    expect(lobCondition({ kind: 'none' })).toBeNull();
  });
  it('rejects bad values with statusCode 400', () => {
    for (const v of ['abc', "x' OR 1=1", ['a', 'b'], 5]) {
      expect(() => parseLobFilterParam(v)).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });
  it('readLobFilter responds 400', () => {
    const json = vi.fn();
    const res: any = { status: vi.fn(() => ({ json })) };
    expect(readLobFilter({ query: { lobId: 'bad' } } as any, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(readLobFilter({ query: {} } as any, res)).toEqual({ kind: 'none' });
  });
});
