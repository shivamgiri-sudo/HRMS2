import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Bellavita Chat "Overview" snapshot -- the Chat Dashboard BVO table (Planned
 * Capacity ... Conversion % On Unique) for MTD, each week and each day.
 *
 * Sources (all confirmed against live data 2026-09-19; the Chat figures below
 * reproduce the reference snapshot exactly -- 10,501 / 8,626 / 2,227 / 90%):
 * - Chat volumes: db_masmis.new_bb_chat WHERE user_type IN ('Chat','Kenaz',
 *   'Bevzilla'). "Overall" is those three combined and nothing else (Email is
 *   excluded); the filter narrows to one of them.
 *   - Overall Chat Volume = COUNT(*)
 *   - Unique Chat Volume  = repeat_status = 'Unique'
 *   - Repeat 24/48/72hrs  = repeat_status_on_assign_time 'Within 24hrs' /
 *     'Within 48hrs' / 'Within 72hrs'; "More then 72hrs" = any 'More%'
 *   - FRT%                = frt_tat = 'IN TAT' / overall
 *   - Without Agent FRT   = frt IS NULL
 * - Sales: db_masmis.bb_sale WHERE campaign = 'Chat' AND calling_status =
 *   'Sale Made'. bb_sale has one row per order LINE ITEM, so an order repeats
 *   (live: 837 rows for 308 orders) and each row carries the whole order's
 *   amount. Sales are therefore counted per DISTINCT bella_vita_order_id and
 *   revenue takes ONE amount per order -- summing rows would inflate revenue
 *   almost threefold (613,287 vs 224,251). The duplicate row count and the
 *   duplicate revenue are reported alongside. bb_sale has no Kenaz/Bevzilla
 *   split, so sales metrics are shown for Overall and Chat only.
 * - Planned Capacity: a business commitment, not derivable from data. Read
 *   from mas_hrms.dashboard_metric_target (monthly, per user type) and set
 *   through setPlannedCapacity below. A month's capacity covers the whole
 *   month; a week or day gets its share by days. Left empty (shown as "-")
 *   until someone sets it -- never invented.
 */

export const CHAT_USER_TYPES = ["Chat", "Kenaz", "Bevzilla"] as const;
export type ChatUserType = (typeof CHAT_USER_TYPES)[number];
export type OverviewUserType = "Overall" | ChatUserType;

export function parseUserType(v: unknown): OverviewUserType {
  const s = String(v ?? "").trim().toLowerCase();
  const hit = CHAT_USER_TYPES.find((t) => t.toLowerCase() === s);
  return hit ?? "Overall";
}

const DASHBOARD_CODE = "bellavita_chat";
const CAPACITY_CODE: Record<ChatUserType, string> = {
  Chat: "BB_CHAT_CAPACITY_CHAT",
  Kenaz: "BB_CHAT_CAPACITY_KENAZ",
  Bevzilla: "BB_CHAT_CAPACITY_BEVZILLA",
};

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (v: number): number => Math.round(v * 100) / 100;
const pct = (part: number, whole: number): number => (whole > 0 ? round2((part / whole) * 100) : 0);
const p2 = (n: number): string => String(n).padStart(2, "0");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_RANGE_DAYS = 366;
const MAX_DAILY_COLUMNS = 62;

/* ------------------------------ date helpers ------------------------------ */

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}
function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
function todayLocal(): string {
  const n = new Date();
  return `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}`;
}
function resolveRange(fromInput: string, toInput: string): { from: string; to: string } {
  const today = todayLocal();
  let from = DATE_RE.test(fromInput) ? fromInput : `${today.slice(0, 7)}-01`;
  let to = DATE_RE.test(toInput) ? toInput : today;
  if (from > to) [from, to] = [to, from];
  if (addDays(from, MAX_RANGE_DAYS) < to) to = addDays(from, MAX_RANGE_DAYS);
  return { from, to };
}
const dayLabel = (iso: string): string => `${iso.slice(8, 10)}-${MON[Number(iso.slice(5, 7)) - 1]}`;
const weekNo = (iso: string): number => Math.min(5, Math.ceil(Number(iso.slice(8, 10)) / 7));

/* --------------------------------- types ---------------------------------- */

export interface OverviewColumn {
  key: string; label: string; kind: "mtd" | "week" | "day"; from: string; to: string;
}

export interface OverviewValues {
  plannedCapacity: number | null;
  overallChat: number;
  capacityUtilizationPct: number | null;
  frtPct: number;
  repeat24: number; repeat48: number; repeat72: number; repeatMore72: number;
  unique: number;
  withoutAgentFrt: number;
  saleMade: number | null;
  revenue: number | null;
  aov: number | null;
  convOverallPct: number | null;
  convUniquePct: number | null;
  /** bb_sale rows beyond the first for an already-counted order. */
  duplicateOrderRows: number | null;
  /** Revenue those duplicate rows would have added if summed. */
  duplicateRevenue: number | null;
  /** PTP (Sale & Revenue Metrics) order-type split: final_status = 'RTO' vs
   * the rest of Sale Made orders ("Prepaid" -- i.e. not returned), same
   * deduped order set as saleMade/revenue. rtoCount + prepaidCount always
   * equals saleMade. */
  rtoCount: number | null;
  prepaidCount: number | null;
  rtoPct: number | null;
}

/** The six QRC categories, in the order the reference "BVO Chat QRC" sheet lists them. */
export const QRC_CATEGORIES = ["Escalation", "Inactive chat", "Inactive sale chat", "Query", "Request chat", "Saleschat"] as const;

