// ─── Date helpers ──────────────────────────────────────────────────────────────

export const today = (): string => new Date().toISOString().slice(0, 10);
export const firstOfMonth = (): string => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

// ─── Data interfaces ───────────────────────────────────────────────────────────

export interface QDSummary {
  total_calls: number;
  audited_calls: number;
  avg_quality_score: number;
  calls_above_80: number;
  calls_below_50: number;
  unique_agents: number;
  unique_clients: number;
  fraud_flags: number;
  fail_rate_call_open: number;
  fail_rate_professionalism: number;
  fail_rate_active_listening: number;
  fail_rate_call_closure: number;
  fail_rate_accuracy: number;
  scope_label?: string;
  calls_60_80?: number;
  calls_50_60?: number;
}

export interface TrendPoint {
  date: string;
  total_calls: number;
  avg_score: number;
  above_80: number;
  below_50: number;
}

export interface AgentRow {
  agent_name: string;
  agent_code?: string;
  total_calls: number;
  avg_score: number;
  calls_above_80: number;
  calls_below_50: number;
  band: string;
}

export interface ClientRow {
  client_id: string;
  client_name?: string | null;
  total_calls: number;
  avg_score: number;
  agent_count: number;
}

export interface FraudSignals {
  data_theft: number;
  financial_fraud: number;
  collusion: number;
  escalation_failure: number;
  unprofessional: number;
  system_manipulation: number;
}

export interface HeatmapCell {
  score: number;
  calls: number;
  critical: number;
}

export interface AgentRisk {
  agent_name: string;
  agent_code?: string;
  total_calls: number;
  overall_avg: number;
  week_avg: number;
  yesterday_avg: number;
  volatility: number;
  critical_count: number;
  trend_delta: number;
  risk_status: string;
  recommended_action: string;
}

export interface Insight {
  type: "success" | "warning" | "critical" | "opportunity";
  title: string;
  message: string;
  metric?: number;
  action?: string;
}

export interface RoiProjection {
  improvement: number;
  label: string;
  current_quality: number;
  projected_quality: number;
  current_conversion: string;
  projected_conversion: string;
  additional_sales: number;
  additional_revenue: number;
  roi_multiple: string;
}

export interface RoiData {
  current_metrics: {
    quality: number;
    conversion: number;
    total_calls: number;
    total_sales: number;
  };
  projections: RoiProjection[];
}

export interface SalesSummary {
  total_calls: number;
  sales_done: number;
  competitor_mentions: number;
  objection_calls: number;
}

export interface Competitor {
  CompetitorName: string;
  mentions: number;
}

export interface SalesFunnel {
  total_calls: number;
  opening_done: number;
  offer_made: number;
  objection_handled: number;
  sale_done: number;
}

export interface RejectionFunnel {
  total_calls: number;
  not_interested: number;
  objection_raised: number;
  rejected_after_offer: number;
  offering_rejected: number;
  opening_rejected: number;
}

export interface RejectionReason {
  reason: string;
  count: number;
}

// ─── RISK_MAP ──────────────────────────────────────────────────────────────────

export const RISK_MAP: Record<string, { label: string; cls: string }> = {
  declining_fast:    { label: "Declining Fast",    cls: "bg-red-100 text-red-700 border-red-200" },
  declining:         { label: "Declining",          cls: "bg-orange-100 text-orange-700 border-orange-200" },
  improving:         { label: "Improving",          cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  unstable:          { label: "Unstable",           cls: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  consistently_poor: { label: "Consistently Poor", cls: "bg-red-100 text-red-700 border-red-200" },
  top_performer:     { label: "Top Performer",      cls: "bg-blue-100 text-blue-700 border-blue-200" },
  stable:            { label: "Stable",             cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

// ─── Pure helpers ──────────────────────────────────────────────────────────────

export function scoreIntent(score: number): "good" | "warning" | "critical" | "neutral" {
  if (score >= 80) return "good";
  if (score >= 65) return "warning";
  if (score >= 0)  return "critical";
  return "neutral";
}

export function clientLabel(c: { client_name?: string | null; client_id: string }): string {
  return c.client_name?.trim() ? c.client_name : `Client #${c.client_id}`;
}

export function safeNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
