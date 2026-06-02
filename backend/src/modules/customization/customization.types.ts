// =============================================================================
// Customization System Types
// =============================================================================

export interface CustomizationDimension {
  id: string;
  dimension_key: string;
  dimension_name: string;
  description?: string;
  is_active: number;
  priority: number;
  created_at: Date;
}

export interface CustomizationRule {
  id: string;
  rule_name: string;
  entity_type: string;
  entity_id?: string;

  // Dimension filters
  branch_ids?: string[];
  process_ids?: string[];
  department_ids?: string[];
  designation_ids?: string[];
  role_ids?: string[];
  employee_ids?: string[];

  // Config
  config_type: 'override' | 'merge' | 'extend' | 'disable';
  config_data: Record<string, any>;

  // Metadata
  priority: number;
  is_active: number;
  effective_from?: string;
  effective_to?: string;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CustomizationContext {
  employeeId: string;
  branchId?: string;
  processId?: string;
  departmentId?: string;
  designationId?: string;
  roleId?: string;
}

export interface CustomizationApplicationLog {
  id: string;
  rule_id: string;
  employee_id: string;
  entity_type: string;
  entity_id?: string;

  // Context at application time
  branch_id?: string;
  process_id?: string;
  department_id?: string;
  designation_id?: string;
  role_id?: string;

  applied_config: Record<string, any>;
  application_source?: string;
  applied_at: Date;
}

export interface CustomizationCache {
  id: string;
  cache_key: string;
  employee_id: string;
  entity_type: string;
  entity_id?: string;
  effective_config: Record<string, any>;
  cached_at: Date;
  expires_at: Date;
  hit_count: number;
}

export interface EffectiveConfigResult {
  config: Record<string, any>;
  appliedRules: string[];
  cached: boolean;
}


export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
