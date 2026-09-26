import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { withDeadlockRetry } from "../../shared/deadlockRetry.js";

/**
 * Housing Premium's full MIS dashboard -- a like-for-like rebuild of the
 * reference "Housing Premium MIS Dashboard" Excel workbook (Dashboard, Day
 * Wise Agent Performance, Agent Wise Performance, Slot Wise Agent
 * Performance, Agent Wise TQ/MQ/BQ, TL wise TQ/MQ/BQ, Team Details sheets),
 * against the three real tables that already hold this data:
 *   - db_masmis.pre_sale          (order-level sales -- the workbook's "Sale Raw")
 *   - db_masmis.pre_agent_details (roster + target/achievement -- "Team Details")
 *   - db_masmis.Pre_cdr           (per-call records -- "CDR"; only 4 rows live
 *     as of 2026-09-20, the full ~125k-row file has not been uploaded yet --
 *     every call-based metric below is written to scale to that size via SQL
 *     aggregation, never a JS loop over raw rows)
 *
 * Column mapping confirmed against the reference workbook's own formulas:
 * - Revenue/Achievement uses pre_sale.amount, matching the workbook's Sale
 *   Raw "Amount" column (C) -- confirmed live 2026-09-20: SUM(amount) per
 *   agent equals pre_agent_details.achievement exactly for 33 of 35 agents
 *   with sales. (Two exceptions surfaced by /validation -- see below. The
 *   workbook itself is inconsistent here: its own "Dashboard" sheet sums
 *   Order_Value (J) instead of Amount (C) for the day-by-day Revenue
 *   Achieved row, while every agent/TL/TQ-MQ-BQ sheet uses Amount (C). This
 *   rebuild standardises on Amount everywhere, since that is what actually
 *   reconciles against the uploaded roster.)
 * - Present Count / Unique Connected use Pre_cdr's own call_count/unique_count
 *   flags exactly as uploaded (call_count='1' = that call is the agent's
 *   first that day; unique_count='1' = first call from that phone number
 *   that day) -- these are NOT recomputed here, they arrive pre-flagged in
 *   the file, same as the reference workbook's CDR!N/O columns.
 * - Target is SUM(pre_agent_details.target) for Active agents (the roster's
 *   own monthly target), not a hardcoded organisation-wide number -- the
 *   reference workbook hardcodes 3,256,800 on its Dashboard sheet, which
 *   this repo has no equivalent single input for. A day's target is the
 *   monthly target divided by the days in that month; a week's target is
 *   the monthly target divided by 30 and multiplied by 7 -- both match the
 *   workbook's own Target/30 and Target/30*7 conventions.
 * - TL attribution for sales does NOT use pre_sale.tl_name: confirmed live
 *   2026-09-20, every single one of the 1,072 pre_sale rows carries the
 *   identical value "Arbaz Khan", which matches none of the roster's three
 *   real TL names ("Rashmi", "Arbaz", "OJT") -- that column is unusable for
 *   grouping. Sales are attributed to a TL by joining agent_name to
 *   pre_agent_details.tl_name instead, which is also how the reference
 *   workbook itself works: its own TL-scoped blocks pull TL via
 *   VLOOKUP(agent, Team Details) rather than trust Sale Raw's own TL column.
 *   Pre_cdr.tl_name, by contrast, does match the roster ("Arbaz" appears in
 *   both) and is used directly.
 * - Slot Wise call metrics come from Pre_cdr.time_value (the hour, 0-23,
 *   already extracted in the uploaded file). Slot Wise SALE metrics
 *   (revenue/count per hour) are NOT available: pre_sale has no captured
 *   time/hour column (the bulk importer for pre_sale never mapped Sale
 *   Raw's "Time"/"Hour" columns), even though the reference workbook's Sale
 *   Raw sheet has them. Shown as "not available" rather than guessed.
 *
 * Dates: pre_sale.report_date is a real "YYYY-MM-DD" string on every row
 * (confirmed live 2026-09-20, spans 2026-09-01..2026-09-19) -- the previous
 * version of this file said these were NULL; that was true 2026-09-17 and
 * is no longer true. Pre_cdr.report_date and pre_agent_details.doj are
 * "M/D/YY" text (e.g. "9/3/26", "3/21/26").
 */

const num = (v: unknown): number => { if (v === null || v === undefined || v === "") return 0; const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (v: number): number => Math.round(v * 100) / 100;
const pct = (part: number, whole: number): number => (whole > 0 ? round2((part / whole) * 100) : 0);
const p2 = (n: number): string => String(n).padStart(2, "0");
const normalizeName = (v: unknown): string => String(v ?? "").trim().replace(/\s+/g, " ");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Every read here is safe to retry: none of them write. */
const readRows = (sql: string, params: Array<string | number> = []) =>
  withDeadlockRetry(() => db.execute<RowDataPacket[]>(sql, params));

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
  if (addDays(from, 200) < to) to = addDays(from, 200);
  return { from, to };
}
const dayLabel = (iso: string): string => `${Number(iso.slice(8, 10))}-${MON[Number(iso.slice(5, 7)) - 1]}`;
const weekNoOfMonth = (iso: string): number => Math.min(5, Math.ceil(Number(iso.slice(8, 10)) / 7));

