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

  return {
    dashboard,
    from,
    to,
    ...totals,
    avgClosurePct,
    daily,
    hasData: daily.length > 0,
  };
}
