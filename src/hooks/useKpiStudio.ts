import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * Data layer for KPI Studio.
 *
 * react-query rather than the useState/useEffect pattern the older Native* KPI pages use: the
 * builder is a write-heavy surface where saving a definition has to invalidate the definition
 * list, the coverage count and the employee's resolved KPIs at once. Doing that by hand across
 * four components is how a stale list ends up showing a definition that was just superseded.
 */

// ─── Types ───────────────────────────────────────────────────────────────────────────────────

export interface StudioCapability {
  /** The Studio tables exist. */
  tables: boolean;
  /** Definitions can drive live scores (migration 1645 applied). */
  resolution: boolean;
}

export interface KpiMetricOption {
  id: string;
  metric_code: string;
  metric_name: string;
  category: string;
  family: string;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  scoring_type: string | null;
  aggregation_method: string | null;
  /** How many daily rows this KPI already has. 0 means nothing feeds it yet. */
  actual_rows: number;
}

export interface ScopeOptions {
  branches: Array<{ id: string; name: string; code: string }>;
  processes: Array<{ id: string; name: string; code: string; branch_id: string | null }>;
  designations: Array<{ id: string; name: string; code: string }>;
}

export interface EmployeeOption {
  id: string;
  employee_code: string;
  full_name: string | null;
  process_name: string | null;
  designation_name: string | null;
}

export interface SourceField {
  id: string;
  field_name: string;
  display_name: string | null;
  source_column: string | null;
  aggregate_fn: string | null;
  source_expression: string | null;
  unit: string | null;
  description: string | null;
}

export interface DataSourceSummary {
  id: string;
  source_code: string;
  source_name: string;
  source_type: "local_query" | "integration_connector" | "upload" | "manual" | "google_sheet_csv";
  integration_key: string | null;
  source_object: string | null;
  employee_key_column: string | null;
  employee_key_kind: string | null;
  date_column: string | null;
  description: string | null;
  field_count: number;
}

export type DataSourceDetail = DataSourceSummary & { fields: SourceField[] };

export interface SourceColumn {
  column_name: string;
  data_type: string;
  is_numeric: boolean;
  is_date: boolean;
}

export interface StudioDefinition {
  id: string;
  metric_id: string;
  metric_code: string;
  metric_name: string;
  unit: string;
  direction: string;
  category: string;
  branch_id: string | null;
  branch_name: string | null;
  process_id: string | null;
  process_name: string | null;
  designation_id: string | null;
  designation_name: string | null;
  employee_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  data_source_id: string | null;
  source_name: string | null;
  source_type: string | null;
  formula_expression: string | null;
  aggregation_method: string | null;
  scoring_type: string | null;
  target_value: string | number | null;
  min_threshold: string | number | null;
  max_achievement: string | number;
  weightage: string | number;
  target_source: string;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  scope_tier: number | null;
  scope_label: string | null;
  /** Sources beyond the primary. Empty for a single-source KPI. */
  extra_sources: Array<{ id: string; source_name: string; source_type: string }>;
}

export interface FormulaValidation {
  ok: boolean;
  error?: string;
  variables: string[];
  functions: string[];
}

export interface DefinitionValidation {
  ok: boolean;
  message?: string;
  variables?: string[];
}

export interface FormulaHelp {
  functions: Array<{ name: string; args: string; description: string }>;
  aggregations: string[];
  notes: string[];
}

export interface PreviewResult {
  ok: boolean;
  message?: string;
  formula: string;
  inputs: Record<string, number | null>;
  value: number | null;
  status: "computed" | "no_data" | "error";
  reason?: string;
  employee?: { id: string; employee_code: string; full_name?: string | null };
  date: string;
  source_error?: string;
}

export interface ComputeOutcome {
  date: string;
  definitions_considered: number;
  employees_considered: number;
  written: number;
  no_data: number;
  errors: number;
  source_failures: Array<{ source_code: string; error: string }>;
  sample: Array<{ employee_code: string; metric_code: string; value: number | null; status: string; reason?: string }>;
}

export interface MetricExplanation {
  metric_code: string;
  metric_name: string;
  days: Array<{
    date: string;
    value: number | null;
    status: string;
    reason: string | null;
    formula: string | null;
    inputs: Record<string, number | null> | null;
  }>;
  reason_summary: Array<{ reason: string; days: number }>;
}