/** pre_agent_details.doj / Pre_cdr.report_date -- "M/D/YY" text -> "YYYY-MM-DD", or null. */
function parseMDY(raw: unknown): string | null {
  const m = String(raw ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return null;
  return `20${m[3]}-${p2(Number(m[1]))}-${p2(Number(m[2]))}`;
}
function tenureDaysFromDoj(doj: unknown, asOf: string): number | null {
  const iso = parseMDY(doj);
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(asOf).getTime() - new Date(iso).getTime()) / 86400000));
}
export function tenureBucket(days: number | null): string {
  if (days === null) return "Unknown";
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  if (days <= 120) return "91-120";
  if (days <= 180) return "121-180";
  return "180 Above";
}
/** BQ < 60%, MQ 60-80%, TQ > 80% of target -- exact thresholds from the reference workbook's stage formula. */
export function stageOf(achievedPct: number | null): "TQ" | "MQ" | "BQ" | "-" {
  if (achievedPct === null) return "-";
  if (achievedPct < 60) return "BQ";
  if (achievedPct <= 80) return "MQ";
  return "TQ";
}
/** Pre_cdr.report_date "M/D/YY" -> DATE for SQL grouping (no MySQL SUBSTRING gymnastics, done once via subquery). */
const CDR_DATE_SQL = `STR_TO_DATE(report_date, '%c/%e/%y')`;
const DOJ_DATE_SQL = `STR_TO_DATE(doj, '%c/%e/%y')`;

/* ---------------------------------- roster --------------------------------- */

interface RosterAgent {
  empId: string; name: string; tlName: string; center: string; doj: string | null;
  status: string; target: number; uploadedAchievement: number; uploadedAchPct: string;
}
async function loadRoster(): Promise<RosterAgent[]> {
  const [rows] = await readRows(
    `SELECT emp_id, agent_name, tl_name, center, doj, status, target, achievement, ach_pct FROM db_masmis.pre_agent_details`,
  );
  return rows.map((r) => ({
    empId: normalizeName(r.emp_id), name: normalizeName(r.agent_name), tlName: normalizeName(r.tl_name) || "Unassigned",
    center: normalizeName(r.center) || "Unknown", doj: r.doj ? String(r.doj) : null,
    status: normalizeName(r.status) || "Unknown", target: num(r.target),
    uploadedAchievement: num(r.achievement), uploadedAchPct: String(r.ach_pct ?? ""),
  })).filter((r) => r.name);
}

/* ================================ 1. OVERVIEW =============================== */
/** Reference workbook's "Dashboard" sheet: MTD / week / day columns, Overall + per-TL blocks. */

export interface OverviewColumn { key: string; label: string; kind: "mtd" | "week" | "day"; from: string; to: string }
export interface OverviewValues {
  connected: number; notConnected: number; uniqueConnected: number; totalCalls: number; connectedPct: number;
  target: number; revenue: number; saleCount: number; achievedPct: number; aov: number;
  presentCount: number; perAgentDialCount: number; avgSalePerAgent: number;
  /** Total talk seconds / Present Count (agent-days) -- average talk time per agent per day, same denominator Per Agent Dial Count uses. */
  avgTalkPerAgentSec: number;
}
export interface HousingPremiumOverviewData {
  from: string; to: string; columns: OverviewColumn[];
  overall: Record<string, OverviewValues>;
  byTl: Array<{ tlName: string; agentCount: number; values: Record<string, OverviewValues> }>;
  cdrRowCount: number; saleRowCount: number; cdrAvailable: boolean;
}

/** tlName filters by the AGENT's roster TL (see header note) -- pre_sale.tl_name itself is not usable. */
async function loadSaleDaily(from: string, to: string, tlName?: string, agentName?: string): Promise<Map<string, { revenue: number; count: number }>> {
  const join = tlName ? `JOIN db_masmis.pre_agent_details ad ON ad.agent_name = ps.agent_name AND ad.tl_name = ?` : "";
  const [rows] = await readRows(
    `SELECT ps.report_date AS d, SUM(ps.amount) AS rev, COUNT(*) AS n FROM db_masmis.pre_sale ps
      ${join} WHERE ps.report_date BETWEEN ? AND ? ${agentName ? "AND ps.agent_name = ?" : ""} GROUP BY ps.report_date`,
    [...(tlName ? [tlName] : []), from, to, ...(agentName ? [agentName] : [])],
  );
  return new Map(rows.map((r) => [String(r.d), { revenue: num(r.rev), count: num(r.n) }]));
}
interface CdrDay { connected: number; notConnected: number; uniqueConnected: number; present: number; talkSec: number }
async function loadCdrDaily(from: string, to: string, tlName?: string, agentName?: string): Promise<{ daily: Map<string, CdrDay>; rowCount: number }> {
  const [rows] = await readRows(
    `SELECT DATE_FORMAT(d, '%Y-%m-%d') AS day, SUM(status='Answered') AS conn, SUM(status='No Answered') AS noconn,
            SUM(status='Answered' AND unique_count='1') AS uconn, SUM(call_count='1') AS present, SUM(talk_duration+0) AS talk
       FROM (SELECT ${CDR_DATE_SQL} AS d, status, unique_count, call_count, talk_duration, tl_name, member FROM db_masmis.Pre_cdr) x
      WHERE d BETWEEN ? AND ? ${tlName ? "AND tl_name = ?" : ""} ${agentName ? "AND member = ?" : ""} GROUP BY d`,
    [from, to, ...(tlName ? [tlName] : []), ...(agentName ? [agentName] : [])],
  );
  const daily = new Map<string, CdrDay>();
  for (const r of rows) {
    daily.set(String(r.day), {
      connected: num(r.conn), notConnected: num(r.noconn), uniqueConnected: num(r.uconn),
      present: num(r.present), talkSec: num(r.talk),
    });
  }
  const [[cnt]] = await readRows(`SELECT COUNT(*) AS n FROM db_masmis.Pre_cdr`);
  return { daily, rowCount: num(cnt?.n) };
}

