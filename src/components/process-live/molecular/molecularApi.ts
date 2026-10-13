/**
 * Molecular / Reginald Email Dashboards — API client and shared types.
 * Mirrors backend/src/modules/process-live-dashboard/molecular-email.service.ts.
 * Both dashboards share one view and one per-ticket pipeline, split by source:
 * Molecular endpoints are under /api/process-live/molecular-email (scope group
 * 'molecular-email'), Reginald Email under /api/process-live/reginald-email
 * (scope group 'reginald-email').
 */
import { getAuthToken } from "@/lib/hrmsApi";

export const MOLECULAR_TITLE = "Molecular Email Dashboard";
export const MOLECULAR_ROUTE = "/molecular-email-dashboard";
export const REGINALD_EMAIL_TITLE = "Reginald Email Dashboard";
export const REGINALD_EMAIL_ROUTE = "/reginald-email-dashboard";

export type EmailDashSource = "molecular" | "reginald";

export interface EmailDashConfig {
  source: EmailDashSource;
  title: string;
  route: string;
  /** Endpoint group under /api/process-live (also its scope group). */
  apiGroup: "molecular-email" | "reginald-email";
  /** How the ticket source is named in notices ("the Molecular ticketing server"). */
  sourceName: string;
  /** Dialler APR campaign holding the agents' time. */
  campaign: string;
}

export const EMAIL_DASHBOARDS: Record<EmailDashSource, EmailDashConfig> = {
  molecular: {
    source: "molecular", title: MOLECULAR_TITLE, route: MOLECULAR_ROUTE,
    apiGroup: "molecular-email", sourceName: "Molecular", campaign: "MOEMAIL",
  },
  reginald: {
    source: "reginald", title: REGINALD_EMAIL_TITLE, route: REGINALD_EMAIL_ROUTE,
    apiGroup: "reginald-email", sourceName: "Reginald Men", campaign: "EMAIL",
  },
};

export type TatBucket = "0-24h" | ">24-48h" | ">48-72h" | ">72h";
export const TAT_BUCKETS: TatBucket[] = ["0-24h", ">24-48h", ">48-72h", ">72h"];

export interface MolFilters {
  from: string;
  to: string;
  agent: string;
  category: string;
  priority: string;
  status: "" | "open" | "closed" | "reopened";
  tatBucket: "" | TatBucket;
  slaHours: number;
}

export interface MolTicket {
  ticketId: string;
  createdAt: string | null;
  agentName: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
  firstClosedAt: string | null;
  finalClosedAt: string | null;
  reopenCount: number;
  dqFlag: string | null;
  isClosed: boolean;
  isReopened: boolean;
  tatHours: number | null;
  tatBucket: TatBucket | null;
  slaStatus: string;
}

export interface MolKpis {
  received: number; closed: number; pending: number; reopened: number; reopenEvents: number;
  closurePct: number | null; reopenPct: number | null; firstTimeClosureRate: number | null;
  avgTatHours: number | null; medianTatHours: number | null; withinSlaPct: number | null;
  slaHours: number; pendingOver72h: number; dataQualityExcluded: number;
  funnel: { received: number; firstClosed: number; reopened: number; finalClosed: number; pending: number };
  closedTatBuckets: Record<TatBucket, number>;
  openAgeingBuckets: Record<TatBucket, number>;
}

export interface MolOverview {
  asOf: string;
  kpis: MolKpis;
  trend: { date: string; received: number; closed: number; reopenedTickets: number; reopenEvents: number }[];
  categoryReopen: { category: string; closed: number; reopened: number; reopenPct: number | null }[];
  oldestPending: MolTicket[];
  fieldAvailability: { category: boolean; priority: boolean; reopenReason: boolean };
  closureBasis: Record<string, number>;
  ticketsWithoutCreatedTime: number;
  lastSyncedAt: string | null;
  hasData: boolean;
  feed: MolFeedStatus;
  /** Day-level counts from the older daily sync, sent only when no tickets exist for the period. */
  dailyFallback: MolDailyFallback | null;
}

