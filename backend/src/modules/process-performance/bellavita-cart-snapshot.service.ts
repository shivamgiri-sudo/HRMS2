import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { withDeadlockRetry } from "../../shared/deadlockRetry.js";
import { loadSpanTargetContext, spanTarget } from "./dashboard-monthly-target.shared.js";

/** Same dashboard_code/metric_code the Overview tab's Monthly Target editor
 * (and the Date-wise Target upload/edit) write to (bellavita-cart-dashboard.
 * service.ts) -- this snapshot reads the identical stored values, just
 * spread across MTD/week/day columns instead of shown as one figure, so a
 * target set from any of the three places shows up in all of them. */
const CART_DASHBOARD_CODE = "bellavita_cart";
const CART_TARGET_METRIC = "BB_CART_REVENUE_TARGET";

/**
 * Bellavita Abandoned Cart -- the overview snapshot (MTD / weeks / days) and
 * the agent-wise view, built from three real tables. Every definition below
 * was checked against the reference sheets for 1-12 Sep 2026 (see the
 * validation notes on each metric).
 *
 * - Carts: db_masmis.bb_cart. call_date is TEXT ("13-Sep-26"), parsed with
 *   STR_TO_DATE. The table can hold the same cart twice on a day (live: 1,688
 *   rows on 1 Sep, 1,700 on 13 Sep, for 1,680 carts each), so everything is
 *   counted per DISTINCT cart_id, never COUNT(*). The sheet's 1,680/day base
 *   is the distinct count.
 *   - Overall Base / Workable Cases = distinct carts that day
 *   - Unique Connected     = distinct carts with disposition = 'Connect'
 *   - Unique Attempted     = distinct carts with disposition Connect or Not Connect
 *   - DND Cases            = distinct carts with disposition 'Pending to call'
 *                            (or none) -- matches the sheet's 1,5,0,2,2,2,1,3,0,2,1
 *   - Same Day Unique Connect = same_day_connect = 'Connect' (matches the
 *                            sheet within 1-6 carts a day)
 *   - NC Connect           = Unique Connected - Same Day Unique Connect
 *   - CPA (cases per agent) = Overall Base / agents logged in that day
 *                            (agents with an Abandon Cart row in bb_apr).
 *                            Matches the sheet exactly on all 12 days. For a
 *                            week or MTD it divides by the AVERAGE daily agent
 *                            count, which is how the sheet's W-1 (1,029) and
 *                            MTD (2,636) work.
 * - Sales: db_masmis.bb_sale WHERE campaign = 'Abandon Cart' AND calling_status
 *   = 'Sale Made'. One row per order LINE ITEM, each carrying the order's
 *   whole amount, so sales are counted per DISTINCT bella_vita_order_id and
 *   revenue takes ONE amount per order (rows summed would be about 3x too
 *   high). The closest of six variants tried to the sheet (15 orders of total
 *   drift over 12 days; days 9-12 exact) -- the small remaining gap is in the
 *   source snapshot, not derivable.
 * - Agents: bb_cart.agent holds the employee id ("MAS61944"); "VDAD" is the
 *   auto-dialer (about half of all carts, connect rate ~1%) and is reported
 *   separately, not as an agent. Login, talk, break etc. come from bb_apr
 *   (lob = 'Abandon Cart'). bb_apr holds SEVERAL rows per agent per day (a full
 *   row plus thinner ones with attendance 'P' and no talk time), so the most
 *   complete row is taken per agent-day. Join date (DOJ) comes from bb_sale's
 *   FHD -- bb_apr carries the same date for every agent -- and tenure/bucket
 *   are counted to the end of the range (0-30, 31-60, 61-90, 91-120, 121-180,
 *   Above 180).
 * - Target / Achievement %: the Abandon Cart Revenue target set via the
 *   Overview tab (bellavita-cart-dashboard.service.ts, dashboard_metric_target
 *   table) -- either a real per-day value (Date-wise Target upload/edit) or
 *   a monthly figure spread across MTD/week/day columns by each day's share
 *   of its calendar month, same convention as Bellavita Chat's planned
 *   capacity. Daily values win over the monthly fallback where both exist.
 *   A column touching a period with no target at all shows null rather than
 *   a partial figure.
 * - NOT derivable from the data, so shown as empty rather than invented:
 *   the TQ/MQ/BQ quality band (per-agent targets live only in the sheet).
 */

