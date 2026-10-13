/**
 * Pure view-models of the Summary charts. Each wraps a Task 9 adapter (or a Task 8 model function) and applies the one rule the
 * adapters do not know: while follow-up mode is off (`qualifiedTracked` false) the qualified stage is not measured, so it shows an
 * en dash and a note instead of zeros that look like data. The chart AND its text table are built here from the same values (parity).
 * Also: the role="img" summaries, the KPI table, the CSV file name / rows and the ink colour for heat cells. No DOM, no regex literals.
 */
import { STAGES } from "../driveCommandTypes";
import type { DriveAnalytics, SourceType, Stage } from "../driveCommandTypes";
import { COMPARE_COLUMNS, SOURCE_TYPES, STAGE_LABEL, TYPE_LABEL, compareRows, countText, kpiTiles, pctText } from "../driveCommandModel";
import type { CompareRow, KpiTile } from "../driveCommandModel";
import { compareColumnsFor, moneyText } from "./costView";
import { conversionHeatmap, funnelChart, scatterChart, timingHeatmap, waterfallChart, yieldChart } from "../driveChartModel";
import type { ChartOpts, HeatCell, TextTable } from "../driveChartModel";

export const DASH = "–";
export const UNTRACKED_NOTE = "Qualified is tracked once the follow-up pipeline is on";
/** The backend drive credit rule (he-drive-credit.ts), shown wherever selected or joined appear. */
export const CREDIT_NOTE = "Selected and joined count only people who arrived at the drive and were selected on or after the drive date.";
export const EMPTY_TEXT = "No drive activity in this range";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-02" as "02 Oct 2026"; "" when not a day. */
export function boundaryDayText(d: string | null | undefined): string {
  const p = String(d ?? "").split("-");
  const [y, m, day] = p.map(Number);
  return p.length === 3 && p[0].length === 4 && p[2].length === 2 && [y, m, day].every(Number.isFinite) && m >= 1 && m <= 12 && day >= 1 && day <= 31 ? `${p[2]} ${MONTHS[m - 1]} ${p[0]}` : "";
}
const daysText = (n: number): string => `${n} day${n === 1 ? "" : "s"}`;
/**
 * Which form fills count as Live Meta, with the computed boundary day (the server's liveFrom). Rolling: "the last N days"; a fixed date (or an
 * older server that sends no liveDays) shows the date only. `type` picks the Live or Old wording; none is the Summary's line; "" for he.
 */
export function liveWindowNote(a: Pick<DriveAnalytics, "liveFrom" | "liveDays" | "liveMode"> | null | undefined, type?: SourceType): string {
  const d = boundaryDayText(a?.liveFrom);
  if (!d || type === "he") return "";
  const n = typeof a?.liveDays === "number" && Number.isFinite(a.liveDays) ? a.liveDays : null;
  if (a?.liveMode === "fixed" || n === null) {
    if (type === "meta_old") return `Old Meta data = first form fill before ${d} (IST).`;
    return `Live Meta = form filled on or after ${d} (IST)${a?.liveMode === "fixed" ? ", a fixed date" : ""}.${type ? "" : ` Old Meta data = first form fill before it.`}`;
  }
  if (type === "meta_live") return `Live Meta = form filled in the last ${daysText(n)}, on or after ${d} (IST).`;
  if (type === "meta_old") return `Old Meta data = first form fill older than ${daysText(n)}, before ${d} (IST). People move here when their first fill leaves the window; their follow-up continues.`;
  return `Live Meta = form filled in the last ${daysText(n)}, on or after ${d} (IST); Old Meta data = first form fill older than that. The boundary moves every day at midnight IST.`;
}

const isTracked = (a: DriveAnalytics): boolean => a?.qualifiedTracked !== false;
const fin = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const touchesQualified = (from: Stage, to: Stage): boolean => from === "qualified" || to === "qualified";
const list = (parts: string[]): string => parts.join(", ");
/** Types in the fixed order that have any data in this window. */
export function presentTypes(a: DriveAnalytics): SourceType[] {
  const p = Array.isArray(a?.typesPresent) ? a.typesPresent : [];
  return SOURCE_TYPES.filter((t) => p.includes(t));
}
export function defaultType(a: DriveAnalytics): SourceType { return presentTypes(a)[0] ?? "meta_live"; }
export function shortLabel(s: string, max = 16): string { const v = String(s ?? ""); return v.length > max ? `${v.slice(0, max - 1)}…` : v; }