export interface QrcColumnValues {
  /** Unique chats per category. */
  counts: Record<string, number>;
  /** Sum of the six categories -- the reference sheet's "Grand Total". */
  total: number;
  /** Unique chats that carry no (or an unrecognised) disposition; excluded from total. */
  untagged: number;
  /** Days in the column that have chats, and how many of them have a disposition source. */
  dataDays: number;
  coveredDays: number;
}

export interface QrcData {
  categories: string[];
  /** null = the column has chats but no day in it has a disposition to count. */
  values: Record<string, QrcColumnValues | null>;
  /** Dates with chats but no disposition in either chat table. */
  uncoveredDates: string[];
  note: string | null;
}

export interface OrderIntegrity {
  saleRows: number;
  uniqueOrders: number;
  duplicateRows: number;
  grossRevenue: number;
  revenue: number;
  duplicateRevenue: number;
  /** Sale Made rows with no bella_vita_order_id -- cannot be de-duplicated, so not counted. */
  blankOrderIdRows: number;
}

export interface DayNightSplit { overall: number; unique: number; frtPct: number }
export interface RosterSummary { roster: number; present: number; ul: number; ulPct: number }
export interface TopAgentRow {
  agent: string; empId: string; overall: number; unique: number;
  saleCount: number | null; revenue: number | null; conversionPct: number | null; frtPct: number;
}

export interface BellavitaChatOverviewData {
  from: string; to: string;
  userType: OverviewUserType;
  columns: OverviewColumn[];
  values: Record<string, OverviewValues>;
  qrc: QrcData;
  daily: Array<{
    date: string; overall: number; unique: number; repeatChat: number; frtPct: number; inTat: number;
    withoutAgentFrt: number; repeat24: number; repeat48: number; repeat72: number; repeatMore72: number;
    saleMade: number | null; revenue: number | null; plannedCapacity: number | null;
    rtoCount: number | null; prepaidCount: number | null;
  }>;
  salesAvailable: boolean;
  salesNote: string | null;
  integrity: OrderIntegrity | null;
  /** The month of `to`, for the capacity setter. */
  capacity: { month: string; byType: Record<ChatUserType, number | null> };
  latestChatDate: string | null;
  dailyColumnsOmitted: boolean;
  /** All for the selected range as a whole (not per week/day column), since
   * the reference dashboard shows each as a single summary, not a matrix. */
  avgResolutionMin: number | null;
  /** Real day_shift_night_shift split (new_bb_chat) -- Sale/Revenue/AOV/
   * Conversion% are NOT split here: bb_sale carries no timestamp or shift
   * column to attribute an order to day vs night, so only chat-side figures
   * (which ARE real per row) are shown. */
  dayNight: { day: DayNightSplit; night: DayNightSplit } | null;
  /** Roster/Present/UL from db_masmis.bb_apr WHERE lob = 'BVO Chat' -- bb_apr
   * has no Kenaz/Bevzilla split either, so (like sales) this is the same
   * shared Chat-roster figure on every tab, not per-LOB. UL ("unplanned
   * leave") is derived as roster minus present -- bb_apr has no real
   * planned/unplanned leave flag, so this is "scheduled but never marked
   * present in range", not a genuine UL code from source data. */
  roster: RosterSummary | null;
  /** COUNT of new_bb_chat rows with a real fraud flag set, for the selected
   * range -- real column, currently NULL on every uploaded row (confirmed
   * live 2026-09-23), so this is 0 until an upload actually carries fraud
   * flags, never invented. */
  fraudCount: number;
  /** Top 10 agents by chat volume for the selected range, from new_bb_chat
   * (not the legacy bb_chat table), joined to bb_sale by emp_id for
   * saleCount/revenue/conversionPct where a real emp_id exists. */
  topAgents: TopAgentRow[];
  /** Admin-settable FRT% target (dashboard_metric_target, like Planned
   * Capacity) -- null until someone sets it, never a hardcoded assumption. */
  frtTarget: number | null;
}

interface Agg { overall: number; unique: number; r24: number; r48: number; r72: number; rmore: number; inTat: number; noFrt: number }
const emptyAgg = (): Agg => ({ overall: 0, unique: 0, r24: 0, r48: 0, r72: 0, rmore: 0, inTat: 0, noFrt: 0 });
interface SaleAgg { orders: number; revenue: number; rows: number; gross: number; rtoOrders: number }
const emptySale = (): SaleAgg => ({ orders: 0, revenue: 0, rows: 0, gross: 0, rtoOrders: 0 });

const typesFor = (t: OverviewUserType): ChatUserType[] => (t === "Overall" ? [...CHAT_USER_TYPES] : [t]);
/** bb_sale's campaign column only ever holds a single combined 'Chat' value
 * (no Kenaz/Bevzilla split), so sales figures exist for Overall and Chat
 * only. Kenaz/Bevzilla tabs show no sale-related figures at all (explicit
 * request 2026-09-23) -- and skip those queries entirely, which also makes
 * those tabs load faster. */
const salesAvailableFor = (t: OverviewUserType): boolean => t === "Overall" || t === "Chat";

/* --------------------------------- queries -------------------------------- */

