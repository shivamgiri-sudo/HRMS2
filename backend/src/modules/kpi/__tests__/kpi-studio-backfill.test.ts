import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../kpi-studio.compute.js', () => ({ computeStudioKpis: vi.fn(), resetFieldNameCache: vi.fn() }));

import { cancelBackfill, daysInRange, getBackfill, resetBackfills, startBackfill } from '../kpi-studio.backfill.js';

const TODAY = new Date(2026, 8, 30);
const outcome = (written: number) => ({ date: '', definitions_considered: 1, employees_considered: 0, written, no_data: 1, errors: 0, source_failures: [], sample: [] }) as never;

describe('daysInRange', () => {
  it('lists every day inclusive, across a month end', () => {
    expect(daysInRange('2026-08-30', '2026-09-02', TODAY)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
    expect(daysInRange('2026-09-12', '2026-09-12', TODAY)).toEqual(['2026-09-12']);
  });
  it('refuses bad, reversed, future and oversized ranges with a readable reason', () => {
    expect(() => daysInRange('12/09/2026', '2026-09-12', TODAY)).toThrow(/YYYY-MM-DD/);
    expect(() => daysInRange('2026-09-12', '2026-09-01', TODAY)).toThrow(/after the end/);
    expect(() => daysInRange('2026-09-12', '2026-10-05', TODAY)).toThrow(/future/);
    expect(() => daysInRange('2026-01-01', '2026-09-01', TODAY)).toThrow(/at most 62 days/);
    // Exactly 62 days is allowed; 63 is not.
    expect(daysInRange('2026-07-01', '2026-08-31', TODAY)).toHaveLength(62);
    expect(() => daysInRange('2026-07-01', '2026-09-01', TODAY)).toThrow(/at most 62 days/);
  });
});

describe('startBackfill', () => {
  beforeEach(() => resetBackfills());

  it('computes each day in order, one at a time, passing scope and dry-run through', async () => {
    const calls: string[] = []; let inFlight = 0, maxInFlight = 0;
    const compute = vi.fn(async (o: { date: string; processId?: string; dryRun: boolean }) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); calls.push(`${o.date}|${o.processId}|${o.dryRun}`);
      await new Promise((r) => setTimeout(r, 2)); inFlight--; return outcome(5);
    });
    const { job, done } = startBackfill({ from: '2026-09-12', to: '2026-09-14', processId: 'p1', dryRun: true }, 'u1', compute);
    expect(job.status).toBe('running');
    await done;
    expect(calls).toEqual(['2026-09-12|p1|true', '2026-09-13|p1|true', '2026-09-14|p1|true']);
    expect(maxInFlight).toBe(1);
    const final = getBackfill(job.id)!;
    expect(final.status).toBe('done');
    expect(final.days.map((d) => [d.status, d.written])).toEqual([['done', 5], ['done', 5], ['done', 5]]);
    expect(final.finishedAt).not.toBeNull();
  });

  it('a failing day is recorded and the rest still run', async () => {
    const compute = vi.fn(async (o: { date: string }) => { if (o.date === '2026-09-13') throw new Error('source unreachable'); return outcome(1); });
    const { job, done } = startBackfill({ from: '2026-09-12', to: '2026-09-14', dryRun: false }, null, compute);
    await done;
    expect(job.days.map((d) => d.status)).toEqual(['done', 'failed', 'done']);
    expect(job.days[1].message).toBe('source unreachable');
    expect(job.status).toBe('done');
  });

  it('only one range runs at a time', async () => {
    let release!: () => void;
    const compute = vi.fn(() => new Promise<never>((r) => { release = () => r(outcome(0)); }));
    const first = startBackfill({ from: '2026-09-12', to: '2026-09-12', dryRun: true }, null, compute);
    expect(() => startBackfill({ from: '2026-09-13', to: '2026-09-13', dryRun: true }, null, compute)).toThrow(/already being computed/);
    release(); await first.done;
    expect(() => startBackfill({ from: '2026-09-13', to: '2026-09-13', dryRun: true }, null, compute)).not.toThrow();
  });

  it('can be cancelled between days', async () => {
    const compute = vi.fn(async () => outcome(1));
    const { job, done } = startBackfill({ from: '2026-09-10', to: '2026-09-14', dryRun: true }, null, async (o) => { if (o.date === '2026-09-11') cancelBackfill(job.id); return compute(); });
    await done;
    expect(job.status).toBe('cancelled');
    expect(job.days.filter((d) => d.status === 'done')).toHaveLength(2);
    expect(job.days.filter((d) => d.status === 'pending')).toHaveLength(3);
  });
});
