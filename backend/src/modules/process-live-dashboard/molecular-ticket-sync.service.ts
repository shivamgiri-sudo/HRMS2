/**
 * Per-ticket sync for the Molecular Email Dashboard (MOL-02..MOL-06).
 *
 * Reads molecular_db_email READ-ONLY (same pool and sources as
 * molecular-email-sync.service.ts) and upserts one molecular_email_ticket row
 * per source ticket (sql/migrations/2180) plus its reopen events (2181).
 *
 * Source schema used (confirmed in molecular-email-sync.service.ts / sql/1806):
 *   tickets(id, created_at, status, assigned_to), users(id, name),
 *   ticket_events(ticket_id, created_at) — every row is a Closed->Open reopen,
 *   ticket_messages(sent_at, direction, from_email, created_by).
 * Probed at run time from information_schema (never assumed):
 *   ticket_messages.ticket_id — needed to tie an agent reply to its ticket;
 *     without it no closure time can be derived (rows get dq 'closed_no_timestamp').
 *   tickets.<priority>, tickets.<category|queue|department|type>,
 *   tickets.<closed_at|resolved_at>, tickets.updated_at — used when present,
 *     otherwise stored NULL and shown as N/A.
 * The source logs no close event, so without a closed column the final closure
 * time is the agent's last qualifying outbound reply (the same signal the source
 * dashboard counts as "Email Closure"); first closure is the last reply before
 * the first reopen. See molecular-email-kpi.ts deriveTicketLifecycle.
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getMolecularEmailPool } from '../../db/molecularEmailDb.js';
import { EMAIL_DASHBOARD_SOURCES } from './molecular-email-sync.service.js';
import { deriveTicketLifecycle, istNow, istToday, parseWallClock, type DerivedTicket } from './molecular-email-kpi.js';

const DATABASE = 'molecular_db_email' as const;
const CHUNK = 500;

const PRIORITY_CANDIDATES = ['priority', 'ticket_priority'];
const CATEGORY_CANDIDATES = ['category', 'queue', 'department', 'ticket_type', 'type', 'tag'];
const CLOSED_CANDIDATES = ['closed_at', 'resolved_at', 'closed_on'];

export interface SourceColumns {
  priority: string | null;
  category: string | null;
  closedAt: string | null;
  updatedAt: string | null;
  messageTicketId: boolean;
}

function excludedSender(): string {
  const src = EMAIL_DASHBOARD_SOURCES.find((s) => s.database === DATABASE);
  return `%${(src?.excludedSenderLike ?? 'info@molecularcompany.com').toLowerCase()}%`;
}

/** Picks optional columns from a whitelist (identifiers are never taken from data). */
export function pickColumns(cols: { table: string; column: string }[]): SourceColumns {
  const has = (table: string, c: string) => cols.some((x) => x.table === table && x.column.toLowerCase() === c);
  const first = (table: string, list: string[]) => list.find((c) => has(table, c)) ?? null;
  return {
    priority: first('tickets', PRIORITY_CANDIDATES),
    category: first('tickets', CATEGORY_CANDIDATES),
    closedAt: first('tickets', CLOSED_CANDIDATES),
    updatedAt: has('tickets', 'updated_at') ? 'updated_at' : null,
    messageTicketId: has('ticket_messages', 'ticket_id'),
  };
}

async function probeColumns(): Promise<SourceColumns> {
  const pool = await getMolecularEmailPool(DATABASE);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tickets', 'ticket_messages', 'ticket_events')`,
  );
  return pickColumns(rows.map((r) => ({ table: String(r.t), column: String(r.c) })));
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

async function readChunk(ids: string[], cols: SourceColumns, nowIst: string): Promise<{ rows: DerivedTicket[]; events: Map<string, string[]>; agentIds: Map<string, string | null> }> {
  const pool = await getMolecularEmailPool(DATABASE);
  const extra = [
    cols.priority ? `t.\`${cols.priority}\` AS priority` : 'NULL AS priority',
    cols.category ? `t.\`${cols.category}\` AS category` : 'NULL AS category',
    cols.closedAt ? `t.\`${cols.closedAt}\` AS closedAt` : 'NULL AS closedAt',
  ].join(', ');
  const [tickets] = await pool.query<RowDataPacket[]>(
    `SELECT t.id, t.created_at AS createdAt, t.status, t.assigned_to AS agentId, u.name AS agentName, ${extra}
       FROM tickets t LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.id IN (?)`,
    [ids],
  );
  const [evRows] = await pool.query<RowDataPacket[]>(
    'SELECT ticket_id AS tid, created_at AS at FROM ticket_events WHERE ticket_id IN (?) ORDER BY created_at',
    [ids],
  );
  const events = new Map<string, string[]>();
  for (const r of evRows) {
    const k = String(r.tid);
    const at = str(r.at);
    if (!at || parseWallClock(at) === null) continue;
    events.set(k, [...(events.get(k) ?? []), at]);
  }
  const replies = new Map<string, string[]>();
  if (cols.messageTicketId) {
    const [msgRows] = await pool.query<RowDataPacket[]>(
      `SELECT ticket_id AS tid, sent_at AS at FROM ticket_messages
        WHERE ticket_id IN (?)
          AND LOWER(TRIM(direction)) LIKE '%outbound%'
          AND from_email IS NOT NULL AND TRIM(from_email) <> ''
          AND LOWER(TRIM(from_email)) NOT LIKE ?`,
      [ids, excludedSender()],
    );
    for (const r of msgRows) {
      const k = String(r.tid);
      const at = str(r.at);
      if (!at) continue;
      replies.set(k, [...(replies.get(k) ?? []), at]);
    }
  }
  const agentIds = new Map<string, string | null>();
  const rows = tickets.map((t) => {
    const id = String(t.id);
    agentIds.set(id, str(t.agentId));
    return deriveTicketLifecycle(
      { id, createdAt: str(t.createdAt), status: str(t.status), agentName: str(t.agentName), category: str(t.category), priority: str(t.priority), closedAtColumn: str(t.closedAt) },
      events.get(id) ?? [],
      replies.get(id) ?? [],
      nowIst,
    );
  });
  return { rows, events, agentIds };
}