async function loadChatDaily(from: string, to: string, types: ChatUserType[]): Promise<Map<string, Agg>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(chat_date, '%Y-%m-%d') AS d,
       COUNT(*) AS overall,
       SUM(repeat_status = 'Unique') AS uniq,
       SUM(repeat_status_on_assign_time = 'Within 24hrs') AS r24,
       SUM(repeat_status_on_assign_time = 'Within 48hrs') AS r48,
       SUM(repeat_status_on_assign_time = 'Within 72hrs') AS r72,
       SUM(repeat_status_on_assign_time LIKE 'More%') AS rmore,
       SUM(frt_tat = 'IN TAT') AS in_tat,
       SUM(frt IS NULL) AS no_frt
     FROM db_masmis.new_bb_chat
     WHERE chat_date BETWEEN ? AND ? AND user_type IN (${types.map(() => "?").join(",")})
     GROUP BY chat_date`,
    [from, to, ...types],
  );
  const m = new Map<string, Agg>();
  for (const r of rows) {
    m.set(String(r.d), {
      overall: num(r.overall), unique: num(r.uniq), r24: num(r.r24), r48: num(r.r48), r72: num(r.r72),
      rmore: num(r.rmore), inTat: num(r.in_tat), noFrt: num(r.no_frt),
    });
  }
  return m;
}

interface QrcDay { counts: Record<string, number>; untagged: number }

/**
 * Unique chats per disposition per day. The disposition (Escalation / Inactive chat /
 * Inactive sale chat / Query / Request chat / Saleschat) lives in the chat export's
 * "Disposition" column. new_bb_chat is the current chat table but its uploads so far
 * carry no disposition; the older bb_chat has it for the dates it covers (identical
 * chats, checked 1-4 Sep). So per date: new_bb_chat if it has dispositions for that date,
 * otherwise bb_chat, otherwise the date is reported as uncovered -- never guessed.
 */
async function loadQrcDaily(from: string, to: string, types: ChatUserType[]): Promise<Map<string, QrcDay>> {
  const known = new Set<string>(QRC_CATEGORIES);
  const sql = (table: string) => `SELECT DATE_FORMAT(chat_date, '%Y-%m-%d') AS d, TRIM(COALESCE(disposition, '')) AS disp, COUNT(*) AS n
       FROM db_masmis.${table}
      WHERE chat_date BETWEEN ? AND ? AND user_type IN (${types.map(() => "?").join(",")}) AND repeat_status = 'Unique'
      GROUP BY chat_date, TRIM(COALESCE(disposition, ''))`;
  const params = [from, to, ...types];
  const [[newRows], [oldRows]] = await Promise.all([
    db.execute<RowDataPacket[]>(sql("new_bb_chat"), params),
    db.execute<RowDataPacket[]>(sql("bb_chat"), params),
  ]);
  const group = (rows: RowDataPacket[]) => {
    const m = new Map<string, QrcDay & { hasDisposition: boolean }>();
    for (const r of rows) {
      const d = String(r.d);
      const cur = m.get(d) ?? { counts: {}, untagged: 0, hasDisposition: false };
      const disp = String(r.disp);
      if (known.has(disp)) { cur.counts[disp] = (cur.counts[disp] ?? 0) + num(r.n); cur.hasDisposition = true; }
      else cur.untagged += num(r.n);
      m.set(d, cur);
    }
    return m;
  };
  const fromNew = group(newRows);
  const fromOld = group(oldRows);
  const out = new Map<string, QrcDay>();
  for (const d of new Set([...fromNew.keys(), ...fromOld.keys()])) {
    const n = fromNew.get(d);
    const o = fromOld.get(d);
    const pick = n?.hasDisposition ? n : o?.hasDisposition ? o : null;
    if (pick) out.set(d, { counts: pick.counts, untagged: pick.untagged });
  }
  return out;
}

const SALE_WHERE = "campaign = 'Chat' AND calling_status = 'Sale Made'";

async function loadSalesDaily(from: string, to: string): Promise<{ daily: Map<string, SaleAgg>; blankRows: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(d, '%Y-%m-%d') AS d, COUNT(*) AS orders, SUM(a) AS revenue, SUM(n) AS row_cnt, SUM(gross) AS gross,
       SUM(is_rto) AS rto_orders
     FROM (
       SELECT MIN(\`Date\`) AS d, MAX(amount) AS a, COUNT(*) AS n, SUM(amount) AS gross,
         MAX(final_status = 'RTO') AS is_rto
       FROM db_masmis.bb_sale
       WHERE ${SALE_WHERE} AND \`Date\` BETWEEN ? AND ?
         AND bella_vita_order_id IS NOT NULL AND bella_vita_order_id <> ''
       GROUP BY bella_vita_order_id
     ) x
     GROUP BY d`,
    [from, to],
  );
  const daily = new Map<string, SaleAgg>();
  for (const r of rows) {
    daily.set(String(r.d), { orders: num(r.orders), revenue: num(r.revenue), rows: num(r.row_cnt), gross: num(r.gross), rtoOrders: num(r.rto_orders) });
  }
  const [[blank]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM db_masmis.bb_sale
      WHERE ${SALE_WHERE} AND \`Date\` BETWEEN ? AND ? AND (bella_vita_order_id IS NULL OR bella_vita_order_id = '')`,
    [from, to],
  );
  return { daily, blankRows: num(blank?.n) };
}

/** Real bb_sale.emp_id has no LOB split either (same as loadSalesDaily) --
 * for the Top Agents revenue join, keyed case-insensitively (same reason
 * documented in bellavita-agent-performance.service.ts: MySQL's GROUP BY
 * hands back an arbitrary-case emp_id). */
async function loadSalesByAgent(from: string, to: string): Promise<Map<string, { orders: number; revenue: number }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT s.emp_id AS emp_id, COUNT(*) AS orders, SUM(s.amount) AS revenue
     FROM db_masmis.bb_sale s
     INNER JOIN (
       SELECT bella_vita_order_id, MAX(id) AS keep_id
       FROM db_masmis.bb_sale
       WHERE ${SALE_WHERE} AND \`Date\` BETWEEN ? AND ?
         AND bella_vita_order_id IS NOT NULL AND bella_vita_order_id <> ''
       GROUP BY bella_vita_order_id
     ) dk ON dk.keep_id = s.id
     WHERE s.emp_id IS NOT NULL AND s.emp_id <> ''
     GROUP BY s.emp_id`,
    [from, to],
  );
  const out = new Map<string, { orders: number; revenue: number }>();
  for (const r of rows) out.set(String(r.emp_id).toUpperCase(), { orders: num(r.orders), revenue: num(r.revenue) });
  return out;
}