/** Every query here is a read, so a lock-wait timeout caused by another session's write is safe to retry. */
const readRows = (sql: string, params: Array<string | number>) =>
  withDeadlockRetry(() => db.execute<RowDataPacket[]>(sql, params));

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (v: number): number => Math.round(v * 100) / 100;
const pct = (part: number, whole: number): number => (whole > 0 ? round2((part / whole) * 100) : 0);
const p2 = (n: number): string => String(n).padStart(2, "0");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_IDX: Record<string, number> = Object.fromEntries(MON.map((m, i) => [m.toLowerCase(), i + 1]));
const MAX_RANGE_DAYS = 200;
const MAX_DAILY_COLUMNS = 62;
const AUTO_DIALER = "VDAD";
const CART_DATE = "STR_TO_DATE(call_date, '%e-%b-%y')";

/* ------------------------------ date helpers ------------------------------ */

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
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
const dayLabel = (iso: string): string => `${Number(iso.slice(8, 10))}-${MON[Number(iso.slice(5, 7)) - 1]}`;
const weekNo = (iso: string): number => Math.min(5, Math.ceil(Number(iso.slice(8, 10)) / 7));

/** "19-May-26" / "2026-05-19" -> "2026-05-19". */
function parseTextDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if (!m) return null;
  const mon = MONTH_IDX[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${p2(mon)}-${p2(Number(m[1]))}`;
}
function durationToSec(v: unknown): number {
  const m = String(v ?? "").trim().match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
/** '1.00' / '0.50' as a number, 'P' = present (1), 'HD' = half day (0.5), anything else 0. */
function attendanceValue(v: unknown): number {
  const t = String(v ?? '').trim().toUpperCase();
  if (t === 'P') return 1;
  if (t === 'HD') return 0.5;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}
const parsePct = (v: unknown): number => { const n = parseFloat(String(v ?? "").replace("%", "")); return Number.isFinite(n) ? n : 0; };

export function tenureBucket(days: number): string {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  if (days <= 120) return "91-120";
  if (days <= 180) return "121-180";
  return "Above 180";
}

/* --------------------------------- types ---------------------------------- */

export interface CartColumn { key: string; label: string; kind: "mtd" | "week" | "day"; from: string; to: string }

export interface CartSnapshotValues {
  overallBase: number; workableCases: number; dndCases: number;
  uniqueAttempted: number; uniqueConnected: number; uniqueConnectedPct: number;
  sameDayUniqueAttempt: number; sameDayUniqueConnect: number; sameDayUniqueConnectPct: number;
  ncConnect: number; cpa: number | null;
  revenue: number; saleCount: number;
  convBasePct: number; convUniqueConnectPct: number;
  target: number | null; overallRevenueBau: number; achievementPct: number | null; aov: number;
  codOrders: number; paidOrders: number; rtoOrders: number; rtoRevenue: number;
  duplicateCartRows: number; duplicateOrderRows: number; duplicateRevenue: number;
}

export interface CartOrderIntegrity {
  saleRows: number; uniqueOrders: number; duplicateRows: number;
  grossRevenue: number; revenue: number; duplicateRevenue: number; blankOrderIdRows: number;
  cartRows: number; uniqueCarts: number; duplicateCartRows: number;
}

export interface BellavitaCartSnapshotData {
  from: string; to: string; dataThrough: string | null;
  columns: CartColumn[]; values: Record<string, CartSnapshotValues>;
  integrity: CartOrderIntegrity;
  daily: Array<{ date: string; base: number; connected: number; saleCount: number; revenue: number }>;
  targetNote: string;
  dailyColumnsOmitted: boolean;
}

interface CartDay { rows: number; base: number; attempted: number; connected: number; dnd: number; sdc: number }
interface SaleDay {
  orders: number; revenue: number; rows: number; gross: number;
  cod: number; paid: number; rto: number; rtoRevenue: number;
}

/* --------------------------------- loaders -------------------------------- */

async function loadCartDaily(from: string, to: string): Promise<Map<string, CartDay>> {
  const [rows] = await readRows(
    `SELECT DATE_FORMAT(d, '%Y-%m-%d') AS d,
       COUNT(*) AS row_cnt,
       COUNT(DISTINCT cart_id) AS base,
       COUNT(DISTINCT CASE WHEN disposition IN ('Connect','Not Connect') THEN cart_id END) AS attempted,
       COUNT(DISTINCT CASE WHEN disposition = 'Connect' THEN cart_id END) AS connected,
       COUNT(DISTINCT CASE WHEN disposition IS NULL OR disposition = '' OR disposition = 'Pending to call' THEN cart_id END) AS dnd,
       COUNT(DISTINCT CASE WHEN same_day_connect = 'Connect' THEN cart_id END) AS sdc
     FROM (SELECT ${CART_DATE} AS d, cart_id, disposition, same_day_connect FROM db_masmis.bb_cart) x
     WHERE d BETWEEN ? AND ?
     GROUP BY d`,
    [from, to],
  );
  const m = new Map<string, CartDay>();
  for (const r of rows) {
    m.set(String(r.d), {
      rows: num(r.row_cnt), base: num(r.base), attempted: num(r.attempted),
      connected: num(r.connected), dnd: num(r.dnd), sdc: num(r.sdc),
    });
  }
  return m;
}

const SALE_WHERE = "campaign = 'Abandon Cart' AND calling_status = 'Sale Made'";

/** One row per ORDER (see the header). */
const ORDER_SUBQUERY = `
  SELECT bella_vita_order_id AS oid, MIN(\`Date\`) AS d, MIN(emp_id) AS emp_id, MAX(amount) AS a, SUM(amount) AS g, COUNT(*) AS n,
         MAX(payment_status) AS pay, MAX(final_status = 'RTO') AS rto
    FROM db_masmis.bb_sale
   WHERE ${SALE_WHERE} AND \`Date\` BETWEEN ? AND ?
     AND bella_vita_order_id IS NOT NULL AND bella_vita_order_id <> ''
   GROUP BY bella_vita_order_id`;

async function loadSalesDaily(from: string, to: string): Promise<{ daily: Map<string, SaleDay>; blankRows: number }> {
  const [rows] = await readRows(
    `SELECT DATE_FORMAT(d, '%Y-%m-%d') AS d, COUNT(*) AS orders, SUM(a) AS revenue, SUM(n) AS row_cnt, SUM(g) AS gross,
            SUM(pay = 'cod') AS cod, SUM(pay = 'paid') AS paid, SUM(rto) AS rto, SUM(CASE WHEN rto = 1 THEN a ELSE 0 END) AS rto_rev
       FROM (${ORDER_SUBQUERY}) o GROUP BY d`,
    [from, to],
  );
  const daily = new Map<string, SaleDay>();
  for (const r of rows) {
    daily.set(String(r.d), {
      orders: num(r.orders), revenue: num(r.revenue), rows: num(r.row_cnt), gross: num(r.gross),
      cod: num(r.cod), paid: num(r.paid), rto: num(r.rto), rtoRevenue: num(r.rto_rev),
    });
  }
  const [[blank]] = await readRows(
    `SELECT COUNT(*) AS n FROM db_masmis.bb_sale
      WHERE ${SALE_WHERE} AND \`Date\` BETWEEN ? AND ? AND (bella_vita_order_id IS NULL OR bella_vita_order_id = '')`,
    [from, to],
  );
  return { daily, blankRows: num(blank?.n) };
}

async function loadAgentCountByDay(from: string, to: string): Promise<Map<string, number>> {
  const [rows] = await readRows(
    `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, COUNT(DISTINCT noiid) AS agents
       FROM db_masmis.bb_apr WHERE lob = 'Abandon Cart' AND report_date BETWEEN ? AND ? GROUP BY report_date`,
    [from, to],
  );
  return new Map(rows.map((r) => [String(r.d), num(r.agents)]));
}

/* ------------------------------ columns builder ---------------------------- */

function buildColumns(from: string, to: string, lastDataDay: string | null): { columns: CartColumn[]; omitted: boolean } {
  const days = eachDay(from, lastDataDay && lastDataDay < to ? (lastDataDay < from ? from : lastDataDay) : to);
  const months = new Set(days.map((d) => d.slice(0, 7)));
  const multi = months.size > 1;
  const singleFromFirst = !multi && from.endsWith("-01");
  const columns: CartColumn[] = [
    { key: "mtd", label: singleFromFirst ? "MTD" : "Selected range", kind: "mtd", from, to },
  ];
  const weeks = new Map<string, { label: string; from: string; to: string }>();
  for (const d of days) {
    const key = `${d.slice(0, 7)}-W${weekNo(d)}`;
    const label = multi ? `${MON[Number(d.slice(5, 7)) - 1]} Week-${weekNo(d)}` : `Week-${weekNo(d)}`;
    const cur = weeks.get(key);
    if (!cur) weeks.set(key, { label, from: d, to: d }); else cur.to = d;
  }
  for (const [key, w] of weeks) columns.push({ key, label: w.label, kind: "week", from: w.from, to: w.to });
  const omitted = days.length > MAX_DAILY_COLUMNS;
  if (!omitted) for (const d of days) columns.push({ key: d, label: dayLabel(d), kind: "day", from: d, to: d });
  return { columns, omitted };
}

/* --------------------------------- snapshot -------------------------------- */

export async function getBellavitaCartSnapshot(fromInput: string, toInput: string): Promise<BellavitaCartSnapshotData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const [cartDaily, sales, agentsByDay] = await Promise.all([
    loadCartDaily(from, to), loadSalesDaily(from, to), loadAgentCountByDay(from, to),
  ]);

  const cartDates = [...cartDaily.keys()].sort();
  const dataThrough = cartDates.length ? cartDates[cartDates.length - 1] : null;
  const { columns, omitted } = buildColumns(from, to, dataThrough);

  // Same target(s) the Overview tab's editors write (dashboard-monthly-target.shared.ts):
  // a real per-day value (from the Date-wise Target upload/edit) where one is set, else that
  // day's monthly target spread evenly across its month -- same convention already used for
  // Bellavita Chat's planned capacity, now overridable per day.
  const allDates = [...new Set(columns.flatMap((c) => eachDay(c.from, c.to)))];
  const targetCtx = await loadSpanTargetContext(CART_DASHBOARD_CODE, CART_TARGET_METRIC, allDates);

  const values: Record<string, CartSnapshotValues> = {};
  for (const col of columns) {
    const span = eachDay(col.from, col.to);
    const target = spanTarget(targetCtx, span);
    let base = 0, attempted = 0, connected = 0, dnd = 0, sdc = 0, cartRows = 0;
    let orders = 0, revenue = 0, saleRows = 0, gross = 0, cod = 0, paid = 0, rto = 0, rtoRev = 0;
    const agentCounts: number[] = [];
    for (const d of span) {
      const c = cartDaily.get(d);
      if (c) {
        base += c.base; attempted += c.attempted; connected += c.connected; dnd += c.dnd; sdc += c.sdc; cartRows += c.rows;
        const ag = agentsByDay.get(d);
        if (ag) agentCounts.push(ag);
      }
      const s = sales.daily.get(d);
      if (s) { orders += s.orders; revenue += s.revenue; saleRows += s.rows; gross += s.gross; cod += s.cod; paid += s.paid; rto += s.rto; rtoRev += s.rtoRevenue; }
    }
    const avgAgents = agentCounts.length ? agentCounts.reduce((a, b) => a + b, 0) / agentCounts.length : 0;
    values[col.key] = {
      overallBase: base, workableCases: base, dndCases: dnd,
      uniqueAttempted: attempted, uniqueConnected: connected, uniqueConnectedPct: pct(connected, attempted),
      sameDayUniqueAttempt: attempted, sameDayUniqueConnect: sdc, sameDayUniqueConnectPct: pct(sdc, attempted),
      ncConnect: Math.max(0, connected - sdc),
      cpa: avgAgents > 0 ? Math.round(base / avgAgents) : null,
      revenue: round2(revenue), saleCount: orders,
      convBasePct: pct(orders, base), convUniqueConnectPct: pct(orders, connected),
      target, overallRevenueBau: round2(revenue), achievementPct: target ? pct(revenue, target) : null,
      aov: orders > 0 ? Math.round(revenue / orders) : 0,
      codOrders: cod, paidOrders: paid, rtoOrders: rto, rtoRevenue: round2(rtoRev),
      duplicateCartRows: Math.max(0, cartRows - base),
      duplicateOrderRows: Math.max(0, saleRows - orders),
      duplicateRevenue: round2(Math.max(0, gross - revenue)),
    };
  }

  const m = values.mtd;
  let saleRows = 0, gross = 0, cartRows = 0;
  for (const s of sales.daily.values()) { saleRows += s.rows; gross += s.gross; }
  for (const c of cartDaily.values()) cartRows += c.rows;

  const dayKeys = eachDay(from, dataThrough && dataThrough < to ? dataThrough : to);
  return {
    from, to, dataThrough, columns, values,
    integrity: {
      saleRows, uniqueOrders: m.saleCount, duplicateRows: Math.max(0, saleRows - m.saleCount),
      grossRevenue: round2(gross), revenue: m.revenue, duplicateRevenue: round2(Math.max(0, gross - m.revenue)),
      blankOrderIdRows: sales.blankRows,
      cartRows, uniqueCarts: m.overallBase, duplicateCartRows: Math.max(0, cartRows - m.overallBase),
    },
    daily: dayKeys.map((d) => ({
      date: d, base: cartDaily.get(d)?.base ?? 0, connected: cartDaily.get(d)?.connected ?? 0,
      saleCount: sales.daily.get(d)?.orders ?? 0, revenue: sales.daily.get(d)?.revenue ?? 0,
    })),
    targetNote: targetCtx.dailyByDate.size === 0 && targetCtx.monthlyByMonth.size === 0
      ? "No target has been set yet for this range -- set a monthly figure on the Overview tab, or upload/edit real per-day values there, and it will appear here across MTD/week/day."
      : "Target prefers a real per-day value (Overview tab's Date-wise Target) where one is set; otherwise it falls back to the monthly figure spread evenly across the days in its month. A column touching a period with no target at all shows — rather than a partial number.",
    dailyColumnsOmitted: omitted,
  };
}

/* --------------------------------- agents ---------------------------------- */

export interface CartAgentRow {
  empId: string; name: string; doj: string | null; tenureDays: number | null; bucket: string | null;
  status: "Active" | "InActive" | "Not in APR"; tl: string;
  saleMade: number; cod: number; paid: number; rto: number; codPct: number; paidPct: number; rtoPct: number;
  rtoAmount: number; revenue: number; avgSalePerDay: number;
  attendanceDays: number; manDays: number; calls: number;
  avgLoginSec: number; avgNetLoginSec: number; avgBreakSec: number; avgTalkSec: number; avgDispoSec: number;
  acht: number; occupancyPct: number;
  allocation: number; connected: number; connectedPct: number; convPct: number;
  byPeriod: Record<string, { sales: number; revenue: number }>;
}

export interface BellavitaCartAgentsData {
  from: string; to: string; dataThrough: string | null;
  columns: CartColumn[];
  agents: CartAgentRow[];
  totals: { saleMade: number; revenue: number; allocation: number; connected: number; calls: number; agentsActive: number };
  /** Ids with carts but no Abandon Cart APR row and no sale -- not listed as agents. */
  otherAgents: { count: number; allocation: number };
  autoDialer: { allocation: number; connected: number; connectedPct: number; sharePct: number };
  targetNote: string;
}

interface AprRow {
  date: string; empId: string; name: string; calls: number; loginSec: number; netSec: number; breakSec: number;
  talkSec: number; dispoSec: number; acht: number; util: number; att: number; tl: string; doj: string | null;
}

async function loadApr(from: string, to: string): Promise<AprRow[]> {
  const [rows] = await readRows(
    `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, noiid, emp_name, num_calls_chat, login_time, net_login_hrs, total_break,
            talk_time, dispo_time, acht, utilization, attendance_1, team_leader, fhd
       FROM db_masmis.bb_apr WHERE lob = 'Abandon Cart' AND report_date BETWEEN ? AND ? ORDER BY id`,
    [from, to],
  );
  // bb_apr holds several rows per agent per day: the full row, and thinner ones
  // (attendance 'P' with no talk time, exact repeats). Take the MOST COMPLETE
  // row for each agent-day -- talk time present, then a numeric attendance,
  // then the latest upload -- rather than blindly the last one.
  const score = (r: RowDataPacket): number =>
    (r.talk_time ? 4 : 0) + (r.num_calls_chat ? 2 : 0) + (/^\d/.test(String(r.attendance_1 ?? "")) ? 1 : 0);
  const best = new Map<string, RowDataPacket>();
  for (const r of rows) {
    const empId = String(r.noiid ?? '').trim();
    if (!empId) continue;
    const key = `${empId}|${r.d}`;
    const cur = best.get(key);
    if (!cur || score(r) >= score(cur)) best.set(key, r);
  }
  const out: AprRow[] = [];
  for (const [key, r] of best) {
    out.push({
      date: String(r.d), empId: key.split('|')[0], name: String(r.emp_name ?? '').trim(),
      calls: num(r.num_calls_chat), loginSec: durationToSec(r.login_time), netSec: durationToSec(r.net_login_hrs),
      breakSec: durationToSec(r.total_break), talkSec: durationToSec(r.talk_time), dispoSec: durationToSec(r.dispo_time),
      acht: num(r.acht), util: parsePct(r.utilization), att: attendanceValue(r.attendance_1),
      tl: String(r.team_leader ?? '').trim(), doj: parseTextDate(r.fhd),
    });
  }
  return out;
}

const titleCase = (s: string): string => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export async function getBellavitaCartAgents(fromInput: string, toInput: string): Promise<BellavitaCartAgentsData> {
  const { from, to } = resolveRange(fromInput, toInput);

  const [apr, saleAgents, cartAgent, orderRows, cartDaily] = await Promise.all([
    loadApr(from, to),
    // Each agent's real join date (FHD), name and TL as the sales table records them.
    readRows(
      `SELECT emp_id, MAX(emp_name) AS nm, MAX(tl) AS tl, MAX(DATE_FORMAT(FHD, '%Y-%m-%d')) AS fhd
         FROM db_masmis.bb_sale WHERE campaign = 'Abandon Cart' AND \`Date\` BETWEEN ? AND ? GROUP BY emp_id`,
      [from, to],
    ).then(([r]) => r),
    readRows(
      `SELECT agent, DATE_FORMAT(d, '%Y-%m-%d') AS d, COUNT(DISTINCT cart_id) AS alloc,
              COUNT(DISTINCT CASE WHEN disposition = 'Connect' THEN cart_id END) AS conn
         FROM (SELECT ${CART_DATE} AS d, agent, cart_id, disposition FROM db_masmis.bb_cart) x
        WHERE d BETWEEN ? AND ? GROUP BY agent, d`,
      [from, to],
    ).then(([r]) => r),
    readRows(
      `SELECT oid, DATE_FORMAT(d, '%Y-%m-%d') AS d, emp_id, a, pay, rto FROM (${ORDER_SUBQUERY}) o`,
      [from, to],
    ).then(([r]) => r),
    loadCartDaily(from, to),
  ]);

  const cartDates = [...cartDaily.keys()].sort();
  const dataThrough = cartDates.length ? cartDates[cartDates.length - 1] : null;
  const { columns } = buildColumns(from, to, dataThrough);
  const colOfDay = (d: string): string[] => columns.filter((c) => c.from <= d && d <= c.to).map((c) => c.key);

  const agents = new Map<string, CartAgentRow>();
  const ensure = (empId: string): CartAgentRow => {
    let a = agents.get(empId);
    if (!a) {
      a = {
        empId, name: empId, doj: null, tenureDays: null, bucket: null, status: "Not in APR", tl: "",
        saleMade: 0, cod: 0, paid: 0, rto: 0, codPct: 0, paidPct: 0, rtoPct: 0, rtoAmount: 0, revenue: 0, avgSalePerDay: 0,
        attendanceDays: 0, manDays: 0, calls: 0,
        avgLoginSec: 0, avgNetLoginSec: 0, avgBreakSec: 0, avgTalkSec: 0, avgDispoSec: 0, acht: 0, occupancyPct: 0,
        allocation: 0, connected: 0, connectedPct: 0, convPct: 0, byPeriod: {},
      };
      agents.set(empId, a);
    }
    return a;
  };
  const bump = (a: CartAgentRow, day: string, sales: number, revenue: number) => {
    for (const key of colOfDay(day)) {
      const cur = a.byPeriod[key] ?? { sales: 0, revenue: 0 };
      cur.sales += sales; cur.revenue = round2(cur.revenue + revenue);
      a.byPeriod[key] = cur;
    }
  };

  // ---- APR: identity, attendance, time ----
  const lastAprDay = apr.reduce((m, r) => (r.date > m ? r.date : m), "");
  const aprByAgent = new Map<string, AprRow[]>();
  for (const r of apr) {
    const arr = aprByAgent.get(r.empId);
    if (arr) arr.push(r); else aprByAgent.set(r.empId, [r]);
  }
  // Tenure runs to the end of the selected range (never past today) -- the
  // reference sheet's 184 days for a 20-Mar joiner is counted to 20 Sep.
  const today = todayLocal();
  const asOf = to < today ? to : today;
  for (const [empId, rows] of aprByAgent) {
    const a = ensure(empId);
    const latest = rows.reduce((m, r) => (r.date > m.date ? r : m), rows[0]);
    a.name = titleCase(latest.name || empId);
    a.tl = latest.tl;
    a.doj = latest.doj;
    if (a.doj) { a.tenureDays = Math.max(0, daysBetween(a.doj, asOf)); a.bucket = tenureBucket(a.tenureDays); }
    const n = rows.length;
    a.attendanceDays = rows.filter((r) => r.att > 0).length;
    a.manDays = round2(rows.reduce((s, r) => s + r.att, 0));
    a.calls = rows.reduce((s, r) => s + r.calls, 0);
    a.avgLoginSec = Math.round(rows.reduce((s, r) => s + r.loginSec, 0) / n);
    a.avgNetLoginSec = Math.round(rows.reduce((s, r) => s + r.netSec, 0) / n);
    a.avgBreakSec = Math.round(rows.reduce((s, r) => s + r.breakSec, 0) / n);
    a.avgTalkSec = Math.round(rows.reduce((s, r) => s + r.talkSec, 0) / n);
    a.avgDispoSec = Math.round(rows.reduce((s, r) => s + r.dispoSec, 0) / n);
    a.acht = Math.round(rows.reduce((s, r) => s + r.acht, 0) / n);
    // Occupancy = (talk + dispo time) / net login time, as ratio of sums -- reproduces the reference sheet (Abhishek 49%).
    const netTotal = rows.reduce((s, r) => s + r.netSec, 0);
    a.occupancyPct = netTotal > 0 ? Math.round((rows.reduce((s, r) => s + r.talkSec + r.dispoSec, 0) / netTotal) * 100) : 0;
    // Active = worked in the last 2 days of the APR data in this range.
    a.status = lastAprDay && daysBetween(latest.date, lastAprDay) <= 2 ? "Active" : "InActive";
  }

  // ---- Sales per order ----
  for (const o of orderRows) {
    const empId = String(o.emp_id ?? "").trim().toUpperCase();
    if (!empId) continue;
    const a = ensure(empId);
    const amt = num(o.a);
    a.saleMade += 1; a.revenue = round2(a.revenue + amt);
    if (o.pay === "cod") a.cod += 1;
    if (o.pay === "paid") a.paid += 1;
    if (num(o.rto) === 1) { a.rto += 1; a.rtoAmount = round2(a.rtoAmount + amt); }
    bump(a, String(o.d), 1, amt);
  }

  // ---- Join date, name and TL from the sales table (the APR's date is the same for everyone) ----
  for (const s of saleAgents) {
    const empId = String(s.emp_id ?? "").trim().toUpperCase();
    const a = empId ? agents.get(empId) : undefined;
    if (!a) continue;
    if (s.nm) a.name = titleCase(String(s.nm));
    if (s.tl && !a.tl) a.tl = String(s.tl);
    const doj = parseTextDate(s.fhd);
    if (doj) { a.doj = doj; a.tenureDays = Math.max(0, daysBetween(doj, asOf)); a.bucket = tenureBucket(a.tenureDays); }
  }

  // ---- Allocation from carts (real agents only; the auto-dialer is separate) ----
  const dialer = { allocation: 0, connected: 0 };
  let allAllocation = 0;
  for (const r of cartAgent) {
    const code = String(r.agent ?? "").trim();
    const alloc = num(r.alloc), conn = num(r.conn);
    allAllocation += alloc;
    if (code === AUTO_DIALER) { dialer.allocation += alloc; dialer.connected += conn; continue; }
    if (!/^MAS\d+$/i.test(code)) continue;
    const a = ensure(code.toUpperCase());
    a.allocation += alloc; a.connected += conn;
  }

  // An agent needs an Abandon Cart APR row or a sale to be listed; ids that only
  // touched a handful of carts are summed into "other agents" instead.
  const otherAgents = { count: 0, allocation: 0 };
  const list = [...agents.values()]
    .filter((a) => {
      if (a.attendanceDays > 0 || a.saleMade > 0) return true;
      if (a.allocation > 0) { otherAgents.count += 1; otherAgents.allocation += a.allocation; }
      return false;
    })
    .map((a) => {
      const denom = Math.max(1, a.attendanceDays);
      return {
        ...a,
        codPct: pct(a.cod, a.saleMade), paidPct: pct(a.paid, a.saleMade), rtoPct: pct(a.rto, a.saleMade),
        avgSalePerDay: a.attendanceDays > 0 ? round2(a.saleMade / denom) : 0,
        connectedPct: pct(a.connected, a.allocation), convPct: pct(a.saleMade, a.allocation),
      };
    })
    .sort((x, y) => y.revenue - x.revenue || y.allocation - x.allocation);

  const totals = list.reduce((t, a) => ({
    saleMade: t.saleMade + a.saleMade, revenue: round2(t.revenue + a.revenue), allocation: t.allocation + a.allocation,
    connected: t.connected + a.connected, calls: t.calls + a.calls, agentsActive: t.agentsActive + (a.status === "Active" ? 1 : 0),
  }), { saleMade: 0, revenue: 0, allocation: 0, connected: 0, calls: 0, agentsActive: 0 });

  return {
    from, to, dataThrough, columns, agents: list, totals, otherAgents,
    autoDialer: {
      allocation: dialer.allocation, connected: dialer.connected,
      connectedPct: pct(dialer.connected, dialer.allocation), sharePct: pct(dialer.allocation, allAllocation),
    },
    targetNote:
      "Target, Achievement % and the TQ/MQ/BQ band are not in the database (they live in the reference sheet), so they are not shown. Tenure is counted to the end of the data in this range.",
  };
}

/* ------------------------------ agent drill-down --------------------------- */

export interface CartAgentDetail {
  empId: string; name: string; from: string; to: string;
  kpis: { saleMade: number; revenue: number; allocation: number; connected: number; connectedPct: number; convPct: number; calls: number };
  daily: Array<{ date: string; allocation: number; connected: number; sales: number; revenue: number; loginSec: number; talkSec: number }>;
  subDispositions: Array<{ label: string; count: number }>;
  orders: Array<{ orderId: string; date: string; amount: number; payment: string; rto: boolean; rows: number }>;
}

const DETAIL_LIMIT = 100;

export async function getBellavitaCartAgentDetail(empIdRaw: string, fromInput: string, toInput: string): Promise<CartAgentDetail | null> {
  const { from, to } = resolveRange(fromInput, toInput);
  const empId = String(empIdRaw ?? "").trim().toUpperCase();
  if (!/^MAS\d+$/.test(empId)) return null;

  const [cartRows, subRows, orders, apr] = await Promise.all([
    readRows(
      `SELECT DATE_FORMAT(d, '%Y-%m-%d') AS d, COUNT(DISTINCT cart_id) AS alloc,
              COUNT(DISTINCT CASE WHEN disposition = 'Connect' THEN cart_id END) AS conn
         FROM (SELECT ${CART_DATE} AS d, agent, cart_id, disposition FROM db_masmis.bb_cart) x
        WHERE d BETWEEN ? AND ? AND agent = ? GROUP BY d`,
      [from, to, empId],
    ).then(([r]) => r),
    readRows(
      `SELECT COALESCE(NULLIF(sub_disposition, ''), 'None') AS s, COUNT(*) AS n
         FROM (SELECT ${CART_DATE} AS d, agent, sub_disposition FROM db_masmis.bb_cart) x
        WHERE d BETWEEN ? AND ? AND agent = ? GROUP BY s ORDER BY n DESC LIMIT 12`,
      [from, to, empId],
    ).then(([r]) => r),
    readRows(
      `SELECT oid, DATE_FORMAT(d, '%Y-%m-%d') AS d, a, pay, rto, n FROM (${ORDER_SUBQUERY}) o WHERE emp_id = ? ORDER BY d DESC, a DESC LIMIT ${DETAIL_LIMIT}`,
      [from, to, empId],
    ).then(([r]) => r),
    loadApr(from, to),
  ]);

  const mine = apr.filter((r) => r.empId === empId);
  const days = new Map<string, CartAgentDetail["daily"][number]>();
  const row = (d: string) => {
    let r = days.get(d);
    if (!r) { r = { date: d, allocation: 0, connected: 0, sales: 0, revenue: 0, loginSec: 0, talkSec: 0 }; days.set(d, r); }
    return r;
  };
  for (const r of cartRows) { const x = row(String(r.d)); x.allocation = num(r.alloc); x.connected = num(r.conn); }
  for (const r of mine) { const x = row(r.date); x.loginSec = r.loginSec; x.talkSec = r.talkSec; }

  // Totals for the KPI strip come from ALL orders (not just the 100 listed).
  const [allOrders] = await readRows(
    `SELECT DATE_FORMAT(d, '%Y-%m-%d') AS d, COUNT(*) AS n, SUM(a) AS rev FROM (${ORDER_SUBQUERY}) o WHERE emp_id = ? GROUP BY d`,
    [from, to, empId],
  );
  for (const r of allOrders) { const x = row(String(r.d)); x.sales = num(r.n); x.revenue = num(r.rev); }

  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (daily.length === 0 && orders.length === 0) return null;
  const sum = <K extends "allocation" | "connected" | "sales" | "revenue">(k: K) => daily.reduce((s, r) => s + r[k], 0);
  const allocation = sum("allocation");
  return {
    empId, name: titleCase(mine[mine.length - 1]?.name || empId), from, to,
    kpis: {
      saleMade: sum("sales"), revenue: round2(sum("revenue")), allocation, connected: sum("connected"),
      connectedPct: pct(sum("connected"), allocation), convPct: pct(sum("sales"), allocation),
      calls: mine.reduce((s, r) => s + r.calls, 0),
    },
    daily,
    subDispositions: subRows.map((r) => ({ label: String(r.s), count: num(r.n) })),
    orders: orders.map((o) => ({
      orderId: String(o.oid), date: String(o.d), amount: num(o.a), payment: String(o.pay ?? ""), rto: num(o.rto) === 1, rows: num(o.n),
    })),
  };
}
