import { db } from "../../db/mysql.js";
import { getDialerPool } from "../../db/dialerDb.js";
import type { RowDataPacket } from "mysql2";

/**
 * Satya Retail "Calling & Order Tracking" report -- live SQL aggregates over
 * db_masmis.satya_allocation (one row per shop allocated to an agent on a
 * date, still a staged upload table) and, as of 2026-09-30, the call side
 * reads LIVE from dialer_db.data_master_in (WHERE ClientId = 499) instead of
 * the staged db_masmis.satya_cdr copy -- same live-read pattern the Call
 * Master inbound dashboards already use (inbound.service.ts), so the Calls
 * tab is never stale behind a sync job. See dialerCdrBase() below for the
 * exact field mapping and the "attempt" formula. db_masmis.satya_cdr itself
 * is untouched and still fed by the manual Excel upload / sync_satya_cdr.py
 * -- only this report stopped reading it.
 * GET /api/process-performance/satya-retail-report. Built to reproduce the
 * ops team's Excel "Calling & Order Tracking Report"; every figure it shows
 * was reconciled against that report on live data (2026-09-20, uploads
 * through 18-Sep-26):
 *
 *   allocation 8,025 | Morning 2,025 / Absentee 5,999 | pending 90
 *   connected 2,047 | not connected 5,883 | orders 137 (132 from unique
 *   calls -- the Excel's "Connect > Order Placed" -- and 5 from repeat calls)
 *   | revenue 197,464
 *   per-agent allocation / orders / unique / revenue and the 1-5 Sep daily
 *   grid also match cell-for-cell.
 *
 * Definitions (verified, not guessed):
 * - "Connected"/"Not connected"/"Call Dropped"/"Pending Call" = disposition;
 *   the sub-disposition is the outcome (Order Placed, Call Back, ...). An
 *   order is sub_disposition = 'Order Placed'.
 * - Unique vs Repeat = unique_flag 1 vs 2. Calls made = allocation - pending
 *   = unique + repeat (7,734 + 201 = 7,935 on live data). The Excel's headline
 *   "13,912 total / 6,178 repeat calls" is NOT reproducible from the uploaded
 *   data: in its agent table "repeat" equals "unique" for 7 of 8 agents while
 *   the data has only 201 repeat rows in total, so it looks like a double-count
 *   in the workbook. That double-count is deliberately not replicated here.
 * - Pending rows belong to the queue sentinel agent 'VDCL' (not a person) and
 *   are excluded from agent tables, kept in headline/roster/day totals.
 * - Week buckets are day-of-month 1-7 / 8-14 / 15-21 / 22-28 / 29+ (matches
 *   the Excel's W-1..W-3).
 *
 * Data-quality handling, all read-time -- nothing is modified or deleted:
 * - 9 rows from an earlier test upload are exact duplicates (same report_date
 *   + uid + unique_flag) of rows in the full upload; the older copy is
 *   dropped (allocDuplicateIds). The Excel already excluded them.
 * - One real call row has its text columns overwritten by header labels
 *   (roster 'Roster', warehouse 'Warehouse', beat 'Beatname'). It is kept in
 *   every count (so totals match the Excel) and labelled 'Unmapped'.
 * - order_value is text with thousands separators ("1,292").
 * - The live dialer_db.data_master_in source has a real dataId primary key
 *   (no repeating call_id problem the old staged satya_cdr had), so there is
 *   no CDR duplicate-row check any more -- it can't happen from this source.
 *
 * "attempt" (call count on a number), verified 2026-09-30: dialer_db.data_master_in
 * carries no attempt-number field at all -- the user's own Excel formula
 * (`=COUNTIFS($A:$A,A2)` on the phone-number column) is what "attempt" means
 * here: how many times THIS number was called, not a sequential 1st/2nd/3rd
 * call index. Reproduced as `COUNT(*) OVER (PARTITION BY MSISDN)` inside
 * dialerCdrBase(), scoped to the same date range + warehouse filter as the
 * rest of the Calls tab (never re-scoped by agent/beat when drilling into
 * one, since the number's total call count doesn't change depending who's
 * looking at it -- same convention the old literal attempt column implied).
 */

export const A = "db_masmis.satya_allocation";
const DIALER_CDR_TABLE = "dialer_db.data_master_in";
const SATYA_CLIENT_ID = 499;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROSTERS = ["Morning", "Absentee", "Unmapped"] as const;

export const A_DATE = `STR_TO_DATE(report_date, '%e-%b-%y')`;
export const WH = `CASE WHEN warehouse IS NULL OR warehouse = '' OR warehouse = 'Warehouse' THEN 'Unmapped' ELSE warehouse END`;
export const ROSTER = `CASE WHEN roster IN ('Morning','Absentee') THEN roster ELSE 'Unmapped' END`;
export const BEAT = `CASE WHEN beat_name IS NULL OR beat_name = '' OR beat_name = 'Beatname' THEN 'Unmapped' ELSE beat_name END`;
export const REVENUE = `CASE WHEN order_value REGEXP '^[0-9,]+([.][0-9]+)?$' THEN CAST(REPLACE(order_value, ',', '') AS DECIMAL(12,2)) ELSE 0 END`;

