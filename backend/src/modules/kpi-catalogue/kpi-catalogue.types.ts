/**
 * KPI Catalogue types. The catalogue is the single source of truth for which KPIs exist per process, how each is
 * computed, where its data comes from, how fresh it is, and which roles / departments see or manage it.
 */

export type KpiGrain = "employee" | "process" | "both";
export type KpiSourceKind = "dialer_live" | "upload" | "daily_sync" | "studio" | "derived" | "manual";
export type KpiFreshness = "realtime" | "hourly" | "daily" | "upload";
export type KpiFamily = "rate" | "volume" | "duration" | "roi";
export type KpiUnit = "percent" | "count" | "currency" | "seconds" | "ratio" | "minutes" | "hours";
export type KpiDirection = "higher_is_better" | "lower_is_better";
export type CatalogueStatus = "draft" | "published" | "retired";
export type CatalogueAccess = "view" | "manage";

/** Audience presets expand to the role keys and department that see the KPI. */
export type AudiencePreset =
  | "agent" | "team_leader" | "process_manager" | "quality" | "wfm" | "branch" | "head_office" | "trainer" | "admin";

export interface AudienceDef {
  roles: string[];
  department: string;
  access: CatalogueAccess;
}

export interface CatalogueKpiDef {
  metricKey: string;
  name: string;
  theme: string;
  family: KpiFamily;
  unit: KpiUnit;
  direction: KpiDirection;
  grain: KpiGrain;
  sourceKind: KpiSourceKind;
  sourceRef: string;
  formula: string;
  freshness: KpiFreshness;
  dimensions: string[];
  audience: AudiencePreset[];
  /** Real kpi_metric_master.metric_code when one measures this concept. */
  metricCode?: string | null;
  defaultTarget?: number | null;
  /** false = the feed exists but holds no rows today; the page must say "no data", never 0. */
  hasData?: boolean;
  notes?: string;
}

export interface CatalogueProcessDef {
  processKey: string;
  processName: string;
  /** process_master.process_code values (resolved to ids at read time). */
  processCodes: string[];
  kpis: CatalogueKpiDef[];
}

export interface CatalogueRow {
  id: string;
  process_key: string;
  process_name: string;
  metric_key: string;
  metric_name: string;
  metric_code: string | null;
  theme: string;
  family: string;
  unit: string;
  direction: string;
  grain: string;
  source_kind: string;
  source_ref: string | null;
  formula: string | null;
  freshness: string;
  dimensions: string[];
  has_data: boolean;
  target_source: string;
  default_target: number | null;
  status: string;
}

export type ConflictType =
  | "rating_scale_mismatch"
  | "weight_not_normalised"
  | "duplicate_definition"
  | "target_mismatch"
  | "direction_mismatch"
  | "unit_mismatch"
  | "studio_unlinked"
  | "catalogue_without_feed"
  | "legacy_only_metric";

export interface ConflictInput {
  type: ConflictType;
  processKey?: string | null;
  metricKey?: string | null;
  detail: Record<string, unknown>;
}
