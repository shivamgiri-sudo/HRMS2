import { describe, expect, it } from 'vitest';
import {
  computeMolecularKpis, deriveTicketLifecycle, enrichTicket, hoursBetween, istNow, istToday,
  nameKey, tatBucket, type SourceTicket, type StoredTicket,
} from '../molecular-email-kpi.js';

const NOW = '2026-10-13 12:00:00';
const SLA = 24;

function stored(p: Partial<StoredTicket> & { ticketId: string }): StoredTicket {
  return {
    createdAt: '2026-10-01 10:00:00', agentName: 'A', category: null, priority: null,
    status: 'Open', firstClosedAt: null, finalClosedAt: null, reopenCount: 0, dqFlag: null, ...p,
  };
}

function src(p: Partial<SourceTicket> = {}): SourceTicket {
  return { id: '1', createdAt: '2026-10-01 10:00:00', status: 'Closed', agentName: 'A', category: null, priority: null, closedAtColumn: null, ...p };
}

describe('tatBucket (UAT-08)', () => {
  it('puts 23h/30h/60h/80h tickets in 0-24 / >24-48 / >48-72 / >72', () => {
    expect(tatBucket(23)).toBe('0-24h');
    expect(tatBucket(30)).toBe('>24-48h');
    expect(tatBucket(60)).toBe('>48-72h');
    expect(tatBucket(80)).toBe('>72h');
  });
  it('treats exactly 24h as 0-24 and just over as >24-48; 48 and 72 close their buckets', () => {
    expect(tatBucket(24)).toBe('0-24h');
    expect(tatBucket(24.0001)).toBe('>24-48h');
    expect(tatBucket(48)).toBe('>24-48h');
    expect(tatBucket(72)).toBe('>48-72h');
    expect(tatBucket(0)).toBe('0-24h');
  });
  it('gives no bucket for negative or unknown durations', () => {
    expect(tatBucket(-1)).toBeNull();
    expect(tatBucket(null)).toBeNull();
    expect(tatBucket(Number.NaN)).toBeNull();
  });
  it('buckets closed tickets end to end from timestamps', () => {
    const mk = (id: string, closedAt: string) =>
      enrichTicket(stored({ ticketId: id, status: 'Closed', createdAt: '2026-10-01 00:00:00', finalClosedAt: closedAt, firstClosedAt: closedAt }), NOW, SLA);
    expect(mk('a', '2026-10-01 23:00:00').tatBucket).toBe('0-24h');
    expect(mk('b', '2026-10-02 06:00:00').tatBucket).toBe('>24-48h');
    expect(mk('c', '2026-10-03 12:00:00').tatBucket).toBe('>48-72h');
    expect(mk('d', '2026-10-04 08:00:00').tatBucket).toBe('>72h');
    expect(mk('e', '2026-10-02 00:00:00').tatBucket).toBe('0-24h');
    expect(mk('e', '2026-10-02 00:00:00').slaStatus).toBe('Within SLA');
  });
});

describe('time helpers', () => {
  it('uses IST for today/now', () => {
    // 2026-10-12 20:00 UTC = 2026-10-13 01:30 IST
    const d = new Date(Date.UTC(2026, 9, 12, 20, 0, 0));
    expect(istToday(d)).toBe('2026-10-13');
    expect(istNow(d)).toBe('2026-10-13 01:30:00');
  });
  it('measures hours between wall-clock strings', () => {
    expect(hoursBetween('2026-10-01 00:00:00', '2026-10-02 06:00:00')).toBe(30);
    expect(hoursBetween('0000-00-00 00:00:00', '2026-10-02 06:00:00')).toBeNull();
    expect(hoursBetween(null, '2026-10-02 06:00:00')).toBeNull();
  });
  it('normalises names for agent linking', () => {
    expect(nameKey('  Ravi  KUMAR. ')).toBe('ravi kumar');
  });
});

