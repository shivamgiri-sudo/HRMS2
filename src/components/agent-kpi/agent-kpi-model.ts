import { hrmsApi } from "@/lib/hrmsApi";

export type PeriodTotals = {
  handled: number;
  within_20s: number;
  sl_pct: number | null;
  aht_s: number | null;
  talk_s: number;
  avg_hold_s: number | null;
  avg_acw_s: number | null;
  login_s: number | null;
  first_login: string | null;
  days_worked: number;
};

export type QueueTotals = { offered: number; answered: number; abandoned: number; abandon_pct: number | null };
export type QueueBlock = { total: QueueTotals; byCampaign: Array<QueueTotals & { campaign: string }> };

/** An agent's acknowledgement of one audit's feedback (insert-only record). */
export type AckInfo = { acknowledged_at: string; comment: string | null; acknowledged_by_user_id: string };

export type AuditRef = {
  audit_id: number; cq_pct: number | null; feedback: string | null; recording_url: string | null; scenario: string | null;
  acknowledgement?: AckInfo | null;
};

export type FeedbackAckSummary = {
  available: boolean; can_acknowledge: boolean; with_feedback: number; acknowledged: number; pending: number;
};

export type CdrCall = {
  id: number;
  date: string;
  time: string;
  campaign: string;
  phone_masked: string;
  disposition: string | null;
  disconnected_by: string | null;
  queue_s: number | null;
  talk_s: number | null;
  hold_s: number | null;
  acw_s: number | null;
  duration_s: number | null;
  within_20s: boolean;
  audit: AuditRef | null;
};

export type MyKpiData = {
  date: string;
  month_start: string;
  previous_date: string | null;
  generated_at: string;
  header: { masid: string; name: string | null; process: string | null; team: string | null; team_leader: string | null; designation: string | null };
  today: PeriodTotals;
  mtd: PeriodTotals;
  previous: PeriodTotals | null;
  team_today: { sl_pct: number | null; aht_s: number | null };
  queue_today: QueueBlock;
  queue_mtd: QueueBlock;
  hourly: Array<{ hour: number; handled: number; within_20s: number; sl_pct: number | null; aht_s: number | null }>;
  weekly: Array<{ week: number; from: string; to: string; handled: number; within_20s: number; sl_pct: number | null; aht_s: number | null }>;
  campaign_mix: Array<{ campaign: string; calls: number }>;
  recent_calls: CdrCall[];
  recent_feedback: Array<{
    audit_id: number; at: string; campaign: string | null; scenario: string | null; cq_pct: number | null; feedback: string | null;
    acknowledgement?: AckInfo | null;
  }>;
  feedback_ack?: FeedbackAckSummary;
};

export type CqScore = {
  total_calls: number;
  fatal_calls: number;
  cq_score_current: number;
  cq_score_7day_avg: number;
  cq_score_30day_avg: number;
  rank: { position: number; total_agents: number };
  peer_avg: number;
  target: number;
  status: "On Track" | "Below Target" | "Risk";
  band: "TQ" | "MQ" | "BQ" | null;
};

/** The inbound QA scorecard's 5 score components, in the audit site's order and colours. */
export const QUALITY_COMPONENTS = ["Opening Skill", "Soft Skill", "Hold Procedure", "Resolution", "Closing"] as const;
export const COMPONENT_COLORS: Record<string, string> = {
  "Opening Skill": "#0EA5E9",
  "Soft Skill": "#8B5CF6",
  "Hold Procedure": "#F59E0B",
  Resolution: "#14B8A6",
  Closing: "#EC4899",
};

export type ParameterScore = {
  key: string;
  label: string;
  group: string;
  is_fatal_component: boolean;
  score: number | null;
  peer_avg: number | null;
  graded_calls: number;
  failed_calls: number;
  tip: string | null;
};

export type WeaknessData = {
  audited_calls: number;
  weakness_areas: Array<{ category: string; score: number | null; peer_avg: number | null; gap: number | null }>;
  parameters: ParameterScore[];
};

export type CallsFilter = { from: string; to: string; hour?: number; campaign?: string; sl?: "in" | "out"; sort?: "time" | "duration" };

export type TrendMetric = "offered" | "answered" | "sl" | "abandoned" | "aht" | "login" | "quality";

export const TREND_TITLES: Record<TrendMetric, string> = {
  offered: "Calls Offered — date-wise",
  abandoned: "Total Abandoned — date-wise",
  answered: "Calls Answered — date-wise",
  sl: "Answered within 20 Sec — date-wise",
  aht: "AHT — date-wise",
  login: "Login Hours — date-wise",
  quality: "Quality Score — date-wise",
};

export type DailyRow = {
  date: string;
  handled: number;
  within_20s: number;
  sl_pct: number | null;
  aht_s: number | null;
  talk_s: number;
  avg_hold_s: number | null;
  avg_acw_s: number | null;
  queue_offered: number;
  queue_answered: number;
  queue_abandoned: number;
  queue_abandon_pct: number | null;
  login_s: number | null;
  first_login: string | null;
  audits: number;
  cq_pct: number | null;
  fatal_calls: number;
};

export type DrawerSpec =
  | { kind: "trend"; metric: TrendMetric; from: string; to: string }
  | { kind: "calls"; title: string; filter: CallsFilter }
  | { kind: "call"; id: number }
  | { kind: "audit"; auditId: number }
  | { kind: "login"; from: string; to: string }
  | { kind: "queue"; from: string; to: string; title: string }
  | { kind: "quality" }
  | { kind: "feedback" };

export async function getData<T>(path: string): Promise<T> {
  const res = await hrmsApi.get<{ success: boolean; data: T }>(path);
  return res.data;
}

export function withAgent(path: string, agentCode?: string): string {
  if (!agentCode) return path;
  return `${path}${path.includes("?") ? "&" : "?"}agentCode=${encodeURIComponent(agentCode)}`;
}

export function fmtDuration(s: number | null | undefined, withHours = false): string {
  if (s === null || s === undefined || Number.isNaN(Number(s))) return "—";
  const total = Math.max(0, Math.round(Number(s)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  return h > 0 || withHours ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function fmtHoursMinutes(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  const total = Math.round(Number(s) / 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: digits })}%`;

export const fmtNum = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("en-IN");

/** DD/MM/YYYY and DD/MM/YYYY HH:mm, per the platform display rule. */
export function fmtDate(iso: string | null | undefined, time?: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  const base = `${d}/${m}/${y}`;
  const t = time ?? (iso.length > 10 ? iso.slice(11, 16) : null);
  return t ? `${base} ${t.slice(0, 5)}` : base;
}

/** Change vs a previous value, as a signed % (null when there is nothing to compare). */
export function changePct(curr: number | null | undefined, prev: number | null | undefined): number | null {
  if (curr === null || curr === undefined || prev === null || prev === undefined || prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

/** Feedback tone from the audited call's CQ% — labelled in the UI as derived from CQ, not sentiment analysis. */
export function toneForCq(cq: number | null): "positive" | "neutral" | "negative" | "unknown" {
  if (cq === null) return "unknown";
  if (cq >= 90) return "positive";
  if (cq >= 70) return "neutral";
  return "negative";
}

export function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
