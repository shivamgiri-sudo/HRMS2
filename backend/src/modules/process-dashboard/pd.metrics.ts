/**
 * Process Dashboard -- the ONE pure module that turns normalized APR rows into metrics (no DB, no I/O).
 *
 * Rules that hold everywhere:
 *  - A derived metric is null unless EVERY canonical field in its formula is mapped and has data (never a guessed 0).
 *  - A zero / missing denominator gives null, never 0 and never NaN.
 *  - Times are converted to seconds on the way in according to the config's time_unit.
 *  - Rates are percentages (0-100); aht is seconds; calls_per_login_hr is a plain ratio.
 *      utilization = (talk+wait+dispo)/login        occupancy = (talk+dispo)/(talk+wait+dispo)
 *      aht = (talk+dispo)/calls                     calls_per_login_hr = calls/(login/3600)
 *      connect_rate = connected/calls               conversion = sales/connected (sales/calls when connected is not mapped)
 *      ptp_rate = ptp/connected                     answer_rate = handled/offered      abandon_rate = abandoned/offered
 *      qa_score = mean qa_audit.quality_percentage of the audits in the bucket
 */
import { CANONICAL_FIELDS, METRICS, METRIC_BY_KEY, NUMERIC_FIELDS, TIME_FIELDS, type TimeUnit } from "./pd.fields.js";

export type NumKey = "calls" | "login_sec" | "talk_sec" | "wait_sec" | "dispo_sec" | "break_sec" | "connected" | "ptp" | "sales_count" | "amount" | "handled" | "offered" | "abandoned";
const NUM_KEYS = NUMERIC_FIELDS as NumKey[];

export interface NormRow {
  date: string; agent_code: string;
  agent_name: string | null; tl_name: string | null; lob: string | null; hour: number | null;
  calls: number | null; login_sec: number | null; talk_sec: number | null; wait_sec: number | null; dispo_sec: number | null; break_sec: number | null;
  connected: number | null; ptp: number | null; sales_count: number | null; amount: number | null;
  handled: number | null; offered: number | null; abandoned: number | null;
}
export interface QaBucket { agentCode: string; date: string; n: number; sum: number; fatal: number }
export type Metrics = Record<string, number | null>;

/* ---------- value parsing ---------- */

/** "HH:MM:SS(.f)", "H:MM" (hours:minutes) or "-HH:MM:SS" to seconds; null when it is not of that shape. */
export function parseHms(raw: string): number | null {
  const m = /^\s*(-)?(\d{1,4}):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?\s*$/.exec(raw);
  if (!m) return null;
  const sec = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0);
  return m[1] ? -sec : sec;
}

/** Convert one source duration to seconds. Strings shaped like a clock are accepted under any unit (TIME columns arrive that way). */
export function toSeconds(raw: unknown, unit: TimeUnit): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "string" && raw.includes(":")) return parseHms(raw);
  const n = toNumber(raw);
  if (n === null) return null;
  if (unit === "day_fraction") return n * 86400;
  if (unit === "hhmmss") return null; // a bare number is not a clock reading; counted as a problem rather than guessed
  return n;
}

