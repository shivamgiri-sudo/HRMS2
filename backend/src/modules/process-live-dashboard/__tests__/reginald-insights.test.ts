import { beforeEach, describe, expect, it, vi } from 'vitest';

const dialerQuery = vi.fn();
const dbQuery = vi.fn();
vi.mock('../../../db/dialerDb.js', () => ({ dialerQuery: (...a: unknown[]) => dialerQuery(...a) }));
vi.mock('../../../db/mysql.js', () => ({ db: { query: (...a: unknown[]) => dbQuery(...a), execute: vi.fn() } }));
vi.mock('../live-cache.js', () => ({ cachedLive: (_n: string, _r: unknown, fn: () => unknown) => fn() }));
vi.mock('../employee-names.js', () => ({
  codeKey: (c: unknown) => String(c ?? '').trim().toUpperCase(),
  resolveEmployeeNames: async () => new Map([['MAS1', 'Asha']]),
}));

const { getInsightTargets, getInsightOverview, parseInsightFilters } = await import('../reginald-insights.service.js');

const cdr = (d: string, totalCdr: number) => ({ agent: 'MAS1', d, totalCdr, connected: 10, uniqueDialed: 100, uniqueConnected: 25, uniqueQualified: 5, talkSec: 600 });

describe('Reginald analyst-day targets (UAT-05)', () => {
  beforeEach(() => {
    dialerQuery.mockReset(); dbQuery.mockReset();
    dialerQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('cdr_ob_25')) return [cdr('2026-09-01', 12150), cdr('2026-09-02', 13500), cdr('2026-09-04', 400)];
      return [];
    });
    dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('attendance_daily_record')) {
        return [[
          { code: 'MAS1', d: '2026-09-01', st: 'present' },
          { code: 'MAS1', d: '2026-09-02', st: 'present' },
          { code: 'MAS1', d: '2026-09-03', st: 'present' }, // present, no dialling: target still due
          { code: 'MAS1', d: '2026-09-04', st: 'absent' },  // dialled but absent: no target
          { code: 'MAS1', d: '2026-09-02', st: 'absent' },  // duplicate HRMS row must not double or erase
        ]];
      }
      return [[]];
    });
  });

  it('targets only present days: 3 present days = 40,500', async () => {
    const t = await getInsightTargets({ from: '2026-09-01', to: '2026-09-04' });
    const byDate = Object.fromEntries(t.rows.map(r => [r.date, r]));
    expect(t.rows.map(r => r.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    expect(t.rows.reduce((s, r) => s + r.target, 0)).toBe(40500);
    expect(byDate['2026-09-01']).toMatchObject({ target: 13500, totalCdr: 12150, gap: -1350, achievementPct: 90, agentName: 'Asha' });
    expect(byDate['2026-09-03']).toMatchObject({ target: 13500, totalCdr: 0, achievementPct: 0 });
    expect(byDate['2026-09-04']).toMatchObject({ target: 0, attendanceStatus: 'absent', achievementPct: null });
  });

  it('computes Connect % on unique connect / unique dialed', async () => {
    dialerQuery.mockImplementation(async (sql: string) => (sql.includes('cdr_ob_25') && !sql.includes('DISTINCT UPPER') ? [cdr('', 999)] : []));
    dbQuery.mockResolvedValue([[{ orders: 3, revenue: 4500 }]]);
    const o = await getInsightOverview({ from: '2026-09-01', to: '2026-09-04' });
    expect(o.cdr.connectPct).toBe(25);
    expect(o.cdr.uniqueContacted).toBeNull();
    expect(o.byCampaign[0].connectPct).toBe(25);
    expect(o.sales).toMatchObject({ orders: 3, revenue: 4500 });
  });
});

describe('filter parsing', () => {
  it('accepts only cart campaigns and code-shaped agents', () => {
    expect(parseInsightFilters({ from: '2026-09-01', to: '2026-09-30', campaign: 'tamil', agent: 'mas123' }))
      .toEqual({ from: '2026-09-01', to: '2026-09-30', campaign: 'TAMIL', agent: 'MAS123' });
    expect(parseInsightFilters({ from: '2026-09-01', to: '2026-09-30', campaign: 'RTO', agent: "x' OR 1=1" }))
      .toMatchObject({ campaign: null, agent: null });
  });
});
