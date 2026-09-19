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

export interface BellavitaChatOverviewData {
  from: string; to: string;
  userType: OverviewUserType;
  columns: OverviewColumn[];
  values: Record<string, OverviewValues>;
  daily: Array<{ date: string; overall: number; unique: number; saleMade: number | null }>;
  salesAvailable: boolean;
  salesNote: string | null;
  integrity: OrderIntegrity | null;
  /** The month of `to`, for the capacity setter. */
  capacity: { month: string; byType: Record<ChatUserType, number | null> };
  latestChatDate: string | null;
  dailyColumnsOmitted: boolean;
}

interface Agg { overall: number; unique: number; r24: number; r48: number; r72: number; rmore: number; inTat: number; noFrt: number }
const emptyAgg = (): Agg => ({ overall: 0, unique: 0, r24: 0, r48: 0, r72: 0, rmore: 0, inTat: 0, noFrt: 0 });
interface SaleAgg { orders: number; revenue: number; rows: number; gross: number }
const emptySale = (): SaleAgg => ({ orders: 0, revenue: 0, rows: 0, gross: 0 });

const typesFor = (t: OverviewUserType): ChatUserType[] => (t === "Overall" ? [...CHAT_USER_TYPES] : [t]);
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

const SALE_WHERE = "campaign = 'Chat' AND calling_status = 'Sale Made'";

async function loadSalesDaily(from: string, to: string): Promise<{ daily: Map<string, SaleAgg>; blankRows: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(d, '%Y-%m-%d') AS d, COUNT(*) AS orders, SUM(a) AS revenue, SUM(n) AS row_cnt, SUM(gross) AS gross
     FROM (
       SELECT MIN(\`Date\`) AS d, MAX(amount) AS a, COUNT(*) AS n, SUM(amount) AS gross
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
    daily.set(String(r.d), { orders: num(r.orders), revenue: num(r.revenue), rows: num(r.row_cnt), gross: num(r.gross) });
  }
  const [[blank]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM db_masmis.bb_sale
      WHERE ${SALE_WHERE} AND \`Date\` BETWEEN ? AND ? AND (bella_vita_order_id IS NULL OR bella_vita_order_id = '')`,
    [from, to],
  );
  return { daily, blankRows: num(blank?.n) };
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

  const [chatDaily, sales] = await Promise.all([
    loadChatDaily(from, to, types),
    salesAvailable ? loadSalesDaily(from, to) : Promise.resolve(null),
  ]);

  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const capacity = await loadCapacity(months);
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
      if (sd) { s.orders += sd.orders; s.revenue += sd.revenue; s.rows += sd.rows; s.gross += sd.gross; }
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
    };
  }

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
    from, to, userType, columns, values,
    daily: days.map((d) => ({
      date: d,
      overall: chatDaily.get(d)?.overall ?? 0,
      unique: chatDaily.get(d)?.unique ?? 0,
      saleMade: sales ? (sales.daily.get(d)?.orders ?? 0) : null,
    })),
    salesAvailable,
    salesNote: salesAvailable
      ? userType === "Overall"
        ? "Sales come from bb_sale's 'Chat' campaign, which has no Kenaz/Bevzilla split, so for Overall the same Chat-campaign sales are set against the combined chat volume."
        : null
      : "Sales, revenue, AOV and conversion aren't available for this user type: the sales table (bb_sale) has no Kenaz/Bevzilla split, only a single 'Chat' campaign.",
    integrity,
    capacity: {
      month: lastMonth,
      byType: { Chat: capNow.Chat ?? null, Kenaz: capNow.Kenaz ?? null, Bevzilla: capNow.Bevzilla ?? null },
    },
    latestChatDate: latest?.d ? String(latest.d) : null,
    dailyColumnsOmitted,
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