function buildOverviewColumns(from: string, to: string): OverviewColumn[] {
  const days = eachDay(from, to);
  const months = new Set(days.map((d) => d.slice(0, 7)));
  const singleFromFirst = months.size === 1 && from.endsWith("-01");
  const cols: OverviewColumn[] = [{ key: "mtd", label: singleFromFirst ? "MTD" : "Selected range", kind: "mtd", from, to }];
  const weeks = new Map<string, { from: string; to: string; label: string }>();
  for (const d of days) {
    const key = `${d.slice(0, 7)}-W${weekNoOfMonth(d)}`;
    const cur = weeks.get(key);
    if (!cur) weeks.set(key, { from: d, to: d, label: months.size > 1 ? `${MON[Number(d.slice(5, 7)) - 1]} Week-${weekNoOfMonth(d)}` : `Week-${weekNoOfMonth(d)}` });
    else cur.to = d;
  }
  for (const [key, w] of weeks) cols.push({ key, label: w.label, kind: "week", from: w.from, to: w.to });
  if (days.length <= 62) for (const d of days) cols.push({ key: d, label: dayLabel(d), kind: "day", from: d, to: d });
  return cols;
}

function rollUpOverview(
  columns: OverviewColumn[], saleDaily: Map<string, { revenue: number; count: number }>,
  cdrDaily: Map<string, CdrDay>, monthlyTarget: number,
): Record<string, OverviewValues> {
  const out: Record<string, OverviewValues> = {};
  for (const col of columns) {
    const span = eachDay(col.from, col.to);
    let revenue = 0, saleCount = 0, connected = 0, notConnected = 0, uniqueConnected = 0, present = 0, talkSec = 0;
    for (const d of span) {
      const s = saleDaily.get(d); if (s) { revenue += s.revenue; saleCount += s.count; }
      const c = cdrDaily.get(d); if (c) { connected += c.connected; notConnected += c.notConnected; uniqueConnected += c.uniqueConnected; present += c.present; talkSec += c.talkSec; }
    }
    const totalCalls = connected + notConnected;
    let target = 0;
    if (col.kind === "mtd" && col.from.endsWith("-01")) target = monthlyTarget;
    else for (const d of span) target += monthlyTarget / daysInMonth(d.slice(0, 7));
    target = Math.round(target);
    out[col.key] = {
      connected, notConnected, uniqueConnected, totalCalls, connectedPct: pct(connected, totalCalls),
      target, revenue: round2(revenue), saleCount, achievedPct: pct(revenue, target), aov: saleCount > 0 ? Math.round(revenue / saleCount) : 0,
      presentCount: present, perAgentDialCount: present > 0 ? Math.round(totalCalls / present) : 0,
      avgSalePerAgent: present > 0 ? round2(saleCount / present) : 0,
      avgTalkPerAgentSec: present > 0 ? Math.round(talkSec / present) : 0,
    };
  }
  return out;
}

export async function getHousingPremiumOverview(fromInput: string, toInput: string, agentInput?: string): Promise<HousingPremiumOverviewData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const columns = buildOverviewColumns(from, to);
  const roster = await loadRoster();
  const agent = agentInput && agentInput.trim() && agentInput.trim().toLowerCase() !== "overall" ? agentInput.trim() : null;
  if (agent) {
    // Agent scope: the same day/week/MTD columns for one agent, with that agent's own roster target (same convention getHousingPremiumDayWise uses). No per-TL blocks -- they would not describe one agent.
    const agentTarget = roster.find((r) => r.name.toLowerCase() === agent.toLowerCase())?.target ?? 0;
    const [sd, cd] = await Promise.all([loadSaleDaily(from, to, undefined, agent), loadCdrDaily(from, to, undefined, agent)]);
    const [[saleCntA]] = await readRows(`SELECT COUNT(*) AS n FROM db_masmis.pre_sale`);
    return { from, to, columns, overall: rollUpOverview(columns, sd, cd.daily, agentTarget), byTl: [], cdrRowCount: cd.rowCount, saleRowCount: num(saleCntA?.n), cdrAvailable: cd.rowCount > 0 };
  }
  const activeTarget = roster.filter((r) => r.status === "Active").reduce((s, r) => s + r.target, 0);
  const targetByTl = new Map<string, number>();
  for (const r of roster.filter((r) => r.status === "Active")) targetByTl.set(r.tlName, (targetByTl.get(r.tlName) ?? 0) + r.target);

  const [saleDaily, cdr] = await Promise.all([loadSaleDaily(from, to), loadCdrDaily(from, to)]);
  const overall = rollUpOverview(columns, saleDaily, cdr.daily, activeTarget);

  const tlNames = [...new Set(roster.map((r) => r.tlName))];
  const byTl = await Promise.all(tlNames.map(async (tlName) => {
    const [sd, cd] = await Promise.all([loadSaleDaily(from, to, tlName), loadCdrDaily(from, to, tlName)]);
    return {
      tlName, agentCount: roster.filter((r) => r.tlName === tlName).length,
      values: rollUpOverview(columns, sd, cd.daily, targetByTl.get(tlName) ?? 0),
    };
  }));
  byTl.sort((a, b) => b.values.mtd.revenue - a.values.mtd.revenue);

  const [[saleCnt]] = await readRows(`SELECT COUNT(*) AS n FROM db_masmis.pre_sale`);
  return { from, to, columns, overall, byTl, cdrRowCount: cdr.rowCount, saleRowCount: num(saleCnt?.n), cdrAvailable: cdr.rowCount > 0 };
}

