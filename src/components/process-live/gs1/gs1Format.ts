// Display rules for the GS1 dashboard: N/A for not-applicable, "No Data" for an empty period.

export const NA = "N/A";
export const NO_DATA = "No Data";

export function fmtCount(v: number | null | undefined, hasData = true): string {
  if (!hasData) return NO_DATA;
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  return Math.round(v).toLocaleString("en-IN");
}

export function fmtPct(v: number | null | undefined, hasData = true): string {
  if (!hasData) return NO_DATA;
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  return `${v.toFixed(1)}%`;
}

export function fmtDec(v: number | null | undefined, hasData = true, digits = 1): string {
  if (!hasData) return NO_DATA;
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  return v.toFixed(digits);
}

/** Minutes as "45 min" or "2 h 05 min". */
export function fmtMinutes(v: number | null | undefined, hasData = true): string {
  if (!hasData) return NO_DATA;
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  if (v < 60) return `${v.toFixed(1)} min`;
  const h = Math.floor(v / 60);
  const m = Math.round(v - h * 60);
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

/** ISO timestamp as local "13 Oct 2026, 14:05"; unknown when missing. */
export function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return "not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "2026-09-01" -> "01 Sep" for chart axes. */
export function fmtDayShort(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1] ?? m[2];
  return `${m[3]} ${mon}`;
}

/** Recharts cannot plot null; comparison charts plot N/A as a gap, never as 0. */
export function chartValue(v: number | null | undefined): number | undefined {
  return v === null || v === undefined || !Number.isFinite(v) ? undefined : v;
}

export const LOB_COLOR = { email: "#2f6fed", dataCard: "#0ea5b7", approval: "#7c5ce5" } as const;
export const STATUS_COLOR: Record<string, string> = {
  Closed: "#10b981", Completed: "#10b981", Approved: "#10b981",
  Pending: "#f59e0b", Rejected: "#f43f5e", "Other / unmapped": "#94a3b8",
};
