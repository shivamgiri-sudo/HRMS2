/** Baseline guard (snapshot generated on origin/main): interventions + process team roster, no lobId. */
import { describe, it, expect, vi } from 'vitest';
import { getPendingInterventions, getInterventionOutcomes } from '../../analytics/intervention-recommendation.service';
import { getProcessTeamRosterView } from '../process-team-roster.service';

const { calls, mockExecute } = vi.hoisted(() => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const mockExecute = vi.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return [[], []]; });
  return { calls, mockExecute };
});
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mockExecute, query: mockExecute } }));

const fakeRes = () => {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; } };
  return { out, res };
};
// The team roster now also selects e.lob_id (needed for the per-member lobId); strip it so the
// rest of the statement is compared verbatim against origin/main.
const strip = (s: string) => s.replace(/\s+/g, ' ').replace('e.lob_id, ', '').trim();

describe('unfiltered SQL is unchanged', () => {
  it('pending interventions', async () => {
    calls.length = 0;
    await getPendingInterventions({ query: { owner: 'manager', limit: '20' } } as any, fakeRes().res);
    expect(calls.map((c) => ({ sql: strip(c.sql), params: c.params }))).toMatchSnapshot();
  });
  it('outcomes', async () => {
    calls.length = 0;
    await getInterventionOutcomes({ query: {} } as any, fakeRes().res);
    expect(calls.map((c) => ({ sql: strip(c.sql), params: c.params }))).toMatchSnapshot();
  });
  it('process team roster', async () => {
    calls.length = 0;
    await getProcessTeamRosterView('p1', '2026-09-01');
    expect(calls.map((c) => ({ sql: strip(c.sql), params: c.params }))).toMatchSnapshot();
  });
});