async function loadAvgResolution(from: string, to: string, types: ChatUserType[]): Promise<number | null> {
  const [[row]] = await db.execute<RowDataPacket[]>(
    `SELECT AVG(CAST(resolution_time_in_min AS DECIMAL(10,2))) AS avg_min
     FROM db_masmis.new_bb_chat
     WHERE chat_date BETWEEN ? AND ? AND user_type IN (${types.map(() => "?").join(",")})
       AND resolution_time_in_min IS NOT NULL AND resolution_time_in_min <> ''`,
    [from, to, ...types],
  );
  return row?.avg_min !== null && row?.avg_min !== undefined ? round2(Number(row.avg_min)) : null;
}

/** day_shift_night_shift is a real, clean column (confirmed live 2026-09-23:
 * only 'Day Shift'/'Night Shift', no other values) -- unlike same_day_connect
 * elsewhere in this codebase, this one is trustworthy as-is. Sale-side
 * figures (Sale Made/Revenue/AOV/Conversion%) are NOT split here: bb_sale
 * carries no timestamp/shift column to attribute an order to a shift. */
async function loadDayNight(from: string, to: string, types: ChatUserType[]): Promise<{ day: DayNightSplit; night: DayNightSplit } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT day_shift_night_shift AS shift, COUNT(*) AS overall,
       SUM(repeat_status = 'Unique') AS uniq, SUM(frt_tat = 'IN TAT') AS in_tat
     FROM db_masmis.new_bb_chat
     WHERE chat_date BETWEEN ? AND ? AND user_type IN (${types.map(() => "?").join(",")})
       AND day_shift_night_shift IN ('Day Shift', 'Night Shift')
     GROUP BY day_shift_night_shift`,
    [from, to, ...types],
  );
  if (rows.length === 0) return null;
  const empty = (): DayNightSplit => ({ overall: 0, unique: 0, frtPct: 0 });
  const split = { day: empty(), night: empty() };
  for (const r of rows) {
    const overall = num(r.overall);
    const target = String(r.shift) === "Day Shift" ? split.day : split.night;
    target.overall = overall; target.unique = num(r.uniq); target.frtPct = pct(num(r.in_tat), overall);
  }
  return split;
}

/** bb_apr has no Kenaz/Bevzilla split (lob = 'BVO Chat' covers all of Chat
 * roster together, confirmed live) -- same shared-figure convention as
 * sales above. UL = roster minus present is a DERIVED absence count, not a
 * real "unplanned leave" flag from source data (bb_apr's own attendance_1
 * only has present/half-day values, no leave-type code) -- documented on
 * the RosterSummary type itself, not silently presented as a real UL flag. */
async function loadRoster(from: string, to: string): Promise<RosterSummary | null> {
  const [[row]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT noiid) AS roster,
       COUNT(DISTINCT CASE WHEN attendance_1 IN ('P', '1', '1.00', '0.5', '0.50', 'HD') THEN noiid END) AS present
     FROM db_masmis.bb_apr
     WHERE report_date BETWEEN ? AND ? AND lob = 'BVO Chat'`,
    [from, to],
  );
  const roster = num(row?.roster);
  if (roster === 0) return null;
  const present = num(row?.present);
  const ul = Math.max(0, roster - present);
  return { roster, present, ul, ulPct: pct(ul, roster) };
}

/** `fraud` is a real column on new_bb_chat but every uploaded row has it
 * NULL (confirmed live 2026-09-23) -- this returns the real count (0 today),
 * never a fabricated figure, and will reflect real flags the moment an
 * upload actually carries them. */
async function loadFraudCount(from: string, to: string, types: ChatUserType[]): Promise<number> {
  const [[row]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM db_masmis.new_bb_chat
     WHERE chat_date BETWEEN ? AND ? AND user_type IN (${types.map(() => "?").join(",")})
       AND fraud IS NOT NULL AND fraud NOT IN ('', '0', 'No', 'FALSE', 'false')`,
    [from, to, ...types],
  );
  return num(row?.n);
}

/** Top 10 agents by chat volume, from new_bb_chat (not the legacy bb_chat
 * table this Overview otherwise avoids) so agent identity stays consistent
 * with every other figure on this page. */
async function loadTopAgents(from: string, to: string, types: ChatUserType[], withSales: boolean): Promise<TopAgentRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(current_agent, ''), 'Unassigned') AS agent, MAX(emp_id) AS emp_id,
       COUNT(*) AS overall, SUM(repeat_status = 'Unique') AS uniq, SUM(frt_tat = 'IN TAT') AS in_tat
     FROM db_masmis.new_bb_chat
     WHERE chat_date BETWEEN ? AND ? AND user_type IN (${types.map(() => "?").join(",")})
     GROUP BY agent ORDER BY overall DESC LIMIT 10`,
    [from, to, ...types],
  );
  const salesByAgent = withSales ? await loadSalesByAgent(from, to) : new Map<string, { orders: number; revenue: number }>();
  return rows.map((r) => {
    const empId = String(r.emp_id || "");
    const sale = empId ? salesByAgent.get(empId.toUpperCase()) : undefined;
    const overall = num(r.overall);
    return {
      agent: String(r.agent), empId,
      overall, unique: num(r.uniq), frtPct: pct(num(r.in_tat), overall),
      saleCount: sale ? sale.orders : null,
      revenue: sale ? round2(sale.revenue) : null,
      conversionPct: sale ? pct(sale.orders, overall) : null,
    };
  });
}

