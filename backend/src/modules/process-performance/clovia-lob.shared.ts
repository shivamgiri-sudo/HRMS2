import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Shared building blocks for the Clovia per-LOB dashboards (Email, Chat,
 * Outbound, Inbound add-ons, Overview). Read-only: every function here only
 * SELECTs from db_masmis.cl_* (and, for the inbound day-level survey
 * denominator, the read-only dialer table).
 *
 * The LOB services return a REPORT SPEC (kpis / charts / tables / insights)
 * rather than bare numbers, so one generic renderer on the client draws every
 * LOB the same way, the export uses the same figures, and a KPI defined once
 * is the only definition used for the headline, every week column and every
 * date column (see kpiPeriods below).
 *
 * Source date formats (all confirmed against live rows, 0 unparseable rows):
 *   cl_apr / cl_email_raw / cl_feedback / cl_rechurn_call  report_date  "1-Sep-26"           -> %e-%b-%y
 *   cl_quality                                             audit_date   "1-Sep-26"           -> %e-%b-%y
 *   cl_outbound   call_date "9/1/26" (%c/%e/%y), start_time "9/1/26 10:33" (%c/%e/%y %H:%i)
 *   cl_dispo      report_date "01/09/2026 09:35:25" -> %d/%m/%Y %H:%i:%s
 *   cl_chat       date_time "2026-09-01T09:38:20.000Z" -- a 'Z' suffix but the value is
 *                 wall-clock local time (its own report_date / hours columns agree), so it
 *                 is read literally, never converted through UTC.
 * A row whose date does not parse cannot fall in any date range; the coverage
 * block counts them so they are visible rather than silently missing.
 */

/* ───────────────────────────── spec types ───────────────────────────── */

export type Fmt = "int" | "pct" | "sec" | "hrs" | "dec1" | "dec2" | "text";
export type Tone = "sky" | "emerald" | "teal" | "amber" | "violet" | "indigo" | "rose" | "cyan" | "red" | "blue";

export interface Kpi {
  key: string; label: string; value: number | string | null; fmt: Fmt; tone: Tone;
  /** lucide icon name, mapped on the client. */
  icon: string; sub?: string; tab?: string;
}
export interface ChartSeries {
  key: string; label: string; color: string; type?: "bar" | "line" | "area";
  axis?: "left" | "right"; stackId?: string; fmt?: Fmt;
}
export interface ChartSpec {
  key: string; title: string; subtitle?: string; tab: string;
  kind: "combo" | "hbar" | "donut" | "heatmap";
  /** combo / hbar: name of the category field; how to print it. */
  xKey?: string; xFmt?: "date" | "text" | "hour";
  series?: ChartSeries[];
  data?: Array<Record<string, number | string | null>>;
  heat?: { xLabels: string[]; yLabels: string[]; xKeys: string[]; yKeys: string[]; cells: Array<{ x: number; y: number; v: number }>; unit: string };
  footnote?: string;
  /** Clicking a bar / segment / heat cell opens this drill-down. */
  drill?: { kind: string; keyField?: string };
  span?: 1 | 2;
}
export interface Column { key: string; label: string; fmt?: Fmt; align?: "left" | "right"; hint?: string }
export interface TableSpec {
  key: string; title: string; subtitle?: string; tab: string;
  columns: Column[]; rows: Array<Record<string, unknown>>;
  /** Row click -> GET detail?kind=<drillKind>&key=<row[keyField]>. */
  drillKind: string; keyField: string;
  searchable?: boolean; footnote?: string; totals?: Record<string, unknown>; icon?: string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
}
export interface Insight { tone: "info" | "good" | "warn" | "bad"; text: string; tab?: string }
export interface CoverageRow { source: string; table: string; rows: number; minDate: string | null; maxDate: string | null; days: number; note?: string }

export interface LobPayload {
  lob: string; label: string; from: string; to: string;
  filters: Record<string, string>;
  options: Record<string, string[]>;
  tabs: Array<{ key: string; label: string }>;
  coverage: CoverageRow[];
  kpis: Kpi[]; charts: ChartSpec[]; tables: TableSpec[]; insights: Insight[];
  /** Every computed metric of the headline window (a superset of the KPI cards) -- lets other slides reuse the exact same numbers. */
  metrics: Record<string, number | null>;
  /** Data-quality findings and omitted metrics -- always visible in the UI. */
  notes: string[];
  definitions: Array<{ term: string; meaning: string }>;
  empty: boolean; latestDate: string | null;
}

