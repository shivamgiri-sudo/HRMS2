import { formatCategory } from "./format";
import type { Cell, Format, QueryResult, ResultColumn } from "./types";

/**
 * Pure data shaping between a QueryResult and what charts draw. Kept free of React so each transform is unit-tested.
 * A Frame is the common shape: categories along one axis, one or more numeric series.
 */
export interface Series { key: string; label: string; format: Format; values: Array<number | null> }
export interface Frame { categories: string[]; raw: Cell[]; categoryKey: string | null; series: Series[] }

export const dims = (r: QueryResult): ResultColumn[] => r.columns.filter((c) => c.kind === "dimension");
export const measures = (r: QueryResult): ResultColumn[] => r.columns.filter((c) => c.kind === "measure");
const num = (v: Cell | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export const MAX_PIVOT_SERIES = 12;

/**
 * 0 dimensions: one category "Total". 1 dimension: a series per measure. 2+ dimensions: the second dimension becomes
 * the series (first measure only), capped at 12 with the rest summed into "Other".
 */
export function toFrame(r: QueryResult): Frame {
  const ds = dims(r), ms = measures(r);
  if (!ds.length) {
    return { categories: ["Total"], raw: [null], categoryKey: null, series: ms.map((m) => ({ key: m.key, label: m.label, format: m.format, values: [num(r.rows[0]?.[m.key])] })) };
  }
  const d0 = ds[0];
  if (ds.length === 1) {
    return {
      categories: r.rows.map((x) => formatCategory(x[d0.key], d0)), raw: r.rows.map((x) => x[d0.key]), categoryKey: d0.key,
      series: ms.map((m) => ({ key: m.key, label: m.label, format: m.format, values: r.rows.map((x) => num(x[m.key])) })),
    };
  }
  const d1 = ds[1], m0 = ms[0];
  const cats: Cell[] = []; const catIdx = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const row of r.rows) {
    const c = String(row[d0.key]); if (!catIdx.has(c)) { catIdx.set(c, cats.length); cats.push(row[d0.key]); }
    const s = formatCategory(row[d1.key], d1); totals.set(s, (totals.get(s) ?? 0) + Math.abs(num(row[m0.key]) ?? 0));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const keep = ranked.length > MAX_PIVOT_SERIES ? ranked.slice(0, MAX_PIVOT_SERIES - 1) : ranked;
  const names = ranked.length > keep.length ? [...keep, "Other"] : keep;
  const grid = names.map(() => cats.map((): number | null => null));
  for (const row of r.rows) {
    const ci = catIdx.get(String(row[d0.key]))!; const label = formatCategory(row[d1.key], d1);
    const si = keep.includes(label) ? names.indexOf(label) : names.indexOf("Other");
    const v = num(row[m0.key]); if (v === null || si < 0) continue;
    grid[si][ci] = (grid[si][ci] ?? 0) + v;
  }
  return {
    categories: cats.map((c) => formatCategory(c, d0)), raw: cats, categoryKey: d0.key,
    series: names.map((n, i) => ({ key: `s${i}`, label: n, format: m0?.format ?? "number", values: grid[i] })),
  };
}

/** Recharts rows: { name, <seriesKey>: value, __raw }. */
export function frameRows(f: Frame): Array<Record<string, Cell>> {
  return f.categories.map((name, i) => ({ name, __raw: f.raw[i], ...Object.fromEntries(f.series.map((s) => [s.key, s.values[i]])) }));
}

/** Keep the n largest categories (by first series) and sum the rest into "Other". n <= 0 keeps everything. */
export function topN(f: Frame, n: number | undefined): Frame {
  if (!n || n <= 0 || f.categories.length <= n) return f;
  const order = f.categories.map((_, i) => i).sort((a, b) => Math.abs(f.series[0]?.values[b] ?? 0) - Math.abs(f.series[0]?.values[a] ?? 0));
  const keep = order.slice(0, n).sort((a, b) => a - b), rest = order.slice(n);
  return {
    categoryKey: f.categoryKey, categories: [...keep.map((i) => f.categories[i]), "Other"], raw: [...keep.map((i) => f.raw[i]), null],
    series: f.series.map((s) => ({ ...s, values: [...keep.map((i) => s.values[i]), rest.reduce((a, i) => a + (s.values[i] ?? 0), 0)] })),
  };
}

/** Each category's series values as a share of that category's total (for 100% stacked). */
export function toPercentOfTotal(f: Frame): Frame {
  const sums = f.categories.map((_, i) => f.series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0));
  return { ...f, series: f.series.map((s) => ({ ...s, format: "percent" as Format, values: s.values.map((v, i) => (v === null || !sums[i] ? null : (Math.abs(v) / sums[i]) * 100)) })) };
}

export interface Bin { label: string; from: number; to: number; count: number }
export function histogram(values: Array<number | null>, binCount = 10): Bin[] {
  const xs = values.filter((v): v is number => v !== null);
  if (xs.length < 2) return [];
  const lo = Math.min(...xs), hi = Math.max(...xs);
  if (lo === hi) return [{ label: String(lo), from: lo, to: hi, count: xs.length }];
  const step = (hi - lo) / binCount; const dec = step >= 10 ? 0 : step >= 1 ? 1 : 2;
  const bins: Bin[] = Array.from({ length: binCount }, (_, i) => ({ from: lo + i * step, to: lo + (i + 1) * step, count: 0, label: `${(lo + i * step).toFixed(dec)}–${(lo + (i + 1) * step).toFixed(dec)}` }));
  for (const v of xs) bins[Math.min(binCount - 1, Math.floor((v - lo) / step))].count++;
  return bins;
}

