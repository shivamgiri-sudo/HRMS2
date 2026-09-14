export interface IntegrationConfig {
  id: string;
  integration_key: string;
  integration_name: string;
  integration_type: string;
  vendor_name: string | null;
  base_url: string | null;
  auth_type: string | null;
  secret_name: string | null;
  config_json: Record<string, unknown> | null;
  active_status: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationConnectorRun {
  id: string;
  integration_key: string;
  triggered_by: string;
  triggered_user: string | null;
  status: string;
  rows_fetched: number;
  rows_staged: number;
  rows_promoted: number;
  rows_failed: number;
  duration_ms: number | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface IntegrationFieldMap {
  id: string;
  integration_key: string;
  source_table: string;
  source_field: string;
  target_table: string;
  target_column: string;
  transform: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  active_status: number;
  created_at: string;
}

export interface IntegrationTableMap {
  id: string;
  integration_key: string;
  source_table: string;
  target_table: string;
  sync_mode: "daily_aggregate";
  active_status: number;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationFieldMapSuggestion {
  id: string;
  integration_key: string;
  source_table: string;
  source_field: string;
  suggested_table: string | null;
  suggested_column: string | null;
  confidence_score: number;
  status: string;
  created_at: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface IntegrationListFilters {
  activeStatus?: "active" | "inactive" | "all";
}

export interface IntegrationSchedule {
  id: string;
  integration_key: string;
  cron_expression: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
}
