import type { Cell, Format, Grain, ResultColumn, VizStyle } from "./types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function compact(n: number, decimals: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e7).toFixed(decimals)}Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(decimals)}L`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(decimals)}K`;
  return n.toFixed(decimals === 0 ? 0 : Math.min(decimals, 1));
}

/** A measure value as text. `style` supplies the user's decimals / prefix / suffix / compact choices. */
export function formatValue(value: Cell | undefined, format: Format, style: Pick<VizStyle, "decimals" | "prefix" | "suffix" | "compact"> = {}): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "—";
  const wrap = (s: string) => `${style.prefix ?? ""}${s}${style.suffix ?? ""}`;
  if (format === "duration") {
    const s = Math.round(value);
    if (s < 90) return wrap(`${s}s`);
    if (s < 3600) return wrap(`${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);
    return wrap(`${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`);
  }
  const dflt = format === "integer" ? 0 : format === "currency" ? 0 : format === "percent" ? 1 : Number.isInteger(value) ? 0 : 2;
  const d = Math.max(0, Math.min(style.decimals ?? dflt, 6));
  if (format === "percent") return wrap(`${value.toFixed(d)}%`);
  const body = style.compact ? compact(value, style.decimals ?? 1) : value.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  return wrap(format === "currency" ? `₹${body}` : body);
}

/** Short axis tick for big numbers, regardless of the user's compact setting. */
export function axisTick(value: number, format: Format): string {
  if (format === "percent") return `${Math.round(value * 10) / 10}%`;
  if (format === "duration") return formatValue(value, "duration");
  const s = Math.abs(value) >= 1000 ? compact(value, 1).replace(/\.0(?=[A-Za-z])/, "") : String(Math.round(value * 100) / 100);
  return format === "currency" ? `₹${s}` : s;
}

/** A dimension value as a label, aware of the time grain it was grouped by. */
export function formatCategory(value: Cell | undefined, column?: Pick<ResultColumn, "grain" | "format" | "dataType">): string {
  if (value === null || value === undefined || value === "") return "(blank)";
  const grain: Grain | undefined = column?.grain;
  if (grain === "weekday") return WEEKDAYS[Number(value)] ?? String(value);
  if (grain === "hour") return `${String(value).padStart(2, "0")}:00`;
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m && (grain || column?.format === "date")) {
    const [, y, mo, d] = m;
    if (grain === "month") return `${MONTHS[Number(mo) - 1]} ${y}`;
    if (grain === "week") return `w/c ${Number(d)} ${MONTHS[Number(mo) - 1]}`;
    return `${Number(d)} ${MONTHS[Number(mo) - 1]}`;
  }
  return s;
}

/** Change against a comparison value: text, direction, and whether it is good given "higher is better". */
export function delta(current: number | null | undefined, previous: number | null | undefined, higherIsBetter = true) {
  if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const flat = Math.abs(pct) < 0.05;
  return { pct, text: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`, up: pct > 0, flat, good: flat ? null : pct > 0 === higherIsBetter };
}
