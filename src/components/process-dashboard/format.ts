import type { KpiStatus } from "./types";

export const DASH = "—";
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}

/** Unit-aware value formatting. Unknown units fall back to a plain number. */
export function formatValue(v: number | null | undefined, unit?: string): string {
  if (!isNum(v)) return DASH;
  switch ((unit ?? "").toLowerCase()) {
    case "pct": case "%": case "percent": return `${nf.format(v)}%`;
    case "sec": case "s": case "seconds": return formatDuration(v);
    case "min": case "minutes": return formatDuration(v * 60);
    case "hours": case "hrs": case "h": return `${nf.format(v)}h`;
    case "inr": case "rs": case "₹": case "currency": return `₹${Math.round(v).toLocaleString("en-IN")}`;
    default: return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-IN") : nf.format(v);
  }
}

export type DeltaTone = "good" | "bad" | "neutral";
export interface DeltaInfo { text: string; arrow: "up" | "down" | "flat" | "none"; tone: DeltaTone; srText: string }
export const lowerIsBetter = (direction?: string) => /lower|down|min|less|desc/i.test(direction ?? "");

/** Arrow + text + tone. Direction decides whether a rise is good; colour is never the only signal (arrow and text carry it). */
export function formatDelta(deltaPct: number | null | undefined, direction?: string): DeltaInfo {
  if (!isNum(deltaPct)) return { text: "no prior period", arrow: "none", tone: "neutral", srText: "No comparison with the previous period" };
  if (Math.abs(deltaPct) < 0.05) return { text: "0.0% vs prev", arrow: "flat", tone: "neutral", srText: "Unchanged versus previous period" };
  const up = deltaPct > 0;
  const good = lowerIsBetter(direction) ? !up : up;
  const mag = `${Math.abs(deltaPct).toFixed(1)}%`;
  return {
    text: `${up ? "+" : "-"}${mag} vs prev`, arrow: up ? "up" : "down", tone: good ? "good" : "bad",
    srText: `${up ? "Up" : "Down"} ${mag} versus previous period, ${good ? "favourable" : "unfavourable"}`,
  };
}

export const STATUS_META: Record<KpiStatus, { label: string; cls: string }> = {
  good: { label: "On target", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  warn: { label: "Near target", cls: "bg-amber-50 text-amber-900 ring-amber-200" },
  bad: { label: "Off target", cls: "bg-red-50 text-red-800 ring-red-200" },
  nodata: { label: "No data", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
};
export const statusMeta = (s?: string) => STATUS_META[(s as KpiStatus) in STATUS_META ? (s as KpiStatus) : "nodata"];

export function csvFilename(processCode: string, view: string, from: string, to: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "process";
  return `${safe(processCode)}_${safe(view)}_${from}_${to}.csv`;
}

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Data is stale when the newest source row is older than 10 refresh cycles (floor 30 min). */
export function isStale(lastDataAt: string | null | undefined, nowMs: number, refreshSeconds = 30): boolean {
  if (!lastDataAt) return false;
  const t = Date.parse(lastDataAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t > Math.max(refreshSeconds * 10, 1800) * 1000;
}

export const humanize = (k: string) => k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
export const CATEGORY_LABEL: Record<string, string> = { sales: "Sales", support_inbound: "Support / Inbound", outbound: "Outbound", collections: "Collections" };
