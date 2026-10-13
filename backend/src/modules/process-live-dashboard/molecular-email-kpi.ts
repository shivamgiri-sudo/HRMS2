/**
 * Molecular Email Dashboard — pure ticket lifecycle, TAT and KPI logic.
 *
 * No imports, no I/O: the sync (molecular-email-sync.service.ts) uses
 * deriveTicketLifecycle to turn one source ticket + its reopen events + its
 * agent replies into one molecular_email_ticket row, and the read service
 * (molecular-email.service.ts) uses enrichTicket / computeMolecularKpis on
 * those rows. Every KPI on the dashboard and every column in the ticket table
 * comes from these functions, so a card can always be reproduced from the table.
 *
 * Timestamps are IST wall-clock strings "YYYY-MM-DD HH:MM:SS" (both MySQL pools
 * run with timezone +05:30 and dateStrings). Durations parse both sides the same
 * way, so the offset cancels out.
 *
 * Definitions (requirement sheet, "KPI & Calculations" rows 64-68):
 *   Received          unique ticket IDs created in the period
 *   Closed            unique tickets whose CURRENT status is closed (final closure)
 *   Pending           Received - Closed (anything not closed: open, pending, in progress...)
 *   Reopened          unique tickets with at least one reopen event
 *   Reopen Events     total reopen events (a ticket reopened twice = 1 reopened, 2 events)
 *   Closure %         Closed / Received x 100
 *   Reopen %          unique Reopened (among closed) / Closed x 100
 *   First-Time Closure Rate  closed tickets never reopened / Closed x 100
 *   TAT (closed)      final closed - created, hours
 *   Age (open)        now (IST) - created, hours
 *   TAT buckets       0-24 (24 inclusive), >24-48, >48-72, >72
 *   Within SLA %      closed tickets with TAT <= SLA hours / closed tickets with a valid TAT
 * Tickets with invalid timestamps are flagged and kept out of TAT averages,
 * medians, buckets and SLA %, but still count as received/closed.
 */

export type TatBucket = '0-24h' | '>24-48h' | '>48-72h' | '>72h';
export const TAT_BUCKETS: readonly TatBucket[] = ['0-24h', '>24-48h', '>48-72h', '>72h'];

export type DataQualityFlag =
  | 'missing_created'
  | 'invalid_created'
  | 'future_created'
  | 'closed_before_created'
  | 'closed_no_timestamp';

export const DQ_LABELS: Record<DataQualityFlag, string> = {
  missing_created: 'Created time missing',
  invalid_created: 'Created time unreadable',
  future_created: 'Created time in the future',
  closed_before_created: 'Closed before created',
  closed_no_timestamp: 'Closed, no closure time at source',
};

const CLOSED_STATUSES = new Set(['closed', 'resolved', 'solved']);

export function isClosedStatus(status: string | null | undefined): boolean {
  return CLOSED_STATUSES.has(String(status ?? '').trim().toLowerCase());
}

/** Parses "YYYY-MM-DD HH:MM:SS" (or ISO-ish) as a wall-clock instant; null when unreadable. */
export function parseWallClock(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.startsWith('0000-00-00')) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  return Number.isNaN(t) ? null : t;
}

/** Hours from a to b (b - a); null when either side is unreadable. */
export function hoursBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const ta = parseWallClock(a);
  const tb = parseWallClock(b);
  if (ta === null || tb === null) return null;
  return (tb - ta) / 3_600_000;
}

/** Current IST wall-clock time as "YYYY-MM-DD HH:MM:SS". */
export function istNow(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 19).replace('T', ' ');
}

/** Today's IST date as "YYYY-MM-DD" (UTC would be yesterday until 05:30 IST). */
export function istToday(now: Date = new Date()): string {
  return istNow(now).slice(0, 10);
}

/** 0-24 includes exactly 24h; >24-48 includes 48; >48-72 includes 72. Negative/unknown -> null. */
export function tatBucket(hours: number | null | undefined): TatBucket | null {
  if (hours === null || hours === undefined || !Number.isFinite(hours) || hours < 0) return null;
  if (hours <= 24) return '0-24h';
  if (hours <= 48) return '>24-48h';
  if (hours <= 72) return '>48-72h';
  return '>72h';
}

// ── Sync side: one source ticket -> one stored row ─────────────────────────────

