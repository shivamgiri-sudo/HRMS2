/** Types and formatting helpers shared by LpCallDashboard and LpCallDrawer.
 * Shapes mirror backend/src/modules/process-performance/lp-call-dashboard.shared.ts. */

export interface Headline {
  loginCount: number; overallCalls: number; uniqueLeadset: number;
  uniqueConnectedCalls: number; uniqueConnectivityPct: number;
  overallConnected: number; overallConnectedPct: number;
  shrinkagePct: number; avgLeadPerAgent: number; perAgentDialCount: number;
  avgTalkTimeSec: number; occupancyPct: number;
  avgAttemptsPerLead: number; firstCallConnectedPct: number; avgTalkPerConnectedSec: number;
  callBackPct: number; activeDays: number;
}
export interface ServiceRow { service: string; calls: number; connected: number; connectedPct: number; uniqueLeads: number }
export interface WeekRow { weekLabel: string; loginCount: number; overallCalls: number; uniqueLeadset: number; overallConnected: number; overallConnectedPct: number; talkTimeSec: number }
export interface AgentRow {
  agent: string; loginId: string; totalCalls: number; connectedCalls: number; connectedPct: number;
  uniqueLeads: number; talkTimeSec: number; loginTimeSec: number; netLoginTimeSec: number;
  shrinkagePct: number; occupancyPct: number; daysWorked: number; aprDays: number; avgCallsPerDay: number;
  avgTalkPerConnectedSec: number; idleSec: number; breakSec: number; firstCallConnectedPct: number;
}
export interface DailyRow { date: string; calls: number; uniqueLeads: number; connected: number; connectedPct: number; uniqueConnected: number; loginCount: number; talkTimeSec: number }
export interface HourRow { hour: number; calls: number; connected: number; connectedPct: number }
export interface StatusRow { status: string; calls: number; pct: number }
export interface DispositionRow { disposition: string; calls: number; pct: number }
export interface AttemptRow { attempt: string; calls: number; connected: number; connectedPct: number }
export interface BucketRow { label: string; calls: number }
export interface TimeUse {
  agentDays: number;
  loginSec: number; netLoginSec: number; talkSec: number; wrapupSec: number; idleSec: number;
  holdSec: number; ringSec: number; breakSec: number; otherSec: number;
  breaks: { tea: number; lunch: number; meeting: number; bio: number; unsolicited: number };
  breakCount: number;
}
export interface DashboardData {
  headline: Headline; from: string; to: string;
  byService: ServiceRow[]; byWeek: WeekRow[]; agents: AgentRow[];
  daily: DailyRow[]; byHour: HourRow[]; byStatus: StatusRow[]; byDisposition: DispositionRow[];
  byAttempt: AttemptRow[]; talkBuckets: BucketRow[]; hangup: BucketRow[]; timeUse: TimeUse;
}

export type DetailKind = "agent" | "service" | "week" | "day";
export interface DetailData {
  kind: DetailKind; key: string; title: string; subtitle: string; from: string; to: string;
  kpis: {
    calls: number; uniqueLeads: number; connected: number; connectedPct: number;
    uniqueConnected: number; uniqueConnectivityPct: number;
    avgTalkPerConnectedSec: number; firstCallConnectedPct: number; avgAttemptsPerLead: number;
  };
  daily: DailyRow[]; byHour: HourRow[]; byStatus: StatusRow[]; byDisposition: DispositionRow[]; byAttempt: AttemptRow[];
  timeUse: TimeUse | null; shrinkagePct: number | null; occupancyPct: number | null;
  breakdownLabel: string;
  breakdown: Array<{ name: string; calls: number; connected: number; connectedPct: number; uniqueLeads: number }>;
  recentCalls: Array<{
    reportDate: string; hour: number | null; leadId: string; agent: string; service: string;
    disposition: string; status: string; attempt: number; talkSec: number;
  }>;
}

export const PALETTE = {
  blue: "#2563eb", sky: "#0ea5e9", indigo: "#6366f1", violet: "#8b5cf6", teal: "#14b8a6",
  emerald: "#10b981", amber: "#f59e0b", rose: "#f43f5e", slate: "#94a3b8", cyan: "#06b6d4",
} as const;

export const STATUS_COLORS: Record<string, string> = {
  Connected: PALETTE.emerald, "Call Back": PALETTE.amber, "Not Connected": "#cbd5e1", Unknown: "#e2e8f0",
};

export const SERVICE_COLORS = [PALETTE.blue, PALETTE.sky, PALETTE.indigo, PALETTE.violet, PALETTE.cyan, PALETTE.teal];

/** Dark tooltip for every chart on these dashboards. Series keep their own
 * colors in the body (all of them read clearly on slate-900); only the
 * surface and the heading text are set here. */
export const TOOLTIP_PROPS = {
  contentStyle: {
    fontSize: 12, borderRadius: 10, border: "1px solid #334155", background: "#0f172a",
    boxShadow: "0 8px 24px rgba(15,23,42,0.4)", padding: "8px 12px",
  },
  labelStyle: { color: "#f1f5f9", fontWeight: 600, marginBottom: 4 },
} as const;

export const secToHms = (s: number): string => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

/** Compact "1h 12m" style for durations shown in tight spaces. */
export const secToShort = (s: number): string => {
  if (s <= 0) return "0m";
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  if (h === 0) return m === 0 ? `${Math.round(s)}s` : `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
};

export const fmtN = (n: number): string => n.toLocaleString("en-IN");

/** YYYY-MM-DD -> DD/MM/YYYY without going through Date (no timezone shift). */
export const fmtDate = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

export const fmtShortDay = (iso: string): string => {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[2])} ${months[Number(m[1]) - 1]}`;
};

export const hourLabel = (h: number): string => `${String(h).padStart(2, "0")}:00`;

/** Soft emerald wash whose strength tracks value/max -- the "heat" in a heat strip. */
export const heatStyle = (value: number, max: number): { backgroundColor: string } => {
  const a = max > 0 ? Math.max(0.08, Math.min(1, value / max)) : 0.08;
  return { backgroundColor: `rgba(16, 185, 129, ${a.toFixed(2)})` };
};
