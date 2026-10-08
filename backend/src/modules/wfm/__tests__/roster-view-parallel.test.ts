/** getRosterView: the count and page queries are issued concurrently, results unchanged. */
import { describe, it, expect, vi } from 'vitest';

const { mockExecute, order } = vi.hoisted(() => {
  const order: string[] = [];
  const mockExecute = vi.fn(async (sql: string) => {
    if (sql.includes('COUNT(DISTINCT')) {
      order.push('count-start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('count-end');
      return [[{ n: 7 }]];
    }
    order.push('rows-start');
    await new Promise((r) => setTimeout(r, 10));
    order.push('rows-end');
    return [[]];
  });
  return { mockExecute, order };
});

vi.mock('../../../db/mysql.js', () => ({ db: { execute: mockExecute } }));

import { getRosterView } from '../roster-view.service.js';

describe('getRosterView', () => {
  it('runs count and page query concurrently and keeps total', async () => {
    const res = await getRosterView({ fromDate: '2026-09-01', toDate: '2026-09-07' });
    expect(res.total).toBe(7);
    expect(res.rows).toEqual([]);
    expect(order.slice(0, 2)).toEqual(['count-start', 'rows-start']);
  });
});