export interface BoxStats { label: string; min: number; q1: number; median: number; q3: number; max: number; n: number }
const quantile = (s: number[], q: number) => { const p = (s.length - 1) * q, b = Math.floor(p); return s[b] + (s[Math.min(b + 1, s.length - 1)] - s[b]) * (p - b); };
/** Five-number summary of each series' values across categories (or of one series when only one exists). */
export function boxStats(f: Frame): BoxStats[] {
  return f.series.map((s) => {
    const xs = s.values.filter((v): v is number => v !== null).sort((a, b) => a - b);
    if (!xs.length) return null;
    return { label: s.label, min: xs[0], q1: quantile(xs, 0.25), median: quantile(xs, 0.5), q3: quantile(xs, 0.75), max: xs[xs.length - 1], n: xs.length };
  }).filter((x): x is BoxStats => x !== null);
}

export interface WaterfallStep { name: string; base: number; value: number; end: number; kind: "up" | "down" | "total" }
/** Running total of the first series, with a closing "Total" bar. */
export function waterfall(f: Frame): WaterfallStep[] {
  let run = 0; const out: WaterfallStep[] = [];
  f.categories.forEach((name, i) => {
    const v = f.series[0]?.values[i] ?? 0; const start = run; run += v;
    out.push({ name, base: Math.min(start, run), value: Math.abs(v), end: run, kind: v >= 0 ? "up" : "down" });
  });
  out.push({ name: "Total", base: Math.min(0, run), value: Math.abs(run), end: run, kind: "total" });
  return out;
}

export interface Matrix { rows: string[]; cols: string[]; cells: Array<Array<number | null>>; min: number; max: number }
/** Two dimensions and a measure as a grid (heatmap, pivot table). Needs 2 dimensions; with 1 it is a single-column grid. */
export function toMatrix(r: QueryResult): Matrix {
  const ds = dims(r), m = measures(r)[0];
  const rows: string[] = [], cols: string[] = []; const ri = new Map<string, number>(), ci = new Map<string, number>();
  const colRaw: Cell[] = [];
  const cells: Array<Array<number | null>> = [];
  let min = Infinity, max = -Infinity;
  for (const row of r.rows) {
    const rl = ds[0] ? formatCategory(row[ds[0].key], ds[0]) : "Total";
    const cl = ds[1] ? formatCategory(row[ds[1].key], ds[1]) : m?.label ?? "Value";
    if (!ri.has(rl)) { ri.set(rl, rows.length); rows.push(rl); cells.push([]); }
    if (!ci.has(cl)) { ci.set(cl, cols.length); cols.push(cl); colRaw.push(ds[1] ? row[ds[1].key] : null); }
    const v = m ? num(row[m.key]) : null;
    cells[ri.get(rl)!][ci.get(cl)!] = v;
    if (v !== null) { min = Math.min(min, v); max = Math.max(max, v); }
  }
  for (const c of cells) for (let i = 0; i < cols.length; i++) if (c[i] === undefined) c[i] = null;
  // Time buckets (hour, weekday, dates) read left to right in order, not in the order rows happened to arrive.
  const order = sortedOrder(colRaw, ds[1]?.grain);
  if (order) return { rows, cols: order.map((i) => cols[i]), cells: cells.map((r) => order.map((i) => r[i])), min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 };
  return { rows, cols, cells, min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 };
}

/** Index order that sorts raw column values ascending when they are all numbers or a time grain; null = keep as is. */
function sortedOrder(raw: Cell[], grain: string | undefined): number[] | null {
  const allNum = raw.every((v) => typeof v === "number");
  if (!grain && !allNum) return null;
  const idx = raw.map((_, i) => i);
  idx.sort((a, b) => (allNum ? (raw[a] as number) - (raw[b] as number) : String(raw[a]).localeCompare(String(raw[b]))));
  return idx.some((v, i) => v !== i) ? idx : null;
}

export interface FlowGraph { nodes: Array<{ name: string }>; links: Array<{ source: number; target: number; value: number }> }
/** Two dimensions as a flow: left values to right values, weighted by the first measure. Self-loops and empties dropped. */
export function toFlow(r: QueryResult): FlowGraph {
  const ds = dims(r), m = measures(r)[0];
  if (ds.length < 2 || !m) return { nodes: [], links: [] };
  const idx = new Map<string, number>(); const nodes: Array<{ name: string }> = [];
  const id = (side: string, label: string) => { const k = `${side}|${label}`; if (!idx.has(k)) { idx.set(k, nodes.length); nodes.push({ name: label }); } return idx.get(k)!; };
  const links: FlowGraph["links"] = [];
  for (const row of r.rows) {
    const v = num(row[m.key]); if (!v || v <= 0) continue;
    links.push({ source: id("L", formatCategory(row[ds[0].key], ds[0])), target: id("R", formatCategory(row[ds[1].key], ds[1])), value: v });
  }
  return { nodes, links };
}

/** Rows and header for "view as table" and CSV/XLSX export. */
export function toTable(r: QueryResult): { header: string[]; rows: Cell[][] } {
  return { header: r.columns.map((c) => c.label), rows: r.rows.map((row) => r.columns.map((c) => (c.kind === "dimension" ? formatCategory(row[c.key], c) : row[c.key]))) };
}