export interface SourceTicket {
  id: string;
  createdAt: string | null;
  status: string | null;
  agentName: string | null;
  category: string | null;
  priority: string | null;
  /** Source's own closed/resolved timestamp column, when the schema has one. */
  closedAtColumn: string | null;
}

export interface DerivedTicket {
  ticketId: string;
  createdAt: string | null;
  agentName: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
  firstClosedAt: string | null;
  finalClosedAt: string | null;
  reopenCount: number;
  firstReopenedAt: string | null;
  lastReopenedAt: string | null;
  /** 'closed_at' = source column; 'last_agent_reply' = inferred from the agent's reply (no close event at source). */
  closureBasis: 'closed_at' | 'last_agent_reply' | null;
  dqFlag: DataQualityFlag | null;
}

const byTime = (a: string, b: string) => (parseWallClock(a) ?? 0) - (parseWallClock(b) ?? 0);

/**
 * reopenEvents: timestamps of the ticket's Closed->Open events.
 * agentReplies: timestamps of qualifying agent outbound replies (the source's
 * own closure signal — it logs no close event).
 *
 * first closure = the close that preceded the first reopen (last agent reply
 * at or before the first reopen event); without reopens it is the final closure.
 * final closure = source closed column when present, else the last agent reply,
 * and only while the ticket is currently closed.
 */
export function deriveTicketLifecycle(
  t: SourceTicket,
  reopenEvents: readonly string[],
  agentReplies: readonly string[],
  nowIst: string,
): DerivedTicket {
  const events = reopenEvents.filter((e) => parseWallClock(e) !== null).slice().sort(byTime);
  const replies = agentReplies.filter((r) => parseWallClock(r) !== null).slice().sort(byTime);
  const closed = isClosedStatus(t.status);

  let finalClosedAt: string | null = null;
  let closureBasis: DerivedTicket['closureBasis'] = null;
  if (closed) {
    if (parseWallClock(t.closedAtColumn) !== null) {
      finalClosedAt = t.closedAtColumn;
      closureBasis = 'closed_at';
    } else if (replies.length > 0) {
      finalClosedAt = replies[replies.length - 1];
      closureBasis = 'last_agent_reply';
    }
  }

  let firstClosedAt: string | null = null;
  if (events.length > 0) {
    const firstReopen = parseWallClock(events[0]) as number;
    const before = replies.filter((r) => (parseWallClock(r) as number) <= firstReopen);
    firstClosedAt = before.length > 0 ? before[before.length - 1] : null;
    if (firstClosedAt && !closureBasis) closureBasis = 'last_agent_reply';
  } else {
    firstClosedAt = finalClosedAt;
  }

  let dqFlag: DataQualityFlag | null = null;
  const created = parseWallClock(t.createdAt);
  if (t.createdAt === null || t.createdAt === undefined || String(t.createdAt).trim() === '') dqFlag = 'missing_created';
  else if (created === null) dqFlag = 'invalid_created';
  else if (created > (parseWallClock(nowIst) ?? Infinity) + 5 * 60_000) dqFlag = 'future_created';
  else if (closed && finalClosedAt === null) dqFlag = 'closed_no_timestamp';
  else if (finalClosedAt !== null && (parseWallClock(finalClosedAt) as number) < created) dqFlag = 'closed_before_created';

  return {
    ticketId: String(t.id),
    createdAt: t.createdAt ?? null,
    agentName: t.agentName ?? null,
    category: t.category ?? null,
    priority: t.priority ?? null,
    status: t.status ?? null,
    firstClosedAt,
    finalClosedAt,
    reopenCount: events.length,
    firstReopenedAt: events[0] ?? null,
    lastReopenedAt: events.length > 0 ? events[events.length - 1] : null,
    closureBasis,
    dqFlag,
  };
}

// ── Read side ──────────────────────────────────────────────────────────────────

export interface StoredTicket {
  ticketId: string;
  createdAt: string | null;
  agentName: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
  firstClosedAt: string | null;
  finalClosedAt: string | null;
  reopenCount: number;
  dqFlag: DataQualityFlag | null;
}

export type SlaStatus = 'Within SLA' | 'Breached' | 'Open - within SLA' | 'Open - breached' | 'N/A';

export interface EnrichedTicket extends StoredTicket {
  isClosed: boolean;
  isReopened: boolean;
  /** Closed: final closed - created. Open: now - created (age). Null when invalid. */
  tatHours: number | null;
  tatBucket: TatBucket | null;
  slaStatus: SlaStatus;
}

