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
  /**
   * Session id, matched against portal_user_sessions.jti so a single token can be revoked
   * without deactivating the whole account.
   *
   * Optional because tokens issued before session tracking existed do not carry one, and they
   * stay valid until they expire. Their absence means "no session row to check", not "revoked" -
   * treating them as revoked would sign out every client currently holding a 7-day token.
   */
  jti?: string;
}

export interface ProcessCard {
  process_id: string;
  process_name: string;
  client_name: string;
  // "no_data" means no headline metric on this process has a real reading from
  // ANY pipeline -- not "green", which is what an unconfigured process used to
  // default to (see portal.overview.service.ts's fix history).
  rag: PortalRag;
  headline_metrics: HeadlineMetric[];
  last_updated: string | null;
}

export interface HeadlineMetric {
  metric_code: string;
  metric_name: string;
  unit: string;
  actual: number | null;
  target: number;
  achievement_pct: number | null;
  rag: PortalRag;
}

export interface KpiScorecard {
  metric_id: string;
  metric_code: string;
  metric_name: string;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  target: number;
  actual: number | null;
  // null, not 0, when the metric has no real reading -- a fabricated 0% read as
  // "failing badly" to a client, indistinguishable from genuinely poor
  // performance. See rag: "no_data" on the same row.
  achievement_pct: number | null;
  rag: PortalRag;
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

/**
 * `paths` empty means two different things the UI must not conflate:
 * everything genuinely within target (real excellence), or no KPI metric was
 * ever configured for this process at all. `hasConfiguredMetrics` is what lets
 * the empty state tell them apart instead of always claiming "excellence".
 */
export interface GlidePathsResult {
  hasConfiguredMetrics: boolean;
  paths: GlidePath[];
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

export type PortalRag = "green" | "amber" | "red" | "no_data";

export interface SparklinePoint {
  period: string;
  value: number;
}

export interface PortalKpiMetric {
  metric_code: string;
  metric_name: string;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  target: number;
  target_source: string | null;
  actual: number | null;
  achievement_pct: number | null;
  rag: PortalRag;
  description: string | null;
  no_data_reason: string | null;
  numerator: number | null;
  denominator: number | null;
  delta_vs_previous: number | null;
  improved: boolean | null;
  sparkline: SparklinePoint[];
}