export interface OverviewAgentTrendRow {
  date: string; overall: number; unique: number; inTat: number;
  saleMade: number | null; revenue: number | null;
}

/** One agent's day-by-day figures for the Overview's Top Agents row click.
 * Same source and agent identity as loadTopAgents (new_bb_chat grouped by
 * current_agent, 'Unassigned' when blank), so a row's totals always equal
 * the sum of its own days. Sales/revenue join bb_sale by emp_id with the same
 * dedup-by-order pattern as loadSalesByAgent, and only when sales exist for
 * this tab and the row has a real emp_id (else null, never 0). */
export async function getBellavitaChatOverviewAgentTrend(
  fromInput: string, toInput: string, userType: OverviewUserType, agent: string, empId: string,
): Promise<OverviewAgentTrendRow[]> {
  const { from, to } = resolveRange(fromInput, toInput);
  const types = typesFor(userType);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(chat_date, '%Y-%m-%d') AS d, COUNT(*) AS overall,
       SUM(repeat_status = 'Unique') AS uniq, SUM(frt_tat = 'IN TAT') AS in_tat
     FROM db_masmis.new_bb_chat
     WHERE chat_date BETWEEN ? AND ? AND user_type IN (${types.map(() => "?").join(",")})
       AND COALESCE(NULLIF(current_agent, ''), 'Unassigned') = ?
     GROUP BY chat_date ORDER BY chat_date`,
    [from, to, ...types, agent],
  );

  let salesByDate: Map<string, { n: number; revenue: number }> | null = null;
  if (salesAvailableFor(userType) && empId.trim()) {
    const [saleRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(s.\`Date\`, '%Y-%m-%d') AS d, COUNT(*) AS n, SUM(s.amount) AS revenue
       FROM db_masmis.bb_sale s
       INNER JOIN (
         SELECT bella_vita_order_id, MAX(id) AS keep_id
         FROM db_masmis.bb_sale
         WHERE ${SALE_WHERE} AND \`Date\` BETWEEN ? AND ?
           AND bella_vita_order_id IS NOT NULL AND bella_vita_order_id <> ''
         GROUP BY bella_vita_order_id
       ) dk ON dk.keep_id = s.id
       WHERE s.emp_id = ?
       GROUP BY s.\`Date\``,
      [from, to, empId.trim()],
    );
    salesByDate = new Map(saleRows.map((r) => [String(r.d), { n: num(r.n), revenue: num(r.revenue) }]));
  }

  return rows.map((r) => {
    const d = String(r.d);
    const s = salesByDate?.get(d);
    return {
      date: d, overall: num(r.overall), unique: num(r.uniq), inTat: num(r.in_tat),
      saleMade: salesByDate ? (s?.n ?? 0) : null,
      revenue: salesByDate ? round2(s?.revenue ?? 0) : null,
    };
  });
}

const FRT_TARGET_METRIC = "BB_CHAT_FRT_TARGET";

/** Admin-settable FRT% target for the month, same storage/lookup pattern as
 * Planned Capacity below -- null (never a hardcoded 95%) until someone sets it. */
async function loadFrtTarget(month: string): Promise<number | null> {
  const first = `${month}-01`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT target_value, DATE_FORMAT(effective_from, '%Y-%m-%d') AS ef, DATE_FORMAT(effective_to, '%Y-%m-%d') AS et
       FROM dashboard_metric_target
      WHERE dashboard_code = ? AND metric_code = ? AND target_period = 'monthly'
        AND branch_id IS NULL AND process_id IS NULL
      ORDER BY effective_from DESC`,
    [DASHBOARD_CODE, FRT_TARGET_METRIC],
  );
  const hit = rows.find((r) => String(r.ef) <= first && (!r.et || String(r.et) >= first));
  return hit ? num(hit.target_value) : null;
}

export async function setFrtTarget(month: string, value: number, actorId: string): Promise<{ oldValue: number | null; newValue: number }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("month must be YYYY-MM");
  if (!Number.isFinite(value) || value <= 0 || value > 100) throw new Error("FRT target must be a percentage between 0 and 100");
  const first = `${month}-01`;
  const last = `${month}-${p2(daysInMonth(month))}`;

  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id, target_value FROM dashboard_metric_target
      WHERE dashboard_code = ? AND metric_code = ? AND target_period = 'monthly'
        AND branch_id IS NULL AND process_id IS NULL AND effective_from = ? LIMIT 1`,
    [DASHBOARD_CODE, FRT_TARGET_METRIC, first],
  );
  if (existing.length) {
    await db.execute<ResultSetHeader>(
      `UPDATE dashboard_metric_target SET target_value = ?, effective_to = ?, updated_at = NOW() WHERE id = ?`,
      [value, last, existing[0].id],
    );
    return { oldValue: num(existing[0].target_value), newValue: value };
  }
  await db.execute<ResultSetHeader>(
    `INSERT INTO dashboard_metric_target
       (id, metric_code, dashboard_code, branch_id, process_id, target_value, target_period,
        effective_from, effective_to, created_by, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, ?, 'monthly', ?, ?, ?, NOW(), NOW())`,
    [randomUUID(), FRT_TARGET_METRIC, DASHBOARD_CODE, value, first, last, actorId],
  );
  return { oldValue: null, newValue: value };
}

