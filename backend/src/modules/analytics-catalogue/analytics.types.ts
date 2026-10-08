/** Shared vocabulary of the analytics catalogue. Every enum is a const array so routes, compiler and UI agree. */

export const FIELD_ROLES = ["dimension", "measure", "time"] as const;
export const DATA_TYPES = ["string", "number", "date", "datetime", "boolean"] as const;
export const AGGS = ["sum", "avg", "min", "max", "count", "count_distinct"] as const;
export const GRAINS = ["hour", "day", "week", "month", "quarter", "year", "weekday"] as const;
export const OPS = ["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "between", "contains", "starts_with", "is_null", "not_null"] as const;
export const SCOPE_MODES = ["process_branch", "process", "branch", "employee", "constant", "org"] as const;
export const DATE_PRESETS = ["today", "yesterday", "last_7", "last_30", "last_90", "this_week", "this_month", "last_month", "this_quarter", "this_year", "all", "custom"] as const;
export const FORMATS = ["number", "integer", "percent", "currency", "duration", "text", "date"] as const;
export const LOOKUPS = ["none", "process", "branch", "employee", "metric", "metric_code"] as const;

export type FieldRole = (typeof FIELD_ROLES)[number];
export type DataType = (typeof DATA_TYPES)[number];
export type Agg = (typeof AGGS)[number];
export type Grain = (typeof GRAINS)[number];
export type Op = (typeof OPS)[number];
export type ScopeMode = (typeof SCOPE_MODES)[number];
export type DatePreset = (typeof DATE_PRESETS)[number];
export type FieldFormat = (typeof FORMATS)[number];
export type Lookup = (typeof LOOKUPS)[number];

export interface DatasetField {
  fieldKey: string; label: string; columnName: string; role: FieldRole; dataType: DataType;
  defaultAgg: Agg; format: FieldFormat; lookup: Lookup; description: string | null; sortOrder: number; hidden: boolean;
}

export interface Dataset {
  id: string; code: string; name: string; description: string | null; category: string | null;
  /** "hrms" (mas_hrms) or a NAMED_POOLS key. */
  connection: string; sourceTable: string; timeField: string | null; scopeMode: ScopeMode;
  processColumn: string | null; branchColumn: string | null; employeeColumn: string | null; scopeProcessId: string | null;
  maxRows: number; fields: DatasetField[];
}

export interface DateRangeSpec { preset: DatePreset; from?: string; to?: string }
export interface QuerySpec {
  dataset: string;
  dimensions: Array<{ field: string; grain?: Grain }>;
  measures: Array<{ field?: string; agg?: Agg; alias?: string }>;
  filters?: Array<{ field: string; op: Op; value?: unknown }>;
  dateRange?: DateRangeSpec;
  compare?: "previous_period" | "previous_year";
  scope?: { branchIds?: string[]; processIds?: string[] };
  sort?: Array<{ key: string; dir: "asc" | "desc" }>;
  limit?: number;
}

export interface ResultColumn { key: string; label: string; kind: "dimension" | "measure"; format: FieldFormat; dataType: DataType; grain?: Grain }
export interface QueryResult {
  columns: ResultColumn[];
  rows: Array<Record<string, string | number | null>>;
  truncated: boolean;
  range: { from: string; to: string } | null;
  compare?: { range: { from: string; to: string }; totals: Record<string, number | null> };
  totals: Record<string, number | null>;
  generatedAt: string;
}

/** A SQL fragment that restricts rows to what the viewer may read. */
export interface ScopeClause { sql: string; params: unknown[]; joins: string[] }

export class AnalyticsError extends Error {
  constructor(message: string, public readonly code: "INVALID_QUERY" | "NOT_FOUND" | "FORBIDDEN" | "INVALID_DATASET" = "INVALID_QUERY") { super(message); }
}