export function toNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  const s = String(raw).trim().replace(/,/g, "").replace(/%$/, "");
  if (s === "" || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/** Hour of day from 0-23, "HH:MM:SS" or "YYYY-MM-DD HH:MM:SS". */
export function toHour(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : null;
  const s = String(raw).trim();
  if (/^\d{1,2}$/.test(s)) { const n = Number(s); return n >= 0 && n <= 23 ? n : null; }
  const m = /(?:^|[ T])(\d{1,2}):\d{2}/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 23 ? n : null;
}

export interface NormStats { rows: number; badValues: Record<string, number>; badSamples: Record<string, string[]> }
export const newStats = (): NormStats => ({ rows: 0, badValues: {}, badSamples: {} });

/** Raw row keyed by canonical field -> NormRow. Returns null when the row has no usable agent_code / date. Counts unparseable values in stats. */
export function normalizeRow(raw: Record<string, unknown>, timeUnit: TimeUnit, stats?: NormStats): NormRow | null {
  const agent = text(raw.agent_code)?.toUpperCase() ?? null;
  const date = text(raw.date);
  if (stats) stats.rows += 1;
  if (!agent || !date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const bad = (k: string, v: unknown) => {
    if (!stats) return;
    stats.badValues[k] = (stats.badValues[k] ?? 0) + 1;
    const arr = (stats.badSamples[k] ??= []);
    if (arr.length < 3) arr.push(String(v).slice(0, 40));
  };
  const out: NormRow = {
    date: date.slice(0, 10), agent_code: agent, agent_name: text(raw.agent_name), tl_name: text(raw.tl_name), lob: text(raw.lob), hour: toHour(raw.hour),
    calls: null, login_sec: null, talk_sec: null, wait_sec: null, dispo_sec: null, break_sec: null,
    connected: null, ptp: null, sales_count: null, amount: null, handled: null, offered: null, abandoned: null,
  };
  for (const k of NUM_KEYS) {
    const v = raw[k];
    if (v === null || v === undefined || v === "") continue;
    const n = TIME_FIELDS.includes(k) ? toSeconds(v, timeUnit) : toNumber(v);
    if (n === null) bad(k, v); else out[k] = n;
  }
  if (raw.hour !== null && raw.hour !== undefined && raw.hour !== "" && out.hour === null) bad("hour", raw.hour);
  return out;
}

/* ---------- accumulation ---------- */

export interface Acc {
  rows: number; agents: Set<string>; days: Set<string>;
  sum: Record<NumKey, number | null>;
  qa: { n: number; sum: number; fatal: number };
}
export function emptyAcc(): Acc {
  const sum = {} as Record<NumKey, number | null>;
  for (const k of NUM_KEYS) sum[k] = null;
  return { rows: 0, agents: new Set(), days: new Set(), sum, qa: { n: 0, sum: 0, fatal: 0 } };
}
export function addRow(a: Acc, r: NormRow): Acc {
  a.rows += 1; a.agents.add(r.agent_code); a.days.add(r.date);
  for (const k of NUM_KEYS) { const v = r[k]; if (v !== null) a.sum[k] = (a.sum[k] ?? 0) + v; }
  return a;
}
export function addQa(a: Acc, q: QaBucket): Acc { a.qa.n += q.n; a.qa.sum += q.sum; a.qa.fatal += q.fatal; return a; }

const ratio = (n: number | null, d: number | null): number | null => (n === null || d === null || !(d > 0) ? null : n / d);
const plus = (...v: Array<number | null>): number | null => (v.some((x) => x === null) ? null : (v as number[]).reduce((p, c) => p + c, 0));
const r = (n: number | null, dp: number): number | null => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp);
const pctOf = (n: number | null, d: number | null): number | null => { const x = ratio(n, d); return x === null ? null : x * 100; };

/** Every metric for one bucket. Keys: all METRICS plus `agents`, `audits`, `fatal`. */
export function computeMetrics(a: Acc): Metrics {
  const s = a.sum;
  const busy = plus(s.talk_sec, s.wait_sec, s.dispo_sec);
  const sold = s.sales_count;
  const convDen = s.connected !== null ? s.connected : s.calls;
  return {
    agents: a.agents.size,
    calls: r(s.calls, 2), login_hours: r(s.login_sec === null ? null : s.login_sec / 3600, 2),
    handled: r(s.handled, 2), offered: r(s.offered, 2), abandoned: r(s.abandoned, 2), connected: r(s.connected, 2),
    ptp: r(s.ptp, 2), sales_count: r(s.sales_count, 2), amount: r(s.amount, 2),
    utilization: r(pctOf(busy, s.login_sec), 2),
    occupancy: r(pctOf(plus(s.talk_sec, s.dispo_sec), busy), 2),
    aht: r(ratio(plus(s.talk_sec, s.dispo_sec), s.calls), 1),
    calls_per_login_hr: r(ratio(s.calls, s.login_sec === null ? null : s.login_sec / 3600), 2),
    connect_rate: r(pctOf(s.connected, s.calls), 2),
    conversion: r(pctOf(sold, convDen), 2),
    ptp_rate: r(pctOf(s.ptp, s.connected), 2),
    answer_rate: r(pctOf(s.handled, s.offered), 2),
    abandon_rate: r(pctOf(s.abandoned, s.offered), 2),
    qa_score: a.qa.n > 0 ? r(a.qa.sum / a.qa.n, 2) : null,
    audits: a.qa.n, fatal: a.qa.fatal,
  };
}

/** Is a metric computable with this set of mapped canonical fields? (qa_score is always available: it comes from qa_audit.) */
export function metricAvailable(key: string, mapped: ReadonlySet<string>): boolean {
  const def = METRIC_BY_KEY.get(key);
  if (!def) return false;
  if (!def.requires.every((f) => mapped.has(f))) return false;
  if (key === "conversion") return mapped.has("connected") || mapped.has("calls");
  return true;
}
export const availableMetrics = (mapped: ReadonlySet<string>): Record<string, boolean> =>
  Object.fromEntries(METRICS.map((m) => [m.key, metricAvailable(m.key, mapped)]));

/* ---------- grouping ---------- */

export function groupRows(rows: NormRow[], qa: QaBucket[], keyOf: (r: NormRow) => string, qaKeyOf?: (q: QaBucket) => string | null): Map<string, Acc> {
  const m = new Map<string, Acc>();
  for (const row of rows) {
    const k = keyOf(row);
    let a = m.get(k); if (!a) { a = emptyAcc(); m.set(k, a); }
    addRow(a, row);
  }
  if (qaKeyOf) for (const q of qa) { const k = qaKeyOf(q); if (k === null) continue; const a = m.get(k); if (a) addQa(a, q); }
  return m;
}

/** Total over all rows, plus every qa bucket (caller pre-slices by date) of an agent that appears in rows. */
export function totalAcc(rows: NormRow[], qa: QaBucket[]): Acc {
  const a = emptyAcc();
  for (const row of rows) addRow(a, row);
  for (const q of qa) if (a.agents.has(q.agentCode)) addQa(a, q);
  return a;
}

export const pctDelta = (cur: number | null, prev: number | null): number | null =>
  cur === null || prev === null || prev === 0 ? null : r(((cur - prev) / Math.abs(prev)) * 100, 2);

export type KpiStatus = "good" | "warn" | "bad" | "nodata";
/**
 * Status of a tile. With a target: good when it meets it, warn within 10% of it, else bad. Without a target the only honest signal is the
 * change against the previous period (good when flat/favourable, warn <=10% worse, bad beyond); with neither, or no value, it is 'nodata'.
 */
export function kpiStatus(value: number | null, target: number | null, prev: number | null, direction: "higher" | "lower"): { status: KpiStatus; basis: "target" | "trend" | "none" } {
  if (value === null) return { status: "nodata", basis: "none" };
  if (target !== null && Number.isFinite(target)) {
    const meets = direction === "higher" ? value >= target : value <= target;
    if (meets) return { status: "good", basis: "target" };
    const gap = target === 0 ? Infinity : Math.abs(value - target) / Math.abs(target);
    return { status: gap <= 0.1 ? "warn" : "bad", basis: "target" };
  }
  const d = pctDelta(value, prev);
  if (d === null) return { status: "nodata", basis: "none" };
  const worse = direction === "higher" ? -d : d;
  if (worse <= 2) return { status: "good", basis: "trend" };
  return { status: worse <= 10 ? "warn" : "bad", basis: "trend" };
}

/** Rank position (1 = best) of each key by metric, direction-aware; null values are unranked. Ties share a position. */
export function rankBy(items: Array<{ key: string; value: number | null }>, direction: "higher" | "lower"): Map<string, number> {
  const ranked = items.filter((i) => i.value !== null).sort((x, y) => (direction === "higher" ? (y.value as number) - (x.value as number) : (x.value as number) - (y.value as number)));
  const out = new Map<string, number>();
  let pos = 0; let prev: number | null = null;
  ranked.forEach((it, i) => { if (it.value !== prev) { pos = i + 1; prev = it.value; } out.set(it.key, pos); });
  return out;
}

export const CANONICAL_KEYS = CANONICAL_FIELDS.map((f) => f.key);
