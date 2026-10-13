import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/mysql.js', () => ({ db: { query: vi.fn(), execute: vi.fn() } }));
vi.mock('../../../db/dialerDb.js', () => ({ dialerQuery: vi.fn() }));
vi.mock('../../../db/molecularEmailDb.js', () => ({ getMolecularEmailPool: vi.fn() }));

const { parseMolecularFilters } = await import('../molecular-email.service.js');
const { pickColumns } = await import('../molecular-ticket-sync.service.js');

describe('parseMolecularFilters', () => {
  it('keeps valid values and drops anything unexpected', () => {
    const f = parseMolecularFilters({
      from: '2026-10-01', to: '2026-10-10', agent: ' Ravi ', category: 'All', status: 'open', tatBucket: '>72h', slaHours: '48',
    });
    expect(f).toMatchObject({ from: '2026-10-01', to: '2026-10-10', agent: 'Ravi', category: null, status: 'open', tatBucket: '>72h', slaHours: 48 });
    const bad = parseMolecularFilters({ from: "2026-10-01' OR 1=1", status: 'drop', tatBucket: '99h', slaHours: '-5' });
    expect(bad.status).toBeNull();
    expect(bad.tatBucket).toBeNull();
    expect(bad.slaHours).toBe(24);
    expect(bad.from).toMatch(/^\d{4}-\d{2}-01$/);
  });
  it('swaps a reversed range', () => {
    const f = parseMolecularFilters({ from: '2026-10-10', to: '2026-10-01' });
    expect([f.from, f.to]).toEqual(['2026-10-01', '2026-10-10']);
  });
});

describe('pickColumns (source schema probe)', () => {
  it('uses only whitelisted optional columns that exist', () => {
    const c = pickColumns([
      { table: 'tickets', column: 'priority' },
      { table: 'tickets', column: 'queue' },
      { table: 'tickets', column: 'updated_at' },
      { table: 'ticket_messages', column: 'ticket_id' },
    ]);
    expect(c).toEqual({ priority: 'priority', category: 'queue', closedAt: null, updatedAt: 'updated_at', messageTicketId: true });
    expect(pickColumns([])).toEqual({ priority: null, category: null, closedAt: null, updatedAt: null, messageTicketId: false });
  });
});