/** A DATETIME column only takes a readable value; anything else is stored NULL (raw kept for audit). */
const dt = (v: string | null, ok: boolean) => (ok ? v : null);

async function writeChunk(rows: DerivedTicket[], events: Map<string, string[]>, agentIds: Map<string, string | null>): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((r) => {
    const createdOk = r.dqFlag !== 'missing_created' && r.dqFlag !== 'invalid_created';
    return [
      r.ticketId, dt(r.createdAt, createdOk), agentIds.get(r.ticketId) ?? null, r.agentName, r.category, r.priority, r.status,
      r.firstClosedAt, r.finalClosedAt, r.reopenCount, r.firstReopenedAt, r.lastReopenedAt, r.closureBasis, r.dqFlag,
      r.createdAt === null ? null : String(r.createdAt).slice(0, 40),
    ];
  });
  await db.query(
    `INSERT INTO molecular_email_ticket
       (ticket_id, created_at, agent_user_id, agent_name, category, priority, status,
        first_closed_at, final_closed_at, reopen_count, first_reopened_at, last_reopened_at,
        closure_basis, dq_flag, raw_created_at)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       created_at = VALUES(created_at), agent_user_id = VALUES(agent_user_id), agent_name = VALUES(agent_name),
       category = VALUES(category), priority = VALUES(priority), status = VALUES(status),
       first_closed_at = VALUES(first_closed_at), final_closed_at = VALUES(final_closed_at),
       reopen_count = VALUES(reopen_count), first_reopened_at = VALUES(first_reopened_at),
       last_reopened_at = VALUES(last_reopened_at), closure_basis = VALUES(closure_basis),
       dq_flag = VALUES(dq_flag), raw_created_at = VALUES(raw_created_at)`,
    [values],
  );
  const ids = rows.map((r) => r.ticketId);
  await db.query('DELETE FROM molecular_email_ticket_reopen_event WHERE ticket_id IN (?)', [ids]);
  const ev: (string | number)[][] = [];
  for (const id of ids) (events.get(id) ?? []).forEach((at, i) => ev.push([id, i + 1, at]));
  if (ev.length > 0) {
    await db.query('INSERT INTO molecular_email_ticket_reopen_event (ticket_id, seq, event_at) VALUES ?', [ev]);
  }
}

export interface TicketSyncResult { mode: 'recent' | 'backfill'; tickets: number; columns: SourceColumns }

async function syncIds(ids: string[], cols: SourceColumns): Promise<number> {
  const nowIst = istNow();
  let n = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const { rows, events, agentIds } = await readChunk(part, cols, nowIst);
    await writeChunk(rows, events, agentIds);
    n += rows.length;
  }
  return n;
}

/**
 * Re-reads every ticket that could have changed: created, reopened, replied to
 * or updated in the last `daysBack` days, plus every ticket not yet closed
 * (its status/age moves on without any new event).
 */
export async function syncRecentMolecularTickets(daysBack = 3): Promise<TicketSyncResult> {
  const cols = await probeColumns();
  const pool = await getMolecularEmailPool(DATABASE);
  const since = `${new Date(Date.parse(`${istToday()}T00:00:00Z`) - daysBack * 86_400_000).toISOString().slice(0, 10)} 00:00:00`;
  const parts = [
    'SELECT id FROM tickets WHERE created_at >= ?',
    "SELECT id FROM tickets WHERE LOWER(TRIM(COALESCE(status, ''))) NOT IN ('closed', 'resolved', 'solved')",
    'SELECT ticket_id AS id FROM ticket_events WHERE created_at >= ?',
  ];
  const params: string[] = [since, since];
  if (cols.updatedAt) { parts.push('SELECT id FROM tickets WHERE updated_at >= ?'); params.push(since); }
  if (cols.messageTicketId) { parts.push('SELECT ticket_id AS id FROM ticket_messages WHERE sent_at >= ?'); params.push(since); }
  const [rows] = await pool.query<RowDataPacket[]>(parts.join(' UNION '), params);
  const ids = [...new Set(rows.map((r) => String(r.id)).filter((x) => x && x !== 'null'))];
  return { mode: 'recent', tickets: await syncIds(ids, cols), columns: cols };
}

/** Full history, in id pages. */
export async function backfillMolecularTickets(): Promise<TicketSyncResult> {
  const cols = await probeColumns();
  const pool = await getMolecularEmailPool(DATABASE);
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM tickets ORDER BY id');
  const ids = rows.map((r) => String(r.id));
  return { mode: 'backfill', tickets: await syncIds(ids, cols), columns: cols };
}

/** Worker entry: backfill once when the table is empty, then incremental. */
export async function syncMolecularTickets(): Promise<TicketSyncResult> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT 1 AS x FROM molecular_email_ticket LIMIT 1');
  return rows.length === 0 ? backfillMolecularTickets() : syncRecentMolecularTickets(3);
}