/** Monthly capacity per user type for the given months -- the row in force on the 1st. */
async function loadCapacity(months: string[]): Promise<Map<string, Partial<Record<ChatUserType, number>>>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_code, target_value,
            DATE_FORMAT(effective_from, '%Y-%m-%d') AS ef, DATE_FORMAT(effective_to, '%Y-%m-%d') AS et
       FROM dashboard_metric_target
      WHERE dashboard_code = ? AND target_period = 'monthly' AND branch_id IS NULL AND process_id IS NULL
        AND metric_code IN (${CHAT_USER_TYPES.map(() => "?").join(",")})
      ORDER BY effective_from DESC`,
    [DASHBOARD_CODE, ...CHAT_USER_TYPES.map((t) => CAPACITY_CODE[t])],
  );
  const out = new Map<string, Partial<Record<ChatUserType, number>>>();
  for (const ym of months) {
    const first = `${ym}-01`;
    const entry: Partial<Record<ChatUserType, number>> = {};
    for (const t of CHAT_USER_TYPES) {
      const hit = rows.find((r) => r.metric_code === CAPACITY_CODE[t] && String(r.ef) <= first && (!r.et || String(r.et) >= first));
      if (hit) entry[t] = num(hit.target_value);
    }
    out.set(ym, entry);
  }
  return out;
}

/* ------------------------------- the snapshot ------------------------------ */

export async function getBellavitaChatOverview(
  fromInput: string, toInput: string, userType: OverviewUserType,
): Promise<BellavitaChatOverviewData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const types = typesFor(userType);
  const salesAvailable = salesAvailableFor(userType);
  const days = eachDay(from, to);

  const [chatDaily, sales, qrcDaily, avgResolutionMin, dayNight, roster, fraudCount, topAgents] = await Promise.all([
    loadChatDaily(from, to, types),
    salesAvailable ? loadSalesDaily(from, to) : Promise.resolve(null),
    loadQrcDaily(from, to, types),
    loadAvgResolution(from, to, types),
    loadDayNight(from, to, types),
    loadRoster(from, to),
    loadFraudCount(from, to, types),
    loadTopAgents(from, to, types, salesAvailable),
  ]);

  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const capacity = await loadCapacity(months);
  const frtTarget = await loadFrtTarget(months[months.length - 1]);
  const capFor = (ym: string): number | null => {
    const e = capacity.get(ym) ?? {};
    const vals = types.map((t) => e[t]);
    return vals.every((v) => typeof v === "number") ? (vals as number[]).reduce((s, v) => s + v, 0) : null;
  };

  const multiMonth = months.length > 1;
  const columns: OverviewColumn[] = [];
  const singleMonthFromFirst = !multiMonth && from.endsWith("-01");
  columns.push({ key: "mtd", label: singleMonthFromFirst ? "MTD" : "Selected range", kind: "mtd", from, to });

  const weekMap = new Map<string, { label: string; from: string; to: string }>();
  for (const d of days) {
    const key = `${d.slice(0, 7)}-W${weekNo(d)}`;
    const label = multiMonth ? `${MON[Number(d.slice(5, 7)) - 1]} W-${weekNo(d)}` : `W-${weekNo(d)}`;
    const cur = weekMap.get(key);
    if (!cur) weekMap.set(key, { label, from: d, to: d });
    else cur.to = d;
  }
  for (const [key, w] of weekMap) columns.push({ key, label: w.label, kind: "week", from: w.from, to: w.to });
  const dailyColumnsOmitted = days.length > MAX_DAILY_COLUMNS;
  if (!dailyColumnsOmitted) {
    for (const d of days) columns.push({ key: d, label: dayLabel(d), kind: "day", from: d, to: d });
  }

  const values: Record<string, OverviewValues> = {};
  for (const col of columns) {
    const span = eachDay(col.from, col.to);
    const a = emptyAgg();
    const s = emptySale();
    for (const d of span) {
      const c = chatDaily.get(d);
      if (c) {
        a.overall += c.overall; a.unique += c.unique; a.r24 += c.r24; a.r48 += c.r48; a.r72 += c.r72;
        a.rmore += c.rmore; a.inTat += c.inTat; a.noFrt += c.noFrt;
      }
      const sd = sales?.daily.get(d);
      if (sd) { s.orders += sd.orders; s.revenue += sd.revenue; s.rows += sd.rows; s.gross += sd.gross; s.rtoOrders += sd.rtoOrders; }
    }

    // Capacity: a month's figure covers the whole month (so a full MTD column
    // uses it as-is, matching the reference); anything narrower gets its days' share.
    let planned: number | null = 0;
    if (col.kind === "mtd" && singleMonthFromFirst) {
      planned = capFor(from.slice(0, 7));
    } else {
      for (const d of span) {
        const c = capFor(d.slice(0, 7));
        if (c === null) { planned = null; break; }
        planned += c / daysInMonth(d.slice(0, 7));
      }
      if (planned !== null) planned = Math.round(planned);
    }

    values[col.key] = {
      plannedCapacity: planned,
      overallChat: a.overall,
      capacityUtilizationPct: planned && planned > 0 ? pct(a.overall, planned) : null,
      frtPct: pct(a.inTat, a.overall),
      repeat24: a.r24, repeat48: a.r48, repeat72: a.r72, repeatMore72: a.rmore,
      unique: a.unique,
      withoutAgentFrt: a.noFrt,
      saleMade: salesAvailable ? s.orders : null,
      revenue: salesAvailable ? round2(s.revenue) : null,
      aov: salesAvailable ? (s.orders > 0 ? Math.round(s.revenue / s.orders) : 0) : null,
      convOverallPct: salesAvailable ? pct(s.orders, a.overall) : null,
      convUniquePct: salesAvailable ? pct(s.orders, a.unique) : null,
      duplicateOrderRows: salesAvailable ? Math.max(0, s.rows - s.orders) : null,
      duplicateRevenue: salesAvailable ? round2(Math.max(0, s.gross - s.revenue)) : null,
      rtoCount: salesAvailable ? s.rtoOrders : null,
      prepaidCount: salesAvailable ? Math.max(0, s.orders - s.rtoOrders) : null,
      rtoPct: salesAvailable ? pct(s.rtoOrders, s.orders) : null,
    };
  }

  const qrcValues: Record<string, QrcColumnValues | null> = {};
  for (const col of columns) {
    const span = eachDay(col.from, col.to);
    const dataDays = span.filter((d) => (chatDaily.get(d)?.overall ?? 0) > 0);
    const covered = dataDays.filter((d) => qrcDaily.has(d));
    if (dataDays.length > 0 && covered.length === 0) { qrcValues[col.key] = null; continue; }
    const counts: Record<string, number> = Object.fromEntries(QRC_CATEGORIES.map((c) => [c, 0]));
    let untagged = 0;
    for (const d of covered) {
      const day = qrcDaily.get(d)!;
      for (const c of QRC_CATEGORIES) counts[c] += day.counts[c] ?? 0;
      untagged += day.untagged;
    }
    qrcValues[col.key] = {
      counts, total: QRC_CATEGORIES.reduce((sum, c) => sum + counts[c], 0), untagged,
      dataDays: dataDays.length, coveredDays: covered.length,
    };
  }
  const uncoveredDates = days.filter((d) => (chatDaily.get(d)?.overall ?? 0) > 0 && !qrcDaily.has(d));
  const qrc: QrcData = {
    categories: [...QRC_CATEGORIES],
    values: qrcValues,
    uncoveredDates,
    note: uncoveredDates.length > 0
      ? `Disposition is missing for ${uncoveredDates.length} of the days in this range (${uncoveredDates[0]}${uncoveredDates.length > 1 ? ` to ${uncoveredDates[uncoveredDates.length - 1]}` : ""}) because the chat export uploaded for them has no Disposition column filled in. Those days are not counted, so weekly and MTD totals cover only the days that have it. Re-upload the chat export with Disposition to complete them.`
      : null,
  };

  let integrity: OrderIntegrity | null = null;
  if (sales) {
    const t = emptySale();
    for (const v of sales.daily.values()) { t.orders += v.orders; t.revenue += v.revenue; t.rows += v.rows; t.gross += v.gross; }
    integrity = {
      saleRows: t.rows, uniqueOrders: t.orders, duplicateRows: Math.max(0, t.rows - t.orders),
      grossRevenue: round2(t.gross), revenue: round2(t.revenue), duplicateRevenue: round2(Math.max(0, t.gross - t.revenue)),
      blankOrderIdRows: sales.blankRows,
    };
  }

  const lastMonth = months[months.length - 1];
  const capNow = capacity.get(lastMonth) ?? {};
  const [[latest]] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(MAX(chat_date), '%Y-%m-%d') AS d FROM db_masmis.new_bb_chat WHERE user_type IN (${CHAT_USER_TYPES.map(() => "?").join(",")})`,
    [...CHAT_USER_TYPES],
  );

  return {
    from, to, userType, columns, values, qrc,
    daily: days.map((d) => {
      const dayCap = capFor(d.slice(0, 7));
      const c = chatDaily.get(d);
      const overall = c?.overall ?? 0;
      const unique = c?.unique ?? 0;
      const sd = sales?.daily.get(d);
      const orders = sd?.orders ?? 0;
      return {
        date: d,
        overall, unique,
        repeatChat: Math.max(0, overall - unique),
        withoutAgentFrt: c?.noFrt ?? 0,
        repeat24: c?.r24 ?? 0, repeat48: c?.r48 ?? 0, repeat72: c?.r72 ?? 0, repeatMore72: c?.rmore ?? 0,
        frtPct: pct(c?.inTat ?? 0, overall), inTat: c?.inTat ?? 0,
        saleMade: sales ? orders : null,
        revenue: sales ? round2(sd?.revenue ?? 0) : null,
        rtoCount: sales ? (sd?.rtoOrders ?? 0) : null,
        prepaidCount: sales ? Math.max(0, orders - (sd?.rtoOrders ?? 0)) : null,
        plannedCapacity: dayCap !== null ? Math.round(dayCap / daysInMonth(d.slice(0, 7))) : null,
      };
    }),
    salesAvailable,
    salesNote: userType === "Overall"
      ? "Sales come from bb_sale's 'Chat' campaign, which has no Kenaz/Bevzilla split, so for Overall the same Chat-campaign sales are set against the combined chat volume."
      : null,
    integrity,
    capacity: {
      month: lastMonth,
      byType: { Chat: capNow.Chat ?? null, Kenaz: capNow.Kenaz ?? null, Bevzilla: capNow.Bevzilla ?? null },
    },
    latestChatDate: latest?.d ? String(latest.d) : null,
    dailyColumnsOmitted,
    avgResolutionMin, dayNight, roster, fraudCount, topAgents, frtTarget,
  };
}