// ---- KPI strip ---------------------------------------------------------------------------------------------------------------------------
export interface KpiView { tiles: Array<KpiTile & { present: boolean; sparkLabel: string }>; untracked: boolean; empty: boolean; table: TextTable }
/** `only` limits the view to one drive type (the Live Meta / Old Meta data sections). */
export function kpiView(a: DriveAnalytics, only?: SourceType): KpiView {
  const untracked = !isTracked(a);
  const present = presentTypes(a);
  const tiles = kpiTiles(a).filter((t) => !only || t.sourceType === only).map((t) => ({
    ...t,
    values: t.values.map((v) => (untracked && v.stage === "qualified" ? { ...v, text: DASH } : v)),
    present: present.includes(t.sourceType),
    sparkLabel: `Daily arrivals: ${t.sparkline.length ? t.sparkline.map((n) => String(Math.round(fin(n)))).join(", ") : "none"}`,
  }));
  const empty = tiles.every((t) => t.values.every((v) => v.value === 0));
  const table: TextTable = {
    caption: "Drive types at a glance: people at each stage and the change in arrivals against the previous period",
    columns: ["Drive type", ...STAGES.map((s) => STAGE_LABEL[s]), "Arrivals change"],
    rows: tiles.map((t) => [t.label, ...t.values.map((v) => v.text), t.arrivalsChange.text]),
  };
  return { tiles, untracked, empty, table };
}

// ---- funnel ------------------------------------------------------------------------------------------------------------------------------
/** Axis width and margins of the funnel. Below `sm` (a 375px phone leaves ~309px in the card) the plot keeps at least 160px. */
export function funnelLayout(narrow: boolean): { yAxisWidth: number; margin: { top: number; right: number; bottom: number; left: number } } {
  return narrow ? { yAxisWidth: 84, margin: { top: 4, right: 56, bottom: 4, left: 4 } } : { yAxisWidth: 112, margin: { top: 4, right: 104, bottom: 4, left: 4 } };
}
export interface FunnelRow {
  stage: Stage; label: string; convText: string;
  values: Record<SourceType, number | null>; text: Record<SourceType, string>; conversion: Record<SourceType, number | null>;
}
/** Untracked mode: the qualified count and both conversions that touch it (into qualified, into invited) are not measured. */
const maskedConversion = (untracked: boolean, s: Stage): boolean => untracked && (s === "qualified" || s === "invited");
export function funnelView(a: DriveAnalytics, opts?: ChartOpts) {
  const f = funnelChart(a, opts);
  const untracked = !isTracked(a);
  const rows: FunnelRow[] = f.stages.map((s) => {
    const masked = untracked && s.stage === "qualified";
    const values = {} as Record<SourceType, number | null>;
    const text = {} as Record<SourceType, string>;
    const conversion = {} as Record<SourceType, number | null>;
    for (const t of SOURCE_TYPES) {
      values[t] = masked ? null : s.values[t]; text[t] = masked ? DASH : String(s.values[t]);
      conversion[t] = maskedConversion(untracked, s.stage) ? null : s.conversion[t];
    }
    return { stage: s.stage, label: s.label, values, text, conversion, convText: SOURCE_TYPES.map((t) => pctText(conversion[t])).join(" / ") };
  });
  const biggestDrop = {} as Record<SourceType, Stage | null>;
  for (const t of SOURCE_TYPES) {
    let worst: Stage | null = null; let low = Infinity;
    for (const r of rows) { const c = r.conversion[t]; if (c !== null && c < low) { low = c; worst = r.stage; } }
    biggestDrop[t] = worst;
  }
  // The largest bar of each stage carries the type name as its direct label.
  const labels = rows.map((r) => {
    let best: SourceType | null = null;
    for (const t of SOURCE_TYPES) { const v = r.values[t]; if (v !== null && v > 0 && (best === null || v > (r.values[best] ?? 0))) best = t; }
    const out = {} as Record<SourceType, string>;
    for (const t of SOURCE_TYPES) out[t] = t === best ? `${r.text[t]} ${TYPE_LABEL[t]}` : r.text[t];
    return out;
  });
  // Same cell layout as the adapter: Stage, then count and conversion per type.
  const tableRows = rows.map((r) => [r.label, ...SOURCE_TYPES.flatMap((t) => [r.text[t], pctText(r.conversion[t])])]);
  const first = rows[0], last = rows[rows.length - 1];
  const drops = SOURCE_TYPES.filter((t) => biggestDrop[t]).map((t) => `${TYPE_LABEL[t]} loses most into ${STAGE_LABEL[biggestDrop[t] as Stage]}`);
  const aria = f.empty ? `Funnel by drive type: ${EMPTY_TEXT}` : [
    `Funnel by drive type. Leads: ${list(SOURCE_TYPES.map((t) => `${TYPE_LABEL[t]} ${first.text[t]}`))}.`,
    `Joined: ${list(SOURCE_TYPES.map((t) => `${TYPE_LABEL[t]} ${last.text[t]}`))}.`,
    drops.length ? `${list(drops)}.` : "",
  ].filter(Boolean).join(" ");
  return { rows, labels, biggestDrop, untracked, empty: f.empty, motion: f.motion, aria, table: { ...f.table, rows: tableRows } };
}

