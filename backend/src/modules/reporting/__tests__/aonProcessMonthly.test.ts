import { describe, it, expect } from 'vitest';
import { buildProcessMonthlyAttrition } from '../executors/aon.executor.js';

const P = (process_name: string, joined: string, exited: string | null) =>
  ({ process_id: process_name, process_name, joined, exited });

describe('buildProcessMonthlyAttrition', () => {
  it('counts exits in the month and divides by the average of start and end headcount', () => {
    const rows = buildProcessMonthlyAttrition(
      [
        P('A', '2026-01-01', null),
        P('A', '2026-01-01', '2026-02-10'), // exits in Feb
        P('A', '2026-02-15', null),         // joins mid-Feb
      ],
      '2026-02-01',
      '2026-02-28',
    );
    expect(rows).toEqual([
      { month: '2026-02', process_id: 'A', process_name: 'A', exits: 1, avg_headcount: 2, attrition_rate_pct: 50 },
    ]);
  });

  it('keeps processes apart and totals reconcile to the company-wide figure', () => {
    const people = [P('A', '2025-12-01', '2026-01-05'), P('B', '2025-12-01', null), P('B', '2025-12-01', '2026-01-20')];
    const rows = buildProcessMonthlyAttrition(people, '2026-01-01', '2026-01-31');
    const exits = rows.reduce((a, r) => a + Number(r.exits), 0);
    expect(exits).toBe(2);
    expect(rows.map((r) => r.process_name)).toEqual(['A', 'B']);
  });

  it('generates at most 12 months and stops at the to-date', () => {
    const rows = buildProcessMonthlyAttrition([P('A', '2024-01-01', null)], '2025-01-01', '2026-12-31');
    expect(new Set(rows.map((r) => r.month)).size).toBe(12);
    const few = buildProcessMonthlyAttrition([P('A', '2024-01-01', null)], '2026-01-01', '2026-02-10');
    expect(new Set(few.map((r) => r.month))).toEqual(new Set(['2026-01', '2026-02']));
  });
});