/* -------------------------------- drill-down ------------------------------- */

export interface BellavitaChatPeriodDetail {
  from: string; to: string; userType: OverviewUserType;
  byUserType: Array<{ userType: string; overall: number; unique: number; frtPct: number; repeat24: number }>;
  byTl: Array<{ tlName: string; overall: number; unique: number; frtPct: number }>;
  byAgent: Array<{ agent: string; empId: string; overall: number; unique: number; frtPct: number }>;
  integrity: OrderIntegrity | null;
  duplicateOrders: Array<{ orderId: string; date: string; amount: number; rows: number; extraRevenue: number }>;
}

const DETAIL_LIST_LIMIT = 100;

export async function getBellavitaChatPeriodDetail(
  fromInput: string, toInput: string, userType: OverviewUserType,
): Promise<BellavitaChatPeriodDetail> {
  const { from, to } = resolveRange(fromInput, toInput);
  const types = typesFor(userType);
  const inTypes = `user_type IN (${types.map(() => "?").join(",")})`;
  const chatParams = [from, to, ...types];
  const base = `FROM db_masmis.new_bb_chat WHERE chat_date BETWEEN ? AND ? AND ${inTypes}`;

  const [byType] = await db.execute<RowDataPacket[]>(
    `SELECT user_type, COUNT(*) AS n, SUM(repeat_status = 'Unique') AS uniq, SUM(frt_tat = 'IN TAT') AS in_tat,
            SUM(repeat_status_on_assign_time = 'Within 24hrs') AS r24
     ${base} GROUP BY user_type ORDER BY n DESC`,
    chatParams,
  );
  const [byTl] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(tl_name, ''), 'Unassigned') AS tl, COUNT(*) AS n, SUM(repeat_status = 'Unique') AS uniq, SUM(frt_tat = 'IN TAT') AS in_tat
     ${base} GROUP BY tl ORDER BY n DESC LIMIT ${DETAIL_LIST_LIMIT}`,
    chatParams,
  );
  const [byAgent] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(current_agent, ''), 'Unassigned') AS agent, MAX(emp_id) AS emp_id, COUNT(*) AS n,
            SUM(repeat_status = 'Unique') AS uniq, SUM(frt_tat = 'IN TAT') AS in_tat
     ${base} GROUP BY agent ORDER BY n DESC LIMIT ${DETAIL_LIST_LIMIT}`,
    chatParams,
  );

  let integrity: OrderIntegrity | null = null;
  let duplicateOrders: BellavitaChatPeriodDetail["duplicateOrders"] = [];
  if (salesAvailableFor(userType)) {
    const s = await loadSalesDaily(from, to);
    const t = emptySale();
    for (const v of s.daily.values()) { t.orders += v.orders; t.revenue += v.revenue; t.rows += v.rows; t.gross += v.gross; }
    integrity = {
      saleRows: t.rows, uniqueOrders: t.orders, duplicateRows: Math.max(0, t.rows - t.orders),
      grossRevenue: round2(t.gross), revenue: round2(t.revenue), duplicateRevenue: round2(Math.max(0, t.gross - t.revenue)),
      blankOrderIdRows: s.blankRows,
    };
    const [dups] = await db.execute<RowDataPacket[]>(
      `SELECT bella_vita_order_id AS id, DATE_FORMAT(MIN(\`Date\`), '%Y-%m-%d') AS d, MAX(amount) AS amt, COUNT(*) AS n, SUM(amount) AS gross
         FROM db_masmis.bb_sale
        WHERE ${SALE_WHERE} AND \`Date\` BETWEEN ? AND ? AND bella_vita_order_id IS NOT NULL AND bella_vita_order_id <> ''
        GROUP BY bella_vita_order_id HAVING COUNT(*) > 1
        ORDER BY n DESC, amt DESC LIMIT ${DETAIL_LIST_LIMIT}`,
      [from, to],
    );
    duplicateOrders = dups.map((r) => ({
      orderId: String(r.id), date: String(r.d), amount: num(r.amt), rows: num(r.n),
      extraRevenue: round2(num(r.gross) - num(r.amt)),
    }));
  }

  return {
    from, to, userType,
    byUserType: byType.map((r) => ({
      userType: String(r.user_type), overall: num(r.n), unique: num(r.uniq), frtPct: pct(num(r.in_tat), num(r.n)), repeat24: num(r.r24),
    })),
    byTl: byTl.map((r) => ({ tlName: String(r.tl), overall: num(r.n), unique: num(r.uniq), frtPct: pct(num(r.in_tat), num(r.n)) })),
    byAgent: byAgent.map((r) => ({
      agent: String(r.agent), empId: String(r.emp_id ?? ""), overall: num(r.n), unique: num(r.uniq), frtPct: pct(num(r.in_tat), num(r.n)),
    })),
    integrity,
    duplicateOrders,
  };
}

