import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Molecular and Reginald Email Dashboards share one per-ticket pipeline, split by
// `source` (sql/migrations/2190). Every read and write must carry the source, and each
// source must reach its own database, daily label and APR campaign.

const dbQuery = vi.fn();
const dialerQuery = vi.fn();
const getPool = vi.fn();
const getEmailTickets = vi.fn();

vi.mock('../../../db/mysql.js', () => ({ db: { query: dbQuery, execute: vi.fn() } }));
vi.mock('../../../db/dialerDb.js', () => ({ dialerQuery }));
vi.mock('../../../db/molecularEmailDb.js', () => ({ getMolecularEmailPool: getPool }));
vi.mock('../email-ticket.service.js', () => ({ getEmailTickets }));
vi.mock('../employee-names.js', () => ({
  resolveEmployeeNames: vi.fn(async () => new Map<string, string>()),
  codeKey: (c: unknown) => String(c ?? '').trim().toUpperCase(),
}));

const { TICKET_SOURCES, TICKET_SOURCE_LIST, ticketSourceConfig } = await import('../email-ticket-source.js');
const svc = await import('../molecular-email.service.js');
const sync = await import('../molecular-ticket-sync.service.js');

type Src = 'molecular' | 'reginald';

beforeEach(() => {
  dbQuery.mockReset().mockResolvedValue([[]]);
  dialerQuery.mockReset().mockResolvedValue([]);
  getPool.mockReset();
  getEmailTickets.mockReset().mockResolvedValue({ rows: [] });
});

describe('email ticket sources', () => {
  it('maps each source to its database, daily label and APR campaign', () => {
    expect(TICKET_SOURCE_LIST).toEqual(['molecular', 'reginald']);
    expect(TICKET_SOURCES.molecular).toMatchObject({ database: 'molecular_db_email', dashboardLabel: 'MOLECULAR', aprCampaign: 'MOEMAIL' });
    expect(TICKET_SOURCES.reginald).toMatchObject({ database: 'db_email', dashboardLabel: 'REGINALD_MEN', aprCampaign: 'EMAIL', excludedSenderLike: 'info@reginaldmen.com' });
  });
  it('refuses an unknown source', () => {
    expect(() => ticketSourceConfig('x' as Src)).toThrow(/Unknown/);
  });
});

describe.each<[Src, string, string]>([
  ['molecular', 'MOLECULAR', 'MOEMAIL'],
  ['reginald', 'REGINALD_MEN', 'EMAIL'],
])('read service, source %s', (source, label, campaign) => {
  it('overview filters every per-ticket query by source and falls back to its daily label', async () => {
    const out = await svc.getMolecularOverview({ from: '2026-10-01', to: '2026-10-02' }, source);
    expect(out.hasData).toBe(false);
    const ticketQueries = dbQuery.mock.calls.filter(([sql]) => /molecular_email_ticket/.test(String(sql)));
    expect(ticketQueries.length).toBeGreaterThan(0);
    for (const [sql, params] of ticketQueries) {
      expect(String(sql)).toMatch(/source = \?/);
      expect(params).toContain(source);
    }
    const feed = dbQuery.mock.calls.find(([sql]) => /email_ticket_daily_actual/.test(String(sql)));
    expect(feed?.[1]).toEqual([label]);
    expect(getEmailTickets).toHaveBeenCalledWith(label, { from: '2026-10-01', to: '2026-10-02' });
  });

  it('ticket list and filter options read only that source', async () => {
    await svc.getMolecularTicketList({}, source);
    await svc.getMolecularFilterOptions(source);
    expect(dbQuery.mock.calls.length).toBe(4);
    for (const [sql, params] of dbQuery.mock.calls) {
      expect(String(sql)).toMatch(/source = \?/);
      expect(params).toContain(source);
    }
  });

  it('agent daily reads its own APR campaign', async () => {
    dialerQuery.mockResolvedValue([{ d: '2026-10-01', user: 'MAS1', waitSec: 60, talkSec: 0, dispoSec: 0, pauseSec: 60 }]);
    const out = await svc.getMolecularAgentDaily({ from: '2026-10-01', to: '2026-10-01' }, source);
    expect(dialerQuery.mock.calls[0][1]).toEqual(['2026-10-01', '2026-10-01', campaign]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].dataStatus).toBe('apr_only');
    for (const [, params] of dbQuery.mock.calls) expect(params[0]).toBe(source);
  });
});

describe.each<[Src, string, string]>([
  ['molecular', 'molecular_db_email', '%info@molecularcompany.com%'],
  ['reginald', 'db_email', '%info@reginaldmen.com%'],
])('ticket sync, source %s', (source, database, sender) => {
  it('reads its own database and writes rows keyed by source', async () => {
    const poolQuery = vi.fn(async (sql: string) => {
      if (/information_schema/.test(sql)) return [[{ t: 'ticket_messages', c: 'ticket_id' }]];
      if (/SELECT id FROM tickets ORDER BY id/.test(sql)) return [[{ id: 7 }]];
      if (/FROM tickets t/.test(sql)) return [[{ id: 7, createdAt: '2026-10-01 10:00:00', status: 'Closed', agentId: 3, agentName: 'Asha' }]];
      if (/FROM ticket_events/.test(sql)) return [[]];
      if (/FROM ticket_messages/.test(sql)) return [[{ tid: 7, at: '2026-10-01 12:00:00' }]];
      return [[]];
    });
    getPool.mockResolvedValue({ query: poolQuery });
    const res = await sync.syncEmailTicketRows(source);
    expect(res).toMatchObject({ source, mode: 'backfill', tickets: 1 });
    expect(new Set(getPool.mock.calls.map((c) => c[0]))).toEqual(new Set([database]));
    const emptyCheck = dbQuery.mock.calls[0];
    expect(String(emptyCheck[0])).toMatch(/WHERE source = \?/);
    expect(emptyCheck[1]).toEqual([source]);
    const msgCall = poolQuery.mock.calls.find(([sql]) => /FROM ticket_messages/.test(String(sql)) && /NOT LIKE/.test(String(sql)));
    expect((msgCall as unknown[])[1]).toEqual([['7'], sender]);
    const insert = dbQuery.mock.calls.find(([sql]) => /INSERT INTO molecular_email_ticket\s/.test(String(sql)));
    expect(String(insert?.[0])).toMatch(/\(source, ticket_id,/);
    expect(insert?.[1][0][0].slice(0, 2)).toEqual([source, '7']);
    const del = dbQuery.mock.calls.find(([sql]) => /DELETE FROM molecular_email_ticket_reopen_event/.test(String(sql)));
    expect(del?.[1]).toEqual([source, ['7']]);
  });

  it('switches to incremental once the source has rows', async () => {
    dbQuery.mockResolvedValueOnce([[{ x: 1 }]]);
    const poolQuery = vi.fn(async () => [[]]);
    getPool.mockResolvedValue({ query: poolQuery });
    const res = await sync.syncEmailTicketRows(source);
    expect(res).toMatchObject({ source, mode: 'recent', tickets: 0 });
    expect(new Set(getPool.mock.calls.map((c) => c[0]))).toEqual(new Set([database]));
  });
});
