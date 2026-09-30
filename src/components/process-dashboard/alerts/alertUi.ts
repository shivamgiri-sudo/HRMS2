import { FOCUS } from "../ui";
import { formatValue } from "../format";
import type { AlertRule, Comparator, MetricChoice, Severity } from "./api";

export const field = `min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 ${FOCUS}`;
export const primaryBtn = `inline-flex min-h-[40px] cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const CMP_LABEL: Record<Comparator, string> = { gt: "is above", gte: "is at or above", lt: "is below", lte: "is at or below" };
export const CMP_SYMBOL: Record<Comparator, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤" };
export const SEV_STYLE: Record<Severity, string> = { info: "bg-blue-50 text-blue-900 ring-blue-300", warn: "bg-amber-50 text-amber-950 ring-amber-400", critical: "bg-red-50 text-red-900 ring-red-400" };
export const SEV_TEXT: Record<Severity, string> = { info: "Info", warn: "Warning", critical: "Critical" };
export const COOLDOWNS = [{ v: 0, l: "No cooldown" }, { v: 60, l: "1 hour" }, { v: 360, l: "6 hours" }, { v: 1440, l: "1 day" }, { v: 4320, l: "3 days" }, { v: 10080, l: "7 days" }];
export const VIEWER_ROLE_OPTIONS = [["manager", "Managers"], ["process_manager", "Process managers"], ["operations_manager", "Operations managers"], ["branch_head", "Branch heads"], ["qa", "QA"], ["quality_analyst", "Quality analysts"], ["tq_head", "TQ heads"], ["coo", "COO"], ["ceo", "CEO"], ["admin", "Admins"]] as const;

export const isAnomaly = (key: string) => key.startsWith("anomaly:");
export const unitHint = (u?: string): string => ({ percent: "%", seconds: "seconds", hours: "hours", currency: "₹", count: "count", ratio: "ratio" } as Record<string, string>)[u ?? ""] ?? "";
export const when = (iso?: string | null): string => { if (!iso) return "—"; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); };

/** "AHT is above 420 seconds for 2 days in a row" -- the sentence a manager reads, not the stored fields. */
export function describeRule(r: Pick<AlertRule, "metricKey" | "comparator" | "threshold" | "windowDays" | "consecutiveDays">, metrics: MetricChoice[]): string {
  const m = metrics.find((x) => x.key === r.metricKey);
  if (isAnomaly(r.metricKey)) return `${m?.label ?? r.metricKey}: at least ${r.threshold} agent${r.threshold === 1 ? "" : "s"} flagged in a day`;
  const v = m?.unit === "seconds" || m?.unit === "hours" || m?.unit === "percent" || m?.unit === "currency" ? formatValue(r.threshold, m.unit) : String(r.threshold);
  return `${m?.label ?? r.metricKey} ${CMP_LABEL[r.comparator]} ${v}${r.windowDays > 1 ? ` (${r.windowDays}-day window)` : ""}${r.consecutiveDays > 1 ? ` for ${r.consecutiveDays} days in a row` : ""}`;
}
export const errMsg = (e: unknown, fb = "Something went wrong."): string => (e instanceof Error && e.message ? e.message : fb);