/* ============================ 2. DAY WISE PERFORMANCE ======================== */
/** Reference workbook's "Day Wise Agent Performance" + "Date Wise Performance" sheets,
 * merged into one -- both are the same day-by-day block, optionally scoped to one agent. */

export interface DayRow {
  date: string; dayName: string; target: number; totalCalls: number; connected: number; notConnected: number;
  uniqueConnected: number; connectedPct: number; avgTalkTimeSec: number; saleCount: number; revenue: number;
  aov: number; presentCount: number; avgSalePerAgent: number;
}
export interface HousingPremiumDayWiseData { from: string; to: string; agent: string; days: DayRow[] }

export async function getHousingPremiumDayWise(fromInput: string, toInput: string, agentInput?: string): Promise<HousingPremiumDayWiseData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const agent = agentInput && agentInput.trim() && agentInput.trim().toLowerCase() !== "overall" ? agentInput.trim() : null;
  const roster = await loadRoster();
  const monthlyTarget = agent
    ? roster.find((r) => r.name.toLowerCase() === agent.toLowerCase())?.target ?? 0
    : roster.filter((r) => r.status === "Active").reduce((s, r) => s + r.target, 0);

  const [saleRows] = await readRows(
    `SELECT report_date AS d, SUM(amount) AS rev, COUNT(*) AS n FROM db_masmis.pre_sale
      WHERE report_date BETWEEN ? AND ? ${agent ? "AND agent_name = ?" : ""} GROUP BY report_date`,
    agent ? [from, to, agent] : [from, to],
  );
  const saleByDate = new Map(saleRows.map((r) => [String(r.d), { rev: num(r.rev), n: num(r.n) }]));

  const [cdrRows] = await readRows(
    `SELECT DATE_FORMAT(d, '%Y-%m-%d') AS day, SUM(status='Answered') AS conn, SUM(status='No Answered') AS noconn,
            SUM(status='Answered' AND unique_count='1') AS uconn, SUM(call_count='1') AS present,
            SUM(CASE WHEN status='Answered' THEN talk_duration+0 ELSE 0 END) AS talk
       FROM (SELECT ${CDR_DATE_SQL} AS d, status, unique_count, call_count, talk_duration, member FROM db_masmis.Pre_cdr) x
      WHERE d BETWEEN ? AND ? ${agent ? "AND member = ?" : ""} GROUP BY d`,
    agent ? [from, to, agent] : [from, to],
  );
  const cdrByDate = new Map(cdrRows.map((r) => [String(r.day), r]));

  const days: DayRow[] = eachDay(from, to).map((d) => {
    const s = saleByDate.get(d) ?? { rev: 0, n: 0 };
    const c = cdrByDate.get(d);
    const connected = num(c?.conn), notConnected = num(c?.noconn), present = num(c?.present);
    const totalCalls = connected + notConnected;
    const dt = new Date(d);
    return {
      date: d, dayName: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()],
      target: Math.round(monthlyTarget / daysInMonth(d.slice(0, 7))),
      totalCalls, connected, notConnected, uniqueConnected: num(c?.uconn), connectedPct: pct(connected, totalCalls),
      avgTalkTimeSec: connected > 0 ? Math.round(num(c?.talk) / connected) : 0,
      saleCount: s.n, revenue: round2(s.rev), aov: s.n > 0 ? Math.round(s.rev / s.n) : 0,
      presentCount: present, avgSalePerAgent: present > 0 ? round2(s.n / present) : 0,
    };
  });
  return { from, to, agent: agent ?? "Overall", days };
}

/* =========================== 3. AGENT WISE PERFORMANCE ======================= */
/** Reference workbook's "Agent Wise Performance" sheet -- one row per agent, date-ranged. */

export interface AgentPerfRow {
  empId: string; name: string; tlName: string; doj: string | null; tenureDays: number | null; bucket: string;
  status: string; target: number; totalCalls: number; uniqueCalls: number; connected: number; notConnected: number;
  connectedPct: number; avgTalkTimeSec: number; saleCount: number; revenue: number; aov: number;
  presentCount: number; avgSalePerDay: number; achievedPct: number;
}
export interface HousingPremiumAgentWiseData { from: string; to: string; agents: AgentPerfRow[] }

