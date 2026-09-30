/** Shared types of Dashboard Studio. Mirrors backend/src/modules/analytics-catalogue/analytics.types.ts. */

export type Format = "number" | "integer" | "percent" | "currency" | "duration" | "text" | "date";
export type Agg = "sum" | "avg" | "min" | "max" | "count" | "count_distinct";
export type Grain = "hour" | "day" | "week" | "month" | "quarter" | "year" | "weekday";
export type Op = "eq" | "neq" | "in" | "not_in" | "gt" | "gte" | "lt" | "lte" | "between" | "contains" | "starts_with" | "is_null" | "not_null";
export type DatePreset = "today" | "yesterday" | "last_7" | "last_30" | "last_90" | "this_week" | "this_month" | "last_month" | "this_quarter" | "this_year" | "all" | "custom";

export interface DsField {
  fieldKey: string; label: string; role: "dimension" | "measure" | "time";
  dataType: "string" | "number" | "date" | "datetime" | "boolean"; defaultAgg: Agg; format: Format; description: string | null;
}
export interface DatasetDef {
  code: string; name: string; description: string | null; category: string | null; timeField: string | null;
  scopeMode: string; maxRows: number; fields: DsField[];
}

export interface DateRangeSpec { preset: DatePreset; from?: string; to?: string }
export interface FilterSpec { field: string; op: Op; value?: unknown }
export interface QuerySpec {
  dataset: string;
  dimensions: Array<{ field: string; grain?: Grain }>;
  measures: Array<{ field?: string; agg?: Agg; alias?: string }>;
  filters?: FilterSpec[];
  dateRange?: DateRangeSpec;
  compare?: "previous_period" | "previous_year";
  scope?: { branchIds?: string[]; processIds?: string[] };
  sort?: Array<{ key: string; dir: "asc" | "desc" }>;
  limit?: number;
}

export type Cell = string | number | null;
export interface ResultColumn { key: string; label: string; kind: "dimension" | "measure"; format: Format; dataType: string; grain?: Grain }
export interface QueryResult {
  columns: ResultColumn[]; rows: Array<Record<string, Cell>>; truncated: boolean;
  range: { from: string; to: string } | null;
  compare?: { range: { from: string; to: string }; totals: Record<string, number | null> };
  totals: Record<string, number | null>; generatedAt: string;
}

export interface Threshold { value: number; color: string }
/** Everything a user can style on a widget. Every key is optional; each chart reads the ones that apply to it. */
export interface VizStyle {
  palette?: string; colors?: string[];
  legend?: "none" | "top" | "bottom" | "right"; dataLabels?: boolean; grid?: boolean;
  xTitle?: string; yTitle?: string; curve?: "linear" | "smooth" | "step"; dots?: boolean;
  decimals?: number; prefix?: string; suffix?: string; compact?: boolean;
  topN?: number; thresholds?: Threshold[];
  target?: number; min?: number; max?: number; higherIsBetter?: boolean; sparkline?: boolean;
  align?: "left" | "center"; card?: "plain" | "bordered" | "shadow" | "tinted"; fontScale?: number;
  text?: string; pageSize?: number; showTotals?: boolean;
  /** Keep this widget's own date range even when the dashboard filter bar sets one. */
  pinDate?: boolean;
}

export interface GridPos { x: number; y: number; w: number; h: number }
export interface Widget {
  id: string; widgetType: string; title: string | null; subtitle: string | null;
  query: QuerySpec | null; viz: VizStyle; layout: { lg?: GridPos; md?: GridPos; sm?: GridPos };
}

export interface DashboardSettings {
  dateRange?: DateRangeSpec; branchIds?: string[]; processIds?: string[];
  /** Extra filter-bar fields, applied to every widget whose dataset has that field key. */
  filterFields?: Array<{ field: string; label: string }>;
  autoRefreshSec?: number; crossFilter?: boolean;
}
export interface DashboardMeta {
  id: string; name: string; description: string | null; theme: string; ownerUserId: string; ownerName: string | null;
  isOwner: boolean; canEdit: boolean; isTemplate: boolean; widgetCount?: number;
  homeBranchId: string | null; homeProcessId: string | null; updatedAt: string; settings?: DashboardSettings; version?: number;
}
export interface Share { principalType: "role" | "branch" | "process" | "user"; principalValue: string; permission: "view" | "edit" }
export interface DashboardDetail { dashboard: DashboardMeta & { settings: DashboardSettings; version: number }; widgets: Widget[]; shares: Share[]; canEdit: boolean }

export interface Theme {
  key: string; label: string; canvas: string; card: string; border: string; text: string; muted: string; grid: string; accent: string; dark: boolean;
}
/** What every visualisation receives. */
export interface VizProps {
  result: QueryResult; style: VizStyle; theme: Theme; colors: string[];
  /** Click-to-filter: the dimension column key and the raw value that was clicked. */
  onSelect?: (columnKey: string, value: Cell) => void;
}