/* ------------------------------ planned capacity --------------------------- */

export interface CapacityChange {
  userType: ChatUserType; month: string;
  oldValue: number | null; newValue: number;
}

/** Sets one month's planned capacity for one user type. The row is dated to
 * exactly that month; changing it again updates that row, and the old value
 * is returned so the caller can audit it. */
export async function setPlannedCapacity(
  userType: ChatUserType, month: string, capacity: number, actorId: string,
): Promise<CapacityChange> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("month must be YYYY-MM");
  if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 10_000_000) throw new Error("capacity must be a positive number");
  const first = `${month}-01`;
  const last = `${month}-${p2(daysInMonth(month))}`;
  const metric = CAPACITY_CODE[userType];

  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id, target_value FROM dashboard_metric_target
      WHERE dashboard_code = ? AND metric_code = ? AND target_period = 'monthly'
        AND branch_id IS NULL AND process_id IS NULL AND effective_from = ? LIMIT 1`,
    [DASHBOARD_CODE, metric, first],
  );
  if (existing.length) {
    await db.execute<ResultSetHeader>(
      `UPDATE dashboard_metric_target SET target_value = ?, effective_to = ?, updated_at = NOW() WHERE id = ?`,
      [capacity, last, existing[0].id],
    );
    return { userType, month, oldValue: num(existing[0].target_value), newValue: capacity };
  }
  await db.execute<ResultSetHeader>(
    `INSERT INTO dashboard_metric_target
       (id, metric_code, dashboard_code, branch_id, process_id, target_value, target_period,
        effective_from, effective_to, created_by, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, ?, 'monthly', ?, ?, ?, NOW(), NOW())`,
    [randomUUID(), metric, DASHBOARD_CODE, capacity, first, last, actorId],
  );
  return { userType, month, oldValue: null, newValue: capacity };
}
