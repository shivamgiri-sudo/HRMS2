import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type {
  MetricValues, OpsDimension, OpsFilterOptions, OpsMetricDef, OpsQuery, OpsRecordDomain, OpsSummary, PerfResponse,
  RecordsResponse, TrendPoint,
} from "./opsTypes";

const BASE = "/api/operations-command";

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function get<T>(path: string): Promise<T> {
  // A cold first load scans several large tables (up to ~60s on a cold cache); results are then cached server-side.
  const res = await hrmsApi.get<{ success: boolean; data: T }>(`${BASE}${path}`, 120_000);
  return res.data;
}

export function useOpsDefinitions() {
  return useQuery({
    queryKey: ["ops-command", "definitions"],
    queryFn: () => get<{ metrics: OpsMetricDef[] }>("/definitions"),
    staleTime: 60 * 60 * 1000,
  });
}

export function useOpsFilters(q: OpsQuery) {
  return useQuery({
    queryKey: ["ops-command", "filters", q],
    queryFn: () => get<OpsFilterOptions>(`/filters${qs({ ...q })}`),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });
}

export function useOpsSummary(q: OpsQuery, groupBy: OpsDimension, sort: string, dir: "asc" | "desc") {
  return useQuery({
    queryKey: ["ops-command", "summary", q, groupBy, sort, dir],
    queryFn: () => get<OpsSummary>(`/summary${qs({ ...q, groupBy, sort, dir })}`),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}

export function useOpsPrevious(q: OpsQuery) {
  return useQuery({
    queryKey: ["ops-command", "previous", q],
    queryFn: () => get<{ period: { from: string; to: string }; totals: MetricValues }>(`/previous${qs({ ...q })}`),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}

export function useOpsTrend(q: OpsQuery, enabled = true) {
  return useQuery({
    queryKey: ["ops-command", "trend", q],
    queryFn: () => get<{ points: TrendPoint[] }>(`/trend${qs({ ...q })}`),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useOpsPerformance(q: OpsQuery, groupBy: OpsDimension, source: "process" | "agent", enabled: boolean) {
  return useQuery({
    queryKey: ["ops-command", "performance", q, groupBy, source],
    queryFn: () => get<PerfResponse>(`/performance${qs({ ...q, groupBy, source })}`),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 60 * 1000,
  });
}

export interface RecordsRequest {
  domain: OpsRecordDomain;
  groupBy?: OpsDimension;
  groupId?: string;
  date?: string;
  offset: number;
}

export function useOpsRecords(q: OpsQuery, req: RecordsRequest | null) {
  return useQuery({
    queryKey: ["ops-command", "records", q, req],
    queryFn: () => get<RecordsResponse>(`/records${qs({ ...q, domain: req!.domain, groupBy: req!.groupBy, groupId: req!.groupId, date: req!.date, offset: req!.offset, limit: 50 })}`),
    enabled: !!req,
    placeholderData: keepPreviousData,
  });
}

export interface EmployeeDetail {
  profile: Record<string, string | number | null>;
  attendance: Array<Record<string, string | number | null>>;
  roster: Array<Record<string, string | number | null>>;
  exits: Array<Record<string, string | number | null>>;
  warnings: Array<Record<string, string | number | null>>;
  pips: Array<Record<string, string | number | null>>;
  learning: Array<Record<string, string | number | null>>;
  audits: Array<Record<string, string | number | null>>;
  kpis: Array<Record<string, string | number | null>>;
  breaks: Array<Record<string, string | number | null>>;
  window: { from: string; to: string };
  risk: { score: number; level: "high" | "medium" | "low"; reasons: string[] } | null;
  recentCalls: Array<{ at: string; score: number | null }> | null;
  peers: {
    agent: PeerBlock;
    team: PeerBlock | null;
    scope: PeerBlock;
  };
}

export interface PeerBlock {
  label: string;
  size: number | null;
  values: Record<string, number | null>;
}

export function useOpsEmployee(q: OpsQuery, employeeId: string | null) {
  return useQuery({
    queryKey: ["ops-command", "employee", employeeId, q.to],
    queryFn: () => get<EmployeeDetail>(`/employee/${employeeId}${qs({ to: q.to })}`),
    enabled: !!employeeId,
  });
}

export interface HeatmapResponse {
  metric: "attendance" | "shrinkage" | "absent" | "late";
  dates: string[];
  rows: Array<{ id: string; name: string; sub: string | null; cells: Array<number | null>; overall: number | null }>;
  truncatedGroups: boolean;
}

export function useOpsHeatmap(q: OpsQuery, groupBy: OpsDimension, metric: HeatmapResponse["metric"], enabled: boolean) {
  return useQuery({
    queryKey: ["ops-command", "heatmap", q, groupBy, metric],
    queryFn: () => get<HeatmapResponse>(`/heatmap${qs({ ...q, groupBy, metric })}`),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 60 * 1000,
  });
}

export interface AgentDay {
  date: string;
  weekday: string;
  roster: { type: string; start: string | null; end: string | null; minutes: number | null; publish: string | null; ack: string | null } | null;
  attendance: { status: string; late: boolean; lateBy: number | null; clockIn: string | null; clockOut: string | null; minutes: number | null } | null;
  breakMinutes: number | null;
  breakExceeded: number | null;
  calls: number | null;
  talkMinutes: number | null;
  dialMinutes: number | null;
  kpis: Record<string, number | null>;
  audit: { count: number; avg: number | null; fatal: number } | null;
  callAudit: { count: number; avg: number | null; fatal: number } | null;
  warning: boolean;
  flags: string[];
}

export interface AgentDays {
  from: string;
  to: string;
  days: AgentDay[];
  kpiMetrics: Array<{ code: string; name: string; unit: string | null }>;
  summary: { rosteredDays: number; workedDays: number; noShows: number; lateDays: number; avgLoginHours: number | null; avgBreakMinutes: number | null; totalCalls: number; avgAudit: number | null };
  sources: { calls: boolean; dialler: boolean; callAudit: boolean };
}

export function useOpsAgentDays(q: OpsQuery, employeeId: string | null) {
  return useQuery({
    queryKey: ["ops-command", "agent-days", employeeId, q.from, q.to],
    queryFn: () => get<AgentDays | null>(`/employee/${employeeId}/days${qs({ from: q.from, to: q.to })}`),
    enabled: !!employeeId,
  });
}

export interface Insight {
  id: string;
  severity: "critical" | "warning" | "info" | "good";
  domain: string;
  title: string;
  detail: string;
  action?: { tab: string; groupBy?: OpsDimension; filter?: { key: "branch" | "process" | "lob" | "manager"; id: string } };
}

export function useOpsInsights(q: OpsQuery, enabled: boolean) {
  return useQuery({
    queryKey: ["ops-command", "insights", q],
    queryFn: () => get<{ insights: Insight[] }>(`/insights${qs({ ...q })}`),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 60 * 1000,
  });
}

export interface CohortRow {
  month: string; joined: number; stillActive: number; left30: number; left60: number; left90: number;
  retention30: number | null; retention60: number | null; retention90: number | null;
}

export function useOpsCohorts(q: OpsQuery, enabled: boolean) {
  return useQuery({
    queryKey: ["ops-command", "cohorts", q.branchId, q.processId, q.lobId, q.managerId],
    queryFn: () => get<{ cohorts: CohortRow[] }>(`/cohorts${qs({ ...q })}`),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export interface ForecastDay { date: string; weekday: string; rostered: number; expectedPresent: number; mandate: number | null; gap: number | null }

export function useOpsForecast(q: OpsQuery, enabled: boolean) {
  return useQuery({
    queryKey: ["ops-command", "forecast", q.branchId, q.processId, q.lobId, q.managerId],
    queryFn: () => get<{ days: ForecastDay[]; shrinkagePct: number | null; mandate: number | null }>(`/forecast${qs({ ...q })}`),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export interface FreshFeed { feed: string; latest: string | null; note: string; stale: boolean }

export function useOpsFreshness() {
  return useQuery({
    queryKey: ["ops-command", "freshness"],
    queryFn: () => get<{ feeds: FreshFeed[]; today: string }>("/freshness"),
    staleTime: 10 * 60 * 1000,
  });
}

/** Authenticated CSV download of the drill table (audited server-side). */
export async function downloadOpsCsv(q: OpsQuery, groupBy: OpsDimension, columns: string[], sort: string, dir: "asc" | "desc"): Promise<void> {
  const blob = await hrmsApi.getBlob(`${BASE}/export${qs({ ...q, groupBy, columns: columns.join(","), sort, dir })}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `operations-${groupBy}-${q.from ?? "period"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