export interface UploadPreview {
  file_name: string;
  headers: string[];
  row_count: number;
  suggested_mapping: Record<string, string | null>;
  fields: string[];
  sample_rows: Array<Record<string, unknown>>;
}

export interface UploadCommitResult {
  batch_id: string;
  total_rows: number;
  accepted_rows: number;
  rejected_rows: number;
  rejections: Array<{ rowNumber: number; employeeCode?: string; reason: string }>;
}

interface Envelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

const KEY = {
  capability: ["kpi-studio", "capability"] as const,
  formulaHelp: ["kpi-studio", "formula-help"] as const,
  metrics: ["kpi-studio", "metrics"] as const,
  scopeOptions: ["kpi-studio", "scope-options"] as const,
  dataSources: ["kpi-studio", "data-sources"] as const,
  dataSource: (id: string) => ["kpi-studio", "data-source", id] as const,
  columns: (id: string) => ["kpi-studio", "columns", id] as const,
  definitions: (filters: Record<string, string | undefined>) => ["kpi-studio", "definitions", filters] as const,
  coverage: (id: string) => ["kpi-studio", "coverage", id] as const,
  employees: (filters: Record<string, string | undefined>) => ["kpi-studio", "employees", filters] as const,
};

function queryString(filters: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

// ─── Reads ───────────────────────────────────────────────────────────────────────────────────

/**
 * Whether the Studio schema is installed.
 *
 * Queried first and cached for the session: production runs SKIP_MIGRATIONS=true, so the tables
 * may legitimately be absent, and the page needs to say so once rather than let every other
 * request fail separately.
 */
export function useStudioCapability() {
  return useQuery({
    queryKey: KEY.capability,
    queryFn: async () => (await hrmsApi.get<Envelope<StudioCapability>>("/api/kpi-studio/capability")).data,
    staleTime: Infinity,
    retry: false,
  });
}

export function useFormulaHelp() {
  return useQuery({
    queryKey: KEY.formulaHelp,
    queryFn: async () => (await hrmsApi.get<Envelope<FormulaHelp>>("/api/kpi-studio/formula-help")).data,
    // The function catalogue is compiled into the backend; it cannot change while the page is open.
    staleTime: Infinity,
  });
}

export function useKpiMetrics() {
  return useQuery({
    queryKey: KEY.metrics,
    queryFn: async () => (await hrmsApi.get<Envelope<KpiMetricOption[]>>("/api/kpi-studio/metrics")).data ?? [],
    staleTime: 60_000,
  });
}

export function useScopeOptions() {
  return useQuery({
    queryKey: KEY.scopeOptions,
    queryFn: async () => (await hrmsApi.get<Envelope<ScopeOptions>>("/api/kpi-studio/scope-options")).data,
    staleTime: 5 * 60_000,
  });
}

export function useDataSources() {
  return useQuery({
    queryKey: KEY.dataSources,
    queryFn: async () => (await hrmsApi.get<Envelope<DataSourceSummary[]>>("/api/kpi-studio/data-sources")).data ?? [],
    staleTime: 60_000,
  });
}

export function useDataSource(id: string | null) {
  return useQuery({
    queryKey: KEY.dataSource(id ?? ""),
    queryFn: async () => (await hrmsApi.get<Envelope<DataSourceDetail>>(`/api/kpi-studio/data-sources/${id}`)).data,
    enabled: Boolean(id),
  });
}

/**
 * Several sources at once, for a KPI whose formula spans systems.
 *
 * One query per source rather than a batch endpoint: they are individually cached under the same keys
 * useDataSource uses, so opening a source in the Data sources tab and using it in the builder share a
 * cache entry instead of fetching twice.
 */
export function useDataSources_ByIds(ids: readonly string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  return useQuery({
    queryKey: ["kpi-studio", "data-sources-batch", unique],
    queryFn: async () => {
      const loaded = await Promise.all(
        unique.map(async (id) => {
          const response = await hrmsApi.get<Envelope<DataSourceDetail>>(`/api/kpi-studio/data-sources/${id}`);
          return response.data;
        }),
      );
      return loaded.filter(Boolean);
    },
    enabled: unique.length > 0,
  });
}

export function useSourceColumns(id: string | null) {
  return useQuery({
    queryKey: KEY.columns(id ?? ""),
    queryFn: async () => (await hrmsApi.get<Envelope<SourceColumn[]>>(`/api/kpi-studio/data-sources/${id}/columns`)).data ?? [],
    enabled: Boolean(id),
    // An unreachable connector returns an empty list rather than an error, so retrying buys nothing.
    retry: false,
  });
}

export function useDefinitions(filters: {
  metric_id?: string;
  branch_id?: string;
  process_id?: string;
  designation_id?: string;
  employee_id?: string;
  as_of?: string;
}) {
  return useQuery({
    queryKey: KEY.definitions(filters),
    queryFn: async () =>
      (await hrmsApi.get<Envelope<StudioDefinition[]>>(`/api/kpi-studio/definitions${queryString(filters)}`)).data ?? [],
    staleTime: 15_000,
  });
}

export function useDefinitionCoverage(id: string | null) {
  return useQuery({
    queryKey: KEY.coverage(id ?? ""),
    queryFn: async () =>
      (await hrmsApi.get<Envelope<{ employee_count: number; sample: EmployeeOption[] }>>(
        `/api/kpi-studio/definitions/${id}/coverage`,
      )).data,
    enabled: Boolean(id),
  });
}

/**
 * Employee search for the picker.
 *
 * Disabled until there is something to search by, mirroring the backend, which returns nothing for
 * an unfiltered request. Listing 1,121 employees is a scroll, not a picker.
 */
export function useEmployeeSearch(filters: {
  search?: string;
  branch_id?: string;
  process_id?: string;
  designation_id?: string;
}) {
  const hasCriteria = Boolean(
    (filters.search && filters.search.trim().length >= 2) ||
      filters.branch_id ||
      filters.process_id ||
      filters.designation_id,
  );
  return useQuery({
    queryKey: KEY.employees(filters),
    queryFn: async () =>
      (await hrmsApi.get<Envelope<EmployeeOption[]>>(`/api/kpi-studio/employees${queryString(filters)}`)).data ?? [],
    enabled: hasCriteria,
    staleTime: 30_000,
  });
}

// ─── Writes ──────────────────────────────────────────────────────────────────────────────────

/**
 * Validates a formula as it is typed.
 *
 * A mutation rather than a query because it is debounced by the caller and its result is
 * transient — caching "is this half-typed expression valid" would only serve stale answers.
 */
export function useValidateFormula() {
  return useMutation({
    mutationFn: async (input: {
      formula: string;
      data_source_id?: string | null;
      /** So a cross-system formula is validated against every field it can actually see. */
      extra_source_ids?: string[];
    }) => (await hrmsApi.post<Envelope<FormulaValidation>>("/api/kpi-studio/validate-formula", input)).data,
  });
}

export function useValidateDefinition() {
  return useMutation({
    mutationFn: async (input: Record<string, unknown>) =>
      (await hrmsApi.post<Envelope<DefinitionValidation>>("/api/kpi-studio/definitions/validate", input)).data,
  });
}

export function usePreviewFormula() {
  return useMutation({
    mutationFn: async (input: {
      formula: string;
      data_source_id: string;
      extra_source_ids?: string[];
      employee_id: string;
      date: string;
    }) => (await hrmsApi.post<Envelope<PreviewResult>>("/api/kpi-studio/preview", input)).data,
  });
}

export function useSaveDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Record<string, unknown>) =>
      (await hrmsApi.post<Envelope<{ id: string; effective_from: string; scope_label: string | null }>>(
        "/api/kpi-studio/definitions",
        input,
      )).data,
    onSuccess: () => {
      // Saving supersedes a row, which changes the list, every coverage count and what employees
      // resolve to. Invalidating the whole namespace is cheaper to reason about than enumerating
      // which keys moved, and these queries are small.
      void queryClient.invalidateQueries({ queryKey: ["kpi-studio"] });
    },
  });
}