export async function getHousingPremiumAgentWise(fromInput: string, toInput: string): Promise<HousingPremiumAgentWiseData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const roster = await loadRoster();
  const rangeDays = daysInMonth(from.slice(0, 7));
  const daysSpan = Math.max(1, eachDay(from, to).length);

  const [saleRows] = await readRows(
    `SELECT agent_name AS a, SUM(amount) AS rev, COUNT(*) AS n FROM db_masmis.pre_sale
      WHERE report_date BETWEEN ? AND ? GROUP BY agent_name`,
    [from, to],
  );
  const saleByAgent = new Map(saleRows.map((r) => [normalizeName(r.a), { rev: num(r.rev), n: num(r.n) }]));

  const [cdrRows] = await readRows(
    `SELECT member AS a, SUM(status='Answered') AS conn, SUM(status='No Answered') AS noconn,
            SUM(status='Answered' AND unique_count='1') AS uconn, SUM(call_count='1') AS present,
            SUM(CASE WHEN status='Answered' THEN talk_duration+0 ELSE 0 END) AS talk
       FROM (SELECT ${CDR_DATE_SQL} AS d, member, status, unique_count, call_count, talk_duration FROM db_masmis.Pre_cdr) x
      WHERE d BETWEEN ? AND ? GROUP BY member`,
    [from, to],
  );
  const cdrByAgent = new Map(cdrRows.map((r) => [normalizeName(r.a), r]));

  const allNames = new Set<string>([...roster.map((r) => r.name), ...saleByAgent.keys(), ...cdrByAgent.keys()]);
  const agents: AgentPerfRow[] = [...allNames].filter(Boolean).map((name) => {
    const ro = roster.find((r) => r.name === name);
    const sale = saleByAgent.get(name);
    const cdr = cdrByAgent.get(name);
    const connected = num(cdr?.conn), notConnected = num(cdr?.noconn), present = num(cdr?.present);
    const totalCalls = connected + notConnected;
    const monthlyTarget = ro?.target ?? 0;
    const proratedTarget = Math.round((monthlyTarget / rangeDays) * daysSpan);
    const tenureDays = tenureDaysFromDoj(ro?.doj, to);
    return {
      empId: ro?.empId ?? "", name, tlName: ro?.tlName ?? "Unmapped", doj: ro?.doj ?? null,
      tenureDays, bucket: tenureBucket(tenureDays), status: ro?.status ?? (sale || cdr ? "Unmapped" : "Unknown"),
      target: proratedTarget, totalCalls, uniqueCalls: num(cdr?.uconn), connected, notConnected,
      connectedPct: pct(connected, totalCalls), avgTalkTimeSec: connected > 0 ? Math.round(num(cdr?.talk) / connected) : 0,
      saleCount: sale?.n ?? 0, revenue: round2(sale?.rev ?? 0), aov: sale && sale.n > 0 ? Math.round(sale.rev / sale.n) : 0,
      presentCount: present, avgSalePerDay: present > 0 ? round2((sale?.n ?? 0) / present) : 0,
      achievedPct: pct(sale?.rev ?? 0, proratedTarget),
    };
  }).sort((a, b) => b.revenue - a.revenue);

  return { from, to, agents };
}

/* =========================== 4. SLOT WISE PERFORMANCE ========================= */
/** Reference workbook's "Slot Wise Agent Performance" sheet -- one row per hour (0-23). */

export interface SlotRow {
  hour: number; totalCalls: number; connected: number; notConnected: number; connectedPct: number; avgTalkTimeSec: number;
}
export interface HousingPremiumSlotWiseData {
  from: string; to: string; agent: string; slots: SlotRow[];
  saleByHourAvailable: false; saleByHourNote: string;
}

export async function getHousingPremiumSlotWise(fromInput: string, toInput: string, agentInput?: string): Promise<HousingPremiumSlotWiseData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const agent = agentInput && agentInput.trim() && agentInput.trim().toLowerCase() !== "overall" ? agentInput.trim() : null;

  const [rows] = await readRows(
    `SELECT CAST(time_value AS UNSIGNED) AS hour, SUM(status='Answered') AS conn, SUM(status='No Answered') AS noconn,
            SUM(CASE WHEN status='Answered' THEN talk_duration+0 ELSE 0 END) AS talk
       FROM (SELECT ${CDR_DATE_SQL} AS d, time_value, status, talk_duration, member FROM db_masmis.Pre_cdr) x
      WHERE d BETWEEN ? AND ? AND time_value REGEXP '^[0-9]+$' ${agent ? "AND member = ?" : ""}
      GROUP BY hour`,
    agent ? [from, to, agent] : [from, to],
  );
  const byHour = new Map(rows.map((r) => [num(r.hour), r]));
  const slots: SlotRow[] = Array.from({ length: 24 }, (_, hour) => {
    const r = byHour.get(hour);
    const connected = num(r?.conn), notConnected = num(r?.noconn);
    const totalCalls = connected + notConnected;
    return { hour, totalCalls, connected, notConnected, connectedPct: pct(connected, totalCalls), avgTalkTimeSec: connected > 0 ? Math.round(num(r?.talk) / connected) : 0 };
  });

  return {
    from, to, agent: agent ?? "Overall", slots, saleByHourAvailable: false,
    saleByHourNote: "Sale revenue/count by hour isn't available: the uploaded Sale file's Time/Hour column isn't captured by the current importer, only the day. Calls by hour come from the CDR file, which does capture it.",
  };
}

/* ========================== 5. AGENT WISE TQ / MQ / BQ ======================== */
/** Reference workbook's "Agent Wise TQ,MQ,BQ" sheet. */

export interface WeekBlock { label: string; from: string; to: string; target: number; achievement: number; saleCount: number; aov: number; achievedPct: number; stage: "TQ" | "MQ" | "BQ" | "-" }
export interface TqMqBqAgentRow {
  empId: string; name: string; tlName: string; doj: string | null; tenureDays: number | null; bucket: string; status: string;
  target: number; mtdTarget: number; achieved: number; saleCount: number; aov: number; remaining: number;
  achievedPct: number; rank: number | null; stage: "TQ" | "MQ" | "BQ" | "-"; weeks: WeekBlock[];
}
export interface HousingPremiumTqMqBqAgentsData { month: string; asOfDate: string; agents: TqMqBqAgentRow[] }