export interface DetailSection {
  title: string; type: "kv" | "table" | "chart" | "text" | "kpis";
  kv?: Array<{ label: string; value: string | number | null; fmt?: Fmt }>;
  table?: { columns: Column[]; rows: Array<Record<string, unknown>>; recordType?: string; keyField?: string };
  chart?: ChartSpec; text?: string; kpis?: Kpi[]; empty?: string;
}
export interface DetailPayload {
  title: string; subtitle?: string; badge?: { label: string; tone: "green" | "amber" | "red" | "slate" | "blue" };
  sections: DetailSection[];
}

export interface PeriodColumn { key: string; label: string; kind: "week" | "day"; from: string; to: string }
export interface PeriodRow { key: string; label: string; fmt: Fmt; value: number | string | null; cols: Record<string, number | string | null> }
export interface PeriodTable { title: string; rowsLabel: string; rows: PeriodRow[] }
export interface PeriodBreakdown { from: string; to: string; columns: PeriodColumn[]; tables: PeriodTable[]; dailyColumnsOmitted: boolean }

/* ───────────────────────────── numbers / text ───────────────────────────── */

export const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/[%,]/g, "").trim();
  if (s === "" || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
export const round1 = (v: number) => Math.round(v * 10) / 10;
export const round2 = (v: number) => Math.round(v * 100) / 100;
export const pct = (a: number, b: number) => (b > 0 ? round2((a / b) * 100) : 0);
export const avg = (sum: number, cnt: number) => (cnt > 0 ? sum / cnt : 0);
export const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
export const timeToSec = (raw: unknown): number => {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return 0;
};
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (_m, c: string) => c.toUpperCase()).replace(/\s+/g, " ").trim();
}
export function maskPhone(p: unknown): string {
  const d = String(p ?? "").replace(/\s+/g, "");
  if (!d) return "—";
  if (d.length <= 4) return "••••";
  return `${"•".repeat(Math.max(d.length - 4, 3))}${d.slice(-4)}`;
}
/** Free text can carry customer phones / emails: blank out long digit runs and addresses. */
export function maskFreeText(s: unknown): string {
  return String(s ?? "")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\d{9,}/g, (m) => `••••${m.slice(-4)}`);
}
/** Agent login e-mails ("akanksha.sankhwar@purplepanda.in") -> a display name without the address. */
export function nameFromLogin(login: unknown): string {
  const local = String(login ?? "").split("@")[0].replace(/[._]+/g, " ").trim();
  return local ? titleCase(local) : "—";
}
export const bucketOf = (v: number, buckets: ReadonlyArray<{ label: string; min: number; max: number }>) =>
  buckets.find((b) => v >= b.min && v <= b.max)?.label ?? buckets[buckets.length - 1].label;

/* ───────────────────────────── dates / periods ───────────────────────────── */

export const MON_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
const MAX_PERIOD_DAILY_COLUMNS = 62;

export function isoAddDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
export const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
export function localToday(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export function resolveRange(fromIn: string, toIn: string): { from: string; to: string } {
  const today = localToday();
  const fallbackFrom = `${today.slice(0, 7)}-01`;
  let from = DATE_RE.test(fromIn) ? fromIn : fallbackFrom;
  let to = DATE_RE.test(toIn) ? toIn : today;
  if (from > to) [from, to] = [to, from];
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > (MAX_RANGE_DAYS - 1) * 86_400_000) {
    throw new Error(`Date range is limited to ${MAX_RANGE_DAYS} days`);
  }
  return { from, to };
}
export function listDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = isoAddDays(d, 1)) out.push(d);
  return out;
}
export const dayLabel = (d: string) => `${Number(d.slice(8, 10))}-${MON_ABBR[Number(d.slice(5, 7)) - 1]}`;
export const fmtDdMmYyyy = (d: string | null | undefined) => (d && DATE_RE.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d ?? "—");

