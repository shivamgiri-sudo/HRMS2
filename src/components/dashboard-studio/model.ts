import type { Cell, DashboardSettings, DatasetDef, GridPos, QuerySpec, Widget } from "./types";

/**
 * Pure logic of the Studio (no React): how dashboard-level filters reach each widget's query, sensible defaults for a
 * new widget, layouts per breakpoint, and undo/redo. Unit-tested so the editor components stay thin.
 */

export const COLS = { lg: 12, md: 8, sm: 4, xs: 1 } as const;
export const BREAKPOINTS = { lg: 1100, md: 760, sm: 480, xs: 0 } as const;
export const ROW_HEIGHT = 40;
export type Breakpoint = keyof typeof COLS;

export interface Needs { dims: [number, number]; measures: [number, number] }
export interface CrossFilter { field: string; value: Cell; label: string }
export interface RuntimeFilters { values: Record<string, string[]>; cross: CrossFilter[] }

const hasField = (ds: DatasetDef | undefined, key: string) => !!ds?.fields.some((f) => f.fieldKey === key);

/**
 * The query a widget actually runs: its own spec plus the dashboard's date range, branch/process scope, filter-bar
 * values and click-to-filter selections. A filter only applies to widgets whose dataset has a field with that key.
 */
export function effectiveQuery(
  widget: Pick<Widget, "query" | "viz" | "id">, settings: DashboardSettings, runtime: RuntimeFilters, datasets: DatasetDef[], sourceWidgetId?: string,
): QuerySpec | null {
  const q = widget.query;
  if (!q) return null;
  const ds = datasets.find((d) => d.code === q.dataset);
  const out: QuerySpec = { ...q, filters: [...(q.filters ?? [])] };
  if (settings.dateRange && !widget.viz.pinDate && ds?.timeField) out.dateRange = settings.dateRange;
  const scope = { branchIds: settings.branchIds?.length ? settings.branchIds : undefined, processIds: settings.processIds?.length ? settings.processIds : undefined };
  if (scope.branchIds || scope.processIds) out.scope = scope;
  for (const [field, vals] of Object.entries(runtime.values)) {
    if (vals.length && hasField(ds, field)) out.filters!.push({ field, op: "in", value: vals });
  }
  for (const c of runtime.cross) {
    if (widget.id === sourceWidgetId || !hasField(ds, c.field)) continue;
    out.filters!.push(c.value === null ? { field: c.field, op: "is_null" } : { field: c.field, op: "eq", value: c.value });
  }
  return out;
}

/** Why a widget cannot draw yet, in words a user can act on. Empty = ready. */
export function queryProblems(needs: Needs, q: QuerySpec | null, label: string): string[] {
  if (!q) return ["Pick a dataset."];
  const d = q.dimensions.length, m = q.measures.length; const out: string[] = [];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (d < needs.dims[0]) out.push(`${label} needs at least ${plural(needs.dims[0], "dimension")} (the "group by"). You have ${d}.`);
  if (d > needs.dims[1]) out.push(`${label} uses at most ${plural(needs.dims[1], "dimension")}. Remove ${d - needs.dims[1]}.`);
  if (m < needs.measures[0]) out.push(`${label} needs at least ${plural(needs.measures[0], "measure")} (the numbers). You have ${m}.`);
  if (m > needs.measures[1]) out.push(`${label} uses at most ${plural(needs.measures[1], "measure")}. Remove ${m - needs.measures[1]}.`);
  return out;
}