// ---- conversion heatmap ------------------------------------------------------------------------------------------------------------------
export function conversionView(a: DriveAnalytics, opts?: ChartOpts) {
  const h = conversionHeatmap(a, opts);
  const untracked = !isTracked(a);
  const blank: HeatCell = { rate: null, average: null, delta: null, text: DASH, direction: null };
  const rows = h.rows.map((r) => ({ ...r, cells: r.cells.map((c, k) => (maskedConversion(untracked, STAGES[k + 1]) ? blank : c)) }));
  const cellText = (c: HeatCell): string => (c.direction ? `${c.text} (${c.direction === "even" ? "near average" : `${c.direction} average`})` : c.text);
  const tableRows = rows.map((r) => [TYPE_LABEL[r.sourceType], ...r.cells.map(cellText)]);
  const empty = rows.every((r) => r.cells.every((c) => c.rate === null));
  const below = rows.flatMap((r) => r.cells.map((c, k) => ({ t: r.sourceType, k, c }))).filter((x) => x.c.direction === "below" && x.c.delta !== null)
    .sort((p, q) => (p.c.delta as number) - (q.c.delta as number))[0];
  const aria = empty ? `Conversion by drive type and stage: ${EMPTY_TEXT}` :
    `Stage-to-stage conversion for ${SOURCE_TYPES.length} drive types across ${h.columns.length} steps.`
    + (below ? ` Furthest below average: ${TYPE_LABEL[below.t]}, ${h.columns[below.k]} at ${below.c.text}.` : "");
  return { columns: h.columns, rows, untracked, empty, aria, table: { ...h.table, rows: tableRows } };
}

// ---- yield -------------------------------------------------------------------------------------------------------------------------------
export function yieldView(a: DriveAnalytics, opts?: ChartOpts) {
  const y = yieldChart(a, opts);
  const totals = SOURCE_TYPES.map((t) => y.points.reduce((n, p) => n + p[t], 0));
  const hit = y.points.filter((p) => p.target > 0 && p.meta_live + p.meta_old + p.he >= p.target).length;
  const withTarget = y.points.filter((p) => p.target > 0).length;
  const aria = y.empty ? `Daily arrivals against target: ${EMPTY_TEXT}` :
    `Daily arrivals against target over ${y.points.length} drive days. Total arrived: ${list(SOURCE_TYPES.map((t, i) => `${TYPE_LABEL[t]} ${totals[i]}`))}. `
    + `Target met on ${hit} of ${withTarget} days with a target.`;
  // The series that gets an end-of-line label: only those with any arrivals.
  const labelled = SOURCE_TYPES.filter((_, i) => totals[i] > 0);
  return { ...y, totals, labelled, aria };
}

// ---- timing heatmap ----------------------------------------------------------------------------------------------------------------------
export function hourText(h: number): string { return `${String(h).padStart(2, "0")}:00`; }
export function timingView(a: DriveAnalytics, kind: "replies" | "arrivals", t: SourceType, opts?: ChartOpts) {
  const g = timingHeatmap(a, kind, t, opts);
  const what = kind === "replies" ? "replies" : "arrivals";
  const peakText = g.peak ? `Busiest: ${g.peak.weekday} ${hourText(g.peak.hour)} IST with ${g.peak.n} ${what}` : `No ${what} recorded for ${TYPE_LABEL[t]} in this range`;
  const total = g.rows.reduce((n, r) => n + r.cells.reduce((m, v) => m + v, 0), 0);
  const without = kind === "arrivals" ? Math.round(fin(a?.timing?.arrivalsWithoutTime)) : 0;
  const aria = g.empty ? `${TYPE_LABEL[t]} ${what} by weekday and hour: ${EMPTY_TEXT}` : `${TYPE_LABEL[t]}: ${total} ${what} by weekday and hour (IST). ${peakText}.`;
  return { ...g, peakText, total, without, aria };
}