/** W-1 = days 1-7 of the month, W-2 = 8-14 ... (same convention as every other Process Performance dashboard). */
export function buildPeriodColumns(from: string, to: string): { columns: PeriodColumn[]; dailyColumnsOmitted: boolean } {
  const days = listDays(from, to);
  const weekOf = (d: string) => Math.floor((Number(d.slice(8, 10)) - 1) / 7) + 1;
  const multiMonth = new Set(days.map((d) => d.slice(0, 7))).size > 1;
  const weeks = new Map<string, PeriodColumn>();
  for (const d of days) {
    const key = `${d.slice(0, 7)}-W${weekOf(d)}`;
    const w = weeks.get(key);
    if (!w) weeks.set(key, { key, label: multiMonth ? `${MON_ABBR[Number(d.slice(5, 7)) - 1]} W-${weekOf(d)}` : `W-${weekOf(d)}`, kind: "week", from: d, to: d });
    else w.to = d;
  }
  const columns: PeriodColumn[] = [...weeks.values()];
  const dailyColumnsOmitted = days.length > MAX_PERIOD_DAILY_COLUMNS;
  if (!dailyColumnsOmitted) for (const d of days) columns.push({ key: d, label: dayLabel(d), kind: "day", from: d, to: d });
  return { columns, dailyColumnsOmitted };
}

/** Keep the rows whose `date` falls in [from, to] (ISO strings compare correctly). */
export const inRange = <T extends { date: string }>(rows: T[], from: string, to: string): T[] =>
  rows.filter((r) => r.date >= from && r.date <= to);

/* ───────────────────────────── directory (agents / TLs) ───────────────────────────── */

export interface Directory { name: Map<string, string>; tl: Map<string, string> }

/** mas_id -> display name (APR wins, then quality, e-mail, chat) and mas_id -> TL (chat tl_name, quality tl). */
export async function loadDirectory(): Promise<Directory> {
  const [apr] = await db.execute<RowDataPacket[]>(`SELECT mas_id, MAX(user_name) AS n FROM db_masmis.cl_apr WHERE mas_id IS NOT NULL AND mas_id <> '' GROUP BY mas_id`);
  const [qual] = await db.execute<RowDataPacket[]>(`SELECT emp_id AS id, MAX(emp_name) AS n, MAX(tl) AS tl FROM db_masmis.cl_quality WHERE emp_id IS NOT NULL AND emp_id <> '' GROUP BY emp_id`);
  const [mail] = await db.execute<RowDataPacket[]>(`SELECT emp_id AS id, MAX(agent_name) AS n FROM db_masmis.cl_email_raw WHERE emp_id IS NOT NULL AND emp_id <> '' GROUP BY emp_id`);
  const [chat] = await db.execute<RowDataPacket[]>(`SELECT mas_id AS id, MAX(actual_agent_on_chat) AS n, MAX(tl_name) AS tl FROM db_masmis.cl_chat WHERE mas_id IS NOT NULL AND mas_id NOT IN ('', 'NA') GROUP BY mas_id`);
  const name = new Map<string, string>();
  const tl = new Map<string, string>();
  for (const r of chat) { if (r.n) name.set(String(r.id), titleCase(String(r.n))); if (r.tl) tl.set(String(r.id), String(r.tl).trim()); }
  for (const r of mail) if (r.n) name.set(String(r.id), titleCase(String(r.n)));
  for (const r of qual) { if (r.n) name.set(String(r.id), titleCase(String(r.n))); if (r.tl) tl.set(String(r.id), String(r.tl).trim()); }
  for (const r of apr) if (r.n) name.set(String(r.mas_id), titleCase(String(r.n)));
  return { name, tl };
}
export const agentName = (dir: Directory, id: string): string =>
  id === "VDAD" ? "VDAD (auto-dialer)" : dir.name.get(id) ?? id;
export const tlOf = (dir: Directory, id: string): string => dir.tl.get(id) ?? "Unmapped";

/* ───────────────────────────── quality / disposition rows ───────────────────────────── */