/** Additive counters shared by every allocation aggregate (headline, day,
 * roster, agent, warehouse, beat). Everything is a plain sum, so the client
 * can roll days up into weeks/MTD without losing accuracy. */
export const COUNTERS = `
  COUNT(*) AS allocation,
  SUM(disposition = 'Pending Call') AS pending,
  SUM(unique_flag = '1' AND disposition <> 'Pending Call') AS uniq,
  SUM(unique_flag = '2' AND disposition <> 'Pending Call') AS rep,
  SUM(disposition = 'Connected') AS connected,
  SUM(disposition = 'Not Connected') AS not_connected,
  SUM(disposition = 'Call Dropped') AS dropped,
  SUM(sub_disposition = 'Order Placed') AS orders,
  SUM(sub_disposition = 'Order Placed' AND unique_flag = '1') AS orders_unique,
  SUM(${REVENUE}) AS revenue,
  SUM(roster = 'Morning') AS morning,
  SUM(roster = 'Absentee') AS absentee`;

export interface SatyaCounts {
  allocation: number;
  pending: number;
  unique: number;
  repeat: number;
  connected: number;
  notConnected: number;
  dropped: number;
  orders: number;
  /** Orders placed on a first-time (unique) call; orders - ordersUnique came from repeat calls. */
  ordersUnique: number;
  revenue: number;
  morning: number;
  absentee: number;
  unmapped: number;
}

export interface SatyaCallsData {
  headline: {
    attempts: number; connected: number; connectedPct: number; dropped: number;
    orderCalls: number; shops: number; agents: number; avgAttempt: number;
  };
  daily: Array<{ date: string; attempts: number; connected: number; orderCalls: number }>;
  byAttempt: Array<{ bucket: string; attempts: number; connected: number }>;
  hourly: Array<{ hour: number; attempts: number; connected: number }>;
  byScenario: Array<{ scenario: string; count: number }>;
  bySubScenario: Array<{ subScenario: string; count: number }>;
  agents: Array<{ agentId: string; attempts: number; connected: number; orderCalls: number; avgAttempt: number }>;
}

export interface SatyaCheck {
  id: string;
  level: "info" | "warn";
  title: string;
  detail: string;
  count: number;
}

export interface SatyaReportFilters {
  from: string;
  to: string;
  warehouse: string | null;
  roster: string | null;
}

export interface SatyaReportData {
  filters: SatyaReportFilters;
  available: { minDate: string | null; maxDate: string | null; warehouses: string[] };
  headline: SatyaCounts & { agents: number; shops: number };
  byRoster: Array<{ roster: string; counts: SatyaCounts }>;
  daily: Array<{ date: string; roster: string; counts: SatyaCounts }>;
  subDispositionDaily: Array<{ date: string; disposition: string; subDisposition: string; count: number }>;
  agents: Array<{ agentId: string; agentName: string; daysWorked: number; counts: SatyaCounts }>;
  warehouses: Array<{ warehouse: string; beats: number; counts: SatyaCounts }>;
  beats: Array<{ beat: string; warehouse: string; shops: number; counts: SatyaCounts }>;
  calls: SatyaCallsData;
  checks: SatyaCheck[];
}

export type SatyaDetailType = "agent" | "beat" | "warehouse";

export interface SatyaDetail {
  type: SatyaDetailType;
  key: string;
  title: string;
  subtitle: string;
  firstDate: string | null;
  lastDate: string | null;
  counts: SatyaCounts;
  daily: Array<{ date: string; allocation: number; connected: number; orders: number; revenue: number }>;
  dispositions: Array<{ disposition: string; subDisposition: string; count: number }>;
  /** agent -> beats, beat -> agents, warehouse -> beats */
  breakdownLabel: string;
  breakdown: Array<{ name: string; counts: SatyaCounts }>;
  orders: Array<{ date: string; shop: string; beat: string; agent: string; roster: string; amount: number }>;
  ordersTotal: number;
  calls: { attempts: number; connected: number; orderCalls: number; avgAttempt: number };
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);

function mapCounts(r: RowDataPacket): SatyaCounts {
  const allocation = num(r.allocation);
  const morning = num(r.morning);
  const absentee = num(r.absentee);
  return {
    allocation,
    pending: num(r.pending),
    unique: num(r.uniq),
    repeat: num(r.rep),
    connected: num(r.connected),
    notConnected: num(r.not_connected),
    dropped: num(r.dropped),
    orders: num(r.orders),
    ordersUnique: num(r.orders_unique),
    revenue: num(r.revenue),
    morning,
    absentee,
    unmapped: allocation - morning - absentee,
  };
}

export function currentMonthRange(): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
}

export function normalizeFilters(input: { from?: unknown; to?: unknown; warehouse?: unknown; roster?: unknown }): SatyaReportFilters {
  const fallback = currentMonthRange();
  const from = typeof input.from === "string" && DATE_RE.test(input.from) ? input.from : fallback.from;
  const to = typeof input.to === "string" && DATE_RE.test(input.to) ? input.to : fallback.to;
  const warehouse = typeof input.warehouse === "string" && input.warehouse.trim() && input.warehouse.length <= 60 ? input.warehouse.trim() : null;
  const roster = typeof input.roster === "string" && (ROSTERS as readonly string[]).includes(input.roster) ? input.roster : null;
  return { from, to, warehouse, roster };
}

