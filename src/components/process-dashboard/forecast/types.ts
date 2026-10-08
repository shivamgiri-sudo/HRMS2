/** Shapes of GET /api/process-dashboard/:id/forecast. Mirrors backend/src/modules/process-dashboard/forecast/fc.engine.ts. */
export type ForecastStatus = "on_track" | "at_risk" | "off_track" | "nodata" | "no_target";
export interface PathPoint { date: string; actual: number | null; projected: number | null; low: number | null; high: number | null }
export interface ForecastKpi {
  key: string; label: string; unit: string; direction: "higher" | "lower"; kind: "additive" | "rate";
  mtd: number | null; projected: number | null; band: { low: number; high: number; level: number } | null;
  target: number | null; pacingPct: number | null; status: ForecastStatus; requiredDailyRate: number | null;
  daysElapsed: number; daysRemaining: number; method: string; reason?: string;
  expectedDaily: number | null; partial: { date: string; value: number | null } | null;
  pathKind?: "cumulative" | "daily"; path?: PathPoint[];
}
export interface ForecastTl { tl: string; agents: number; kpis: ForecastKpi[] }
export interface ForecastResponse {
  month: string; range: { from: string; to: string }; asOf: string | null; today: string; partialDay: string | null; stale: boolean;
  filters: { tl?: string; lob?: string }; rankMetric: string;
  calendar: { basis: "observed" | "weekday-only"; workingWeekdays: number[]; holidaysHonoured: boolean; holidays: string[]; workingDays: { elapsed: number; remaining: number; total: number }; note: string };
  method: { bandLevel: number; lookbackDays: number; additive: string; rate: string; targets: string };
  kpis: ForecastKpi[]; byTl: ForecastTl[]; warnings: string[];
}