export function useRetireDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, effectiveTo }: { id: string; effectiveTo?: string }) =>
      hrmsApi.delete(`/api/kpi-studio/definitions/${id}`, effectiveTo ? { params: { effective_to: effectiveTo } } : undefined),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["kpi-studio"] }),
  });
}

export function useCreateMetric() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      metric_code: string;
      metric_name: string;
      category?: string;
      unit?: string;
      direction?: string;
    }) =>
      (await hrmsApi.post<Envelope<{ id: string; metric_code: string; reactivated: boolean }>>(
        "/api/kpi-studio/metrics",
        input,
      )).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY.metrics }),
  });
}

export function useSaveDataSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Record<string, unknown>) =>
      (await hrmsApi.post<Envelope<{ id: string }>>("/api/kpi-studio/data-sources", input)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY.dataSources }),
  });
}

export function useSaveSourceField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ dataSourceId, ...field }: { dataSourceId: string } & Record<string, unknown>) =>
      (await hrmsApi.post<Envelope<{ id: string }>>(`/api/kpi-studio/data-sources/${dataSourceId}/fields`, field)).data,
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: KEY.dataSource(variables.dataSourceId) });
      void queryClient.invalidateQueries({ queryKey: KEY.dataSources });
    },
  });
}

export function useDeleteSourceField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fieldId }: { fieldId: string; dataSourceId: string }) =>
      hrmsApi.delete(`/api/kpi-studio/fields/${fieldId}`),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: KEY.dataSource(variables.dataSourceId) });
    },
  });
}

