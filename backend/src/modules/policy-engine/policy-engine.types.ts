export type ConfigValueType =
  | 'integer'
  | 'decimal'
  | 'percentage'
  | 'string'
  | 'boolean'
  | 'json_array'
  | 'json_object';

export interface ConfigItem {
  config_key: string;
  label: string;
  description: string | null;
  value_type: ConfigValueType;
  current_value: string;
  default_value: string;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  is_readonly: boolean;
  effective_from: string;
  updated_at: string;
  updated_by: string | null;
}

export interface PolicySection {
  section_key: string;
  section_label: string;
  configs: ConfigItem[];
}

export interface PolicyDomain {
  domain_key: string;
  label: string;
  description: string;
  icon: string;
  is_editable: boolean;
  sections: PolicySection[];
}

export interface DomainSummary {
  domain_key: string;
  label: string;
  description: string;
  icon: string;
  is_editable: boolean;
  section_count: number;
  config_count: number;
}

export interface HistoryEntry {
  id: string;
  domain_key: string;
  section_key: string;
  config_key: string;
  old_value: string | null;
  new_value: string;
  reason: string | null;
  changed_by: string | null;
  actor_name: string | null;
  changed_at: string;
}

export interface WeekoffSlab {
  from: number;
  to: number;
  max_weekoffs: number;
}

export interface PolicyUpdateItem {
  section_key: string;
  config_key: string;
  new_value: string;
}

export interface PolicyUpdatePayload {
  reason: string;
  updates: PolicyUpdateItem[];
}
