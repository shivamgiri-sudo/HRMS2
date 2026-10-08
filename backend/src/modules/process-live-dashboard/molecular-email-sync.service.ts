/**
 * Live sync for the Molecular Email / Reginald Men Email dashboards.
 *
 * The upload_template_master row for EMAIL_TICKET_DAILY (and the migration
 * that created it) claimed the underlying ticketing DB "does not exist
 * anywhere in this project's infrastructure" — that was wrong. It lives at
 * 122.184.128.89 (one digit off from the dialer_db/masmis host .90, which is
 * why the 2026-09-09 audit missed it): two databases, "db_email" (Reginald)
 * and "molecular_db_email" (Molecular), each with tickets/ticket_events/
 * ticket_messages/users, actively receiving new tickets every day.
 *
 * This reproduces the exact formulas from the real production dashboard
 * source (the Google Apps Script behind both Google Sheets dashboards,
 * "Reginald Dashboard.docx" / "Molecular Dashboard.docx", function
 * getDashboardMetricsOneShot_), not a re-derivation from the raw schema:
 *
 *   - Total Tickets: COUNT(tickets) by DATE(created_at). No channel filter —
 *     the source script never filters by `channel` even though the column
 *     exists, so this dashboard counts every row in these DBs, not just
 *     channel='email'.
 *   - Email Closure: COUNT(ticket_messages) by DATE(created_at) WHERE
 *     direction is outbound AND from_email is a real, non-excluded sender.
 *     There is no closed_at/status-change-to-Closed event anywhere in this
 *     schema (confirmed live: ticket_events only ever logs Closed→Open) —
 *     closure is inferred entirely from an agent's outbound reply.
 *   - Email Reopen: COUNT(ticket_events) by DATE(created_at). No old/new
 *     value filter needed — every row already is a Closed→Open transition.
 *   - Open/Pending (per day): COUNT(tickets) received that day still at
 *     status='open' as of now. The source script's whitelist
 *     (open/opened/new/in progress variants) does not include "pending" —
 *     replicated as-is for parity with the numbers this business already
 *     reviews, even though our schema also has a distinct 'Pending' status.
 *   - Opening Pending (per day): the source script computes this as a single
 *     number for its selected report range — tickets created before the
 *     range start that are not currently closed. Generalised here to a daily
 *     series: opening_pending(day) = count of tickets created before `day`
 *     whose CURRENT status is not 'Closed'. Like the source script, this
 *     reflects status at sync time, not at historical report time — a
 *     ticket reopened today shifts every future day's opening balance,
 *     exactly as it would if the Google Sheet were reloaded today.
 *
 * One deviation from the literal source: the Molecular Apps Script excludes
 * "info@reginaldmen.com" from Email Closure — copy-pasted from the Reginald
 * script and never updated. Molecular's real system auto-sender is
 * "info@molecularcompany.com" (confirmed live: 54,704 outbound messages),
 * so the literal script's exclusion is a no-op for Molecular and inflates
 * its Email Closure count with every auto-generated message. Fixed here to
 * exclude Molecular's actual sender instead of reproducing that bug.
 *
 * Per-analyst breakdown (email_ticket_analyst_daily_actual, migration 1806):
 * same four counters as the day-wise table, grouped by the real owning
 * analyst instead of collapsed across everyone. Received/Open-Pending group
 * by tickets.assigned_to (who currently owns the ticket); Closed groups by
 * ticket_messages.created_by (who actually sent the closing reply — more
 * accurate than the ticket's current owner, since a ticket can change hands).
 * Reopen has no actor column anywhere in this schema (ticket_events only
 * logs old_value/new_value, never who triggered it), so it is attributed to
 * the ticket's CURRENT assigned_to, same "no per-person meaning, best
 * available dimension" tradeoff the day-wise Reopen count already accepts.
 * opening_pending is intentionally not decomposed per analyst — see 1806.
 */

import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { getMolecularEmailPool, type EmailTicketSource } from "../../db/molecularEmailDb.js";

