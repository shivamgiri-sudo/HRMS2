import { describe, it, expect, vi } from 'vitest';

const execute = vi.fn(async (_sql: string, _p?: unknown[]) => [[{ total: 0 }], []]);
vi.mock('../../../db/mysql.js', () => ({ db: { execute, query: execute } }));

const { listHiringActivity } = await import('../recruiter-hiring.service.js');

describe('listHiringActivity scoping', () => {
  it('applies the scope filter inside the single-table derived query, never against the joined tables', async () => {
    execute.mockClear();
    execute.mockImplementation(async (sql: string) => {
      if (/FROM employees e/.test(sql)) return [[{ branch_name: 'AHMEDABAD-JALDARSHAN' }], []];
      return [[{ total: 0 }], []];
    });
    await listHiringActivity('u1', 'hr', { export: '1', limit: 10000 } as never);
    const rowsSql = String(execute.mock.calls.map((c) => c[0]).find((s) => /LEFT JOIN ats_candidate/.test(String(s))));
    expect(rowsSql).toMatch(/FROM \(SELECT \* FROM ats_recruiter_hiring_activity WHERE [\s\S]+\) arha\s+LEFT JOIN ats_candidate/);
    expect(rowsSql).not.toMatch(/LEFT JOIN ats_queue_token qt ON qt\.id = arha\.queue_token_id\s+WHERE/);
  });
});