export interface QualRow {
  id: number; date: string; interactionDate: string; chatId: string; empId: string; empName: string; tl: string;
  source: string; cxQuery: string; params: Array<number | null>; aoi: string; lob: string; score: number; fatal: boolean;
  acpt: string; acptReason: string; uniqueId: string;
}
export const QUALITY_PARAMS: Array<{ key: string; label: string; col: string }> = [
  { key: "frt", label: "FRT shared within timeline", col: "frt_shared_within_timeline" },
  { key: "info", label: "Correct information shared", col: "correct_information_shared" },
  { key: "soft", label: "Soft skills followed", col: "soft_skills_followed_on_chat" },
  { key: "reminder", label: "Reminder shared to customer", col: "reminder_shared_to_cx" },
  { key: "resolved", label: "Customer concern resolved", col: "cx_concern_resolved" },
  { key: "tagging", label: "Tagging / mail shared", col: "tagging_mail_shared" },
];
const DMY_SHORT = "%e-%b-%y";

export async function loadQuality(from: string, to: string, lob: string | null): Promise<QualRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, unique_id, DATE_FORMAT(STR_TO_DATE(audit_date,'${DMY_SHORT}'),'%Y-%m-%d') AS d,
            DATE_FORMAT(STR_TO_DATE(chat_mail_date,'${DMY_SHORT}'),'%Y-%m-%d') AS idate,
            chat_id, emp_id, emp_name, tl, chat_source, cx_query, aoi_if_any, lob, cq_score, fatal, acpt, acpt_reason,
            ${QUALITY_PARAMS.map((p) => p.col).join(", ")}
       FROM db_masmis.cl_quality
      WHERE STR_TO_DATE(audit_date,'${DMY_SHORT}') BETWEEN ? AND ?${lob ? " AND lob = ?" : ""}
      ORDER BY id`,
    lob ? [from, to, lob] : [from, to],
  );
  return rows.map((r) => ({
    id: num(r.id), date: String(r.d), interactionDate: String(r.idate ?? ""), chatId: String(r.chat_id ?? ""),
    empId: String(r.emp_id ?? ""), empName: titleCase(String(r.emp_name ?? "")), tl: String(r.tl ?? "").trim(),
    source: String(r.chat_source ?? ""), cxQuery: String(r.cx_query ?? "").trim() || "Unknown",
    params: QUALITY_PARAMS.map((p) => { const v = String(r[p.col] ?? "").trim(); return v === "" || v === "-" ? null : num(v); }),
    aoi: String(r.aoi_if_any ?? "").trim(), lob: String(r.lob ?? ""), score: num(r.cq_score),
    // fatal is stored as 1 = "no fatal error", 0 = fatal: the only audit with fatal=0 is the one scored 0.00%.
    fatal: String(r.fatal ?? "").trim() === "0",
    acpt: String(r.acpt ?? "").trim() || "Unknown", acptReason: String(r.acpt_reason ?? "").trim(), uniqueId: String(r.unique_id ?? ""),
  }));
}

export interface DispoRow {
  id: number; date: string; ticketNo: string; hour: number; agentLogin: string; agent: string; skill: string;
  reason: string; subReason: string; qrc: string; action: string; orderNo: string; orderStatus: string; courier: string;
  ftr: "FTR" | "Repeat" | "NA"; userState: string; conduct: string; flag: string; week: string;
}
export async function loadDispo(from: string, to: string, skills: string[] | null): Promise<DispoRow[]> {
  const skillSql = skills ? ` AND (${skills.map(() => "skill = ?").join(" OR ")})` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, ticket_no, DATE_FORMAT(STR_TO_DATE(report_date,'%d/%m/%Y %H:%i:%s'),'%Y-%m-%d') AS d,
            HOUR(STR_TO_DATE(report_date,'%d/%m/%Y %H:%i:%s')) AS hr, agent_name, skill, reason, sub_reason, qrc,
            action_taken, order_no, order_status, courier_partner, repeat_ftr, user_state, conduct_of_customer, flag, weeks
       FROM db_masmis.cl_dispo
      WHERE DATE(STR_TO_DATE(report_date,'%d/%m/%Y %H:%i:%s')) BETWEEN ? AND ?${skillSql}
      ORDER BY id`,
    skills ? [from, to, ...skills] : [from, to],
  );
  return rows.map((r) => ({
    id: num(r.id), date: String(r.d), ticketNo: String(r.ticket_no ?? ""), hour: num(r.hr),
    agentLogin: String(r.agent_name ?? ""), agent: nameFromLogin(r.agent_name), skill: String(r.skill ?? "").trim() || "(blank)",
    reason: String(r.reason ?? "").trim() || "Unknown", subReason: String(r.sub_reason ?? "").trim() || "—",
    qrc: String(r.qrc ?? "").trim() || "Unknown", action: String(r.action_taken ?? "").trim() || "(none)",
    orderNo: String(r.order_no ?? "").trim(), orderStatus: String(r.order_status ?? "").trim() || "(none)",
    courier: String(r.courier_partner ?? "").trim() || "(none)",
    ftr: r.repeat_ftr === "FTR" ? "FTR" : r.repeat_ftr === "Repeat" ? "Repeat" : "NA",
    userState: String(r.user_state ?? "").trim(), conduct: String(r.conduct_of_customer ?? "").trim(), flag: String(r.flag ?? "").trim(),
    week: String(r.weeks ?? ""),
  }));
}

