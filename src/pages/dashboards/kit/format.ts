import type { InsightUnit } from "../../../../backend/src/modules/dashboards/role-insights/types";

const IN = "en-IN";

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `${(value / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000) return `${(value / 100_000).toFixed(2)} L`;
  if (abs >= 10_000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString(IN, { maximumFractionDigits: 1 });
}

/** Format a KPI value in its own unit. null -> "—" (never "0"). */
export function formatUnit(value: number | null | undefined, unit: InsightUnit = "count"): { text: string; suffix: string } {
  if (value === null || value === undefined || !Number.isFinite(value)) return { text: "—", suffix: "" };
  switch (unit) {
    case "percent": return { text: value.toLocaleString(IN, { maximumFractionDigits: 1 }), suffix: "%" };
    case "inr": return { text: `₹${formatCompact(value)}`, suffix: "" };
    case "days": return { text: value.toLocaleString(IN, { maximumFractionDigits: 1 }), suffix: "d" };
    case "hours": return { text: value.toLocaleString(IN, { maximumFractionDigits: 1 }), suffix: "h" };
    case "minutes": return { text: value.toLocaleString(IN, { maximumFractionDigits: 0 }), suffix: "m" };
    case "score": return { text: value.toLocaleString(IN, { maximumFractionDigits: 1 }), suffix: "" };
    default: return { text: formatCompact(value), suffix: "" };
  }
}

export function formatDelta(delta: number | null | undefined, unit: InsightUnit = "count"): string | null {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const { text, suffix } = formatUnit(Math.abs(delta), unit === "percent" ? "percent" : unit);
  return `${sign}${text}${unit === "percent" ? " pp" : suffix}`;
}

export function drillHref(dashboardCode: string, metricCode: string, filters?: Record<string, string>): string {
  const qs = filters && Object.keys(filters).length ? `?${new URLSearchParams(filters).toString()}` : "";
  return `/dashboards/drill/${dashboardCode}/${metricCode}${qs}`;
}
