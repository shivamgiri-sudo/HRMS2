/**
 * Email Ticket daily actuals — reads from mas_hrms.email_ticket_daily_actual.
 * Data is uploaded via Bulk Upload Hub → EMAIL_TICKET_DAILY.
 *
 * Covers both Molecular Email (dashboard_label='MOLECULAR') and
 * Reginald Men Email (dashboard_label='REGINALD_MEN').
 *
 * Matches exactly the GAS dashboard daily table columns:
 *   Date, Total Tickets, Email Closure, Open/Pending, Reopen, Opening Pending
 *   + Closure % = email_closed / (opening_pending + total_tickets + email_reopen)
 *
 * byAnalyst reads from email_ticket_analyst_daily_actual (migration 1806),
 * populated by molecular-email-sync.service.ts's live sync from the real
 * upstream ticketing DB — no opening_pending/closure% at analyst grain (see
 * that migration's own comment for why it isn't decomposed per analyst).
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { n, pct, round, parseRange } from './dialler-utils.js';

export type EmailDashboard = 'MOLECULAR' | 'REGINALD_MEN';

export interface EmailTicketRow {
  date: string;
  totalTickets: number;
  emailClosed: number;
  openPending: number;
  emailReopen: number;
  openingPending: number | null;
  closurePct: number;
}

export interface EmailTicketAnalystRow {
  analyst: string;
  ticketsReceived: number;
  ticketsClosed: number;
  ticketsReopened: number;
  ticketsOpenPending: number;
}

export interface EmailTicketSummary {
  dashboard: EmailDashboard;
  from: string;
  to: string;
  totalTickets: number;
  emailClosed: number;
  openPending: number;
  emailReopen: number;
  avgClosurePct: number;
  daily: EmailTicketRow[];
  byAnalyst: EmailTicketAnalystRow[];
  hasData: boolean;
}

export async function getEmailTickets(
  dashboard: EmailDashboard,
  rawFilters: { from?: string; to?: string },
): Promise<EmailTicketSummary> {
  const { from, to } = parseRange(rawFilters);

  const [rows] = await db.execute<RowDataPacket[]>(`
    SELECT
      report_date                   AS date,
      total_tickets                 AS totalTickets,
      email_closed                  AS emailClosed,
      open_pending                  AS openPending,
      email_reopen                  AS emailReopen,
      opening_pending               AS openingPending
    FROM email_ticket_daily_actual
    WHERE dashboard_label = ?
      AND report_date >= ? AND report_date <= ?
    ORDER BY report_date
  `, [dashboard, from, to]);

  const daily: EmailTicketRow[] = rows.map(r => {
    const total = n(r.totalTickets);
    const closed = n(r.emailClosed);
    const opening = r.openingPending != null ? n(r.openingPending) : null;
    const reopen = n(r.emailReopen);
    // GAS closure% = closed / (opening_pending + received + reopen)
    const denominator = (opening ?? 0) + total + reopen;
    const closurePct = denominator > 0 ? round(closed * 100 / denominator, 2) : 0;
    return {
      date: String(r.date ?? ''),
      totalTickets: total,
      emailClosed: closed,
      openPending: n(r.openPending),
      emailReopen: reopen,
      openingPending: opening,
      closurePct,
    };
  });

  const totals = daily.reduce(
    (acc, d) => ({
      totalTickets: acc.totalTickets + d.totalTickets,
      emailClosed: acc.emailClosed + d.emailClosed,
      openPending: d.openPending, // latest day's pending
      emailReopen: acc.emailReopen + d.emailReopen,
    }),
    { totalTickets: 0, emailClosed: 0, openPending: 0, emailReopen: 0 },
  );

  const avgClosurePct = daily.length > 0
    ? round(daily.reduce((s, d) => s + d.closurePct, 0) / daily.length, 2)
    : 0;

  const [analystRows] = await db.execute<RowDataPacket[]>(`
    SELECT
      analyst_name                  AS analyst,
      SUM(tickets_received)         AS ticketsReceived,
      SUM(tickets_closed)           AS ticketsClosed,
      SUM(tickets_reopened)         AS ticketsReopened,
      tickets_open_pending          AS ticketsOpenPending,
      report_date                   AS reportDate
    FROM email_ticket_analyst_daily_actual
    WHERE dashboard_label = ?
      AND report_date >= ? AND report_date <= ?
    GROUP BY analyst_user_id, analyst_name, tickets_open_pending, report_date
    ORDER BY report_date DESC
  `, [dashboard, from, to]);

  // tickets_open_pending is a same-day snapshot (see molecular-email-sync.service.ts), so it
  // cannot be summed across days like the other three counters — only the latest day per
  // analyst is meaningful, same convention the day-wise "Open/Pending" total already uses.
  const byAnalystMap = new Map<string, EmailTicketAnalystRow>();
  for (const r of analystRows) {
    const name = String(r.analyst ?? '');
    const existing = byAnalystMap.get(name);
    if (existing) {
      existing.ticketsReceived += n(r.ticketsReceived);
      existing.ticketsClosed += n(r.ticketsClosed);
      existing.ticketsReopened += n(r.ticketsReopened);
    } else {
      byAnalystMap.set(name, {
        analyst: name,
        ticketsReceived: n(r.ticketsReceived),
        ticketsClosed: n(r.ticketsClosed),
        ticketsReopened: n(r.ticketsReopened),
        ticketsOpenPending: n(r.ticketsOpenPending), // first row seen = latest date, ORDER BY report_date DESC
      });
    }
  }
  const byAnalyst = Array.from(byAnalystMap.values()).sort((a, b) => b.ticketsReceived - a.ticketsReceived);

  return {
    dashboard,
    from,
    to,
    ...totals,
    avgClosurePct,
    daily,
    byAnalyst,
    hasData: daily.length > 0,
  };
}
