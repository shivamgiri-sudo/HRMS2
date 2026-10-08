import type { ElementType } from "react";
import { PulseTile, type InsightKpi, type InsightSeries, type InsightTable, type RoleInsights } from "../../kit";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";

/** Lookups into the role-insights payload. Every one tolerates insights not having loaded yet. */
export const kpiOf = (ins: RoleInsights | undefined, key: string): InsightKpi | undefined => ins?.kpis.find((k) => k.key === key);
export const tableOf = (ins: RoleInsights | undefined, key: string): InsightTable | undefined => ins?.tables.find((t) => t.key === key);
export const seriesOf = (ins: RoleInsights | undefined, key: string): InsightSeries | undefined => ins?.series.find((s) => s.key === key);

/** Text for a hero chip: "…" while loading, "—" when the source gave nothing (never a confident 0). */
export function chipValue(kpi: InsightKpi | undefined, loading: boolean | undefined, suffix = ""): string {
  if (loading && !kpi) return "…";
  if (!kpi || kpi.value === null || kpi.value === undefined) return "—";
  return `${kpi.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}${suffix}`;
}

/** One insight KPI as a clickable tile; skeleton while loading, honest "—" + reason when unavailable. */
export function InsightTile({ data, kpiKey, icon, label, onDrillFallback }: {
  data: ReferenceDashboardData; kpiKey: string; icon?: ElementType; label?: string; onDrillFallback?: () => void;
}) {
  const k = kpiOf(data.insights, kpiKey);
  if (!k) {
    return <PulseTile label={label ?? kpiKey} value={null} icon={icon} tone="slate" loading={data.insightsLoading}
      unavailable={data.insightsLoading ? undefined : data.insightsError ?? "Not reported by the source"} onDrill={onDrillFallback} />;
  }
  return (
    <PulseTile label={label ?? k.label} value={k.value} unit={k.unit} tone={k.tone ?? "blue"} delta={k.delta} deltaLabel={k.deltaLabel} higherIsBetter={k.higherIsBetter ?? true}
      spark={k.spark} helper={k.helper} formula={k.formula} unavailable={k.unavailable} icon={icon} href={k.href}
      onDrill={!k.href && k.drill ? () => data.openDrill?.(k.drill!.metricCode, k.label, k.drill!.filters) : undefined} />
  );
}

