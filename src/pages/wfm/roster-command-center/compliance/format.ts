/** Display helpers for the Compliance panel: Indian date formats, percentages, month labels. */

/** YYYY-MM-DD -> DD/MM/YYYY (no Date object, so no timezone shift). */
export function fmtDate(v: string | null | undefined): string {
  const m = typeof v === "string" ? v.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/** ISO datetime -> DD/MM/YYYY HH:mm (local time). */
export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** YYYY-MM -> "Sep 2026" */
export function fmtMonth(v: string | null | undefined): string {
  const m = typeof v === "string" ? v.match(/^(\d{4})-(\d{2})$/) : null;
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "—";
}

/** null-safe percent: null means "no data", never rendered as 0% or 100%. */
export function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
}

export function fmtPoints(v: number | null | undefined): string | null {
  return v === null || v === undefined || !Number.isFinite(v) ? null : `${v > 0 ? "+" : ""}${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })} pts`;
}

export const fmtInt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("en-IN"));

/** Percentage change of a count vs previous; null when there is no baseline. */
export function pctChange(cur: number, prev: number | null | undefined): number | undefined {
  if (prev === null || prev === undefined || prev === 0) return undefined;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** Score band used for both colour and the text label (colour is never the only signal). */
export function scoreBand(pct: number | null): { tone: "green" | "amber" | "red" | "neutral"; label: string } {
  if (pct === null) return { tone: "neutral", label: "No data" };
  if (pct >= 90) return { tone: "green", label: "Healthy" };
  if (pct >= 75) return { tone: "amber", label: "Watch" };
  return { tone: "red", label: "At risk" };
}

/** Last `count` months ending at `current` (YYYY-MM), newest first, for the period dropdown. */
export function recentMonths(current: string, count = 6): string[] {
  const out: string[] = [];
  let [y, m] = current.split("-").map(Number);
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

/** IST current month, independent of the browser timezone. */
export function currentMonthIst(now: number = Date.now()): string {
  return new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 7);
}

export const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
