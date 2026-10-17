import type { SectionResult } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { TableSpec } from "../viz";
import { PAL, type ChartSeries } from "../look";
import { num } from "./OpsHeatGrid";

export type Part = SectionResult<unknown> | undefined;
export interface FatalData { totalFatalCalls: number; agentsWithFatals: number; truncated: boolean }
export interface CallmasterParts { kpis?: Part; qualityTrend?: Part; cx?: Part; fatal?: SectionResult<FatalData> }

/** Column keys that could carry a person or agent identity are never rendered. */
const IDENTITY_WORDS = ["agent", "name", "user", "employee", "code", "email", "manager"];
export const hidden = (k: string): boolean => IDENTITY_WORDS.some((w) => k.toLowerCase().includes(w));

export function humanLabel(k: string): string {
  let out = "";
  for (const ch of k) {
    if (ch === "_") out += " ";
    else out += ch >= "A" && ch <= "Z" && out.length > 0 ? ` ${ch}` : ch;
  }
  return out.length > 0 ? out[0].toUpperCase() + out.slice(1) : out;
}
export const cellText = (v: unknown): string => (v == null ? "—" : typeof v === "number" ? num(v) : String(v));

/** Scalar, non-identity fields of an object. */
export function scalars(o: unknown): Array<[string, unknown]> {
  if (o == null || typeof o !== "object" || Array.isArray(o)) return [];
  return Object.entries(o as Record<string, unknown>).filter(([k, v]) => (typeof v !== "object" || v === null) && !hidden(k));
}

const objRows = (data: unknown) => (Array.isArray(data) ? data : []).filter((r) => r && typeof r === "object") as Array<Record<string, unknown>>;

/** Any array of flat rows as a table (identity columns dropped, at most 31 rows). */
export function rowsTable(caption: string, data: unknown): TableSpec | null {
  const rows = objRows(data);
  const cols = rows.length ? scalars(rows[0]).map(([k]) => k) : [];
  if (!cols.length) return null;
  return { caption, columns: cols.map(humanLabel), rows: rows.slice(0, 31).map((r) => cols.map((c) => cellText(r[c]))) };
}

export const okObj = (p: Part) => (p?.status === "ok" && p.data && typeof p.data === "object" ? p.data : null);

/** CX parameter scores with their labels (definitions win over the raw key). */
export function cxItems(p: Part): Array<{ key: string; label: string; value: number }> {
  const cxd = okObj(p) as { params?: Record<string, unknown>; definitions?: Array<{ key: string; label?: string }> } | null;
  return Object.entries(cxd?.params ?? {}).filter(([k, v]) => typeof v === "number" && Number.isFinite(v) && !hidden(k))
    .map(([k, v]) => ({ key: k, label: cxd?.definitions?.find((d) => d.key === k)?.label ?? humanLabel(k), value: v as number }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Daily quality trend as chart rows: the first text column is the x axis, a "quality" column is the line on
 * the left axis, "calls" bars and "fatal" a dashed line on the right axis; other numbers become lines.
 */
export function trendChart(data: unknown): { xKey: string; rows: Array<Record<string, string | number | null>>; series: ChartSeries[] } | null {
  const rows = objRows(data).slice(0, 31);
  if (!rows.length) return null;
  const cols = scalars(rows[0]).map(([k]) => k);
  const xKey = cols.find((c) => rows.some((r) => typeof r[c] === "string")) ?? "";
  const nums = cols.filter((c) => c !== xKey && rows.some((r) => typeof r[c] === "number"));
  if (!xKey || !nums.length) return null;
  const extra = [PAL.s3, PAL.s4, PAL.other];
  const series: ChartSeries[] = nums.map((k, i) => {
    const l = k.toLowerCase();
    if (l.includes("quality")) return { key: k, label: humanLabel(k), color: PAL.s1, kind: "line" };
    if (l.includes("call")) return { key: k, label: humanLabel(k), color: "#9ec5f4", axis: "right" };
    if (l.includes("fatal")) return { key: k, label: humanLabel(k), color: PAL.s2, kind: "line", axis: "right", dashed: true };
    return { key: k, label: humanLabel(k), color: extra[i % extra.length], kind: "line" };
  });
  // A right axis alone draws nothing: move the series to the left when nothing else is there.
  const fixed = series.some((s) => s.axis !== "right") ? series : series.map((s) => ({ ...s, axis: undefined }));
  return { xKey, series: fixed, rows: rows.map((r) => Object.fromEntries([[xKey, String(r[xKey] ?? "")], ...nums.map((k) => [k, typeof r[k] === "number" ? (r[k] as number) : null])])) };
}
