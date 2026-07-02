export interface ClientUser {
  id: string;
  client_id: string;
  email: string;
  name: string;
  designation: string | null;
  process_ids: string[];
  is_active: number;
  created_at: string;
}

export interface PortalTokenPayload {
  clientUserId: string;
  clientId: string;
  processIds: string[];
  role: "client";
}

export interface ProcessCard {
  process_id: string;
  process_name: string;
  client_name: string;
  rag: "green" | "amber" | "red";
  headline_metrics: HeadlineMetric[];
  last_updated: string | null;
}

export interface HeadlineMetric {
  metric_code: string;
  metric_name: string;
  unit: string;
  actual: number | null;
  target: number;
  achievement_pct: number;
  rag: "green" | "amber" | "red";
}

export interface KpiScorecard {
  metric_id: string;
  metric_code: string;
  metric_name: string;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  target: number;
  actual: number | null;
  achievement_pct: number;
  rag: "green" | "amber" | "red";
  sparkline: Array<{ period: string; value: number }>;
}

export interface GlidePoint {
  month: string;
  actual: number | null;
  committed: number | null;
  target: number;
}

export interface GlidePath {
  metric_id: string;
  metric_code: string;
  metric_name: string;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  target: number;
  points: GlidePoint[];
  behind_commitment: boolean;
}

export interface ActionPlanItem {
  id: string;
  process_id: string;
  metric_id: string;
  metric_code: string;
  metric_name: string;
  action_text: string;
  owner_level: "analyst" | "tl" | "process_manager" | "branch_head";
  owner_name: string;
  due_date: string;
  status: "planned" | "in_progress" | "done" | "delayed";
}

export interface GovernanceActivity {
  activity_id: string;
  activity_name: string;
  level: "analyst" | "tl" | "process_manager" | "branch_head";
  frequency: "daily" | "weekly" | "monthly";
  required_count: number;
  completed_count: number;
  completion_pct: number;
  rag: "green" | "amber" | "red";
}

export interface AttritionData {
  period: string;
  attrition_pct: number;
  voluntary_count: number;
  involuntary_count: number;
  headcount: number;
  sanctioned_strength: number;
  open_positions: number;
  avg_tenure_months: number;
  top_exit_reasons: Array<{ reason: string; count: number }>;
}

export interface Commentary {
  id: string;
  process_id: string;
  period: string;
  author_name: string;
  author_designation: string;
  body: string;
  published_at: string;
  acknowledged_at: string | null;
  acknowledged_by_client_user_id: string | null;
  replies: CommentaryReply[];
}

export interface CommentaryReply {
  id: string;
  replied_by_client_user_id: string;
  reply_text: string;
  created_at: string;
}
