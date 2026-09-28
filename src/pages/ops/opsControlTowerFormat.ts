const IST = "Asia/Kolkata";

export function formatDate(ms: number | null): string {
  if (ms === null) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" }).format(ms);
}

export function formatDateTime(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(ms);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/** none/low/medium/high, by a metric's own thresholds — matches the backend's severityForCount bands. */
export function countSeverity(n: number, mediumAt: number, highAt: number): "none" | "low" | "medium" | "high" {
  if (n <= 0) return "none";
  if (n < mediumAt) return "low";
  if (n < highAt) return "medium";
  return "high";
}

export const SEVERITY_CLASS: Record<string, string> = {
  none: "text-slate-400",
  low: "text-amber-600",
  medium: "text-orange-600",
  high: "text-red-600",
};
