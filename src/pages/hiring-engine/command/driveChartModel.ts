/**
 * Chart adapters of the Drive Command Center. Each adapter turns a DriveAnalytics into the series a chart draws AND the text table
 * shown as its text alternative, from the same computed values, so the two cannot disagree (parity test). Pure: no window access
 * (reduced motion comes in as an option), dates are labelled by UTC arithmetic on the IST calendar day, and empty or zero input gives
 * `empty: true` and en dashes, never NaN / Infinity. Counts in tables are plain integers, rates go through pctText.
 */
import { STAGES } from "./driveCommandTypes";
import type { DriveAnalytics, Grid, ScatterPoint, SourceType, Stage } from "./driveCommandTypes";
import { SOURCE_TYPES, STAGE_LABEL, TYPE_LABEL, pctText } from "./driveCommandModel";
import { REASON_CHIPS } from "../outcomeReasonsModel";
import { chartMotion } from "./chartTheme";
import type { ChartMotion } from "./chartTheme";

export interface TextTable { caption: string; columns: string[]; rows: string[][] }
export interface ChartOpts { prefersReducedMotion?: boolean }
export interface SeriesInfo { key: string; label: string; type: SourceType | null }
interface ChartBase { empty: boolean; series: SeriesInfo[]; motion: ChartMotion; table: TextTable }

const DASH = "–";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A non-negative whole count; anything non-finite is 0. */
function cnt(n: unknown): number { return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0; }
function rateOrNull(n: unknown): number | null { return typeof n === "number" && Number.isFinite(n) ? n : null; }
function round(n: number, places: number): number { const f = 10 ** places; const v = Math.round(n * f) / f; return Number.isFinite(v) ? v + 0 : 0; }
const txt = (n: number): string => String(n);

function base(opts: ChartOpts | undefined, series: SeriesInfo[], empty: boolean, table: TextTable): ChartBase {
  return { empty, series, motion: chartMotion(opts?.prefersReducedMotion === true), table };
}
const typeSeries = (types: readonly SourceType[]): SeriesInfo[] => types.map((t) => ({ key: t, label: TYPE_LABEL[t], type: t }));

