/**
 * Molecular Email Dashboard read service (MOL-01..MOL-06).
 *
 * Reads only HRMS tables: molecular_email_ticket / molecular_email_ticket_reopen_event
 * (sql/migrations/2180-2181, filled by molecular-ticket-sync.service.ts) and the
 * MOEMAIL campaign's dialler APR (vicidial_agent_log_10_25) for agent time.
 * Nothing here is attached to the Reginald process (REG-07).
 *
 * Period = tickets RECEIVED (created, IST) in the selected dates. Every KPI and
 * the ticket table come from the same filtered cohort through
 * molecular-email-kpi.ts, so a card can be reproduced row by row from the table.
 * Trend lines that are dated by a different event (closures by closed date,
 * reopens by reopen date) say so in their labels.
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { dialerQuery } from '../../db/dialerDb.js';
import { n, pct, fmtDuration } from './dialler-utils.js';
import { resolveEmployeeNames, codeKey } from './employee-names.js';
import {
  computeMolecularKpis, enrichTicket, istNow, istToday, nameKey, TAT_BUCKETS,
  type DataQualityFlag, type EnrichedTicket, type MolecularKpis, type TatBucket,
} from './molecular-email-kpi.js';
import { getEmailTickets, type EmailTicketSummary } from './email-ticket.service.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TABLE_ROW_LIMIT = 5000;

export interface MolecularFilters {
  from: string;
  to: string;
  agent: string | null;
  category: string | null;
  priority: string | null;
  status: 'open' | 'closed' | 'reopened' | null;
  tatBucket: TatBucket | null;
  slaHours: number;
}

const clean = (v: unknown, max = 200): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= max && s.toLowerCase() !== 'all' ? s : null;
};

/** Validates every query value; anything unexpected falls back to "no filter". */
export function parseMolecularFilters(q: Record<string, unknown>): MolecularFilters {
  const today = istToday();
  const from = typeof q.from === 'string' && DATE_RE.test(q.from) ? q.from : `${today.slice(0, 8)}01`;
  const to = typeof q.to === 'string' && DATE_RE.test(q.to) ? q.to : today;
  const status = clean(q.status);
  const bucket = clean(q.tatBucket);
  const sla = Number(q.slaHours);
  return {
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    agent: clean(q.agent),
    category: clean(q.category),
    priority: clean(q.priority),
    status: status === 'open' || status === 'closed' || status === 'reopened' ? status : null,
    tatBucket: (TAT_BUCKETS as readonly string[]).includes(bucket ?? '') ? (bucket as TatBucket) : null,
    slaHours: Number.isFinite(sla) && sla > 0 && sla <= 720 ? sla : 24,
  };
}