describe('deriveTicketLifecycle (UAT-07: received -> closed -> reopened -> closed)', () => {
  it('keeps first and final closure apart and counts the reopen', () => {
    const d = deriveTicketLifecycle(
      src(),
      ['2026-10-02 09:00:00'],
      ['2026-10-01 18:00:00', '2026-10-03 10:00:00'],
      NOW,
    );
    expect(d.firstClosedAt).toBe('2026-10-01 18:00:00');
    expect(d.finalClosedAt).toBe('2026-10-03 10:00:00');
    expect(d.reopenCount).toBe(1);
    expect(d.closureBasis).toBe('last_agent_reply');
    expect(d.dqFlag).toBeNull();

    const e = enrichTicket({ ...d }, NOW, SLA);
    expect(e.tatHours).toBe(48); // final closed - created
    expect(e.tatBucket).toBe('>24-48h');
    const k = computeMolecularKpis([e], SLA);
    expect(k.received).toBe(1);
    expect(k.closed).toBe(1);
    expect(k.reopened).toBe(1);
    expect(k.reopenEvents).toBe(1);
    expect(k.firstTimeClosureRate).toBe(0);
  });

  it('prefers the source closed column when the schema has one', () => {
    const d = deriveTicketLifecycle(src({ closedAtColumn: '2026-10-01 20:00:00' }), [], ['2026-10-01 18:00:00'], NOW);
    expect(d.finalClosedAt).toBe('2026-10-01 20:00:00');
    expect(d.firstClosedAt).toBe('2026-10-01 20:00:00');
    expect(d.closureBasis).toBe('closed_at');
  });

  it('leaves an open ticket without closure times', () => {
    const d = deriveTicketLifecycle(src({ status: 'Pending' }), [], ['2026-10-01 18:00:00'], NOW);
    expect(d.finalClosedAt).toBeNull();
    expect(d.firstClosedAt).toBeNull();
    expect(d.dqFlag).toBeNull();
  });

  it('flags invalid timestamps', () => {
    expect(deriveTicketLifecycle(src({ createdAt: null }), [], [], NOW).dqFlag).toBe('missing_created');
    expect(deriveTicketLifecycle(src({ createdAt: 'garbage' }), [], [], NOW).dqFlag).toBe('invalid_created');
    expect(deriveTicketLifecycle(src({ createdAt: '2026-12-01 00:00:00', status: 'Open' }), [], [], NOW).dqFlag).toBe('future_created');
    expect(deriveTicketLifecycle(src(), [], [], NOW).dqFlag).toBe('closed_no_timestamp');
    expect(deriveTicketLifecycle(src({ closedAtColumn: '2026-09-30 10:00:00' }), [], [], NOW).dqFlag).toBe('closed_before_created');
  });
});

describe('computeMolecularKpis', () => {
  it('counts a ticket reopened twice as 1 unique reopened ticket and 2 reopen events', () => {
    const t = enrichTicket(stored({ ticketId: 'r2', status: 'Closed', reopenCount: 2, firstClosedAt: '2026-10-01 12:00:00', finalClosedAt: '2026-10-02 12:00:00' }), NOW, SLA);
    const k = computeMolecularKpis([t, t], SLA); // duplicated row must not inflate either
    expect(k.received).toBe(1);
    expect(k.reopened).toBe(1);
    expect(k.reopenEvents).toBe(2);
    expect(k.reopenPct).toBe(100);
  });

  it('computes closure %, reopen %, pending, SLA and ageing from unique tickets', () => {
    const tickets = [
      stored({ ticketId: '1', status: 'Closed', finalClosedAt: '2026-10-01 20:00:00', firstClosedAt: '2026-10-01 20:00:00' }), // 10h
      stored({ ticketId: '2', status: 'Closed', finalClosedAt: '2026-10-03 10:00:00', firstClosedAt: '2026-10-01 20:00:00', reopenCount: 1 }), // 48h
      stored({ ticketId: '3', status: 'Open' }), // age > 72h
      stored({ ticketId: '4', status: 'pending', createdAt: '2026-10-13 02:00:00' }), // 10h old
      stored({ ticketId: '5', status: 'Closed', dqFlag: 'closed_no_timestamp' }),
    ].map((t) => enrichTicket(t, NOW, SLA));
    const k = computeMolecularKpis(tickets, SLA);
    expect(k.received).toBe(5);
    expect(k.closed).toBe(3);
    expect(k.pending).toBe(2);
    expect(k.closurePct).toBe(60);
    expect(k.reopenPct).toBe(33.33);
    expect(k.firstTimeClosureRate).toBe(66.67);
    expect(k.avgTatHours).toBe(29);
    expect(k.medianTatHours).toBe(29);
    expect(k.withinSlaPct).toBe(50); // invalid ticket excluded from the denominator
    expect(k.dataQualityExcluded).toBe(1);
    expect(k.pendingOver72h).toBe(1);
    expect(k.openAgeingBuckets['0-24h']).toBe(1);
    expect(k.closedTatBuckets['0-24h']).toBe(1);
    expect(k.closedTatBuckets['>24-48h']).toBe(1);
    expect(k.funnel).toEqual({ received: 5, firstClosed: 3, reopened: 1, finalClosed: 3, pending: 2 });
  });

  it('returns null percentages, not zero, when there is nothing to divide by', () => {
    const k = computeMolecularKpis([], SLA);
    expect(k.closurePct).toBeNull();
    expect(k.avgTatHours).toBeNull();
    expect(k.withinSlaPct).toBeNull();
  });
});
