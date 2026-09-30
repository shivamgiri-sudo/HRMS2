import { useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { Legend, ResponsiveContainer } from "recharts";
import { axisTick, formatValue } from "../format";
import type { Frame, Series } from "../shape";
import type { Cell, Format, Theme, VizProps, VizStyle } from "../types";

/** Shared pieces of the cartesian and part-to-whole charts: root wrapper, tooltip box, axis / legend props. */

/** Stroke patterns so line series stay distinguishable without colour. */
export const DASHES: Array<string | undefined> = [undefined, "6 3", "2 3", "8 3 2 3"];
export const DOWN_COLOR = "#DC2626";

export const truncate = (v: unknown, n = 14): string => {
  const s = String(v ?? "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
export const colorAt = (colors: string[], i: number, theme: Theme): string => (colors.length ? colors[i % colors.length] : theme.accent);
export const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
export const fmtSeries = (v: unknown, s: Pick<Series, "format"> | undefined, style: VizStyle): string => formatValue(toNum(v), s?.format ?? "number", style);
export const pctOf = (v: number, total: number): string => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "—");

/** Black or white, whichever reads better on a hex fill (labels drawn on top of a coloured mark). */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#FFFFFF";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#111827" : "#FFFFFF";
}

export const chartLabel = (kind: string, labels: string[]): string => (labels.length ? `${kind} of ${labels.join(", ")}` : kind);

export type LegendPos = "none" | "top" | "bottom" | "right";
export const legendPos = (style: VizStyle, seriesCount: number, multiDefault: LegendPos = "bottom"): LegendPos =>
  style.legend ?? (seriesCount > 1 ? multiDefault : "none");

/** A recharts <Legend> element (must be a direct chart child, so this returns the element itself) or null. */
export function legendEl(pos: LegendPos, theme: Theme): ReactElement | null {
  if (pos === "none") return null;
  const side = pos === "right";
  return (
    <Legend
      layout={side ? "vertical" : "horizontal"} align={side ? "right" : "center"} verticalAlign={side ? "middle" : pos}
      iconSize={9} wrapperStyle={{ fontSize: 11, lineHeight: "16px", ...(side ? { paddingLeft: 8 } : {}) }}
      formatter={(value: unknown) => <span style={{ color: theme.text }}>{truncate(value, 20)}</span>}
    />
  );
}

const tickStyle = (theme: Theme) => ({ fill: theme.muted, fontSize: 11 });
const xTitleLabel = (title: string | undefined, theme: Theme) =>
  title ? { label: { value: title, position: "insideBottom" as const, offset: -12, fill: theme.muted, fontSize: 11 } } : {};
const yTitleLabel = (title: string | undefined, theme: Theme, right = false) =>
  title ? { label: { value: title, angle: right ? 90 : -90, position: right ? ("insideRight" as const) : ("insideLeft" as const), fill: theme.muted, fontSize: 11, style: { textAnchor: "middle" as const } } } : {};

/** Props for the axis that carries category names. `axis` says which screen axis it is drawn on. */
/** `count` = number of categories: short axes show every label, long ones thin them out. */
export function catAxisProps(theme: Theme, axis: "x" | "y", title?: string, count = 99) {
  return {
    tick: tickStyle(theme), stroke: theme.grid, tickLine: false, interval: (count <= (axis === "y" ? 30 : 10) ? 0 : "preserveStartEnd") as 0 | "preserveStartEnd", minTickGap: 12,
    tickFormatter: (v: unknown) => truncate(v),
    ...(axis === "x" ? xTitleLabel(title, theme) : yTitleLabel(title, theme)),
  };
}
/** Props for a numeric axis. */
export function valAxisProps(theme: Theme, format: Format, axis: "x" | "y", title?: string, right = false) {
  return {
    tick: tickStyle(theme), stroke: theme.grid, tickLine: false,
    tickFormatter: (v: unknown) => axisTick(Number(v), format),
    ...(axis === "x" ? xTitleLabel(title, theme) : yTitleLabel(title, theme, right)),
  };
}
export const chartMargin = (style: VizStyle, extra: { top?: number; right?: number } = {}) => ({
  top: extra.top ?? (style.dataLabels ? 18 : 8), right: extra.right ?? 12, left: style.yTitle ? 12 : 0, bottom: style.xTitle ? 18 : 4,
});

/** Click-to-filter on a chart row: needs a dimension column and a real category (not the top-N "Other" bucket). */
export function selectRow(frame: Pick<Frame, "categoryKey">, onSelect: VizProps["onSelect"], row: unknown): void {
  if (!onSelect || !frame.categoryKey || !row || typeof row !== "object") return;
  const r = row as { name?: unknown; __raw?: Cell; payload?: unknown };
  if (!("__raw" in r)) { if (r.payload && r.payload !== row) selectRow(frame, onSelect, r.payload); return; }
  if (r.name === "Other" && (r.__raw === null || r.__raw === undefined)) return;
  onSelect(frame.categoryKey, r.__raw ?? null);
}

export interface TipItem { color?: string; label: string; value: string; dash?: string }
/** The small tooltip card every chart uses. */
export function TipBox({ theme, title, items }: { theme: Theme; title?: string; items: TipItem[] }) {
  return (
    <div style={{ background: theme.card, border: `1px solid ${theme.border}`, color: theme.text, borderRadius: 6, padding: "6px 8px", fontSize: 11, lineHeight: 1.5, maxWidth: 260, boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>
      {title ? <div style={{ fontWeight: 600, marginBottom: 2, overflowWrap: "anywhere" }}>{title}</div> : null}
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {it.color ? <span style={{ width: 8, height: 8, borderRadius: 2, background: it.color, flex: "none" }} /> : null}
          <span style={{ color: theme.muted }}>{it.label}</span>
          <span style={{ marginLeft: "auto", paddingLeft: 10, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Root of every recharts chart: fills the parent, labelled for assistive tech. */
export function ChartRoot({ label, clickable, children }: { label: string; clickable?: boolean; children: ReactElement }) {
  return (
    <div className="h-full w-full" role="img" aria-label={label} style={clickable ? { cursor: "pointer" } : undefined}>
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

/** Root for charts drawn without recharts, and for "nothing to draw" states. */
export function PlainRoot({ label, children }: { label: string; children: ReactNode }) {
  return <div className="h-full w-full" role="img" aria-label={label}>{children}</div>;
}
export function EmptyChart({ label, theme }: { label: string; theme: Theme }) {
  return (
    <PlainRoot label={label}>
      <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: theme.muted }}>No data to show</div>
    </PlainRoot>
  );
}

/** Width of an element (null until measured, and always null when rendered on the server). */
export function useWidth<T extends HTMLElement>(): [RefObject<T>, number | null] {
  const ref = useRef<T>(null);
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setW(entries[0]?.contentRect.width ?? null));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