const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/** The filtered cohort: unique tickets created in the period, enriched with TAT/SLA. */
async function loadCohort(f: MolecularFilters, nowIst: string): Promise<EnrichedTicket[]> {
  const where = ['created_at >= ?', 'created_at < DATE_ADD(?, INTERVAL 1 DAY)'];
  const params: unknown[] = [f.from, f.to];
  if (f.agent) { where.push('agent_name = ?'); params.push(f.agent); }
  if (f.category) { where.push('category = ?'); params.push(f.category); }
  if (f.priority) { where.push('priority = ?'); params.push(f.priority); }
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ticket_id, created_at, agent_name, category, priority, status,
            first_closed_at, final_closed_at, reopen_count, dq_flag
       FROM molecular_email_ticket WHERE ${where.join(' AND ')}`,
    params,
  );
  return rows
    .map((r) => enrichTicket({
      ticketId: String(r.ticket_id),
      createdAt: s(r.created_at),
      agentName: s(r.agent_name),
      category: s(r.category),
      priority: s(r.priority),
      status: s(r.status),
      firstClosedAt: s(r.first_closed_at),
      finalClosedAt: s(r.final_closed_at),
      reopenCount: n(r.reopen_count),
      dqFlag: (s(r.dq_flag) as DataQualityFlag | null),
    }, nowIst, f.slaHours))
    .filter((t) => {
      if (f.status === 'open' && t.isClosed) return false;
      if (f.status === 'closed' && !t.isClosed) return false;
      if (f.status === 'reopened' && !t.isReopened) return false;
      if (f.tatBucket && t.tatBucket !== f.tatBucket) return false;
      return true;
    });
}

/** Tickets with created_at outside readable range never enter a period; counted separately. */
async function invalidCreatedCount(): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS c FROM molecular_email_ticket WHERE created_at IS NULL',
  );
  return n(rows[0]?.c);
}

export interface MolecularTrendRow { date: string; received: number; closed: number; reopenedTickets: number; reopenEvents: number }

export interface MolecularOverview {
  filters: MolecularFilters;
  asOf: string;
  kpis: MolecularKpis;
  trend: MolecularTrendRow[];
  categoryReopen: { category: string; closed: number; reopened: number; reopenPct: number | null }[];
  oldestPending: EnrichedTicket[];
  fieldAvailability: { category: boolean; priority: boolean; reopenReason: false };
  closureBasis: Record<string, number>;
  ticketsWithoutCreatedTime: number;
  lastSyncedAt: string | null;
  hasData: boolean;
  feed: MolecularFeedStatus;
  /**
   * When the per-ticket table has nothing for the period, the daily counts the
   * older hourly sync stored (email_ticket_daily_actual, MOLECULAR) so the page
   * is not blank. Day-level counts only, as the source reported them.
   */
  dailyFallback: EmailTicketSummary | null;
}

export interface MolecularFeedStatus {
  /** Newest synced_at in molecular_email_ticket; null = the per-ticket sync has never completed. */
  ticketFeedLastSyncedAt: string | null;
  /** Newest write by the daily sync for MOLECULAR (the last time HRMS reached the ticket server). */
  dailyFeedLastSyncedAt: string | null;
  /** Latest report_date the daily sync holds for MOLECULAR. */
  dailyLatestDate: string | null;
}

async function feedStatus(ticketSyncedAt: string | null): Promise<MolecularFeedStatus> {
  const [r] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(MAX(updated_at), '%Y-%m-%d %H:%i:%s') AS synced, DATE_FORMAT(MAX(report_date), '%Y-%m-%d') AS latest
       FROM email_ticket_daily_actual WHERE dashboard_label = 'MOLECULAR'`,
  );
  return { ticketFeedLastSyncedAt: ticketSyncedAt, dailyFeedLastSyncedAt: s(r[0]?.synced), dailyLatestDate: s(r[0]?.latest) };
}

