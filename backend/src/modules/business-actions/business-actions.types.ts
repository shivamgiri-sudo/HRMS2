export type BusinessActionSeverity = "critical" | "high" | "medium" | "low";
export type BusinessActionStatus = "open" | "in_progress" | "blocked" | "escalated" | "completed" | "cancelled" | "overdue";

export const BUSINESS_ACTION_SOURCE_MODULES = [
  "people_experience",
  "support",
  "grievance",
  "attendance",
  "roster",
  "payroll",
  "quality",
  "operations",
  "client",
  "revenue",
  "security",
  "cosec",
  "manual",
] as const;

export const BUSINESS_ACTION_RISK_TYPES = [
  "people_risk",
  "sla_breach",
  "grievance_risk",
  "roster_shortage",
  "attendance_gap",
  "payroll_readiness",
  "quality_fatal",
  "revenue_leakage",
  "client_escalation",
  "security_risk",
  "data_sync_issue",
  "manual_follow_up",
] as const;

export interface BusinessActionInput {
  source_module?: string;
  source_id?: string | null;
  risk_type: string;
  severity?: BusinessActionSeverity;
  title: string;
  description?: string | null;
  owner_user_id?: string | null;
  owner_role?: string | null;
  due_date?: string | null;
  status?: BusinessActionStatus;
}

export interface BusinessActionCommentInput {
  comment_text: string;
  is_internal?: boolean;
}