/** "Wed 14 Oct" for an ISO day; the browser zone is never consulted. An invalid day is returned as given. */
export function dayLabel(iso: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (typeof iso !== "string" || !Number.isFinite(ms)) return String(iso ?? "");
  const d = new Date(ms);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
function isSunday(iso: string): boolean { const ms = Date.parse(`${iso}T00:00:00Z`); return Number.isFinite(ms) && new Date(ms).getUTCDay() === 0; }

function stageValue(a: DriveAnalytics, t: SourceType, s: Stage): number { return cnt(a?.types?.[t]?.stages?.[s]); }

/** Conversion into stage index i (1..6) for a type: null when the previous stage is 0 or smaller than this one. */
function pairRate(a: DriveAnalytics, t: SourceType, i: number): number | null {
  const prev = stageValue(a, t, STAGES[i - 1]);
  const cur = stageValue(a, t, STAGES[i]);
  if (prev <= 0 || cur > prev) return null;
  const given = a?.types?.[t]?.conversions?.find((c) => c.to === STAGES[i]);
  return rateOrNull(given?.rate) ?? cur / prev;
}

// ---- funnel ----------------------------------------------------------------------------------------------------------------------------
export function funnelChart(a: DriveAnalytics, opts?: ChartOpts) {
  const stages = STAGES.map((stage, i) => {
    const values = {} as Record<SourceType, number>;
    const conversion = {} as Record<SourceType, number | null>;
    for (const t of SOURCE_TYPES) { values[t] = stageValue(a, t, stage); conversion[t] = i === 0 ? null : pairRate(a, t, i); }
    return { stage, label: STAGE_LABEL[stage], values, conversion };
  });
  const biggestDrop = {} as Record<SourceType, Stage | null>;
  for (const t of SOURCE_TYPES) {
    let worst: Stage | null = null; let low = Infinity;
    for (const s of stages) { const c = s.conversion[t]; if (c !== null && c < low) { low = c; worst = s.stage; } }
    biggestDrop[t] = worst;
  }
  const columns = ["Stage"];
  for (const t of SOURCE_TYPES) columns.push(`${TYPE_LABEL[t]} count`, `${TYPE_LABEL[t]} conversion`);
  const rows = stages.map((s) => [s.label, ...SOURCE_TYPES.flatMap((t) => [txt(s.values[t]), pctText(s.conversion[t])])]);
  const empty = stages.every((s) => SOURCE_TYPES.every((t) => s.values[t] === 0));
  return { stages, biggestDrop, ...base(opts, typeSeries(SOURCE_TYPES), empty, { caption: "Funnel by drive type: people at each stage and the conversion from the stage before", columns, rows }) };
}

// ---- yield (daily arrivals vs target) --------------------------------------------------------------------------------------------------
export interface YieldPoint { date: string; label: string; meta_live: number; meta_old: number; he: number; target: number }
export function yieldChart(a: DriveAnalytics, opts?: ChartOpts) {
  const points: YieldPoint[] = (a?.daily ?? []).filter((d) => !isSunday(d.date)).map((d) => ({
    date: d.date, label: dayLabel(d.date),
    meta_live: cnt(d.byType?.meta_live?.arrived), meta_old: cnt(d.byType?.meta_old?.arrived), he: cnt(d.byType?.he?.arrived), target: cnt(d.target),
  }));
  const rows = points.map((p) => [p.label, txt(p.meta_live), txt(p.meta_old), txt(p.he), txt(p.target)]);
  const series = [...typeSeries(SOURCE_TYPES), { key: "target", label: "Target", type: null }];
  const empty = points.every((p) => p.meta_live + p.meta_old + p.he === 0);
  const columns = ["Date", ...SOURCE_TYPES.map((t) => `${TYPE_LABEL[t]} arrived`), "Target"];
  return { points, ...base(opts, series, empty, { caption: "People who arrived each drive day, by drive type, against the daily target (Sundays left out)", columns, rows }) };
}

// ---- conversion heatmap ----------------------------------------------------------------------------------------------------------------
export type HeatDirection = "above" | "below" | "even";
export interface HeatCell { rate: number | null; average: number | null; delta: number | null; text: string; direction: HeatDirection | null }
const EVEN_BAND = 0.01;
export function conversionHeatmap(a: DriveAnalytics, opts?: ChartOpts) {
  const columns = STAGES.slice(1).map((s, i) => `${STAGE_LABEL[STAGES[i]]} to ${STAGE_LABEL[s]}`);
  const average = STAGES.slice(1).map((_, k) => {
    let from = 0; let to = 0;
    for (const t of SOURCE_TYPES) { from += stageValue(a, t, STAGES[k]); to += stageValue(a, t, STAGES[k + 1]); }
    return from > 0 && to <= from ? to / from : null;
  });
  const rows = SOURCE_TYPES.map((sourceType) => ({
    sourceType,
    cells: columns.map((_, k): HeatCell => {
      const rate = pairRate(a, sourceType, k + 1);
      const avg = average[k];
      const delta = rate !== null && avg !== null ? round(rate - avg, 4) : null;
      const direction: HeatDirection | null = delta === null ? null : delta > EVEN_BAND ? "above" : delta < -EVEN_BAND ? "below" : "even";
      return { rate, average: avg, delta, text: pctText(rate), direction };
    }),
  }));
  const tableRows = rows.map((r) => [TYPE_LABEL[r.sourceType], ...r.cells.map((c) => (c.direction ? `${c.text} (${c.direction === "even" ? "near average" : `${c.direction} average`})` : c.text))]);
  const empty = rows.every((r) => r.cells.every((c) => c.rate === null));
  return { columns, rows, ...base(opts, typeSeries(SOURCE_TYPES), empty, { caption: "Stage-to-stage conversion by drive type, compared with all types combined", columns: ["Drive type", ...columns], rows: tableRows }) };
}

// ---- timing heatmap --------------------------------------------------------------------------------------------------------------------
export function timingHeatmap(a: DriveAnalytics, kind: "replies" | "arrivals", t: SourceType, opts?: ChartOpts) {
  const grid: Grid = a?.timing?.[kind]?.[t] ?? [];
  const rows = WEEKDAYS.map((weekday, d) => ({ weekday: weekday as string, cells: Array.from({ length: 24 }, (_, h) => cnt(grid[d]?.[h])) }));
  let max = 0; let peak: { weekday: string; hour: number; n: number } | null = null;
  for (const r of rows) r.cells.forEach((n, hour) => { if (n > max) { max = n; peak = { weekday: r.weekday, hour, n }; } });
  const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
  const what = kind === "replies" ? "replies received" : "arrivals";
  return {
    max, rows, peak,
    ...base(opts, typeSeries([t]), max === 0, { caption: `${TYPE_LABEL[t]}: ${what} by weekday and hour (IST)`, columns: ["Weekday", ...hours], rows: rows.map((r) => [r.weekday, ...r.cells.map(txt)]) }),
  };
}

// ---- scatter ---------------------------------------------------------------------------------------------------------------------------
export type ScatterDot = ScatterPoint & { x: number; y: number; z: number; labelled: boolean };
export function scatterChart(a: DriveAnalytics, opts?: ChartOpts) {
  const sorted = [...(a?.scatter ?? [])].sort((p, q) => cnt(q.leads) - cnt(p.leads) || String(p.code).localeCompare(String(q.code)));
  const points: ScatterDot[] = sorted.map((p, i) => ({
    ...p, leads: cnt(p.leads), x: round(Math.max(0, rateOrNull(p.showRate) ?? 0) * 100, 2), y: round(Math.max(0, rateOrNull(p.leadToJoinRate) ?? 0) * 100, 2),
    z: cnt(p.leads), labelled: i < 5,
  }));
  const rows = points.map((p) => [p.code, p.branch, TYPE_LABEL[p.sourceType], txt(p.leads), pctText(p.x / 100), pctText(p.y / 100)]);
  const types = SOURCE_TYPES.filter((t) => points.some((p) => p.sourceType === t));
  return { points, ...base(opts, typeSeries(types.length ? types : SOURCE_TYPES), points.length === 0, { caption: "Requisitions: leads against show rate and lead-to-join rate", columns: ["Requisition", "Branch", "Drive type", "Leads", "Show rate", "Lead to join"], rows }) };
}

// ---- waterfall -------------------------------------------------------------------------------------------------------------------------
function reasonText(r: string): string { return r.split("_").join(" "); }
/** "declined 4 (distance 2, salary 1, not stated 1)"; an entry without a detail prints as before. */
function lossText(r: { reason: string; n: number; detail?: Array<{ code: string; n: number }> }): string {
  const head = `${reasonText(r.reason)} ${cnt(r.n)}`;
  const parts = (r.detail ?? []).filter((d) => cnt(d.n) > 0)
    .map((d) => `${d.code === "not_stated" ? "not stated" : (REASON_CHIPS.find((c) => c.code === d.code)?.label ?? reasonText(d.code)).toLowerCase()} ${cnt(d.n)}`);
  return parts.length ? `${head} (${parts.join(", ")})` : head;
}
export function waterfallChart(a: DriveAnalytics, t: SourceType, opts?: ChartOpts) {
  const bars = (a?.waterfall?.[t] ?? []).map((w) => {
    const from = stageValue(a, t, w.from);
    const lost = Math.min(from, cnt(w.lost));
    const reasons = (w.reasons ?? []).filter((r) => cnt(r.n) > 0).map(lossText).join(", ");
    return { label: `${STAGE_LABEL[w.from]} to ${STAGE_LABEL[w.to]}`, base: from - lost, lost, reasons };
  });
  const rows = bars.map((b) => [b.label, txt(b.base + b.lost), txt(b.base), txt(b.lost), b.reasons || DASH]);
  const empty = bars.length === 0 || bars.every((b) => b.base + b.lost === 0);
  return { bars, ...base(opts, typeSeries([t]), empty, { caption: `${TYPE_LABEL[t]}: where people were lost between stages`, columns: ["Step", "Started", "Continued", "Lost", "Reasons"], rows }) };
}

// ---- sparkline -------------------------------------------------------------------------------------------------------------------------
export function sparklinePath(values: number[], w: number, h: number): string {
  if (!Array.isArray(values) || values.length === 0) return "";
  const vs = values.map(cnt);
  const max = Math.max(...vs);
  const width = Number.isFinite(w) && w > 0 ? w : 0;
  const height = Number.isFinite(h) && h > 1 ? h : 2;
  const y = (v: number): number => round(height - 1 - (max > 0 ? (v / max) * (height - 2) : 0), 2);
  if (vs.length === 1) return `M0,${y(vs[0])} L${width},${y(vs[0])}`;
  return vs.map((v, i) => `${i === 0 ? "M" : "L"}${round((i * width) / (vs.length - 1), 2)},${y(v)}`).join(" ");
}
