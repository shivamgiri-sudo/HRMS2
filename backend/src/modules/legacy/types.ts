export interface TableProfile {
  id: string;
  source_db: string;
  schema_name: string;
  table_name: string;
  row_count: number | null;
  last_user_update: Date | null;
  candidate_latest_column: string | null;
  max_candidate_date: Date | null;
  relevance_score: number;
  relevance_reason: string | null;
  scan_status: string;
  scanned_at: Date | null;
  created_at: Date;
}

export interface ColumnProfile {
  id: string;
  source_db: string;
  schema_name: string;
  table_name: string;
  column_name: string;
  data_type: string | null;
  max_length: number | null;
  is_nullable: boolean;
  ordinal_position: number;
  matched_domain: string | null;
  confidence_score: number;
  scanned_at: Date | null;
  created_at: Date;
}

export interface MappingCandidate {
  id: string;
  hrms_domain: string;
  hrms_target_table: string | null;
  hrms_target_column: string | null;
  legacy_schema: string;
  legacy_table: string;
  legacy_column: string | null;
  confidence_score: number;
  mapping_reason: string | null;
  sample_safe_values: string | null;
  approved_status: string;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
}

export interface SyncMap {
  id: string;
  hrms_domain: string;
  source_schema: string;
  source_table: string;
  source_key_column: string;
  source_watermark_column: string | null;
  target_table: string;
  target_key_column: string;
  column_mapping_json: Record<string, string>;
  transform_rules_json: any;
  sync_mode: string;
  sync_order: number;
  active_status: boolean;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SyncCheckpoint {
  id: string;
  sync_map_id: string;
  last_watermark_value: string | null;
  last_source_key: string | null;
  last_ct_version: bigint | null;
  last_success_at: Date | null;
  last_run_status: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SyncRunLog {
  id: string;
  sync_map_id: string;
  run_type: string;
  started_at: Date;
  finished_at: Date | null;
  rows_read: number;
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  rows_failed: number;
  status: string;
  error_message: string | null;
  created_at: Date;
}

export interface SyncException {
  id: string;
  sync_map_id: string;
  sync_run_log_id: string | null;
  exception_type: string;
  source_key: string | null;
  source_data_json: any;
  target_data_json: any;
  error_message: string | null;
  resolved_status: string;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
}

export interface ScanResult {
  tablesFound: number;
  candidateTables: TableProfile[];
  scanDuration: number;
}

export interface AnalysisResult {
  analyzedTables: number;
  mappingSuggestions: MappingCandidate[];
}

export interface RelevanceFactors {
  hasEmployeeColumn: boolean;
  hasDateColumns: boolean;
  hasOrgColumns: boolean;
  recentlyUpdated: boolean;
  hasWatermarkColumn: boolean;
  rowCountReasonable: boolean;
}

export interface LegacyChange {
  SYS_CHANGE_VERSION: bigint;
  SYS_CHANGE_OPERATION: 'I' | 'U' | 'D';
  [key: string]: any;
}

export interface TransformedRecord {
  operation: 'I' | 'U' | 'D';
  source_key: string;
  data: Record<string, any>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface StagingResult {
  staged: number;
}

export interface MergeResult {
  inserted: number;
  updated: number;
}

export interface SyncError {
  syncMapId: string;
  error: Error;
  sourceKey?: string;
  sourceData?: any;
}