export async function getMolecularOverview(q: Record<string, unknown>): Promise<MolecularOverview> {
  const f = parseMolecularFilters(q);
  const nowIst = istNow();
  const cohort = await loadCohort(f, nowIst);
  const kpis = computeMolecularKpis(cohort, f.slaHours);
  const ids = new Set(cohort.map((t) => t.ticketId));

  // Trend: received by created date; closed by final-closed date; reopens by reopen-event date.
  const days = new Map<string, MolecularTrendRow>();
  const day = (d: string) => {
    let r = days.get(d);
    if (!r) { r = { date: d, received: 0, closed: 0, reopenedTickets: 0, reopenEvents: 0 }; days.set(d, r); }
    return r;
  };
  for (let d = f.from; d <= f.to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) day(d);
  for (const t of cohort) {
    if (t.createdAt) day(t.createdAt.slice(0, 10)).received++;
    if (t.isClosed && t.finalClosedAt) {
      const d = t.finalClosedAt.slice(0, 10);
      if (d >= f.from && d <= f.to) day(d).closed++;
    }
  }
  const [ev] = ids.size === 0 ? [[] as RowDataPacket[]] : await db.query<RowDataPacket[]>(
    `SELECT ticket_id, DATE(event_at) AS d FROM molecular_email_ticket_reopen_event
      WHERE event_at >= ? AND event_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [f.from, f.to],
  );
  const perDayTickets = new Map<string, Set<string>>();
  for (const r of ev) {
    const id = String(r.ticket_id);
    if (!ids.has(id)) continue;
    const d = String(r.d).slice(0, 10);
    day(d).reopenEvents++;
    perDayTickets.set(d, (perDayTickets.get(d) ?? new Set()).add(id));
  }
  for (const [d, set] of perDayTickets) day(d).reopenedTickets = set.size;

  const cat = new Map<string, { closed: number; reopened: number }>();
  for (const t of cohort) {
    if (!t.isClosed) continue;
    const k = t.category ?? 'N/A';
    const c = cat.get(k) ?? { closed: 0, reopened: 0 };
    c.closed++;
    if (t.isReopened) c.reopened++;
    cat.set(k, c);
  }

  const [meta] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(category) AS cat, COUNT(priority) AS pri, MAX(synced_at) AS synced,
            SUM(closure_basis = 'closed_at') AS byCol, SUM(closure_basis = 'last_agent_reply') AS byReply
       FROM molecular_email_ticket`,
  );
  const m = meta[0] ?? {};

  return {
    filters: f,
    asOf: nowIst,
    kpis,
    trend: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    categoryReopen: [...cat.entries()]
      .map(([category, c]) => ({ category, ...c, reopenPct: c.closed > 0 ? pct(c.reopened, c.closed) : null }))
      .sort((a, b) => b.closed - a.closed),
    oldestPending: cohort
      .filter((t) => !t.isClosed && t.tatHours !== null)
      .sort((a, b) => (b.tatHours ?? 0) - (a.tatHours ?? 0))
      .slice(0, 25),
    fieldAvailability: { category: n(m.cat) > 0, priority: n(m.pri) > 0, reopenReason: false },
    closureBasis: { closed_at: n(m.byCol), last_agent_reply: n(m.byReply) },
    ticketsWithoutCreatedTime: await invalidCreatedCount(),
    lastSyncedAt: s(m.synced),
    hasData: cohort.length > 0,
    feed: await feedStatus(s(m.synced)),
    dailyFallback: cohort.length > 0 ? null : await getEmailTickets('MOLECULAR', { from: f.from, to: f.to }),
  };
}

export interface MolecularTicketList {
  filters: MolecularFilters;
  asOf: string;
  total: number;
  truncated: boolean;
  rows: EnrichedTicket[];
}

export async function getMolecularTicketList(q: Record<string, unknown>): Promise<MolecularTicketList> {
  const f = parseMolecularFilters(q);
  const nowIst = istNow();
  const cohort = await loadCohort(f, nowIst);
  cohort.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { filters: f, asOf: nowIst, total: cohort.length, truncated: cohort.length > TABLE_ROW_LIMIT, rows: cohort.slice(0, TABLE_ROW_LIMIT) };
}

export interface MolecularFilterOptions { agents: string[]; categories: string[]; priorities: string[] }

