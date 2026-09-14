export type KpiFamily = "operations" | "quality" | "performance" | "custom";

export interface KpiMetric {
  id: string;
  metric_code: string;
  metric_name: string;
  family: KpiFamily;
  category: "operations" | "quality" | "sales" | "hr" | "custom";
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  active_status: number;
  created_at: string;
}

export interface FamilySummaryEntry {
  avg_score: number;
  employees_scored: number;
}

export type FamilySummary = Record<KpiFamily, FamilySummaryEntry>;

export interface KpiTemplate {
  id: string;
  template_name: string;
  description: string | null;
  active_status: number;
  created_at: string;
}

export interface KpiTemplateMetric {
  id: string;
  template_id: string;
  metric_id: string;
  target_value: number;
  weight_pct: number;
  // joined fields
  metric_code?: string;
  metric_name?: string;
  unit?: string;
  direction?: string;
}

export interface KpiAssignment {
  id: string;
  template_id: string;
  designation_id: string | null;
  department_id: string | null;
  employee_id: string | null;
  active_status: number;
  created_at: string;
}

export interface KpiScore {
  id: string;
  employee_id: string;
  metric_id: string;
  period: string;
  actual_value: number;
  source: string;
  created_at: string;
}

export interface KpiMetricSummary {
  metric_id: string;
  metric_code: string;
  target_value: number;
  actual_value: number | null;
  weight_pct: number;
  achievement_pct: number;
  direction: string;
}

export interface KpiSummary {
  employee_id: string;
  template_id: string;
  period: string;
  weighted_score_pct: number;
  rating: "S" | "A" | "B" | "C" | "D";
  metrics: KpiMetricSummary[];
}

export interface LeaderboardEntry {
  employee_id: string;
  employee_code: string;
  full_name: string;
  weighted_score_pct: number;
  rating: string;
}