export function enrichTicket(t: StoredTicket, nowIst: string, slaHours: number): EnrichedTicket {
  const isClosed = isClosedStatus(t.status);
  const invalid = t.dqFlag !== null;
  let tatHours: number | null = null;
  if (!invalid) {
    tatHours = isClosed ? hoursBetween(t.createdAt, t.finalClosedAt) : hoursBetween(t.createdAt, nowIst);
    if (tatHours !== null && tatHours < 0) tatHours = null;
  }
  const bucket = tatBucket(tatHours);
  let slaStatus: SlaStatus = 'N/A';
  if (tatHours !== null) {
    const within = tatHours <= slaHours;
    slaStatus = isClosed ? (within ? 'Within SLA' : 'Breached') : (within ? 'Open - within SLA' : 'Open - breached');
  }
  return {
    ...t,
    reopenCount: Number(t.reopenCount) || 0,
    isClosed,
    isReopened: (Number(t.reopenCount) || 0) > 0,
    tatHours: tatHours === null ? null : Math.round(tatHours * 100) / 100,
    tatBucket: bucket,
    slaStatus,
  };
}

const pctOf = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 10000) / 100 : null;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface MolecularKpis {
  received: number;
  closed: number;
  pending: number;
  reopened: number;
  reopenEvents: number;
  closurePct: number | null;
  reopenPct: number | null;
  firstTimeClosureRate: number | null;
  avgTatHours: number | null;
  medianTatHours: number | null;
  withinSlaPct: number | null;
  slaHours: number;
  pendingOver72h: number;
  dataQualityExcluded: number;
  funnel: { received: number; firstClosed: number; reopened: number; finalClosed: number; pending: number };
  closedTatBuckets: Record<TatBucket, number>;
  openAgeingBuckets: Record<TatBucket, number>;
}

const emptyBuckets = (): Record<TatBucket, number> => ({ '0-24h': 0, '>24-48h': 0, '>48-72h': 0, '>72h': 0 });

/** All KPIs over one set of unique tickets (the cohort received in the period, after filters). */
export function computeMolecularKpis(tickets: readonly EnrichedTicket[], slaHours: number): MolecularKpis {
  const seen = new Set<string>();
  const unique = tickets.filter((t) => (seen.has(t.ticketId) ? false : (seen.add(t.ticketId), true)));

  const closedT = unique.filter((t) => t.isClosed);
  const received = unique.length;
  const closed = closedT.length;
  const reopened = unique.filter((t) => t.isReopened).length;
  const reopenedClosed = closedT.filter((t) => t.isReopened).length;
  const reopenEvents = unique.reduce((s, t) => s + (t.reopenCount || 0), 0);
  const firstTime = closedT.filter((t) => !t.isReopened).length;

  const closedTat = closedT.map((t) => t.tatHours).filter((h): h is number => h !== null);
  const closedTatBuckets = emptyBuckets();
  for (const t of closedT) if (t.tatBucket) closedTatBuckets[t.tatBucket]++;
  const openAgeingBuckets = emptyBuckets();
  for (const t of unique) if (!t.isClosed && t.tatBucket) openAgeingBuckets[t.tatBucket]++;

  const avg = closedTat.length > 0 ? closedTat.reduce((s, h) => s + h, 0) / closedTat.length : null;
  const med = median(closedTat);
  const round2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

  return {
    received,
    closed,
    pending: received - closed,
    reopened,
    reopenEvents,
    closurePct: pctOf(closed, received),
    reopenPct: pctOf(reopenedClosed, closed),
    firstTimeClosureRate: pctOf(firstTime, closed),
    avgTatHours: round2(avg),
    medianTatHours: round2(med),
    withinSlaPct: pctOf(closedTat.filter((h) => h <= slaHours).length, closedTat.length),
    slaHours,
    pendingOver72h: openAgeingBuckets['>72h'],
    dataQualityExcluded: unique.filter((t) => t.dqFlag !== null).length,
    funnel: {
      received,
      // Closed at least once: currently closed, or reopened (a reopen implies an earlier close).
      firstClosed: unique.filter((t) => t.isClosed || t.isReopened).length,
      reopened,
      finalClosed: closed,
      pending: received - closed,
    },
    closedTatBuckets,
    openAgeingBuckets,
  };
}

/** Normalised person name for linking ticket-system agents to dialler APR agents. */
export function nameKey(v: string | null | undefined): string {
  return String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