export const LIVE_SYNC_SOURCE_REFERENCE = "live_sync";

export type EmailDashboardLabel = "MOLECULAR" | "REGINALD_MEN";

interface DashboardSource {
  dashboardLabel: EmailDashboardLabel;
  database: EmailTicketSource;
  /** Substring match (case-insensitive) excluded from Email Closure's outbound sender. */
  excludedSenderLike: string;
}

export const EMAIL_DASHBOARD_SOURCES: DashboardSource[] = [
  { dashboardLabel: "REGINALD_MEN", database: "db_email", excludedSenderLike: "info@reginaldmen.com" },
  { dashboardLabel: "MOLECULAR", database: "molecular_db_email", excludedSenderLike: "info@molecularcompany.com" },
];

interface DayCounts {
  created: number;
  closed: number;
  reopened: number;
  openStatus: number;
}

async function fetchProcessId(): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM process_master WHERE process_name = 'Reginald' AND active_status = 1 LIMIT 1",
  );
  return rows[0]?.id ?? null;
}

/** Full-history per-day (total, not-closed) — cheap enough to always scan in full; feeds the opening-balance prefix sum. */
async function fetchTicketDayTotals(
  database: EmailTicketSource,
): Promise<Map<string, { total: number; notClosed: number }>> {
  const pool = await getMolecularEmailPool(database);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE(created_at) AS d, COUNT(*) AS total,
            SUM(CASE WHEN LOWER(status) <> 'closed' THEN 1 ELSE 0 END) AS notClosed
       FROM tickets
      GROUP BY DATE(created_at)
      ORDER BY d`,
  );
  const m = new Map<string, { total: number; notClosed: number }>();
  for (const r of rows) m.set(String(r.d), { total: Number(r.total) || 0, notClosed: Number(r.notClosed) || 0 });
  return m;
}

async function fetchDayCounts(
  source: DashboardSource,
  fromDate: string,
  toDate: string,
): Promise<Map<string, DayCounts>> {
  const pool = await getMolecularEmailPool(source.database);
  const counts = new Map<string, DayCounts>();
  const ensure = (d: string): DayCounts => {
    let c = counts.get(d);
    if (!c) {
      c = { created: 0, closed: 0, reopened: 0, openStatus: 0 };
      counts.set(d, c);
    }
    return c;
  };

  const [created] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE(created_at) AS d, COUNT(*) AS c
       FROM tickets
      WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY DATE(created_at)`,
    [fromDate, toDate],
  );
  for (const r of created) ensure(String(r.d)).created = Number(r.c) || 0;

  const [openStatus] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE(created_at) AS d, COUNT(*) AS c
       FROM tickets
      WHERE LOWER(status) = 'open' AND DATE(created_at) BETWEEN ? AND ?
      GROUP BY DATE(created_at)`,
    [fromDate, toDate],
  );
  for (const r of openStatus) ensure(String(r.d)).openStatus = Number(r.c) || 0;

  const [reopened] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE(created_at) AS d, COUNT(*) AS c
       FROM ticket_events
      WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY DATE(created_at)`,
    [fromDate, toDate],
  );
  for (const r of reopened) ensure(String(r.d)).reopened = Number(r.c) || 0;

  const [closed] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE(sent_at) AS d, COUNT(*) AS c
       FROM ticket_messages
      WHERE DATE(sent_at) BETWEEN ? AND ?
        AND LOWER(TRIM(direction)) LIKE '%outbound%'
        AND from_email IS NOT NULL AND TRIM(from_email) <> ''
        AND LOWER(TRIM(from_email)) NOT LIKE ?
      GROUP BY DATE(sent_at)`,
    [fromDate, toDate, `%${source.excludedSenderLike.toLowerCase()}%`],
  );
  for (const r of closed) ensure(String(r.d)).closed = Number(r.c) || 0;

  return counts;
}

interface AnalystDayCounts {
  analystName: string;
  received: number;
  closed: number;
  reopened: number;
  openPending: number;
}

/** Same four counters as fetchDayCounts, grouped by analyst too (see doc-comment above). */
async function fetchAnalystDayCounts(
  source: DashboardSource,
  fromDate: string,
  toDate: string,
): Promise<Map<string, AnalystDayCounts>> {
  const pool = await getMolecularEmailPool(source.database);
  const counts = new Map<string, AnalystDayCounts>();
  const ensure = (day: string, userId: number, name: string): AnalystDayCounts => {
    const key = `${day}|${userId}`;
    let c = counts.get(key);
    if (!c) {
      c = { analystName: name, received: 0, closed: 0, reopened: 0, openPending: 0 };
      counts.set(key, c);
    }
    return c;
  };

  const [received] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE(t.created_at) AS d, t.assigned_to AS uid, u.name AS uname, COUNT(*) AS c
       FROM tickets t
       JOIN users u ON u.id = t.assigned_to
      WHERE DATE(t.created_at) BETWEEN ? AND ?
      GROUP BY DATE(t.created_at), t.assigned_to, u.name`,
    [fromDate, toDate],
  );
  for (const r of received) ensure(String(r.d), Number(r.uid), String(r.uname)).received = Number(r.c) || 0;

  const [openPending] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE(t.created_at) AS d, t.assigned_to AS uid, u.name AS uname, COUNT(*) AS c
       FROM tickets t
       JOIN users u ON u.id = t.assigned_to
      WHERE LOWER(t.status) = 'open' AND DATE(t.created_at) BETWEEN ? AND ?
      GROUP BY DATE(t.created_at), t.assigned_to, u.name`,
    [fromDate, toDate],
  );
  for (const r of openPending) ensure(String(r.d), Number(r.uid), String(r.uname)).openPending = Number(r.c) || 0;

  const [reopened] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE(e.created_at) AS d, t.assigned_to AS uid, u.name AS uname, COUNT(*) AS c
       FROM ticket_events e
       JOIN tickets t ON t.id = e.ticket_id
       JOIN users u ON u.id = t.assigned_to
      WHERE DATE(e.created_at) BETWEEN ? AND ?
      GROUP BY DATE(e.created_at), t.assigned_to, u.name`,
    [fromDate, toDate],
  );
  for (const r of reopened) ensure(String(r.d), Number(r.uid), String(r.uname)).reopened = Number(r.c) || 0;

  const [closed] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE(m.sent_at) AS d, m.created_by AS uid, u.name AS uname, COUNT(*) AS c
       FROM ticket_messages m
       JOIN users u ON u.id = m.created_by
      WHERE DATE(m.sent_at) BETWEEN ? AND ?
        AND LOWER(TRIM(m.direction)) LIKE '%outbound%'
        AND m.from_email IS NOT NULL AND TRIM(m.from_email) <> ''
        AND LOWER(TRIM(m.from_email)) NOT LIKE ?
      GROUP BY DATE(m.sent_at), m.created_by, u.name`,
    [fromDate, toDate, `%${source.excludedSenderLike.toLowerCase()}%`],
  );
  for (const r of closed) ensure(String(r.d), Number(r.uid), String(r.uname)).closed = Number(r.c) || 0;

  return counts;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface SyncResult {
  dashboardLabel: EmailDashboardLabel;
  daysUpserted: number;
}

/** Syncs one dashboard for the inclusive date range [fromDate, toDate]. */
export async function syncEmailDashboard(
  source: DashboardSource,
  fromDate: string,
  toDate: string,
): Promise<SyncResult> {
  const processId = await fetchProcessId();
  if (!processId) {
    throw new Error('No active "Reginald" process found to attach email ticket rows to');
  }

  const [dayTotals, counts, analystCounts] = await Promise.all([
    fetchTicketDayTotals(source.database),
    fetchDayCounts(source, fromDate, toDate),
    fetchAnalystDayCounts(source, fromDate, toDate),
  ]);

  // Prefix sum of not-closed tickets created strictly before each day, over
  // the FULL history (not just the sync window) — opening_pending(day) needs
  // every earlier day's backlog, even on an incremental (last-2-days) sync.
  // Walked over every calendar day (not just days with ticket activity) so a
  // gap day correctly carries forward the prior day's backlog unchanged.
  const knownDays = Array.from(dayTotals.keys()).sort();
  const openingBeforeDay = new Map<string, number>();
  if (knownDays.length > 0) {
    let running = 0;
    let cursor = knownDays[0];
    while (cursor <= toDate) {
      openingBeforeDay.set(cursor, running);
      running += dayTotals.get(cursor)?.notClosed ?? 0;
      cursor = addDays(cursor, 1);
    }
  }

  let d = fromDate;
  let daysUpserted = 0;
  while (d <= toDate) {
    const c = counts.get(d) ?? { created: 0, closed: 0, reopened: 0, openStatus: 0 };
    const opening = openingBeforeDay.get(d) ?? 0;

    await db.execute(
      `INSERT INTO email_ticket_daily_actual
         (id, process_id, dashboard_label, report_date, total_tickets, email_closed,
          open_pending, email_reopen, opening_pending, data_source, source_reference, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live_sync', ?, NULL)
       ON DUPLICATE KEY UPDATE
          total_tickets = VALUES(total_tickets),
          email_closed = VALUES(email_closed),
          open_pending = VALUES(open_pending),
          email_reopen = VALUES(email_reopen),
          opening_pending = VALUES(opening_pending)`,
      [
        randomUUID(), processId, source.dashboardLabel, d,
        c.created, c.closed, c.openStatus, c.reopened, opening,
        LIVE_SYNC_SOURCE_REFERENCE,
      ],
    );
    daysUpserted++;
    d = addDays(d, 1);
  }

  for (const [key, a] of analystCounts) {
    const [day, uidStr] = key.split("|");
    if (day < fromDate || day > toDate) continue;
    await db.execute(
      `INSERT INTO email_ticket_analyst_daily_actual
         (id, process_id, dashboard_label, report_date, analyst_user_id, analyst_name,
          tickets_received, tickets_closed, tickets_reopened, tickets_open_pending,
          data_source, source_reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live_sync', ?)
       ON DUPLICATE KEY UPDATE
          analyst_name          = VALUES(analyst_name),
          tickets_received      = VALUES(tickets_received),
          tickets_closed        = VALUES(tickets_closed),
          tickets_reopened      = VALUES(tickets_reopened),
          tickets_open_pending  = VALUES(tickets_open_pending)`,
      [
        randomUUID(), processId, source.dashboardLabel, day, Number(uidStr), a.analystName,
        a.received, a.closed, a.reopened, a.openPending,
        LIVE_SYNC_SOURCE_REFERENCE,
      ],
    );
  }

  return { dashboardLabel: source.dashboardLabel, daysUpserted };
}

/** Syncs the last `daysBack` days (plus today) for both dashboards — used by the recurring worker. */
export async function syncRecentEmailTickets(daysBack = 2): Promise<SyncResult[]> {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = addDays(today, -daysBack);
  const results: SyncResult[] = [];
  for (const source of EMAIL_DASHBOARD_SOURCES) {
    results.push(await syncEmailDashboard(source, fromDate, today));
  }
  return results;
}

/** Full historical backfill for one dashboard, starting from the earliest ticket in the source DB. */
export async function backfillEmailDashboard(source: DashboardSource): Promise<SyncResult> {
  const pool = await getMolecularEmailPool(source.database);
  const [range] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE(MIN(created_at)) AS mn FROM tickets`,
  );
  const earliest = range[0]?.mn as string | undefined;
  if (!earliest) return { dashboardLabel: source.dashboardLabel, daysUpserted: 0 };
  const today = new Date().toISOString().slice(0, 10);
  return syncEmailDashboard(source, earliest, today);
}