export function useComputeKpis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      date: string;
      process_id?: string;
      branch_id?: string;
      employee_ids?: string[];
      dry_run?: boolean;
    }) => (await hrmsApi.post<Envelope<ComputeOutcome>>("/api/kpi-studio/compute", input)).data,
    onSuccess: (_result, variables) => {
      // A real run rewrites kpi_daily_actual, so anything showing a KPI value is now stale. A dry
      // run changed nothing and must not invalidate, or the page would refetch for no reason.
      if (!variables.dry_run) {
        void queryClient.invalidateQueries({ queryKey: ["kpi-studio"] });
        void queryClient.invalidateQueries({ queryKey: ["my-kpi"] });
      }
    },
  });
}

export function useSaveManualValue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      employee_id: string;
      field_name: string;
      value_date: string;
      value: number | null;
      data_source_id?: string | null;
      note?: string;
    }) => hrmsApi.post("/api/kpi-studio/manual-value", input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["kpi-studio"] }),
  });
}

/**
 * Uploads for preview. Uses postForm because multipart bodies cannot go through the JSON helper.
 */
export function useUploadPreview() {
  return useMutation({
    mutationFn: async ({ file, dataSourceId }: { file: File; dataSourceId: string }) => {
      const form = new FormData();
      form.append("file", file);
      form.append("data_source_id", dataSourceId);
      return (await hrmsApi.postForm<Envelope<UploadPreview>>("/api/kpi-studio/upload/preview", form)).data;
    },
  });
}

export function useUploadCommit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      dataSourceId,
      employeeColumn,
      dateColumn,
      columnMapping,
      dryRun,
    }: {
      file: File;
      dataSourceId: string;
      employeeColumn: string;
      dateColumn: string;
      columnMapping: Record<string, string>;
      dryRun?: boolean;
    }) => {
      const form = new FormData();
      form.append("file", file);
      form.append("data_source_id", dataSourceId);
      form.append("employee_column", employeeColumn);
      form.append("date_column", dateColumn);
      form.append("column_mapping", JSON.stringify(columnMapping));
      if (dryRun) form.append("dry_run", "true");
      return (await hrmsApi.postForm<Envelope<UploadCommitResult>>("/api/kpi-studio/upload/commit", form)).data;
    },
    onSuccess: (_result, variables) => {
      if (!variables.dryRun) void queryClient.invalidateQueries({ queryKey: ["kpi-studio"] });
    },
  });
}

/** Day-by-day explanation of one employee's KPI. Backs the drill-down on /my-kpi. */
export function useMetricExplanation(
  employeeId: string | null,
  metricId: string | null,
  range?: { from?: string; to?: string },
) {
  return useQuery({
    queryKey: ["kpi-studio", "explain", employeeId, metricId, range?.from, range?.to],
    queryFn: async () => {
      const query = queryString({ date_from: range?.from, date_to: range?.to });
      const response = await hrmsApi.get<Envelope<MetricExplanation | null>>(
        `/api/kpi-studio/explain/${employeeId}/${metricId}${query}`,
      );
      return { explanation: response.data, message: response.message };
    },
    enabled: Boolean(employeeId && metricId),
    retry: false,
  });
}