/** A starting query for a chart type on a dataset: time first for trends, otherwise the first dimensions and measures. */
export function defaultQuery(ds: DatasetDef, needs: Needs, preferTime: boolean): QuerySpec {
  const time = ds.fields.find((f) => f.fieldKey === ds.timeField) ?? ds.fields.find((f) => f.role === "time");
  const dimFields = ds.fields.filter((f) => f.role === "dimension");
  const measureFields = ds.fields.filter((f) => f.role === "measure");
  const wantDims = Math.max(needs.dims[0], Math.min(1, needs.dims[1]));
  const dimensions: QuerySpec["dimensions"] = [];
  if (wantDims > 0 && preferTime && time) dimensions.push({ field: time.fieldKey, grain: "day" });
  for (const f of dimFields) { if (dimensions.length >= wantDims) break; dimensions.push({ field: f.fieldKey }); }
  if (dimensions.length < wantDims && time && !dimensions.some((x) => x.field === time.fieldKey)) dimensions.push({ field: time.fieldKey, grain: "day" });
  const wantMeasures = Math.max(needs.measures[0], Math.min(1, needs.measures[1]));
  const measures: QuerySpec["measures"] = measureFields.slice(0, wantMeasures).map((f) => ({ field: f.fieldKey, agg: f.defaultAgg }));
  while (measures.length < wantMeasures) measures.push({ agg: "count" });
  return { dataset: ds.code, dimensions, measures, dateRange: ds.timeField ? { preset: "last_30" } : undefined, limit: 500 };
}

/** Swap a widget to another chart type, trimming dimensions/measures to what the new type can draw. */
export function fitQuery(q: QuerySpec | null, needs: Needs): QuerySpec | null {
  if (!q) return q;
  return { ...q, dimensions: q.dimensions.slice(0, needs.dims[1]), measures: q.measures.slice(0, Math.max(needs.measures[1], 0)) };
}

export const nextY = (widgets: Widget[]): number => widgets.reduce((y, w) => Math.max(y, (w.layout.lg?.y ?? 0) + (w.layout.lg?.h ?? 0)), 0);

/** Layout of one widget at a breakpoint; smaller breakpoints are derived from lg when the user has not arranged them. */
export function posAt(w: Widget, bp: Breakpoint, index: number): GridPos {
  const lg = w.layout.lg ?? { x: 0, y: index * 6, w: 6, h: 6 };
  if (bp === "lg") return lg;
  if (bp === "md") return w.layout.md ?? { x: Math.min(Math.round((lg.x / 12) * 8), 7), y: lg.y, w: Math.max(2, Math.min(8, Math.round((lg.w / 12) * 8))), h: lg.h };
  if (bp === "sm") return w.layout.sm ?? { x: 0, y: lg.y * 12 + lg.x, w: 4, h: lg.h };
  return { x: 0, y: lg.y * 12 + lg.x, w: 1, h: lg.h };
}

export interface RglItem { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number }
export function layoutsFor(widgets: Widget[]): Record<Breakpoint, RglItem[]> {
  const make = (bp: Breakpoint) => widgets.map((w, i) => ({ i: w.id, ...posAt(w, bp, i), minW: 1, minH: 2 }));
  return { lg: make("lg"), md: make("md"), sm: make("sm"), xs: make("xs") };
}

/** Write a drag/resize result back onto the widgets (xs is always derived, never stored). */
export function applyLayout(widgets: Widget[], bp: Breakpoint, layout: RglItem[]): Widget[] {
  if (bp === "xs") return widgets;
  const by = new Map(layout.map((l) => [l.i, l]));
  let changed = false;
  const next = widgets.map((w, index) => {
    const l = by.get(w.id); if (!l) return w;
    // Compare with where the widget already is (stored, or derived from lg): a click is a zero-distance drag, not a change.
    const cur = posAt(w, bp, index);
    if (cur.x === l.x && cur.y === l.y && cur.w === l.w && cur.h === l.h) return w;
    changed = true;
    return { ...w, layout: { ...w.layout, [bp]: { x: l.x, y: l.y, w: l.w, h: l.h } } };
  });
  return changed ? next : widgets;
}

// ── Undo / redo ──
export interface History<T> { past: T[]; present: T; future: T[] }
const LIMIT = 60;
export const initHistory = <T,>(present: T): History<T> => ({ past: [], present, future: [] });
export function pushHistory<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
}
export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}
export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); });
