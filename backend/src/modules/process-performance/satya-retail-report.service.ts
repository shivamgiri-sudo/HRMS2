import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Satya Retail "Calling & Order Tracking" report -- live SQL aggregates over
 * db_masmis.satya_allocation (one row per shop allocated to an agent on a
 * date) and db_masmis.satya_cdr (one row per dial attempt), via
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
 * - satya_cdr has no reliable dedupe key (call_id repeats across attempts),
 *   so it is shown as uploaded; possible duplicates are only *reported* in
 *   the Data checks tab.
 * - satya_cdr.roster is null on ~half its rows, so the roster filter applies
 *   to allocation views only.
 */

const A = "db_masmis.satya_allocation";
const C = "db_masmis.satya_cdr";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROSTERS = ["Morning", "Absentee", "Unmapped"] as const;

const A_DATE = `STR_TO_DATE(report_date, '%e-%b-%y')`;
const WH = `CASE WHEN warehouse IS NULL OR warehouse = '' OR warehouse = 'Warehouse' THEN 'Unmapped' ELSE warehouse END`;
const ROSTER = `CASE WHEN roster IN ('Morning','Absentee') THEN roster ELSE 'Unmapped' END`;
const BEAT = `CASE WHEN beat_name IS NULL OR beat_name = '' OR beat_name = 'Beatname' THEN 'Unmapped' ELSE beat_name END`;
const REVENUE = `CASE WHEN order_value REGEXP '^[0-9,]+([.][0-9]+)?$' THEN CAST(REPLACE(order_value, ',', '') AS DECIMAL(12,2)) ELSE 0 END`;
const CDR_TS = `CASE WHEN call_date REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4} ' THEN STR_TO_DATE(call_date, '%c/%e/%Y %H:%i') ELSE STR_TO_DATE(call_date, '%c/%e/%y %H:%i') END`;

/** Additive counters shared by every allocation aggregate (headline, day,
 * roster, agent, warehouse, beat). Everything is a plain sum, so the client
 * can roll days up into weeks/MTD without losing accuracy. */
const COUNTERS = `
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
async function allocDuplicateIds(): Promise<number[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.id
       FROM ${A} a
       JOIN (SELECT report_date, uid, unique_flag, MAX(id) AS keep_id
               FROM ${A}
              WHERE uid IS NOT NULL AND uid <> ''
              GROUP BY report_date, uid, unique_flag
             HAVING COUNT(*) > 1) d
         ON d.report_date = a.report_date AND d.uid = a.uid AND d.unique_flag <=> a.unique_flag AND a.id < d.keep_id`,
  );
  return rows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n));
}

function allocWhere(f: SatyaReportFilters, dupIds: number[], extra?: { sql: string; params: unknown[] }): { sql: string; params: unknown[] } {
  const parts = [`${A_DATE} >= ?`, `${A_DATE} < DATE_ADD(?, INTERVAL 1 DAY)`];
  const params: unknown[] = [f.from, f.to];
  if (f.warehouse) { parts.push(`(${WH}) = ?`); params.push(f.warehouse); }
  if (f.roster) { parts.push(`(${ROSTER}) = ?`); params.push(f.roster); }
  if (dupIds.length > 0) parts.push(`id NOT IN (${dupIds.join(",")})`);
  if (extra) { parts.push(extra.sql); params.push(...extra.params); }
  return { sql: `WHERE ${parts.join(" AND ")}`, params };
}

function cdrWhere(f: SatyaReportFilters, extra?: { sql: string; params: unknown[] }): { sql: string; params: unknown[] } {
  const parts = [`${A_DATE} >= ?`, `${A_DATE} < DATE_ADD(?, INTERVAL 1 DAY)`];
  const params: unknown[] = [f.from, f.to];
  if (f.warehouse) { parts.push(`(${WH}) = ?`); params.push(f.warehouse); }
  if (extra) { parts.push(extra.sql); params.push(...extra.params); }
  return { sql: `WHERE ${parts.join(" AND ")}`, params };
}