export async function getMolecularFilterOptions(): Promise<MolecularFilterOptions> {
  const list = async (col: 'agent_name' | 'category' | 'priority') => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT DISTINCT ${col} AS v FROM molecular_email_ticket WHERE ${col} IS NOT NULL AND ${col} <> '' ORDER BY v LIMIT 500`,
    );
    return rows.map((r) => String(r.v));
  };
  return { agents: await list('agent_name'), categories: await list('category'), priorities: await list('priority') };
}

// ── Daily agent performance (MOL-03) ─────────────────────────────────────────

export interface MolecularAgentDayRow {
  date: string;
  agent: string;
  received: number | null;
  closed: number | null;
  pendingAssigned: number | null;
  closurePct: number | null;
  netLoginSec: number | null;
  talkSec: number | null;
  waitSec: number | null;
  pauseSec: number | null;
  utilization: number | null;
  netLogin: string | null;
  /** 'both' | 'tickets_only' (no APR row) | 'apr_only' (no ticket row): never filled in with zeros. */
  dataStatus: 'both' | 'tickets_only' | 'apr_only';
}

export async function getMolecularAgentDaily(q: Record<string, unknown>): Promise<{ filters: MolecularFilters; rows: MolecularAgentDayRow[] }> {
  const f = parseMolecularFilters(q);
  const agentClause = f.agent ? ' AND agent_name = ?' : '';
  const agentParam = f.agent ? [f.agent] : [];
  const [recv] = await db.query<RowDataPacket[]>(
    `SELECT DATE(created_at) AS d, agent_name AS a, COUNT(*) AS c,
            SUM(LOWER(TRIM(COALESCE(status, ''))) NOT IN ('closed', 'resolved', 'solved')) AS p
       FROM molecular_email_ticket
      WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) AND agent_name IS NOT NULL${agentClause}
      GROUP BY DATE(created_at), agent_name`,
    [f.from, f.to, ...agentParam],
  );
  const [clos] = await db.query<RowDataPacket[]>(
    `SELECT DATE(final_closed_at) AS d, agent_name AS a, COUNT(*) AS c
       FROM molecular_email_ticket
      WHERE final_closed_at >= ? AND final_closed_at < DATE_ADD(?, INTERVAL 1 DAY) AND agent_name IS NOT NULL
        AND LOWER(TRIM(COALESCE(status, ''))) IN ('closed', 'resolved', 'solved')${agentClause}
      GROUP BY DATE(final_closed_at), agent_name`,
    [f.from, f.to, ...agentParam],
  );
  const apr = await dialerQuery<RowDataPacket>(
    `SELECT DATE(event_time) AS d, user,
            SUM(wait_sec) AS waitSec, SUM(talk_sec) AS talkSec, SUM(dispo_sec) AS dispoSec, SUM(pause_sec) AS pauseSec
       FROM vicidial_agent_log_10_25
      WHERE event_time >= ? AND event_time < DATE_ADD(?, INTERVAL 1 DAY) AND UPPER(campaign_id) = 'MOEMAIL'
      GROUP BY DATE(event_time), user`,
    [f.from, f.to],
  ).catch(() => [] as RowDataPacket[]);
  const names = await resolveEmployeeNames(apr.map((r) => String(r.user ?? '')));

  const out = new Map<string, MolecularAgentDayRow>();
  const dateKey = (v: unknown) => {
    if (v instanceof Date) {
      const p = (x: number) => String(x).padStart(2, '0');
      return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    return String(v ?? '').slice(0, 10);
  };
  const row = (d: string, agent: string) => {
    const k = `${d}|${nameKey(agent)}`;
    let r = out.get(k);
    if (!r) {
      r = { date: d, agent, received: null, closed: null, pendingAssigned: null, closurePct: null, netLoginSec: null, talkSec: null, waitSec: null, pauseSec: null, utilization: null, netLogin: null, dataStatus: 'tickets_only' };
      out.set(k, r);
    }
    return r;
  };
  for (const r of recv) {
    const x = row(dateKey(r.d), String(r.a));
    x.received = n(r.c);
    x.pendingAssigned = n(r.p);
  }
  for (const r of clos) row(dateKey(r.d), String(r.a)).closed = n(r.c);
  for (const r of out.values()) {
    r.received ??= 0;
    r.closed ??= 0;
    r.pendingAssigned ??= 0;
  }
  for (const r of apr) {
    const name = names.get(codeKey(r.user)) ?? String(r.user ?? '');
    if (f.agent && nameKey(name) !== nameKey(f.agent)) continue;
    const k = `${dateKey(r.d)}|${nameKey(name)}`;
    const had = out.has(k);
    const x = row(dateKey(r.d), name);
    const wait = n(r.waitSec), talk = n(r.talkSec), dispo = n(r.dispoSec), pause = n(r.pauseSec);
    const login = wait + talk + dispo + pause;
    x.netLoginSec = Math.round(login);
    x.talkSec = Math.round(talk);
    x.waitSec = Math.round(wait);
    x.pauseSec = Math.round(pause);
    x.netLogin = fmtDuration(login);
    x.utilization = login > 0 ? pct(wait + talk, login) : null;
    x.dataStatus = had ? 'both' : 'apr_only';
  }
  for (const r of out.values()) {
    if (r.dataStatus !== 'apr_only') r.closurePct = r.received && r.received > 0 ? pct(r.closed ?? 0, r.received) : null;
  }
  return {
    filters: f,
    rows: [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.agent.localeCompare(b.agent)),
  };
}
