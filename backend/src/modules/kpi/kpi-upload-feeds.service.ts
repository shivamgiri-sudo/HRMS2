/**
 * Upload feeds: turns per-agent upload tables (SBI Card agent MIS, Bellavita chat, Clovia email) into employee-grain
 * rows in kpi_daily_actual, so the KPI live performance page shows real numbers for them.
 *
 * Each feed reads one source for one date, resolves the agent code to an employee, and upserts one fact per metric. The row
 * -> fact builders are pure and unit tested. Facts carry an explicit process_id_at_event (the process the work belongs to),
 * because some of these processes have no employees assigned to them in employees.process_id.
 *
 * Never writes a fact the source did not support: an agent with no tickets / no assigned mail produces no row, not a zero.
 */
import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { getPoolForKey } from "../external-db/external-db.service.js";

export type FeedFact = {
  employeeCode: string;
  metricCode: string;
  date: string;
  value: number;
  numerator?: number | null;
  denominator?: number | null;
  sourceRecordCount?: number | null;
};

export type FeedResult = { feed: string; date: string; rows: number; facts: number; written: number; unmapped: number; error?: string };

const num = (v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const code = (v: unknown) => String(v ?? "").trim().toUpperCase();

// ── pure builders ─────────────────────────────────────────────────────────────────────────────

export function sbiFacts(row: Record<string, unknown>, date: string): FeedFact[] {
  const c = code(row.employee_id);
  if (!c) return [];
  const calls = num(row.calls), contacts = num(row.contacts);
  const out: FeedFact[] = [];
  if (row.calls != null) out.push({ employeeCode: c, metricCode: "COLLECTION_CALLS", date, value: calls, sourceRecordCount: 1 });
  if (row.contacts != null) out.push({ employeeCode: c, metricCode: "COLLECTION_CONTACTS", date, value: contacts, sourceRecordCount: 1 });
  if (calls > 0 && row.contacts != null) out.push({ employeeCode: c, metricCode: "COLLECTION_CONTACT_RATE", date, value: r2((contacts / calls) * 100), numerator: contacts, denominator: calls, sourceRecordCount: 1 });
  if (row.ptp != null) out.push({ employeeCode: c, metricCode: "COLLECTION_PTP", date, value: num(row.ptp), sourceRecordCount: 1 });
  if (row.pad != null) out.push({ employeeCode: c, metricCode: "COLLECTION_PAD", date, value: num(row.pad), sourceRecordCount: 1 });
  if (row.amt_collected != null) out.push({ employeeCode: c, metricCode: "COLLECTION_AMOUNT", date, value: r2(num(row.amt_collected)), sourceRecordCount: 1 });
  return out;
}

export function bbChatFacts(row: Record<string, unknown>, date: string): FeedFact[] {
  const c = code(row.emp_id);
  const tickets = num(row.tickets);
  if (!c || tickets <= 0) return [];
  const out: FeedFact[] = [
    { employeeCode: c, metricCode: "CHAT_TICKETS", date, value: tickets, sourceRecordCount: tickets },
    { employeeCode: c, metricCode: "CHAT_RESOLVED_PCT", date, value: r2((num(row.resolved) / tickets) * 100), numerator: num(row.resolved), denominator: tickets, sourceRecordCount: tickets },
  ];
  // frt_1 is a small decimal-minute figure; only report it when the agent had at least one non-null value.
  if (row.avg_frt != null && Number.isFinite(Number(row.avg_frt))) {
    out.push({ employeeCode: c, metricCode: "CHAT_FRT_MIN", date, value: r2(num(row.avg_frt)), sourceRecordCount: tickets });
  }
  return out;
}

export function clEmailFacts(row: Record<string, unknown>, date: string): FeedFact[] {
  const c = code(row.emp_id);
  const assigned = num(row.assigned);
  if (!c || assigned <= 0) return [];
  const closed = num(row.closed);
  return [
    { employeeCode: c, metricCode: "EMAIL_ASSIGNED", date, value: assigned, sourceRecordCount: 1 },
    { employeeCode: c, metricCode: "EMAIL_CLOSURE_PCT", date, value: r2(Math.min(100, (closed / assigned) * 100)), numerator: closed, denominator: assigned, sourceRecordCount: 1 },
  ];
}

export function satyaAllocFacts(row: Record<string, unknown>, date: string): FeedFact[] {
  const c = code(row.emp_id);
  const allocated = num(row.allocated);
  if (!c || allocated <= 0) return [];
  const connected = num(row.connected), orders = num(row.orders);
  const out: FeedFact[] = [
    { employeeCode: c, metricCode: "SATYA_ALLOCATED", date, value: allocated, sourceRecordCount: allocated },
    { employeeCode: c, metricCode: "SATYA_CONNECTED", date, value: connected, sourceRecordCount: allocated },
    { employeeCode: c, metricCode: "SATYA_ORDERS", date, value: orders, sourceRecordCount: allocated },
  ];
  if (connected > 0) out.push({ employeeCode: c, metricCode: "SATYA_CONVERSION_PCT", date, value: r2((orders / connected) * 100), numerator: orders, denominator: connected, sourceRecordCount: allocated });
  return out;
}

export function satyaCallFacts(row: Record<string, unknown>, date: string): FeedFact[] {
  const c = code(row.emp_id);
  const calls = num(row.calls);
  return c && calls > 0 ? [{ employeeCode: c, metricCode: "SATYA_CALLS", date, value: calls, sourceRecordCount: calls }] : [];
}

export function awFacts(row: Record<string, unknown>, date: string): FeedFact[] {
  const c = code(row.emp_id);
  const calls = num(row.calls);
  if (!c || calls <= 0) return [];
  const connected = num(row.connected);
  const out: FeedFact[] = [
    { employeeCode: c, metricCode: "AW_CALLS", date, value: calls, sourceRecordCount: calls },
    { employeeCode: c, metricCode: "AW_CONNECTED", date, value: connected, sourceRecordCount: calls },
    { employeeCode: c, metricCode: "AW_CONNECT_PCT", date, value: r2(Math.min(100, (connected / calls) * 100)), numerator: connected, denominator: calls, sourceRecordCount: calls },
  ];
  if (connected > 0 && num(row.talk_s) > 0) out.push({ employeeCode: c, metricCode: "AW_AVG_TALK_SEC", date, value: r2(num(row.talk_s) / connected), numerator: num(row.talk_s), denominator: connected, sourceRecordCount: calls });
  if (num(row.login_s) > 0) out.push({ employeeCode: c, metricCode: "AW_LOGIN_HOURS", date, value: r2(num(row.login_s) / 3600), sourceRecordCount: calls });
  return out;
}

export function clChatFacts(row: Record<string, unknown>, date: string): FeedFact[] {
  const c = code(row.emp_id);
  const chats = num(row.chats);
  if (!c || chats <= 0) return [];
  const out: FeedFact[] = [{ employeeCode: c, metricCode: "CL_CHATS", date, value: chats, sourceRecordCount: chats }];
  if (row.avg_rating != null && Number.isFinite(Number(row.avg_rating)) && Number(row.avg_rating) > 0) out.push({ employeeCode: c, metricCode: "CL_CHAT_RATING", date, value: r2(num(row.avg_rating)), sourceRecordCount: chats });
  if (row.avg_wait_s != null && Number.isFinite(Number(row.avg_wait_s))) out.push({ employeeCode: c, metricCode: "CL_CHAT_WAIT_SEC", date, value: r2(num(row.avg_wait_s)), sourceRecordCount: chats });
  return out;
}

export function clOutboundFacts(row: Record<string, unknown>, date: string): FeedFact[] {
  const c = code(row.emp_id);
  const dials = num(row.dials);
  if (!c || dials <= 0) return [];
  const connected = num(row.connected);
  const out: FeedFact[] = [
    { employeeCode: c, metricCode: "CL_OB_DIALS", date, value: dials, sourceRecordCount: dials },
    { employeeCode: c, metricCode: "CL_OB_CONNECTED", date, value: connected, sourceRecordCount: dials },
    { employeeCode: c, metricCode: "CL_OB_CONNECT_PCT", date, value: r2(Math.min(100, (connected / dials) * 100)), numerator: connected, denominator: dials, sourceRecordCount: dials },
  ];
  if (connected > 0 && row.avg_talk_s != null && Number.isFinite(Number(row.avg_talk_s))) out.push({ employeeCode: c, metricCode: "CL_OB_AVG_TALK_SEC", date, value: r2(num(row.avg_talk_s)), sourceRecordCount: dials });
  return out;
}

// ── feed definitions ──────────────────────────────────────────────────────────────────────────

type FeedDef = {
  key: string;
  /** process_master.process_code the facts belong to (null = use the source row's process_id). */
  processCode: string | null;
  fetch: (date: string) => Promise<Record<string, unknown>[]>;
  toFacts: (row: Record<string, unknown>, date: string) => FeedFact[];
};

/** SQL: seconds from 'h:mm:ss' text or an Excel day-fraction ('0.0034' = 0.0034 days). NULL when blank. */
const secs = (col: string) =>
  `(CASE WHEN NULLIF(TRIM(${col}), '') IS NULL THEN NULL
         WHEN TRIM(${col}) REGEXP '^[0-9]*[.][0-9]+$' THEN CAST(TRIM(${col}) AS DECIMAL(20,10)) * 86400
         ELSE TIME_TO_SEC(TRIM(${col})) END)`;

async function masmisPool(): Promise<Pool> {
  return (await getPoolForKey("sales_brand_mis")) as Pool;
}

export const FEEDS: FeedDef[] = [
  {
    key: "sbi_card_agent_mis",
    processCode: null,
    fetch: async (date) => {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id, process_id, calls, contacts, ptp, pad, amt_collected FROM sbi_card_agent_mis WHERE report_date = ?`, [date]);
      return rows as Record<string, unknown>[];
    },
    toFacts: sbiFacts,
  },
  {
    key: "bb_chat",
    processCode: "BELLA_VITA",
    fetch: async (date) => {
      const pool = await masmisPool();
      const [rows] = await pool.execute(
        `SELECT UPPER(TRIM(emp_id)) AS emp_id, COUNT(*) AS tickets,
                SUM(CASE WHEN ticket_status IN ('resolved','closed') THEN 1 ELSE 0 END) AS resolved,
                AVG(NULLIF(frt_1, '') + 0) AS avg_frt
           FROM db_masmis.bb_chat
          WHERE chat_date >= ? AND chat_date < DATE_ADD(?, INTERVAL 1 DAY) AND emp_id IS NOT NULL AND TRIM(emp_id) <> ''
          GROUP BY UPPER(TRIM(emp_id))`, [date, date]);
      return rows as Record<string, unknown>[];
    },
    toFacts: bbChatFacts,
  },
  {
    key: "cl_email_raw",
    processCode: "CLOVIA",
    fetch: async (date) => {
      const pool = await masmisPool();
      const [rows] = await pool.execute(
        `SELECT UPPER(TRIM(emp_id)) AS emp_id, SUM(CAST(total_mail_assigned AS UNSIGNED)) AS assigned, SUM(CAST(closed_email AS UNSIGNED)) AS closed
           FROM db_masmis.cl_email_raw
          WHERE STR_TO_DATE(report_date, '%e-%b-%y') = ? AND emp_id IS NOT NULL AND TRIM(emp_id) <> ''
          GROUP BY UPPER(TRIM(emp_id))`, [date]);
      return rows as Record<string, unknown>[];
    },
    toFacts: clEmailFacts,
  },
  {
    key: "satya_allocation",
    processCode: "SATYA_RETAIL",
    fetch: async (date) => {
      const pool = await masmisPool();
      const [rows] = await pool.execute(
        `SELECT UPPER(TRIM(COALESCE(NULLIF(mas_id, ''), agent_id))) AS emp_id,
                COUNT(DISTINCT CONCAT_WS('|', uid, unique_flag)) AS allocated,
                COUNT(DISTINCT CASE WHEN LOWER(TRIM(disposition)) = 'connected' THEN CONCAT_WS('|', uid, unique_flag) END) AS connected,
                COUNT(DISTINCT CASE WHEN LOWER(TRIM(sub_disposition)) LIKE 'order placed%' THEN CONCAT_WS('|', uid, unique_flag) END) AS orders
           FROM db_masmis.satya_allocation
          WHERE STR_TO_DATE(report_date, '%e-%b-%y') = ? AND COALESCE(NULLIF(mas_id, ''), NULLIF(agent_id, '')) IS NOT NULL
          GROUP BY UPPER(TRIM(COALESCE(NULLIF(mas_id, ''), agent_id)))`, [date]);
      return rows as Record<string, unknown>[];
    },
    toFacts: satyaAllocFacts,
  },
  {
    key: "satya_cdr",
    processCode: "SATYA_RETAIL",
    fetch: async (date) => {
      const pool = await masmisPool();
      const [rows] = await pool.execute(
        `SELECT UPPER(TRIM(agent_name)) AS emp_id, COUNT(*) AS calls FROM db_masmis.satya_cdr
          WHERE STR_TO_DATE(report_date, '%e-%b-%y') = ? AND agent_name IS NOT NULL AND TRIM(agent_name) <> ''
          GROUP BY UPPER(TRIM(agent_name))`, [date]);
      return rows as Record<string, unknown>[];
    },
    toFacts: satyaCallFacts,
  },
  {
    key: "aw_agent_day",
    processCode: "APPRICIATE_WEALTH",
    fetch: async (date) => {
      const pool = await masmisPool();
      const part = (t: string) => `SELECT UPPER(TRIM(emp_id)) AS emp_id, CAST(NULLIF(total_calls, '') AS UNSIGNED) AS calls, CAST(NULLIF(connected_calls, '') AS UNSIGNED) AS connected,
              ${secs('total_talk_time')} AS talk_s, ${secs('total_login_time')} AS login_s
         FROM db_masmis.${t} WHERE STR_TO_DATE(call_date, '%e-%b-%y') = ? AND emp_id IS NOT NULL AND TRIM(emp_id) <> ''`;
      const [rows] = await pool.execute(
        `SELECT emp_id, SUM(calls) AS calls, SUM(connected) AS connected, SUM(talk_s) AS talk_s, SUM(login_s) AS login_s
           FROM (${part("aw_billing")} UNION ALL ${part("aw_out")}) u GROUP BY emp_id`, [date, date]);
      return rows as Record<string, unknown>[];
    },
    toFacts: awFacts,
  },
  {
    key: "cl_chat",
    processCode: "CLOVIA",
    fetch: async (date) => {
      const pool = await masmisPool();
      const [rows] = await pool.execute(
        `SELECT UPPER(TRIM(mas_id)) AS emp_id, COUNT(*) AS chats,
                AVG(NULLIF(CAST(NULLIF(star_rating_value, '') AS DECIMAL(5,2)), 0)) AS avg_rating, AVG(${secs('wait_time')}) AS avg_wait_s
           FROM db_masmis.cl_chat WHERE STR_TO_DATE(report_date, '%e-%b-%y') = ? AND mas_id IS NOT NULL AND TRIM(mas_id) <> ''
          GROUP BY UPPER(TRIM(mas_id))`, [date]);
      return rows as Record<string, unknown>[];
    },
    toFacts: clChatFacts,
  },
  {
    key: "cl_outbound",
    processCode: "CLOVIA",
    fetch: async (date) => {
      const pool = await masmisPool();
      const [rows] = await pool.execute(
        `SELECT UPPER(TRIM(agent)) AS emp_id, COUNT(*) AS dials, SUM(CASE WHEN status = 'Connected' THEN 1 ELSE 0 END) AS connected,
                AVG(CASE WHEN status = 'Connected' THEN CAST(NULLIF(length_sec, '') AS UNSIGNED) END) AS avg_talk_s
           FROM db_masmis.cl_outbound WHERE STR_TO_DATE(call_date, '%c/%e/%y') = ? AND agent IS NOT NULL AND TRIM(agent) <> ''
          GROUP BY UPPER(TRIM(agent))`, [date]);
      return rows as Record<string, unknown>[];
    },
    toFacts: clOutboundFacts,
  },
];

// ── writer ────────────────────────────────────────────────────────────────────────────────────

async function metricIds(codes: string[]): Promise<Map<string, string>> {
  if (!codes.length) return new Map();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, metric_code FROM kpi_metric_master WHERE metric_code IN (${codes.map(() => "?").join(",")})`, codes as never[]);
  return new Map((rows as RowDataPacket[]).map((r) => [String(r.metric_code), String(r.id)]));
}

async function employeesByCode(codes: string[]): Promise<Map<string, { id: string; branchId: string | null }>> {
  const unique = [...new Set(codes.map(code).filter(Boolean))];
  const out = new Map<string, { id: string; branchId: string | null }>();
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, UPPER(TRIM(employee_code)) AS code, branch_id FROM employees
        WHERE UPPER(TRIM(employee_code)) IN (${chunk.map(() => "?").join(",")}) ORDER BY active_status DESC, created_at ASC`, chunk as never[]);
    for (const r of rows as RowDataPacket[]) if (!out.has(String(r.code))) out.set(String(r.code), { id: String(r.id), branchId: r.branch_id ? String(r.branch_id) : null });
  }
  return out;
}

export async function runFeed(feed: FeedDef, date: string): Promise<FeedResult> {
  const result: FeedResult = { feed: feed.key, date, rows: 0, facts: 0, written: 0, unmapped: 0 };
  try {
    const rows = await feed.fetch(date);
    result.rows = rows.length;
    const built = rows.flatMap((r) => feed.toFacts(r, date).map((f) => ({ f, processId: r.process_id ? String(r.process_id) : null })));
    result.facts = built.length;
    if (!built.length) return result;

    let fixedProcessId: string | null = null;
    if (feed.processCode) {
      const [pm] = await db.execute<RowDataPacket[]>(`SELECT id FROM process_master WHERE process_code = ? LIMIT 1`, [feed.processCode]);
      fixedProcessId = (pm as RowDataPacket[])[0]?.id ? String((pm as RowDataPacket[])[0].id) : null;
    }
    const ids = await metricIds([...new Set(built.map((b) => b.f.metricCode))]);
    const emps = await employeesByCode(built.map((b) => b.f.employeeCode));
    const seenUnmapped = new Set<string>();

    for (const { f, processId } of built) {
      const emp = emps.get(f.employeeCode);
      const metricId = ids.get(f.metricCode);
      if (!emp) { if (!seenUnmapped.has(f.employeeCode)) { seenUnmapped.add(f.employeeCode); result.unmapped++; } continue; }
      if (!metricId) continue; // metric not provisioned yet (migration 1993) - skip rather than fail the feed
      await db.execute(
        `INSERT INTO kpi_daily_actual
           (employee_id, metric_id, score_date, actual_value, source, source_system, numerator_value, denominator_value,
            source_record_count, process_id_at_event, branch_id_at_event, computed_at)
         VALUES (?, ?, ?, ?, 'calculated', ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE actual_value = VALUES(actual_value), source = VALUES(source), source_system = VALUES(source_system),
           numerator_value = VALUES(numerator_value), denominator_value = VALUES(denominator_value),
           source_record_count = VALUES(source_record_count), process_id_at_event = VALUES(process_id_at_event),
           branch_id_at_event = VALUES(branch_id_at_event), computed_at = VALUES(computed_at)`,
        [emp.id, metricId, f.date, f.value, `upload:${feed.key}`, f.numerator ?? null, f.denominator ?? null,
         f.sourceRecordCount ?? null, fixedProcessId ?? processId, emp.branchId],
      );
      result.written++;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}

/** Runs every feed for one date. Each feed is isolated: one failing source never blocks the others. */
export async function syncUploadFeeds(date: string): Promise<FeedResult[]> {
  const out: FeedResult[] = [];
  for (const feed of FEEDS) out.push(await runFeed(feed, date));
  return out;
}

export async function syncUploadFeedsRange(from: string, to: string): Promise<FeedResult[]> {
  const out: FeedResult[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(...await syncUploadFeeds(d.toISOString().slice(0, 10)));
  }
  return out;
}