export async function getHousingPremiumTqMqBqAgents(monthInput: string): Promise<HousingPremiumTqMqBqAgentsData> {
  const month = /^\d{4}-\d{2}$/.test(monthInput) ? monthInput : todayLocal().slice(0, 7);
  const monthFrom = `${month}-01`, monthTo = `${month}-${p2(daysInMonth(month))}`;
  const today = todayLocal();
  const [[latest]] = await readRows(`SELECT MAX(report_date) AS d FROM db_masmis.pre_sale WHERE report_date BETWEEN ? AND ?`, [monthFrom, monthTo]);
  const asOfDate = (latest?.d && String(latest.d) < today) ? String(latest.d) : (monthTo < today ? monthTo : today);
  const elapsedDays = Math.max(1, eachDay(monthFrom, asOfDate).length);

  const roster = await loadRoster();
  const [saleRows] = await readRows(
    `SELECT agent_name AS a, SUM(amount) AS rev, COUNT(*) AS n FROM db_masmis.pre_sale WHERE report_date BETWEEN ? AND ? GROUP BY agent_name`,
    [monthFrom, monthTo],
  );
  const saleByAgent = new Map(saleRows.map((r) => [normalizeName(r.a), { rev: num(r.rev), n: num(r.n) }]));

  const weekRanges = [...new Set(eachDay(monthFrom, monthTo).map((d) => weekNoOfMonth(d)))].map((wn) => {
    const days = eachDay(monthFrom, monthTo).filter((d) => weekNoOfMonth(d) === wn);
    return { wn, from: days[0], to: days[days.length - 1] };
  });
  const weekSaleByAgent = new Map<number, Map<string, { rev: number; n: number }>>();
  for (const wr of weekRanges) {
    const [rows] = await readRows(
      `SELECT agent_name AS a, SUM(amount) AS rev, COUNT(*) AS n FROM db_masmis.pre_sale WHERE report_date BETWEEN ? AND ? GROUP BY agent_name`,
      [wr.from, wr.to],
    );
    weekSaleByAgent.set(wr.wn, new Map(rows.map((r) => [normalizeName(r.a), { rev: num(r.rev), n: num(r.n) }])));
  }

  const activeRoster = roster; // include all statuses; rank scoped to Active below
  const built = activeRoster.map((ro) => {
    const sale = saleByAgent.get(ro.name);
    const mtdTarget = Math.round((ro.target / daysInMonth(month)) * elapsedDays);
    const achievedPct = pct(sale?.rev ?? 0, mtdTarget);
    const tenureDays = tenureDaysFromDoj(ro.doj, asOfDate);
    const weeks: WeekBlock[] = weekRanges.map((wr) => {
      const s = weekSaleByAgent.get(wr.wn)?.get(ro.name);
      const weekTarget = Math.round((ro.target / 30) * 7);
      const ap = pct(s?.rev ?? 0, weekTarget);
      return {
        label: `Week-${wr.wn}`, from: wr.from, to: wr.to, target: weekTarget, achievement: round2(s?.rev ?? 0),
        saleCount: s?.n ?? 0, aov: s && s.n > 0 ? Math.round(s.rev / s.n) : 0, achievedPct: ap, stage: stageOf(ap),
      };
    });
    return {
      empId: ro.empId, name: ro.name, tlName: ro.tlName, doj: ro.doj, tenureDays, bucket: tenureBucket(tenureDays), status: ro.status,
      target: ro.target, mtdTarget, achieved: round2(sale?.rev ?? 0), saleCount: sale?.n ?? 0,
      aov: sale && sale.n > 0 ? Math.round(sale.rev / sale.n) : 0, remaining: round2(ro.target - (sale?.rev ?? 0)),
      achievedPct, rank: null as number | null, stage: stageOf(achievedPct), weeks,
    };
  });

  const activeSorted = built.filter((a) => a.status === "Active").sort((a, b) => b.achievedPct - a.achievedPct);
  activeSorted.forEach((a, i) => { a.rank = i + 1; });
  built.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || b.achievedPct - a.achievedPct);

  return { month, asOfDate, agents: built };
}

/* ============================ 6. TL WISE TQ / MQ / BQ ========================= */

export interface TqMqBqTlRow {
  tlName: string; agentCount: number; target: number; achievement: number; remaining: number;
  tillDayAchievedPct: number; saleCount: number; drr: number; currentDrr: number; stage: "TQ" | "MQ" | "BQ" | "-";
}
export interface HousingPremiumTqMqBqTlData { month: string; asOfDate: string; tls: TqMqBqTlRow[] }

