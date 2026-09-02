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

/**
 * RAG for the client-portal KPI engine (portal.kpi-engine.service.ts). A 4th state relative to the
 * plain "green" | "amber" | "red" used above: `no_data` is a first-class result, not an absence of
 * one — computeRag() there returns it explicitly rather than collapsing a missing month into red.
 */
export type PortalRag = "green" | "amber" | "red" | "no_data";

/** One point on a metric's trend chart. Omitted entirely for a month with no value, rather than a
 *  zero, so a data gap does not read as a collapse in performance. */
export interface SparklinePoint {
  period: string;
  value: number;
}

/** One client-visible KPI for a process/period, as computed by portal.kpi-engine.service.ts. */
export interface PortalKpiMetric {
  metric_code: string;
  metric_name: string;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  target: number;
  /** Where target came from: an agreed process-specific SLA, the portal's own default, or the
   *  engine's last-resort fallback (used only if migration 1647 has not been applied). */
  target_source: "process_specific" | "portal_default" | "engine_fallback";
  actual: number | null;
  achievement_pct: number | null;
  rag: PortalRag;
  description: string | null;
  /** Set only when actual is null — states WHY, so a client sees "not captured this month"
   *  rather than a bare blank. */
  no_data_reason: string | null;
  numerator: number | null;
  denominator: number | null;
  /** Month-on-month movement vs the last month that actually has a value, not literally last
   *  month, so a data gap does not read as a change. */
  delta_vs_previous: number | null;
  /** Direction-aware: null when there is nothing to compare or no movement, otherwise whether
   *  the movement was an improvement for THIS metric's own direction. */
  improved: boolean | null;
  sparkline: SparklinePoint[];
}