// ---- scatter -----------------------------------------------------------------------------------------------------------------------------
export function scatterView(a: DriveAnalytics, opts?: ChartOpts) {
  const s = scatterChart(a, opts);
  const points = s.points.map((p) => ({ ...p, tag: p.labelled ? shortLabel(p.code) : "" }));
  const best = [...points].sort((p, q) => q.x - p.x || q.leads - p.leads)[0];
  const aria = s.empty ? `Show rate against lead-to-join rate: ${EMPTY_TEXT}` :
    `${points.length} requisitions plotted by show rate and lead-to-join rate, dot size is leads. Highest show rate: ${best.code} (${TYPE_LABEL[best.sourceType]}) ${pctText(best.x / 100)}. `
    + `Labelled: the ${Math.min(5, points.length)} with the most leads.`;
  return { ...s, points, aria };
}

// ---- waterfall ---------------------------------------------------------------------------------------------------------------------------
export function waterfallView(a: DriveAnalytics, t: SourceType, opts?: ChartOpts) {
  const w = waterfallChart(a, t, opts);
  const untracked = !isTracked(a);
  const steps = a?.waterfall?.[t] ?? [];
  const keep = w.bars.map((_, i) => !(untracked && steps[i] && touchesQualified(steps[i].from, steps[i].to)));
  const bars = w.bars.filter((_, i) => keep[i]);
  const rows = w.table.rows.filter((_, i) => keep[i]);
  const empty = bars.length === 0 || bars.every((b) => b.base + b.lost === 0);
  const worst = [...bars].sort((p, q) => q.lost - p.lost)[0];
  const aria = empty ? `${TYPE_LABEL[t]} drop-off: ${EMPTY_TEXT}` :
    `${TYPE_LABEL[t]} drop-off by step. Largest loss: ${worst.label}, ${worst.lost} people${worst.reasons ? ` (${worst.reasons})` : ""}.`;
  return { bars, untracked, empty, motion: w.motion, aria, table: { ...w.table, rows } };
}

// ---- compare table + CSV -----------------------------------------------------------------------------------------------------------------
export function compareView(a: DriveAnalytics): { rows: CompareRow[]; untracked: boolean; empty: boolean } {
  const untracked = !isTracked(a);
  const rows = compareRows(a).map((r) => (untracked ? { ...r, cells: { ...r.cells, qualified: null } } : r));
  const empty = rows.every((r) => STAGES.every((s) => !r.cells[s]));
  return { rows, untracked, empty };
}
export function compareCellText(kind: "count" | "rate" | "money", v: number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  return kind === "rate" ? pctText(v) : kind === "money" ? moneyText(v) : countText(v);
}
export const CSV_COLUMNS: ReadonlyArray<{ key: string; label: string }> = [{ key: "type", label: "Drive type" }, ...COMPARE_COLUMNS];
export const csvColumnsFor = (a: DriveAnalytics): ReadonlyArray<{ key: string; label: string }> => [{ key: "type", label: "Drive type" }, ...compareColumnsFor(a)];
/** CSV rows with the same text the table shows (counts and money as numbers, rates as whole percent, untracked or missing as empty). */
export function compareCsvRows(rows: CompareRow[], columns: ReadonlyArray<{ key: string; kind: "count" | "rate" | "money" }> = COMPARE_COLUMNS): Array<Record<string, string | number | null>> {
  return rows.map((r) => {
    const out: Record<string, string | number | null> = { type: r.label };
    for (const c of columns) { const v = r.cells[c.key]; out[c.key] = v === null || v === undefined ? null : c.kind === "rate" ? pctText(v) : v; }
    return out;
  });
}
export function compareCsvName(a: DriveAnalytics): string { return `drive-comparison-${a?.window?.from ?? "from"}-to-${a?.window?.to ?? "to"}.csv`; }

// ---- colours -----------------------------------------------------------------------------------------------------------------------------
function channel(c: number): number { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }
function luminance(hex: string): number {
  const h = String(hex ?? "").startsWith("#") ? hex.slice(1) : String(hex ?? "");
  if (h.length !== 6) return 1;
  const v = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  if (v.some((x) => !Number.isFinite(x))) return 1;
  return 0.2126 * channel(v[0]) + 0.7152 * channel(v[1]) + 0.0722 * channel(v[2]);
}
export function contrastRatio(a: string, b: string): number { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** Dark slate or white, whichever reads better on the cell colour. */
export function inkOn(bg: string): string { return contrastRatio(bg, "#0f172a") >= contrastRatio(bg, "#ffffff") ? "#0f172a" : "#ffffff"; }
/** Cell text style: the better ink, or (when neither reaches 4.5:1, e.g. the mid blue) a light plate behind the number. */
export function cellInk(bg: string): { color: string; plate: boolean } {
  const color = inkOn(bg);
  return contrastRatio(bg, color) >= 4.5 ? { color, plate: false } : { color: "#0f172a", plate: true };
}