async function getCallsData(f: SatyaReportFilters): Promise<SatyaCallsData> {
  const w = cdrWhere(f);
  const dateWhere = cdrWhere(f, { sql: `${A_DATE} IS NOT NULL`, params: [] });
  const hourWhere = cdrWhere(f, { sql: `(${CDR_TS}) IS NOT NULL`, params: [] });

  const [headlineR, dailyR, attemptR, hourR, scenarioR, subR, agentR] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS attempts, SUM(scenario = 'Connected') AS connected, SUM(scenario = 'Call Dropped') AS dropped,
         SUM(sub_scenario_1 = 'Order Placed') AS order_calls,
         COUNT(DISTINCT NULLIF(number_val, '0')) AS shops, COUNT(DISTINCT NULLIF(agent_name, '')) AS agents,
         AVG(CAST(attempt AS UNSIGNED)) AS avg_attempt
       FROM ${C} ${w.sql}`, w.params),
    db.execute<RowDataPacket[]>(
      `SELECT ${A_DATE} AS d, COUNT(*) AS attempts, SUM(scenario = 'Connected') AS connected, SUM(sub_scenario_1 = 'Order Placed') AS order_calls
       FROM ${C} ${dateWhere.sql} GROUP BY d ORDER BY d`, dateWhere.params),
    db.execute<RowDataPacket[]>(
      `SELECT CASE WHEN CAST(attempt AS UNSIGNED) >= 11 THEN '11+' WHEN CAST(attempt AS UNSIGNED) >= 6 THEN '6-10' ELSE CAST(CAST(attempt AS UNSIGNED) AS CHAR) END AS bucket,
         MIN(CAST(attempt AS UNSIGNED)) AS sort_key, COUNT(*) AS attempts, SUM(scenario = 'Connected') AS connected
       FROM ${C} ${w.sql} AND attempt REGEXP '^[0-9]+$' GROUP BY bucket ORDER BY sort_key`, w.params),
    db.execute<RowDataPacket[]>(
      `SELECT HOUR(${CDR_TS}) AS h, COUNT(*) AS attempts, SUM(scenario = 'Connected') AS connected
       FROM ${C} ${hourWhere.sql} GROUP BY h ORDER BY h`, hourWhere.params),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(scenario, ''), 'Unknown') AS scenario, COUNT(*) AS n FROM ${C} ${w.sql} GROUP BY scenario ORDER BY n DESC`, w.params),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(sub_scenario_1, ''), 'Not tagged') AS sub_scenario, COUNT(*) AS n FROM ${C} ${w.sql} GROUP BY sub_scenario ORDER BY n DESC LIMIT 15`, w.params),
    db.execute<RowDataPacket[]>(
      `SELECT agent_name, COUNT(*) AS attempts, SUM(scenario = 'Connected') AS connected, SUM(sub_scenario_1 = 'Order Placed') AS order_calls,
         AVG(CAST(attempt AS UNSIGNED)) AS avg_attempt
       FROM ${C} ${w.sql} AND agent_name IS NOT NULL AND agent_name <> '' GROUP BY agent_name ORDER BY attempts DESC`, w.params),
  ]);

  const h = headlineR[0][0];
  const attempts = num(h?.attempts);
  const connected = num(h?.connected);
  return {
    headline: {
      attempts, connected, connectedPct: pct(connected, attempts), dropped: num(h?.dropped),
      orderCalls: num(h?.order_calls), shops: num(h?.shops), agents: num(h?.agents),
      avgAttempt: Math.round(num(h?.avg_attempt) * 100) / 100,
    },
    daily: dailyR[0].map((r) => ({ date: String(r.d), attempts: num(r.attempts), connected: num(r.connected), orderCalls: num(r.order_calls) })),
    byAttempt: attemptR[0].map((r) => ({ bucket: String(r.bucket), attempts: num(r.attempts), connected: num(r.connected) })),
    hourly: hourR[0].map((r) => ({ hour: num(r.h), attempts: num(r.attempts), connected: num(r.connected) })),
    byScenario: scenarioR[0].map((r) => ({ scenario: String(r.scenario), count: num(r.n) })),
    bySubScenario: subR[0].map((r) => ({ subScenario: String(r.sub_scenario), count: num(r.n) })),
    agents: agentR[0].map((r) => ({
      agentId: String(r.agent_name), attempts: num(r.attempts), connected: num(r.connected),
      orderCalls: num(r.order_calls), avgAttempt: Math.round(num(r.avg_attempt) * 100) / 100,
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

async function getChecks(dupIds: number[]): Promise<SatyaCheck[]> {
  const [totalsR, subR, cdrR, cdrDupR] = await Promise.all([
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
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total, SUM(warehouse IS NULL OR warehouse = '') AS wh_null, SUM(roster IS NULL OR roster = '') AS roster_null, MAX(inserted_at) AS last_upload FROM ${C}`),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(n - 1), 0) AS possible_dupes FROM (SELECT COUNT(*) AS n FROM ${C} GROUP BY call_id, attempt, call_date HAVING COUNT(*) > 1) x`),
  ]);
  const t = totalsR[0][0];
  const c = cdrR[0][0];
  const checks: SatyaCheck[] = [];

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
  if (num(cdrDupR[0][0]?.possible_dupes) > 0) {
    checks.push({
      id: "cdr-dupes", level: "warn", count: num(cdrDupR[0][0]?.possible_dupes),
      title: "Possible duplicate dial-attempt rows",
      detail: "Rows sharing the same call id, attempt number and call time. satya_cdr has no reliable unique key, so nothing is removed — call-attempt totals are shown as uploaded.",
    });
  }
  if (num(c?.roster_null) > 0) {
    checks.push({
      id: "cdr-roster", level: "info", count: num(c?.roster_null),
      title: "Dial attempts with no roster",
      detail: "The roster filter therefore applies to allocation views only, not to the Call attempts tab.",
    });
  }
  checks.push({
    id: "sources", level: "info", count: num(t?.total) + num(c?.total),
    title: "Source rows",
    detail: `${num(t?.total).toLocaleString("en-IN")} allocation rows (last upload ${String(t?.last_upload ?? "—").slice(0, 16).replace("T", " ")}) and ${num(c?.total).toLocaleString("en-IN")} dial-attempt rows (last upload ${String(c?.last_upload ?? "—").slice(0, 16).replace("T", " ")}).`,
  });
  return checks;
}

export async function getSatyaReport(f: SatyaReportFilters): Promise<SatyaReportData> {
  const dupIds = await allocDuplicateIds();
  const w = allocWhere(f, dupIds);
  const agentW = allocWhere(f, dupIds, { sql: `agent_id IS NOT NULL AND agent_id <> '' AND agent_id <> 'VDCL'`, params: [] });

  const [headlineR, rosterR, dailyR, subR, agentR, whR, beatR, availR, whListR, calls, checks] = await Promise.all([
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
    db.execute<RowDataPacket[]>(`SELECT ${WH} AS wh FROM ${A} UNION SELECT ${WH} AS wh FROM ${C} ORDER BY wh`),
    getCallsData(f),
    getChecks(dupIds),
  ]);

  const h = headlineR[0][0];
  return {
    filters: f,
    available: {
      minDate: availR[0][0]?.min_d ? String(availR[0][0].min_d) : null,
      maxDate: availR[0][0]?.max_d ? String(availR[0][0].max_d) : null,
      warehouses: whListR[0].map((r) => String(r.wh)),
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

const DETAIL_DIMENSION: Record<SatyaDetailType, { alloc: string; cdr: string; breakdownLabel: string; breakdownExpr: string }> = {
  agent: { alloc: `agent_id = ?`, cdr: `agent_name = ?`, breakdownLabel: "Beat-wise", breakdownExpr: BEAT },
  beat: { alloc: `(${BEAT}) = ?`, cdr: `(${BEAT}) = ?`, breakdownLabel: "Agent-wise", breakdownExpr: `agent_id` },
  warehouse: { alloc: `(${WH}) = ?`, cdr: `(${WH}) = ?`, breakdownLabel: "Beat-wise", breakdownExpr: BEAT },
};

/** One agent / beat / warehouse in full -- backs the row drill-down drawer.
 * Same date/warehouse/roster filters as the list it was opened from, so the
 * drawer's totals equal the row that was clicked. */
export async function getSatyaDetail(type: SatyaDetailType, key: string, f: SatyaReportFilters): Promise<SatyaDetail | null> {
  const dim = DETAIL_DIMENSION[type];
  const dupIds = await allocDuplicateIds();
  const w = allocWhere(f, dupIds, { sql: dim.alloc, params: [key] });
  const cw = cdrWhere(f, { sql: dim.cdr, params: [key] });

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
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS attempts, SUM(scenario = 'Connected') AS connected, SUM(sub_scenario_1 = 'Order Placed') AS order_calls,
         AVG(CAST(attempt AS UNSIGNED)) AS avg_attempt
       FROM ${C} ${cw.sql}`, cw.params),
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