/* ───────────────────────────── coverage ───────────────────────────── */

/** Row count, parsed date span and unparseable-date count for one source -- shown on every slide. */
export async function coverageOf(source: string, table: string, dateExpr: string, note?: string): Promise<CoverageRow & { unparseable: number }> {
  const [[r]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN (${dateExpr}) IS NULL THEN 1 ELSE 0 END) AS bad,
            DATE_FORMAT(MIN(${dateExpr}),'%Y-%m-%d') AS mn, DATE_FORMAT(MAX(${dateExpr}),'%Y-%m-%d') AS mx,
            COUNT(DISTINCT DATE(${dateExpr})) AS days
       FROM db_masmis.${table}`,
  );
  return { source, table, rows: num(r.n), minDate: r.mn ? String(r.mn) : null, maxDate: r.mx ? String(r.mx) : null, days: num(r.days), note, unparseable: num(r.bad) };
}
export const DATE_EXPR = {
  apr: `STR_TO_DATE(report_date,'${DMY_SHORT}')`,
  chat: `STR_TO_DATE(REPLACE(REPLACE(date_time,'T',' '),'.000Z',''),'%Y-%m-%d %H:%i:%s')`,
  dispo: `STR_TO_DATE(report_date,'%d/%m/%Y %H:%i:%s')`,
  email: `STR_TO_DATE(report_date,'${DMY_SHORT}')`,
  feedback: `STR_TO_DATE(report_date,'${DMY_SHORT}')`,
  outbound: `STR_TO_DATE(call_date,'%c/%e/%y')`,
  quality: `STR_TO_DATE(audit_date,'${DMY_SHORT}')`,
  rechurn: `STR_TO_DATE(report_date,'${DMY_SHORT}')`,
  ibcdr: `STR_TO_DATE(call_date,'${DMY_SHORT}')`,
} as const;

/* ───────────────────────────── KPI periods (Value + W-n + one column per date) ───────────────────────────── */

export interface KpiDefLite { key: string; label: string; fmt: Fmt }

/**
 * Evaluate the SAME compute function for the whole range, every week block and
 * every day, so the headline, the weekly columns and the daily columns are
 * produced by one definition and cannot disagree. Empty periods are zeros.
 */
export function kpiPeriodRows<B>(
  defs: KpiDefLite[], compute: (b: B) => Record<string, number | null>, slice: (from: string, to: string) => B,
  from: string, to: string, columns: PeriodColumn[],
): PeriodRow[] {
  const whole = compute(slice(from, to));
  const perCol = new Map<string, Record<string, number | null>>();
  for (const c of columns) perCol.set(c.key, compute(slice(c.from, c.to)));
  return defs.map((d) => ({
    key: d.key, label: d.label, fmt: d.fmt, value: whole[d.key] ?? 0,
    cols: Object.fromEntries(columns.map((c) => [c.key, perCol.get(c.key)?.[d.key] ?? 0])),
  }));
}

/** Count rows per category per period column, ordered by whole-range volume. */
export function categoryPeriodRows<R extends { date: string }>(
  rows: R[], catOf: (r: R) => string, columns: PeriodColumn[], limit = 25,
): PeriodRow[] {
  const total = new Map<string, number>();
  for (const r of rows) total.set(catOf(r), (total.get(catOf(r)) ?? 0) + 1);
  const cats = [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c);
  return cats.map((cat) => ({
    key: cat, label: cat, fmt: "int" as Fmt, value: total.get(cat) ?? 0,
    cols: Object.fromEntries(columns.map((c) => [c.key, rows.filter((r) => r.date >= c.from && r.date <= c.to && catOf(r) === cat).length])),
  }));
}

/* ───────────────────────────── generic section builders ───────────────────────────── */

export const countBy = <T,>(rows: T[], keyFn: (r: T) => string): Array<{ label: string; count: number }> => {
  const m = new Map<string, number>();
  for (const r of rows) { const k = keyFn(r); m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
};

export const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#0ea5e9", "#f43f5e", "#a78bfa", "#14b8a6", "#ec4899", "#84cc16", "#64748b", "#f97316", "#06b6d4"];

export function dispoKpis(rows: DispoRow[], tab: string): Kpi[] {
  const orderLinked = rows.filter((r) => r.ftr !== "NA");
  const ftr = orderLinked.filter((r) => r.ftr === "FTR").length;
  return [
    { key: "tk_total", label: "CRM tickets", value: rows.length, fmt: "int", tone: "indigo", icon: "ClipboardList", tab },
    { key: "tk_ftr", label: "FTR % (order-linked)", value: pct(ftr, orderLinked.length), fmt: "pct", tone: "emerald", icon: "CheckCircle2", sub: `${ftr.toLocaleString("en-IN")} of ${orderLinked.length.toLocaleString("en-IN")} tickets with an order`, tab },
    { key: "tk_esc", label: "Escalated %", value: pct(rows.filter((r) => r.action === "escalated").length, rows.length), fmt: "pct", tone: "red", icon: "ArrowUpRight", sub: `${rows.filter((r) => r.action === "escalated").length.toLocaleString("en-IN")} escalated`, tab },
    { key: "tk_res", label: "Resolved on call %", value: pct(rows.filter((r) => r.action === "resolved").length, rows.length), fmt: "pct", tone: "teal", icon: "BadgeCheck", tab },
    { key: "tk_cmp", label: "Complaint share", value: pct(rows.filter((r) => r.qrc.toLowerCase().includes("complaint")).length, rows.length), fmt: "pct", tone: "amber", icon: "AlertTriangle", sub: "QRC = Complaint", tab },
  ];
}

/** Ticket (cl_dispo) breakdown tables + reason chart for one LOB / skill. */
export function dispoSection(rows: DispoRow[], tab: string, prefix: string): { charts: ChartSpec[]; tables: TableSpec[] } {
  const summarise = (label: string, rs: DispoRow[]) => {
    const linked = rs.filter((r) => r.ftr !== "NA");
    return {
      label, count: rs.length, share: pct(rs.length, rows.length),
      escPct: pct(rs.filter((r) => r.action === "escalated").length, rs.length),
      ftrPct: pct(linked.filter((r) => r.ftr === "FTR").length, linked.length),
    };
  };
  const grouped = (keyFn: (r: DispoRow) => string) => {
    const m = new Map<string, DispoRow[]>();
    for (const r of rows) { const k = keyFn(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return [...m.entries()].map(([l, rs]) => summarise(l, rs)).sort((a, b) => b.count - a.count);
  };
  const cols: Column[] = [
    { key: "label", label: "", align: "left" }, { key: "count", label: "Tickets", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" },
    { key: "escPct", label: "Escalated %", fmt: "pct" }, { key: "ftrPct", label: "FTR %", fmt: "pct", hint: "of tickets that carry an order number" },
  ];
  const mk = (key: string, title: string, first: string, data: ReturnType<typeof grouped>, drillKind: string, extra?: Partial<TableSpec>): TableSpec => ({
    key: `${prefix}_${key}`, title, tab, columns: [{ ...cols[0], label: first }, ...cols.slice(1)], rows: data.map((d) => ({ ...d, _key: d.label })),
    drillKind, keyField: "_key", searchable: data.length > 8, ...extra,
  });
  const byReason = grouped((r) => r.reason);
  const subs = new Map<string, DispoRow[]>();
  for (const r of rows) { const k = `${r.reason}|${r.subReason}`; (subs.get(k) ?? subs.set(k, []).get(k)!).push(r); }
  const subRows = [...subs.entries()].map(([k, rs]) => ({ ...summarise(`${k.split("|")[0]} › ${k.split("|")[1]}`, rs), _key: k })).sort((a, b) => b.count - a.count).slice(0, 40);
  const agentRows = grouped((r) => r.agentLogin);
  return {
    charts: [{
      key: `${prefix}_reason_chart`, title: "Ticket reasons", tab, kind: "hbar", xKey: "label", xFmt: "text",
      series: [{ key: "count", label: "Tickets", color: "#6366f1" }], data: byReason.slice(0, 12).map((d) => ({ label: d.label, count: d.count })),
      drill: { kind: "dispo_reason", keyField: "label" }, span: 1,
    }, {
      key: `${prefix}_qrc_chart`, title: "Query / Request / Complaint", tab, kind: "donut", xKey: "label",
      series: [{ key: "count", label: "Tickets", color: "#f59e0b" }], data: grouped((r) => r.qrc).map((d) => ({ label: d.label, count: d.count })),
      drill: { kind: "dispo_qrc", keyField: "label" }, span: 1,
    }],
    tables: [
      mk("reason", "Ticket reason", "Reason", byReason, "dispo_reason", { subtitle: "Click a row to see its tickets, sub-reasons and trend." }),
      { key: `${prefix}_subreason`, title: "Reason › sub-reason", tab, columns: [{ ...cols[0], label: "Reason › sub-reason" }, ...cols.slice(1)], rows: subRows, drillKind: "dispo_sub", keyField: "_key", searchable: true },
      mk("qrc", "Query / Request / Complaint", "QRC", grouped((r) => r.qrc), "dispo_qrc"),
      mk("action", "Action taken", "Action", grouped((r) => r.action), "dispo_action"),
      mk("orderstatus", "Order status at ticket time", "Order status", grouped((r) => r.orderStatus), "dispo_orderstatus"),
      mk("courier", "Courier partner", "Courier", grouped((r) => r.courier), "dispo_courier"),
      {
        key: `${prefix}_agent`, title: "Agent-wise tickets", tab, columns: [{ ...cols[0], label: "Agent" }, ...cols.slice(1)],
        rows: agentRows.map((a) => ({ ...a, _key: a.label, label: nameFromLogin(a.label) })), drillKind: "dispo_agent", keyField: "_key", searchable: true,
        subtitle: "Agent login names are shown without the e-mail domain.",
      },
    ],
  };
}

/** Quality-audit KPIs / tables for one LOB (chat and e-mail carry six scored parameters; voice audits do not). */
export function qualitySection(rows: QualRow[], tab: string, prefix: string): { kpis: Kpi[]; charts: ChartSpec[]; tables: TableSpec[]; notes: string[] } {
  const n = rows.length;
  const avgScore = n ? round2(sum(rows.map((r) => r.score)) / n) : 0;
  const fatal = rows.filter((r) => r.fatal).length;
  const below90 = rows.filter((r) => r.score < 90).length;
  const kpis: Kpi[] = [
    { key: "qa_n", label: "Audits", value: n, fmt: "int", tone: "indigo", icon: "ClipboardCheck", tab },
    { key: "qa_avg", label: "Avg quality score", value: avgScore, fmt: "pct", tone: "emerald", icon: "ShieldCheck", sub: n ? `${round2(sum(rows.map((r) => r.score)) / n)}% mean of ${n} audits` : "no audits in range", tab },
    { key: "qa_fatal", label: "Fatal audits", value: fatal, fmt: "int", tone: "red", icon: "OctagonAlert", sub: "fatal flag = 0 (score zeroed)", tab },
    { key: "qa_low", label: "Audits below 90%", value: pct(below90, n), fmt: "pct", tone: "amber", icon: "TrendingDown", sub: `${below90} of ${n}`, tab },
  ];
  const paramRows = QUALITY_PARAMS.map((p, i) => {
    const vals = rows.map((r) => r.params[i]).filter((v): v is number => v !== null);
    const max = vals.length ? Math.max(...vals) : 0;
    const pass = vals.filter((v) => v === max && max > 0).length;
    return { label: p.label, _key: p.key, scored: vals.length, max, pass, fail: vals.filter((v) => v === 0).length, passPct: pct(pass, vals.length), lost: sum(vals.map((v) => max - v)) };
  }).filter((r) => r.scored > 0);
  const grouped = (keyFn: (r: QualRow) => string) => {
    const m = new Map<string, QualRow[]>();
    for (const r of rows) { const k = keyFn(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return [...m.entries()].map(([label, rs]) => ({
      label, _key: label, audits: rs.length, avg: round2(sum(rs.map((r) => r.score)) / rs.length),
      fatal: rs.filter((r) => r.fatal).length, share: pct(rs.length, n),
    })).sort((a, b) => b.audits - a.audits);
  };
  const cols: Column[] = [{ key: "label", label: "", align: "left" }, { key: "audits", label: "Audits", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }, { key: "avg", label: "Avg score", fmt: "pct" }, { key: "fatal", label: "Fatal", fmt: "int" }];
  const mk = (key: string, title: string, first: string, data: ReturnType<typeof grouped>, drillKind: string, extra?: Partial<TableSpec>): TableSpec => ({
    key: `${prefix}_${key}`, title, tab, columns: [{ ...cols[0], label: first }, ...cols.slice(1)], rows: data, drillKind, keyField: "_key", searchable: data.length > 8, ...extra,
  });
  const tables: TableSpec[] = [];
  if (paramRows.length) {
    tables.push({
      key: `${prefix}_params`, title: "Parameter compliance", tab, subtitle: "Share of audits that scored the full marks for each parameter.",
      columns: [{ key: "label", label: "Parameter", align: "left" }, { key: "scored", label: "Scored", fmt: "int" }, { key: "max", label: "Max marks", fmt: "int" }, { key: "pass", label: "Full marks", fmt: "int" }, { key: "fail", label: "Zero marks", fmt: "int" }, { key: "passPct", label: "Compliance", fmt: "pct" }, { key: "lost", label: "Marks lost", fmt: "int" }],
      rows: paramRows, drillKind: "quality_param", keyField: "_key",
    });
  }
  tables.push(
    mk("acpt", "Root cause (ACPT)", "Owner", grouped((r) => r.acpt), "quality_acpt", { subtitle: "Agent / Customer / Process / Technical -- who the audited contact's issue is attributed to." }),
    mk("query", "Audited contact type (customer query)", "Query", grouped((r) => r.cxQuery), "quality_query"),
    mk("aoi", "Areas of improvement", "Area of improvement", grouped((r) => (r.aoi && !/^no error found\.?$/i.test(r.aoi) ? r.aoi : "No error found")).slice(0, 30), "quality_aoi", { footnote: "Free-text auditor remarks, grouped exactly as typed." }),
    mk("agent", "Agent-wise quality", "Agent", grouped((r) => r.empId || r.empName).map((g) => ({ ...g, label: rows.find((r) => (r.empId || r.empName) === g.label)?.empName || g.label })), "quality_agent", { searchable: true }),
  );
  const charts: ChartSpec[] = [];
  if (paramRows.length) {
    charts.push({
      key: `${prefix}_params_chart`, title: "Parameter compliance %", tab, kind: "hbar", xKey: "label", xFmt: "text",
      series: [{ key: "passPct", label: "Compliance %", color: "#10b981", fmt: "pct" }], data: paramRows.map((p) => ({ label: p.label, passPct: p.passPct })), drill: { kind: "quality_param", keyField: "_key" },
    });
  }
  charts.push({
    key: `${prefix}_acpt_chart`, title: "Root cause (ACPT)", tab, kind: "donut", xKey: "label",
    series: [{ key: "audits", label: "Audits", color: "#6366f1" }], data: grouped((r) => r.acpt).map((g) => ({ label: g.label, audits: g.audits })), drill: { kind: "quality_acpt", keyField: "label" },
  });
  const notes: string[] = [];
  if (n > 0) notes.push("Quality is filtered on the AUDIT date (when QA scored it), not the date of the audited contact, the same basis as the existing Overview/Channels quality score.");
  return { kpis, charts, tables, notes };
}
