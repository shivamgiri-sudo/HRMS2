/** Types and formatting helpers shared across the Housing Premium dashboard's
 * tabs and its agent drill-down drawer. Shapes mirror
 * backend/src/modules/process-performance/housing-premium-dashboard.service.ts. */

export interface HPColumn { key: string; label: string; kind: "mtd" | "week" | "day"; from: string; to: string }

export interface HPOverviewValues {
  connected: number; notConnected: number; uniqueConnected: number; totalCalls: number; connectedPct: number;
  target: number; revenue: number; saleCount: number; achievedPct: number; aov: number;
  presentCount: number; perAgentDialCount: number; avgSalePerAgent: number;
}
export interface HPOverviewData {
  from: string; to: string; columns: HPColumn[];
  overall: Record<string, HPOverviewValues>;
  byTl: Array<{ tlName: string; agentCount: number; values: Record<string, HPOverviewValues> }>;
  cdrRowCount: number; saleRowCount: number; cdrAvailable: boolean;
}

export interface HPDayRow {
  date: string; dayName: string; target: number; totalCalls: number; connected: number; notConnected: number;
  uniqueConnected: number; connectedPct: number; avgTalkTimeSec: number; saleCount: number; revenue: number;
  aov: number; presentCount: number; avgSalePerAgent: number;
}
export interface HPDayWiseData { from: string; to: string; agent: string; days: HPDayRow[] }

export interface HPAgentPerfRow {
  empId: string; name: string; tlName: string; doj: string | null; tenureDays: number | null; bucket: string;
  status: string; target: number; totalCalls: number; uniqueCalls: number; connected: number; notConnected: number;
  connectedPct: number; avgTalkTimeSec: number; saleCount: number; revenue: number; aov: number;
  presentCount: number; avgSalePerDay: number; achievedPct: number;
}
export interface HPAgentWiseData { from: string; to: string; agents: HPAgentPerfRow[] }

export interface HPSlotRow { hour: number; totalCalls: number; connected: number; notConnected: number; connectedPct: number; avgTalkTimeSec: number }
export interface HPSlotWiseData { from: string; to: string; agent: string; slots: HPSlotRow[]; saleByHourAvailable: false; saleByHourNote: string }

export type HPStage = "TQ" | "MQ" | "BQ" | "-";
export interface HPWeekBlock { label: string; from: string; to: string; target: number; achievement: number; saleCount: number; aov: number; achievedPct: number; stage: HPStage }
export interface HPTqMqBqAgentRow {
  empId: string; name: string; tlName: string; doj: string | null; tenureDays: number | null; bucket: string; status: string;
  target: number; mtdTarget: number; achieved: number; saleCount: number; aov: number; remaining: number;
  achievedPct: number; rank: number | null; stage: HPStage; weeks: HPWeekBlock[];
}
export interface HPTqMqBqAgentsData { month: string; asOfDate: string; agents: HPTqMqBqAgentRow[] }

export interface HPTqMqBqTlRow {
  tlName: string; agentCount: number; target: number; achievement: number; remaining: number;
  tillDayAchievedPct: number; saleCount: number; drr: number; currentDrr: number; stage: HPStage;
}
export interface HPTqMqBqTlData { month: string; asOfDate: string; tls: HPTqMqBqTlRow[] }

export interface HPTeamDetailsRow {
  empId: string; name: string; tlName: string; center: string; doj: string | null; tenureDays: number | null;
  bucket: string; status: string; target: number; uploadedAchievement: number; uploadedAchPct: string;
  computedRevenue: number; achievementMismatch: boolean; mismatchAmount: number;
}
export interface HPTeamDetailsData { rows: HPTeamDetailsRow[]; mismatchCount: number }