export async function getHousingPremiumTqMqBqTl(monthInput: string): Promise<HousingPremiumTqMqBqTlData> {
  const month = /^\d{4}-\d{2}$/.test(monthInput) ? monthInput : todayLocal().slice(0, 7);
  const monthFrom = `${month}-01`, monthTo = `${month}-${p2(daysInMonth(month))}`;
  const today = todayLocal();
  const [[latest]] = await readRows(`SELECT MAX(report_date) AS d FROM db_masmis.pre_sale WHERE report_date BETWEEN ? AND ?`, [monthFrom, monthTo]);
  const asOfDate = (latest?.d && String(latest.d) < today) ? String(latest.d) : (monthTo < today ? monthTo : today);
  const dayOfMonth = Number(asOfDate.slice(8, 10));

  const roster = await loadRoster();
  const targetByTl = new Map<string, number>(); const countByTl = new Map<string, number>();
  // Target sums Active agents only, same convention as getHousingPremiumOverview's org-wide
  // Target -- countByTl stays a full roster headcount (an InActive agent is still on the team).
  for (const r of roster) countByTl.set(r.tlName, (countByTl.get(r.tlName) ?? 0) + 1);
  for (const r of roster.filter((r) => r.status === "Active")) targetByTl.set(r.tlName, (targetByTl.get(r.tlName) ?? 0) + r.target);

  const [rows] = await readRows(
    `SELECT ad.tl_name AS tl, SUM(ps.amount) AS rev, COUNT(*) AS n
       FROM db_masmis.pre_sale ps JOIN db_masmis.pre_agent_details ad ON ad.agent_name = ps.agent_name
      WHERE ps.report_date BETWEEN ? AND ? GROUP BY ad.tl_name`,
    [monthFrom, monthTo],
  );
  const saleByTl = new Map(rows.map((r) => [normalizeName(r.tl), { rev: num(r.rev), n: num(r.n) }]));

  const tlNames = new Set<string>([...targetByTl.keys(), ...saleByTl.keys()]);
  const tls: TqMqBqTlRow[] = [...tlNames].map((tlName) => {
    const target = targetByTl.get(tlName) ?? 0;
    const sale = saleByTl.get(tlName);
    const drr = Math.round(target / 30);
    const tillDayPct = pct(sale?.rev ?? 0, drr * dayOfMonth);
    return {
      tlName, agentCount: countByTl.get(tlName) ?? 0, target, achievement: round2(sale?.rev ?? 0),
      remaining: round2(target - (sale?.rev ?? 0)), tillDayAchievedPct: tillDayPct, saleCount: sale?.n ?? 0,
      drr, currentDrr: drr * dayOfMonth, stage: stageOf(tillDayPct),
    };
  }).sort((a, b) => b.achievement - a.achievement);

  return { month, asOfDate, tls };
}

/* =============================== 7. TEAM DETAILS =============================== */

export interface TeamDetailsRow {
  empId: string; name: string; tlName: string; center: string; doj: string | null; tenureDays: number | null;
  bucket: string; status: string; target: number; uploadedAchievement: number; uploadedAchPct: string;
  computedRevenue: number; achievementMismatch: boolean; mismatchAmount: number;
}
export interface HousingPremiumTeamDetailsData { rows: TeamDetailsRow[]; mismatchCount: number }

export async function getHousingPremiumTeamDetails(): Promise<HousingPremiumTeamDetailsData> {
  const today = todayLocal();
  const roster = await loadRoster();
  const [saleRows] = await readRows(`SELECT agent_name AS a, SUM(amount) AS rev FROM db_masmis.pre_sale GROUP BY agent_name`);
  const revByAgent = new Map(saleRows.map((r) => [normalizeName(r.a), num(r.rev)]));

  const rows: TeamDetailsRow[] = roster.map((r) => {
    const computed = round2(revByAgent.get(r.name) ?? 0);
    const mismatchAmount = round2(r.uploadedAchievement - computed);
    const tenureDays = tenureDaysFromDoj(r.doj, today);
    return {
      empId: r.empId, name: r.name, tlName: r.tlName, center: r.center, doj: r.doj, tenureDays, bucket: tenureBucket(tenureDays),
      status: r.status, target: r.target, uploadedAchievement: r.uploadedAchievement, uploadedAchPct: r.uploadedAchPct,
      computedRevenue: computed, achievementMismatch: Math.abs(mismatchAmount) > 1, mismatchAmount,
    };
  }).sort((a, b) => b.target - a.target);

  return { rows, mismatchCount: rows.filter((r) => r.achievementMismatch).length };
}

/* ============================ 8. VALIDATION / RECONCILIATION ================== */
/** Cross-checks the three uploaded files against each other -- this is the
 * "does the dashboard match Agent Details and Sale" check the workbook has
 * no equivalent of, since its Team Details sheet computes achievement live
 * from the same Sale Raw sheet it displays (so it can never disagree with
 * itself). Our roster's achievement is a value someone uploaded, separately
 * from pre_sale, so the two CAN drift -- this surfaces exactly where. */

export interface ValidationMismatch { agentName: string; empId: string; uploadedAchievement: number; computedRevenue: number; diff: number }
export interface HousingPremiumValidation {
  saleRowCount: number; agentRowCount: number; cdrRowCount: number;
  agentsInSaleNotInRoster: string[]; agentsInRosterWithNoSale: string[];
  achievementMismatches: ValidationMismatch[];
  cdrAgentsNotInRoster: string[];
  /** pre_sale.tl_name distinct values and whether any of them exist in the roster's own TL names.
   * See getHousingPremiumOverview's header note: confirmed live, every pre_sale row currently
   * carries one TL value that matches no real TL -- this column can't be trusted for grouping. */
  saleTlNameUsable: boolean;
  saleTlNameValues: string[];
  rosterTlNames: string[];
}