/** Ids of older exact-duplicate allocation rows (same date + uid + flag as a
 * newer row) -- see the header comment. */
export async function allocDuplicateIds(): Promise<number[]> {
  // Two rules, both matching the ops team's MIS workbook (verified 2026-10-03 against its
  // Alloction sheet: Absentee 1-Sep 578 - 124 shared with Morning = 454):
  //  1. an exact repeat of the same date + uid + unique flag -> keep the newest row;
  //  2. an Absentee row whose uid is also on a Morning row for the same date -> drop the
  //     Absentee copy (the shop was allocated to the morning roster that day).
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.id
       FROM ${A} a
       JOIN (SELECT report_date, uid, unique_flag, MAX(id) AS keep_id
               FROM ${A}
              WHERE uid IS NOT NULL AND uid <> ''
              GROUP BY report_date, uid, unique_flag
             HAVING COUNT(*) > 1) d
         ON d.report_date = a.report_date AND d.uid = a.uid AND d.unique_flag <=> a.unique_flag AND a.id < d.keep_id
     UNION
     SELECT a.id
       FROM ${A} a
      WHERE a.roster = 'Absentee' AND a.uid IS NOT NULL AND a.uid <> ''
        AND EXISTS (SELECT 1 FROM ${A} m
                     WHERE m.roster = 'Morning' AND m.report_date = a.report_date AND m.uid = a.uid)`,
  );
  return rows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n));
}

export function allocWhere(f: SatyaReportFilters, dupIds: number[], extra?: { sql: string; params: unknown[] }): { sql: string; params: unknown[] } {
  const parts = [`${A_DATE} >= ?`, `${A_DATE} < DATE_ADD(?, INTERVAL 1 DAY)`];
  const params: unknown[] = [f.from, f.to];
  if (f.warehouse) { parts.push(`(${WH}) = ?`); params.push(f.warehouse); }
  if (f.roster) { parts.push(`(${ROSTER}) = ?`); params.push(f.roster); }
  if (dupIds.length > 0) parts.push(`id NOT IN (${dupIds.join(",")})`);
  if (extra) { parts.push(extra.sql); params.push(...extra.params); }
  return { sql: `WHERE ${parts.join(" AND ")}`, params };
}

/**
 * Live call rows for the selected date range (+ optional warehouse), read straight from
 * dialer_db.data_master_in (ClientId = 499) instead of the staged satya_cdr copy. Column
 * mapping confirmed 2026-09-30 by content match against historical satya_cdr rows (see
 * uploader/satya_retail/sync_satya_cdr.py's own header comment for the original reverse-
 * engineering): Category1->scenario, Category2->sub_scenario_1, Field2->beat_name,
 * Field4->warehouse, MSISDN->number_val, CallDate->call_date (a real DATETIME here, unlike
 * satya_cdr's mixed-format text column), callcreated->agent_name (regex-extracted "MASxxxxx"
 * code). "attempt" is computed, not stored -- see the header comment's "attempt" section.
 * Only date range + warehouse are baked into this base query (never agent/beat), so a
 * drill-down into one agent still sees that number's TRUE total attempt count, not just the
 * attempts made by that one agent.
 */
/** Shared by dialerCdrBase() and fetchDialerCdrRows() so the two queries' row sets can never drift apart. */
function dialerWhere(f: SatyaReportFilters): { sql: string; params: (string | number)[] } {
  const parts = [`ClientId = ?`, `CallDate >= ?`, `CallDate < DATE_ADD(?, INTERVAL 1 DAY)`];
  const params: (string | number)[] = [SATYA_CLIENT_ID, f.from, f.to];
  if (f.warehouse) { parts.push(`(CASE WHEN Field4 IS NULL OR Field4 = '' THEN 'Unmapped' ELSE Field4 END) = ?`); params.push(f.warehouse); }
  return { sql: parts.join(" AND "), params };
}

/** Used only by getSatyaDetail() below, scoped to one agent/beat/warehouse -- a small enough
 * row set that the window function's cost there is fine. The main report's own fetch
 * (fetchDialerCdrRows()) does NOT use this -- see its own header note for why. */
function dialerCdrBase(f: SatyaReportFilters): { sql: string; params: (string | number)[] } {
  const w = dialerWhere(f);
  const sql = `
    SELECT
      Category1 AS scenario,
      Category2 AS sub_scenario_1,
      (CASE WHEN Field4 IS NULL OR Field4 = '' THEN 'Unmapped' ELSE Field4 END) AS warehouse,
      (CASE WHEN Field2 IS NULL OR Field2 = '' THEN 'Unmapped' ELSE Field2 END) AS beat_name,
      MSISDN AS number_val,
      CallDate AS call_date,
      REGEXP_SUBSTR(callcreated, 'MAS[0-9]+') AS agent_name,
      COUNT(*) OVER (PARTITION BY MSISDN) AS attempt
    FROM ${DIALER_CDR_TABLE}
    WHERE ${w.sql}`;
  return { sql, params: w.params };
}

export interface DialerCdrRow {
  scenario: string; subScenario: string; warehouse: string; beatName: string;
  numberVal: string; callDate: Date; agentName: string; attempt: number;
}

/**
 * The main report's one fetch for the whole page -- filters the shared dialer table down to
 * this request's range (already narrow: ClientId=499 alone is ~30k rows out of ~900k total,
 * confirmed live) WITHOUT the window function dialerCdrBase() uses: "attempt" (how many times
 * a number was called) is computed here in JS instead, a plain group-by-count over the already-
 * fetched rows. Confirmed live 2026-09-30: asking MySQL for COUNT(*) OVER (PARTITION BY MSISDN)
 * over a month's ~29k rows took 10-19s on its own (server-load dependent) even as ONE query --
 * and before this fix, getCallsData()/getChecks()/getSatyaReport() each ran their OWN
 * independent copy of that window-function query (7 + 1 + 1 = 9 executions per page load, on
 * top of its already-real per-query cost). This is both fixes at once: fetch once, and skip the
 * window function that fetch never needed to pay for in the first place.
 */
const AGENT_CODE_RE = /MAS[0-9]+/;
const DIALER_FETCH_TIMEOUT_MS = 90_000;

export async function fetchDialerCdrRows(f: SatyaReportFilters): Promise<DialerCdrRow[]> {
  const w = dialerWhere(f);
  // Plain columns only -- the "Unmapped" fallback (CASE) and the MASxxxxx extraction
  // (REGEXP_SUBSTR) both moved to the JS .map() below: computed per-row in SQL they were a real,
  // measurable share of this query's cost (confirmed live 2026-09-30: dropping just these two
  // cut an otherwise-identical fetch from ~12.8s to ~9s), and both are trivial in JS for a
  // result set this size. Filtering by warehouse, when f.warehouse is set, still happens
  // server-side via dialerWhere()'s own CASE expression -- only the SELECT-list labelling
  // moved, not the WHERE-side filter.
  const sql = `
    SELECT
      Category1 AS scenario,
      Category2 AS sub_scenario_1,
      Field4 AS warehouse_raw,
      Field2 AS beat_raw,
      MSISDN AS number_val,
      CallDate AS call_date,
      callcreated
    FROM ${DIALER_CDR_TABLE}
    WHERE ${w.sql}`;
  const pool = await getDialerPool();
  // Client-side timeout so a stuck dialer read cannot hold the request (and a pool slot) open indefinitely.
  const [rawRows] = await pool.execute<RowDataPacket[]>({ sql, timeout: DIALER_FETCH_TIMEOUT_MS }, w.params);

  const attemptByNumber = new Map<string, number>();
  for (const r of rawRows) {
    const n = String(r.number_val ?? "");
    attemptByNumber.set(n, (attemptByNumber.get(n) ?? 0) + 1);
  }

  return rawRows.map((r) => {
    const numberVal = String(r.number_val ?? "");
    const warehouseRaw = String(r.warehouse_raw ?? "").trim();
    const beatRaw = String(r.beat_raw ?? "").trim();
    const agentMatch = AGENT_CODE_RE.exec(String(r.callcreated ?? ""));
    return {
      scenario: String(r.scenario ?? ""), subScenario: String(r.sub_scenario_1 ?? ""),
      warehouse: warehouseRaw || "Unmapped", beatName: beatRaw || "Unmapped",
      numberVal, callDate: new Date(r.call_date), agentName: agentMatch ? agentMatch[0] : "",
      attempt: attemptByNumber.get(numberVal) ?? 0,
    };
  });
}

function getCallsData(rows: DialerCdrRow[]): SatyaCallsData {
  const attempts = rows.length;
  const connected = rows.filter((r) => r.scenario === "Connected").length;
  const dropped = rows.filter((r) => r.scenario === "Call Dropped").length;
  const orderCalls = rows.filter((r) => r.subScenario === "Order Placed").length;
  const shops = new Set(rows.map((r) => r.numberVal).filter((v) => v && v !== "0")).size;
  const agentSet = new Set(rows.map((r) => r.agentName).filter((v) => v));
  const avgAttempt = attempts > 0 ? rows.reduce((s, r) => s + r.attempt, 0) / attempts : 0;

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const dailyMap = new Map<string, { attempts: number; connected: number; orderCalls: number }>();
  const hourlyMap = new Map<number, { attempts: number; connected: number }>();
  const scenarioMap = new Map<string, number>();
  const subScenarioMap = new Map<string, number>();
  const attemptBucketMap = new Map<string, { sortKey: number; attempts: number; connected: number }>();
  const agentMap = new Map<string, { attempts: number; connected: number; orderCalls: number; attemptSum: number }>();

  for (const r of rows) {
    const isConnected = r.scenario === "Connected";
    const isOrder = r.subScenario === "Order Placed";

    const dKey = dayKey(r.callDate);
    const dCur = dailyMap.get(dKey) ?? { attempts: 0, connected: 0, orderCalls: 0 };
    dCur.attempts += 1; if (isConnected) dCur.connected += 1; if (isOrder) dCur.orderCalls += 1;
    dailyMap.set(dKey, dCur);

    const hour = r.callDate.getHours();
    const hCur = hourlyMap.get(hour) ?? { attempts: 0, connected: 0 };
    hCur.attempts += 1; if (isConnected) hCur.connected += 1;
    hourlyMap.set(hour, hCur);

    const scenarioKey = r.scenario || "Unknown";
    scenarioMap.set(scenarioKey, (scenarioMap.get(scenarioKey) ?? 0) + 1);
    const subKey = r.subScenario || "Not tagged";
    subScenarioMap.set(subKey, (subScenarioMap.get(subKey) ?? 0) + 1);

    const bucket = r.attempt >= 11 ? "11+" : r.attempt >= 6 ? "6-10" : String(r.attempt);
    const bCur = attemptBucketMap.get(bucket) ?? { sortKey: r.attempt, attempts: 0, connected: 0 };
    bCur.sortKey = Math.min(bCur.sortKey, r.attempt);
    bCur.attempts += 1; if (isConnected) bCur.connected += 1;
    attemptBucketMap.set(bucket, bCur);

    if (r.agentName) {
      const aCur = agentMap.get(r.agentName) ?? { attempts: 0, connected: 0, orderCalls: 0, attemptSum: 0 };
      aCur.attempts += 1; if (isConnected) aCur.connected += 1; if (isOrder) aCur.orderCalls += 1;
      aCur.attemptSum += r.attempt;
      agentMap.set(r.agentName, aCur);
    }
  }

  return {
    headline: {
      attempts, connected, connectedPct: pct(connected, attempts), dropped,
      orderCalls, shops, agents: agentSet.size, avgAttempt: Math.round(avgAttempt * 100) / 100,
    },
    daily: [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v })),
    byAttempt: [...attemptBucketMap.entries()].sort(([, a], [, b]) => a.sortKey - b.sortKey)
      .map(([bucket, v]) => ({ bucket, attempts: v.attempts, connected: v.connected })),
    hourly: [...hourlyMap.entries()].sort(([a], [b]) => a - b)
      .map(([hour, v]) => ({ hour, ...v })),
    byScenario: [...scenarioMap.entries()].sort(([, a], [, b]) => b - a)
      .map(([scenario, count]) => ({ scenario, count })),
    bySubScenario: [...subScenarioMap.entries()].sort(([, a], [, b]) => b - a).slice(0, 15)
      .map(([subScenario, count]) => ({ subScenario, count })),
    agents: [...agentMap.entries()].sort(([, a], [, b]) => b.attempts - a.attempts)
      .map(([agentId, v]) => ({
        agentId, attempts: v.attempts, connected: v.connected, orderCalls: v.orderCalls,
        avgAttempt: v.attempts > 0 ? Math.round((v.attemptSum / v.attempts) * 100) / 100 : 0,
      })),
  };
}

/** Spelling variants of one sub-disposition ("Shop Closed – Temporary" vs
 * "Shop Closed Temporary") that differ only by punctuation/case. */
function findSpellingVariants(rows: Array<{ sub: string; n: number }>): SatyaCheck[] {
  const groups = new Map<string, Array<{ sub: string; n: number }>>();
  for (const r of rows) {
    const key = r.sub.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g, i) => ({
      id: `variant-${i}`,
      level: "warn" as const,
      title: "Same outcome spelled two ways",
      detail: g.map((v) => `"${v.sub}" (${v.n})`).join("  vs  ") + " — reported separately, exactly as uploaded. Fix at source to merge them.",
      count: g.reduce((s, v) => s + v.n, 0),
    }));
}

async function getChecks(dupIds: number[], f: SatyaReportFilters, dialerRows: DialerCdrRow[], dialerError: string | null = null): Promise<SatyaCheck[]> {
  const [totalsR, subR] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total,
         SUM(roster NOT IN ('Morning','Absentee') OR roster IS NULL) AS roster_unmapped,
         SUM(warehouse IS NULL OR warehouse = '' OR warehouse = 'Warehouse') AS wh_unmapped,
         SUM(beat_name IS NULL OR beat_name = '' OR beat_name = 'Beatname') AS beat_unmapped,
         SUM(disposition = 'Pending Call') AS pending,
         SUM(agent_id = 'VDCL') AS vdcl,
         SUM(sub_disposition = 'Order Placed' AND (warehouse IS NULL OR warehouse = '' OR warehouse = 'Warehouse')) AS orders_no_wh,
         MAX(inserted_at) AS last_upload
       FROM ${A}`),
    db.execute<RowDataPacket[]>(`SELECT sub_disposition AS sub, COUNT(*) AS n FROM ${A} WHERE sub_disposition IS NOT NULL AND sub_disposition <> '' GROUP BY sub_disposition`),
  ]);
  // Derived from the same dialerRows fetch getSatyaReport already did -- was its own 9th
  // independent dialerCdrBase() query before; see fetchDialerCdrRows()'s own header note.
  const cdrTotal = dialerRows.length;
  const cdrWhNull = dialerRows.filter((r) => r.warehouse === "Unmapped").length;
  const cdrLastCall = dialerRows.length > 0
    ? new Date(dialerRows.reduce((m, r) => Math.max(m, r.callDate.getTime()), 0))
    : null;
  const t = totalsR[0][0];
  const checks: SatyaCheck[] = [];
  if (dialerError) {
    checks.push({
      id: "cdr-unavailable", level: "warn", count: 0,
      title: "Live dialer data unavailable",
      detail: "The call records could not be read from the dialer (dialer_db.data_master_in) just now, so the Call attempts figures read zero. Allocation figures are unaffected. Try again in a few minutes.",
    });
  }

  if (dupIds.length > 0) {
    checks.push({
      id: "alloc-dupes", level: "warn", count: dupIds.length,
      title: "Duplicate allocation rows excluded",
      detail: `${dupIds.length} older rows are exact copies (same date + shop + flag) of rows in a later upload — most likely an earlier test upload that was re-uploaded in full. They are left in the database and skipped here.`,
    });
  }
  if (num(t?.roster_unmapped) > 0) {
    checks.push({
      id: "roster-unmapped", level: "warn", count: num(t?.roster_unmapped),
      title: "Allocation rows with no Morning/Absentee roster",
      detail: "Counted in every total but shown as 'Unmapped' by roster — the roster/warehouse/beat text on such a row is a header label (e.g. 'Roster', 'Warehouse') from the source sheet.",
    });
  }
  if (num(t?.wh_unmapped) > 0) {
    checks.push({
      id: "wh-unmapped", level: "warn", count: num(t?.wh_unmapped),
      title: "Allocation rows with no warehouse",
      detail: `${num(t?.orders_no_wh)} order(s) sit on these rows and appear under warehouse 'Unmapped'. A workbook that hard-codes a warehouse list (GGN / AGR / GZB) will under-count orders by this amount plus any warehouse it omits (NDA, JNS).`,
    });
  }
  if (num(t?.pending) > 0) {
    checks.push({
      id: "pending", level: "info", count: num(t?.pending),
      title: "Pending (not yet called) allocations",
      detail: `${num(t?.vdcl)} rows are assigned to the queue sentinel 'VDCL' rather than a person. They count in allocation and pending, but not in calls made or any agent table.`,
    });
  }
  checks.push(...findSpellingVariants(subR[0].map((r) => ({ sub: String(r.sub), n: num(r.n) }))));
  if (cdrWhNull > 0) {
    checks.push({
      id: "cdr-warehouse", level: "info", count: cdrWhNull,
      title: "Dial attempts with no warehouse",
      detail: "Shown as 'Unmapped' in the Calls tab's warehouse breakdown; the warehouse filter still excludes them from a specific warehouse's view.",
    });
  }
  const p2 = (n: number) => String(n).padStart(2, "0");
  const lastCallStr = cdrLastCall
    ? `${cdrLastCall.getFullYear()}-${p2(cdrLastCall.getMonth() + 1)}-${p2(cdrLastCall.getDate())} ${p2(cdrLastCall.getHours())}:${p2(cdrLastCall.getMinutes())}`
    : "—";
  checks.push({
    id: "sources", level: "info", count: num(t?.total) + cdrTotal,
    title: "Source rows",
    detail: `${num(t?.total).toLocaleString("en-IN")} allocation rows (last upload ${String(t?.last_upload ?? "—").slice(0, 16).replace("T", " ")}) and ${cdrTotal.toLocaleString("en-IN")} dial-attempt rows, live from the dialer (latest call in range ${lastCallStr}).`,
  });
  return checks;
}

