import { DASH, formatDuration, formatValue } from "../format";

const nf2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
/** Unsigned magnitude of a change. Percent metrics change in percentage points. */
export function changeMagnitude(v: number, unit?: string): string {
  const m = Math.abs(v);
  switch ((unit ?? "").toLowerCase()) {
    case "percent": return `${nf2.format(m)} pp`;
    case "seconds": return formatDuration(m);
    case "hours": return `${nf2.format(m)}h`;
    case "ratio": return nf2.format(m);
    default: return formatValue(m, unit);
  }
}
export function changeText(v: number | null | undefined, unit?: string): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return DASH;
  if (Math.abs(v) < 1e-9) return `0`;
  return `${v > 0 ? "+" : "-"}${changeMagnitude(v, unit)}`;
}
export const pctText = (p: number | null | undefined, dp = 0): string => (typeof p === "number" && Number.isFinite(p) ? `${p.toFixed(dp)}%` : DASH);
export const shortDate = (d: string) => { const t = new Date(`${d}T00:00:00`); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); };
export const rangeText = (r: { from: string; to: string }) => (r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} to ${shortDate(r.to)}`);