export interface HPValidationMismatch { agentName: string; empId: string; uploadedAchievement: number; computedRevenue: number; diff: number }
export interface HPValidation {
  saleRowCount: number; agentRowCount: number; cdrRowCount: number;
  agentsInSaleNotInRoster: string[]; agentsInRosterWithNoSale: string[];
  achievementMismatches: HPValidationMismatch[]; cdrAgentsNotInRoster: string[];
  saleTlNameUsable: boolean; saleTlNameValues: string[]; rosterTlNames: string[];
}

export interface HPAgentDetail {
  empId: string; name: string; tlName: string; center: string; doj: string | null; tenureDays: number | null;
  bucket: string; status: string; target: number; uploadedAchievement: number;
  daily: Array<{ date: string; saleCount: number; revenue: number; calls: number; connected: number }>;
  orders: Array<{ orderId: string; date: string; amount: number; orderValue: number; partnerName: string }>;
}

export const HP_API = "/api/process-performance/housing-premium-dashboard";

export const STAGE_COLORS: Record<HPStage, string> = {
  TQ: "#10b981", MQ: "#f59e0b", BQ: "#ef4444", "-": "#94a3b8",
};
export const STAGE_LABEL: Record<HPStage, string> = {
  TQ: "TQ (>80%)", MQ: "MQ (60-80%)", BQ: "BQ (<60%)", "-": "—",
};

const num = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const fmtN = (v: number | null | undefined): string => num(v).toLocaleString("en-IN");
export const fmtPct = (v: number | null | undefined): string => `${num(v)}%`;

export const secToHms = (s: number): string => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
export const secToShort = (s: number): string => {
  if (s <= 0) return "0m";
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  if (h === 0) return m === 0 ? `${Math.round(s)}s` : `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
};

/** YYYY-MM-DD -> DD/MM/YYYY without going through Date (no timezone shift). */
export const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtShortDay = (iso: string): string => {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])} ${MON[Number(m[1]) - 1]}` : iso;
};

/** Same "day-of-month 1-7 -> W-1, 8-14 -> W-2, ..." convention this app's
 * other week-wise tables/exports already use (see satyaReportModel.weekOf
 * and HousingOwnerDashboard's own copy). Keyed by month too, so a range
 * spanning more than one month never merges two different months' "W-1". */
export function weekBucket(iso: string): { key: string; label: string } {
  const day = Number(iso.slice(8, 10));
  const monthKey = iso.slice(0, 7);
  const weekNum = Math.ceil(day / 7);
  const startDay = (weekNum - 1) * 7 + 1;
  const daysInMonth = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0).getDate();
  const endDay = Math.min(startDay + 6, daysInMonth);
  return { key: `${monthKey}-W${weekNum}`, label: `W-${weekNum} (${startDay}-${endDay} ${MON[Number(iso.slice(5, 7)) - 1]})` };
}
export const hourLabel = (h: number): string => `${String(h).padStart(2, "0")}:00`;

/** "M/D/YY" (pre_agent_details.doj / Pre_cdr.report_date) -> DD/MM/YYYY for display. */
export const fmtMdy = (raw: string | null): string => {
  if (!raw) return "—";
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return raw;
  return `${m[2].padStart(2, "0")}/${m[1].padStart(2, "0")}/20${m[3]}`;
};

export const heatStyle = (value: number, max: number): { backgroundColor: string } => {
  const a = max > 0 ? Math.max(0.08, Math.min(1, value / max)) : 0.08;
  return { backgroundColor: `rgba(16, 185, 129, ${a.toFixed(2)})` };
};

export const BUCKET_ORDER = ["0-30", "31-60", "61-90", "91-120", "121-180", "180 Above", "Unknown"];
export const BUCKET_COLORS: Record<string, string> = {
  "0-30": "bg-sky-100 text-sky-700", "31-60": "bg-indigo-100 text-indigo-700", "61-90": "bg-violet-100 text-violet-700",
  "91-120": "bg-amber-100 text-amber-700", "121-180": "bg-orange-100 text-orange-700",
  "180 Above": "bg-emerald-100 text-emerald-700", Unknown: "bg-slate-100 text-slate-500",
};
