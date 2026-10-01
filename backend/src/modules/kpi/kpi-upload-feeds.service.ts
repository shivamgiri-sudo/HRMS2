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

// ── feed definitions ──────────────────────────────────────────────────────────────────────────

type FeedDef = {
  key: string;
  /** process_master.process_code the facts belong to (null = use the source row's process_id). */
  processCode: string | null;
  fetch: (date: string) => Promise<Record<string, unknown>[]>;
  toFacts: (row: Record<string, unknown>, date: string) => FeedFact[];
};

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