export async function getSatyaReport(f: SatyaReportFilters): Promise<SatyaReportData> {
  const dupIds = await allocDuplicateIds();
  const w = allocWhere(f, dupIds);
  const agentW = allocWhere(f, dupIds, { sql: `agent_id IS NOT NULL AND agent_id <> '' AND agent_id <> 'VDCL'`, params: [] });

  // The one expensive dialer fetch, done ONCE for the whole report -- see fetchDialerCdrRows()'s
  // own header note for why (this used to happen 9 separate times per page load).
  // Fail soft: dialer_db is a separate (read-only) source -- if it is unreachable or slow to error,
  // the allocation side of the report still renders and the Data checks tab says why calls read zero.
  let dialerRows: DialerCdrRow[] = [];
  let dialerError: string | null = null;
  try {
    dialerRows = await fetchDialerCdrRows(f);
  } catch (err) {
    dialerError = err instanceof Error ? err.message : String(err);
    console.warn("[satya-retail-report] live dialer CDR read failed:", dialerError);
  }
  const calls = getCallsData(dialerRows);

  const [headlineR, rosterR, dailyR, subR, agentR, whR, beatR, availR, whListR, checks] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT ${COUNTERS}, COUNT(DISTINCT NULLIF(NULLIF(agent_id, ''), 'VDCL')) AS agents, COUNT(DISTINCT NULLIF(shop_phone, '')) AS shops
       FROM ${A} ${w.sql}`, w.params),
    db.execute<RowDataPacket[]>(`SELECT ${ROSTER} AS roster_n, ${COUNTERS} FROM ${A} ${w.sql} GROUP BY roster_n`, w.params),
    db.execute<RowDataPacket[]>(`SELECT ${A_DATE} AS d, ${ROSTER} AS roster_n, ${COUNTERS} FROM ${A} ${w.sql} GROUP BY d, roster_n ORDER BY d`, w.params),
    db.execute<RowDataPacket[]>(
      `SELECT ${A_DATE} AS d, COALESCE(NULLIF(disposition, ''), 'Unknown') AS disp, COALESCE(NULLIF(sub_disposition, ''), 'Unknown') AS sub, COUNT(*) AS n
       FROM ${A} ${w.sql} GROUP BY d, disp, sub`, w.params),
    db.execute<RowDataPacket[]>(
      `SELECT agent_id, MAX(NULLIF(agent_name_2, '')) AS agent_name, COUNT(DISTINCT ${A_DATE}) AS days_worked, ${COUNTERS}
       FROM ${A} ${agentW.sql} GROUP BY agent_id ORDER BY allocation DESC`, agentW.params),
    db.execute<RowDataPacket[]>(
      `SELECT ${WH} AS wh, COUNT(DISTINCT ${BEAT}) AS beats, ${COUNTERS} FROM ${A} ${w.sql} GROUP BY wh ORDER BY allocation DESC`, w.params),
    db.execute<RowDataPacket[]>(
      `SELECT ${BEAT} AS beat_n, MAX(${WH}) AS wh, COUNT(DISTINCT NULLIF(shop_phone, '')) AS shops, ${COUNTERS}
       FROM ${A} ${w.sql} GROUP BY beat_n ORDER BY allocation DESC`, w.params),
    db.execute<RowDataPacket[]>(`SELECT MIN(${A_DATE}) AS min_d, MAX(${A_DATE}) AS max_d FROM ${A}`),
    db.execute<RowDataPacket[]>(`SELECT DISTINCT ${WH} AS wh FROM ${A}`),
    getChecks(dupIds, f, dialerRows, dialerError),
  ]);

  // Warehouse dropdown options: allocation's own list (no date bound, same as before) plus
  // whatever the live CDR side has for the current range -- derived from the same dialerRows
  // fetch above now, instead of a separate 9th dialerCdrBase() query.
  const warehouseSet = new Set<string>([...whListR[0].map((r) => String(r.wh)), ...dialerRows.map((r) => r.warehouse)]);

  const h = headlineR[0][0];
  return {
    filters: f,
    available: {
      minDate: availR[0][0]?.min_d ? String(availR[0][0].min_d) : null,
      maxDate: availR[0][0]?.max_d ? String(availR[0][0].max_d) : null,
      warehouses: [...warehouseSet].sort(),
    },
    headline: { ...mapCounts(h), agents: num(h?.agents), shops: num(h?.shops) },
    byRoster: rosterR[0].map((r) => ({ roster: String(r.roster_n), counts: mapCounts(r) })),
    daily: dailyR[0].map((r) => ({ date: String(r.d), roster: String(r.roster_n), counts: mapCounts(r) })),
    subDispositionDaily: subR[0].map((r) => ({ date: String(r.d), disposition: String(r.disp), subDisposition: String(r.sub), count: num(r.n) })),
    agents: agentR[0].map((r) => ({
      agentId: String(r.agent_id), agentName: r.agent_name ? String(r.agent_name) : String(r.agent_id),
      daysWorked: num(r.days_worked), counts: mapCounts(r),
    })),
    warehouses: whR[0].map((r) => ({ warehouse: String(r.wh), beats: num(r.beats), counts: mapCounts(r) })),
    beats: beatR[0].map((r) => ({ beat: String(r.beat_n), warehouse: String(r.wh), shops: num(r.shops), counts: mapCounts(r) })),
    calls,
    checks,
  };
}

const DETAIL_DIMENSION: Record<SatyaDetailType, { alloc: string; breakdownLabel: string; breakdownExpr: string }> = {
  agent: { alloc: `agent_id = ?`, breakdownLabel: "Beat-wise", breakdownExpr: BEAT },
  beat: { alloc: `(${BEAT}) = ?`, breakdownLabel: "Agent-wise", breakdownExpr: `agent_id` },
  warehouse: { alloc: `(${WH}) = ?`, breakdownLabel: "Beat-wise", breakdownExpr: BEAT },
};
/** dialerCdrBase() already outputs normalized agent_name/beat_name/warehouse columns, so the
 * live-CDR side of a drill-down is just an equality filter on the matching one -- no CASE
 * expression needed (unlike DETAIL_DIMENSION.alloc, which still runs against raw satya_allocation). */
const CDR_DIM_COLUMN: Record<SatyaDetailType, string> = { agent: "agent_name", beat: "beat_name", warehouse: "warehouse" };

/** One agent / beat / warehouse in full -- backs the row drill-down drawer.
 * Same date/warehouse/roster filters as the list it was opened from, so the
 * drawer's totals equal the row that was clicked. */
export async function getSatyaDetail(type: SatyaDetailType, key: string, f: SatyaReportFilters): Promise<SatyaDetail | null> {
  const dim = DETAIL_DIMENSION[type];
  const dupIds = await allocDuplicateIds();
  const w = allocWhere(f, dupIds, { sql: dim.alloc, params: [key] });
  const cdrBase = dialerCdrBase(f);

  const [totalsR, metaR, dailyR, dispR, breakR, ordersR, ordersCountR, callsR] = await Promise.all([
    db.execute<RowDataPacket[]>(`SELECT ${COUNTERS} FROM ${A} ${w.sql}`, w.params),
    db.execute<RowDataPacket[]>(
      `SELECT MIN(${A_DATE}) AS first_d, MAX(${A_DATE}) AS last_d, MAX(NULLIF(agent_name_2, '')) AS agent_name,
         MAX(${WH}) AS wh, COUNT(DISTINCT ${BEAT}) AS beats, COUNT(DISTINCT NULLIF(agent_id, '')) AS agents
       FROM ${A} ${w.sql}`, w.params),
    db.execute<RowDataPacket[]>(
      `SELECT ${A_DATE} AS d, COUNT(*) AS allocation, SUM(disposition = 'Connected') AS connected,
         SUM(sub_disposition = 'Order Placed') AS orders, SUM(${REVENUE}) AS revenue
       FROM ${A} ${w.sql} GROUP BY d ORDER BY d`, w.params),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(disposition, ''), 'Unknown') AS disp, COALESCE(NULLIF(sub_disposition, ''), 'Unknown') AS sub, COUNT(*) AS n
       FROM ${A} ${w.sql} GROUP BY disp, sub ORDER BY n DESC`, w.params),
    db.execute<RowDataPacket[]>(
      `SELECT ${dim.breakdownExpr} AS name, ${COUNTERS} FROM ${A} ${w.sql} GROUP BY name ORDER BY allocation DESC LIMIT 60`, w.params),
    db.execute<RowDataPacket[]>(
      `SELECT ${A_DATE} AS d, shop_name, ${BEAT} AS beat_n, agent_id, ${ROSTER} AS roster_n, ${REVENUE} AS amount
       FROM ${A} ${w.sql} AND sub_disposition = 'Order Placed' ORDER BY d DESC, id DESC LIMIT 50`, w.params),
    db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${A} ${w.sql} AND sub_disposition = 'Order Placed'`, w.params),
    // Live dialer side fails soft (calls read zero) so the allocation drill-down still opens.
    (async (): Promise<[RowDataPacket[]]> => {
      try {
        const pool = await getDialerPool();
        const [rows] = await pool.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS attempts, SUM(scenario = 'Connected') AS connected, SUM(sub_scenario_1 = 'Order Placed') AS order_calls,
             AVG(attempt) AS avg_attempt
           FROM (${cdrBase.sql}) cdr WHERE ${CDR_DIM_COLUMN[type]} = ?`, [...cdrBase.params, key]);
        return [rows];
      } catch (err) {
        console.warn("[satya-retail-report] live dialer detail read failed:", err instanceof Error ? err.message : String(err));
        return [[]];
      }
    })(),
  ]);

  const counts = mapCounts(totalsR[0][0]);
  if (counts.allocation === 0) return null;
  const meta = metaR[0][0];
  const c = callsR[0][0];

  const title = type === "agent" ? (meta?.agent_name ? `${meta.agent_name} (${key})` : key) : key;
  const subtitle = type === "agent"
    ? `${num(meta?.beats)} beat(s) · warehouse ${meta?.wh ?? "—"}`
    : type === "beat"
      ? `Warehouse ${meta?.wh ?? "—"} · ${num(meta?.agents)} agent(s)`
      : `${num(meta?.beats)} beat(s) · ${num(meta?.agents)} agent(s)`;

  return {
    type, key, title, subtitle,
    firstDate: meta?.first_d ? String(meta.first_d) : null,
    lastDate: meta?.last_d ? String(meta.last_d) : null,
    counts,
    daily: dailyR[0].map((r) => ({ date: String(r.d), allocation: num(r.allocation), connected: num(r.connected), orders: num(r.orders), revenue: num(r.revenue) })),
    dispositions: dispR[0].map((r) => ({ disposition: String(r.disp), subDisposition: String(r.sub), count: num(r.n) })),
    breakdownLabel: dim.breakdownLabel,
    breakdown: breakR[0].map((r) => ({ name: String(r.name), counts: mapCounts(r) })),
    orders: ordersR[0].map((r) => ({
      date: String(r.d), shop: r.shop_name ? String(r.shop_name) : "—", beat: String(r.beat_n),
      agent: r.agent_id ? String(r.agent_id) : "—", roster: String(r.roster_n), amount: num(r.amount),
    })),
    ordersTotal: num(ordersCountR[0][0]?.n),
    calls: {
      attempts: num(c?.attempts), connected: num(c?.connected), orderCalls: num(c?.order_calls),
      avgAttempt: Math.round(num(c?.avg_attempt) * 100) / 100,
    },
  };
}