export async function getHousingPremiumValidation(): Promise<HousingPremiumValidation> {
  const roster = await loadRoster();
  const rosterNames = new Set(roster.map((r) => r.name));

  const [saleRows] = await readRows(`SELECT DISTINCT agent_name AS a FROM db_masmis.pre_sale`);
  const saleNames = new Set(saleRows.map((r) => normalizeName(r.a)).filter(Boolean));
  const [[saleCnt]] = await readRows(`SELECT COUNT(*) AS n FROM db_masmis.pre_sale`);
  const [[agentCnt]] = await readRows(`SELECT COUNT(*) AS n FROM db_masmis.pre_agent_details`);
  const [[cdrCnt]] = await readRows(`SELECT COUNT(*) AS n FROM db_masmis.Pre_cdr`);

  const [revRows] = await readRows(`SELECT agent_name AS a, SUM(amount) AS rev FROM db_masmis.pre_sale GROUP BY agent_name`);
  const revByAgent = new Map(revRows.map((r) => [normalizeName(r.a), num(r.rev)]));

  const mismatches: ValidationMismatch[] = [];
  for (const r of roster) {
    const computed = round2(revByAgent.get(r.name) ?? 0);
    const diff = round2(r.uploadedAchievement - computed);
    if (Math.abs(diff) > 1) mismatches.push({ agentName: r.name, empId: r.empId, uploadedAchievement: r.uploadedAchievement, computedRevenue: computed, diff });
  }
  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  let cdrAgentsNotInRoster: string[] = [];
  if (num(cdrCnt?.n) > 0) {
    const [cdrNameRows] = await readRows(`SELECT DISTINCT member AS a FROM db_masmis.Pre_cdr`);
    cdrAgentsNotInRoster = cdrNameRows.map((r) => normalizeName(r.a)).filter((n) => n && !rosterNames.has(n));
  }

  const rosterTlNames = [...new Set(roster.map((r) => r.tlName))];
  const [saleTlRows] = await readRows(`SELECT DISTINCT tl_name AS t FROM db_masmis.pre_sale`);
  const saleTlNameValues = saleTlRows.map((r) => normalizeName(r.t)).filter(Boolean);
  const saleTlNameUsable = saleTlNameValues.some((t) => rosterTlNames.includes(t));

  return {
    saleRowCount: num(saleCnt?.n), agentRowCount: num(agentCnt?.n), cdrRowCount: num(cdrCnt?.n),
    agentsInSaleNotInRoster: [...saleNames].filter((n) => !rosterNames.has(n)),
    agentsInRosterWithNoSale: [...rosterNames].filter((n) => !saleNames.has(n)),
    achievementMismatches: mismatches, cdrAgentsNotInRoster,
    saleTlNameUsable, saleTlNameValues, rosterTlNames,
  };
}

/* ============================== agent drill-down =============================== */

export interface HousingPremiumAgentDetail {
  empId: string; name: string; tlName: string; center: string; doj: string | null; tenureDays: number | null;
  bucket: string; status: string; target: number; uploadedAchievement: number;
  daily: Array<{ date: string; saleCount: number; revenue: number; calls: number; connected: number }>;
  orders: Array<{ orderId: string; date: string; amount: number; orderValue: number; partnerName: string }>;
}

const DETAIL_LIMIT = 200;

export async function getHousingPremiumAgentDetail(nameRaw: string, fromInput: string, toInput: string): Promise<HousingPremiumAgentDetail | null> {
  const name = normalizeName(nameRaw);
  if (!name) return null;
  const { from, to } = resolveRange(fromInput, toInput);
  const today = todayLocal();

  const roster = await loadRoster();
  const ro = roster.find((r) => r.name === name);

  const [saleDaily] = await readRows(
    `SELECT report_date AS d, SUM(amount) AS rev, COUNT(*) AS n FROM db_masmis.pre_sale WHERE agent_name = ? AND report_date BETWEEN ? AND ? GROUP BY report_date`,
    [name, from, to],
  );
  const [cdrDaily] = await readRows(
    `SELECT DATE_FORMAT(d, '%Y-%m-%d') AS day, COUNT(*) AS n, SUM(status='Answered') AS conn
       FROM (SELECT ${CDR_DATE_SQL} AS d, status, member FROM db_masmis.Pre_cdr) x
      WHERE member = ? AND d BETWEEN ? AND ? GROUP BY d`,
    [name, from, to],
  );
  const cdrMap = new Map(cdrDaily.map((r) => [String(r.day), r]));
  const daily = saleDaily.map((r) => ({
    date: String(r.d), saleCount: num(r.n), revenue: round2(num(r.rev)),
    calls: num(cdrMap.get(String(r.d))?.n), connected: num(cdrMap.get(String(r.d))?.conn),
  }));
  for (const [d, r] of cdrMap) if (!daily.find((x) => x.date === d)) daily.push({ date: d, saleCount: 0, revenue: 0, calls: num(r.n), connected: num(r.conn) });
  daily.sort((a, b) => b.date.localeCompare(a.date));

  const [orders] = await readRows(
    `SELECT order_id, report_date, amount, order_value, partner_name FROM db_masmis.pre_sale WHERE agent_name = ? AND report_date BETWEEN ? AND ? ORDER BY report_date DESC LIMIT ${DETAIL_LIMIT}`,
    [name, from, to],
  );
  if (!ro && daily.length === 0 && orders.length === 0) return null;

  const tenureDays = tenureDaysFromDoj(ro?.doj, today);
  return {
    empId: ro?.empId ?? "", name, tlName: ro?.tlName ?? "Unmapped", center: ro?.center ?? "Unknown", doj: ro?.doj ?? null,
    tenureDays, bucket: tenureBucket(tenureDays), status: ro?.status ?? "Unknown", target: ro?.target ?? 0,
    uploadedAchievement: ro?.uploadedAchievement ?? 0, daily,
    orders: orders.map((o) => ({ orderId: String(o.order_id), date: String(o.report_date), amount: num(o.amount), orderValue: num(o.order_value), partnerName: normalizeName(o.partner_name) || "Unknown" })),
  };
}
