import type { InsightKpi, InsightSeries, InsightTable, RoleInsights } from "../../kit";

export const kpiOf = (i: RoleInsights | undefined, key: string): InsightKpi | undefined => i?.kpis.find((k) => k.key === key);
export const seriesOf = (i: RoleInsights | undefined, key: string): InsightSeries | undefined => i?.series.find((s) => s.key === key);
export const tableOf = (i: RoleInsights | undefined, key: string): InsightTable | undefined => i?.tables.find((t) => t.key === key);
export const kpiValue = (i: RoleInsights | undefined, key: string): number | null => kpiOf(i, key)?.value ?? null;
