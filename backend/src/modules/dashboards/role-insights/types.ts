import type { DashboardScope } from "../../../shared/dashboardScope.js";

/**
 * Wire contract for GET /api/dashboards/:code/insights.
 *
 * Every field is optional-by-section: a provider that cannot compute a section omits it and
 * records why in `sectionErrors`, so the client can tell "nothing to show" from "broke".
 * A value is NEVER fabricated as 0 when the source is empty/unreachable — use null.
 */
export type InsightTone = "blue" | "green" | "amber" | "red" | "violet" | "slate";
export type InsightUnit = "count" | "percent" | "inr" | "days" | "hours" | "minutes" | "score";

/** A pending item a human must act on. `href` MUST be a mounted frontend route. */
export interface InsightAction {
  id: string;
  label: string;
  count: number | null;
  severity: "critical" | "high" | "normal" | "info";
  /** Age in days of the oldest item in the queue (SLA pressure). */
  oldestDays?: number | null;
  /** Items past their SLA / due date. */
  overdue?: number | null;
  href: string;
  hint?: string;
  group?: string;
  /** Why `count` is null (source down / no feed). */
  unavailable?: string | null;
}

export interface InsightKpi {
  key: string;
  label: string;
  value: number | null;
  unit?: InsightUnit;
  /** Change vs previous period, in the KPI's own unit (pp for percent). */
  delta?: number | null;
  deltaLabel?: string;
  /** true when a rising value is good (default true). */
  higherIsBetter?: boolean;
  spark?: number[];
  tone?: InsightTone;
  helper?: string;
  /** Plain-language calculation so the number is auditable. */
  formula?: string;
  href?: string;
  /** Opens the shared drilldown drawer/page for this metric code. */
  drill?: { metricCode: string; filters?: Record<string, string> };
  unavailable?: string | null;
}

export interface InsightPoint { label: string; value?: number | null; [series: string]: string | number | null | undefined }

export interface InsightSeries {
  key: string;
  title: string;
  subtitle?: string;
  kind: "line" | "area" | "bar" | "stacked" | "donut" | "funnel" | "ranked" | "heat";
  /** Series keys for stacked / multi-line. */
  keys?: Array<{ key: string; label: string; tone?: InsightTone }>;
  points: InsightPoint[];
  unit?: InsightUnit;
  href?: string;
  unavailable?: string | null;
}

export interface InsightTable {
  key: string;
  title: string;
  columns: Array<{ key: string; label: string; unit?: InsightUnit; align?: "left" | "right" }>;
  rows: Array<Record<string, string | number | null> & { href?: string }>;
  href?: string;
  unavailable?: string | null;
}

export interface InsightSignal {
  tone: "good" | "bad" | "watch";
  title: string;
  detail: string;
  value?: string | number | null;
  href?: string;
}

export interface RoleInsights {
  dashboardCode: string;
  generatedAt: string;
  scopeLevel: DashboardScope["level"];
  /** 0-100 composite health, only when the provider can justify it; else null. */
  healthScore?: number | null;
  healthBasis?: string | null;
  actions: InsightAction[];
  kpis: InsightKpi[];
  series: InsightSeries[];
  tables: InsightTable[];
  signals: InsightSignal[];
  sectionErrors: Record<string, string>;
  /** Sections still computing in the background; the client polls until this is empty. */
  pending?: string[];
  /** True when this answer is a previous result being refreshed behind the scenes. */
  stale?: boolean;
}

export interface InsightContext {
  scope: DashboardScope;
  userId: string;
  roleKeys: string[];
  /** May see revenue / cost / margin (finance-sensitive) figures. Part of the cache key where it matters. */
  canSeeFinance?: boolean;
  /** IST calendar date, YYYY-MM-DD. */
  today: string;
  branchId?: string;
  processId?: string;
}

/** A provider returns whatever sections it can; the dispatcher merges and isolates failures. */
export type InsightSection = Partial<Pick<RoleInsights, "actions" | "kpis" | "series" | "tables" | "signals" | "healthScore" | "healthBasis">>;
export type InsightSectionFn = (ctx: InsightContext) => Promise<InsightSection>;
export interface InsightProvider {
  /** Independent named sections run in parallel; one failing never blanks the others. */
  sections: Record<string, InsightSectionFn>;
}