export interface MolFeedStatus {
  ticketFeedLastSyncedAt: string | null;
  dailyFeedLastSyncedAt: string | null;
  dailyLatestDate: string | null;
}

export interface MolDailyFallback {
  totalTickets: number;
  emailClosed: number;
  openPending: number;
  emailReopen: number;
  daily: { date: string; totalTickets: number; emailClosed: number; openPending: number; emailReopen: number }[];
  byAnalyst: { analyst: string; ticketsReceived: number; ticketsClosed: number; ticketsReopened: number; ticketsOpenPending: number }[];
  hasData: boolean;
}

export interface MolTicketList { asOf: string; total: number; truncated: boolean; rows: MolTicket[] }

export interface MolAgentDayRow {
  date: string; agent: string;
  received: number | null; closed: number | null; pendingAssigned: number | null; closurePct: number | null;
  netLoginSec: number | null; talkSec: number | null; waitSec: number | null; pauseSec: number | null;
  utilization: number | null; netLogin: string | null;
  dataStatus: "both" | "tickets_only" | "apr_only";
}

export interface MolAprSummary { agentCount: number; avgUtilization: number; totalLoginTime: string }

export interface MolFilterOptions { agents: string[]; categories: string[]; priorities: string[] }

export function filterParams(f: MolFilters): Record<string, string> {
  const p: Record<string, string> = { from: f.from, to: f.to, slaHours: String(f.slaHours) };
  if (f.agent) p.agent = f.agent;
  if (f.category) p.category = f.category;
  if (f.priority) p.priority = f.priority;
  if (f.status) p.status = f.status;
  if (f.tatBucket) p.tatBucket = f.tatBucket;
  return p;
}

async function get<T>(url: string, params: Record<string, string>, title = MOLECULAR_TITLE): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${url}?${new URLSearchParams(params).toString()}`, { headers });
  if (r.status === 403) throw new Error(`You do not have access to the ${title} (process scope).`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = (await r.json()) as { ok: boolean; data: T; error?: string };
  if (!d.ok) throw new Error(d.error || "API error");
  return d.data;
}

export function emailDashApi(source: EmailDashSource) {
  const { apiGroup: g, title } = EMAIL_DASHBOARDS[source];
  return {
    overview: (f: MolFilters) => get<MolOverview>(`/api/process-live/${g}/overview`, filterParams(f), title),
    tickets: (f: MolFilters) => get<MolTicketList>(`/api/process-live/${g}/ticket-list`, filterParams(f), title),
    agentDaily: (f: MolFilters) => get<{ rows: MolAgentDayRow[] }>(`/api/process-live/${g}/agent-daily`, filterParams(f), title),
    filterOptions: () => get<MolFilterOptions>(`/api/process-live/${g}/filter-options`, {}, title),
    aprSummary: (f: MolFilters) => get<MolAprSummary>(`/api/process-live/${g}/summary`, { from: f.from, to: f.to }, title),
  };
}

export const molApi = emailDashApi("molecular");

/** IST date "YYYY-MM-DD". */
export function istDate(offsetDays = 0): string {
  return new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export function defaultFilters(from?: string, to?: string): MolFilters {
  const today = istDate();
  return {
    from: from ?? `${today.slice(0, 8)}01`, to: to ?? today,
    agent: "", category: "", priority: "", status: "", tatBucket: "", slaHours: 24,
  };
}

export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "N/A" : `${v.toFixed(1)}%`);
export const fmtHours = (v: number | null | undefined) => (v === null || v === undefined ? "N/A" : `${v.toFixed(1)} h`);
export const orNA = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "N/A" : String(v));
/** "2026-10-01 10:00:00" -> "01 Oct 10:00" (IST wall clock as stored). */
export function fmtStamp(v: string | null | undefined): string {
  if (!v) return "N/A";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:.(\d{2}):(\d{2}))?/.exec(v);
  if (!m) return v;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1] ?? m[2];
  const time = m[4] ? ` ${m[4]}:${m[5]}` : "";
  return `${m[3]} ${mon} ${m[1].slice(2)}${time}`;
}
export const fmtSecs = (s: number | null | undefined) => {
  if (s === null || s === undefined) return "N/A";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
};
