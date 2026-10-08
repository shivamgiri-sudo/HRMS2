import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { OverviewPeriod } from "./useAtsOverview";

type Pct = { name: string; total: number; selected: number; selRate: number };

export interface AtsInsights {
  generatedAt: string; period: OverviewPeriod; branch: string | null;
  monthly: { month: string; registered: number; selected: number; rejected: number; noShow: number; selRate: number }[];
  rounds: { round: string; sel: number; rej: number; noShow: number; passRate: number }[];
  rejectionReasons: { reason: string; n: number; share: number }[];
  skill: { process: string; typing: number; ai: number; n: number }[];
  salary: { process: string; avg: number; min: number; max: number; n: number }[];
  ctcBands: { band: string; n: number }[];
  decisionSpeed: { bucket: string; n: number }[];
  interviewers: { name: string; interviews: number; selected: number; rejected: number; passRate: number }[];
  experience: Pct[]; education: Pct[]; shift: Pct[]; ageBands: Pct[];
  rewalkins: number;
}

type SourceRow = { name: string; sourced: number; contacted: number; walkin: number; selected: number; joined: number };
export interface AtsSourcing {
  generatedAt: string; period: OverviewPeriod;
  totals: Omit<SourceRow, "name">;
  legacyWalkin: (SourceRow & { contactRate: number; walkinRate: number; yieldRate: number; joinRate: number }) | null;
  funnel: { stage: string; n: number }[];
  sources: (SourceRow & { contactRate: number; walkinRate: number; yieldRate: number; joinRate: number })[];
  seriesNames: string[];
  trend: Record<string, number | string>[];
  recruiters: (Omit<SourceRow, "name"> & { name: string; contactRate: number; walkinRate: number })[];
  rejectionReasons: { reason: string; n: number }[];
  referrers: { name: string; referred: number; joined: number }[];
  duplicateWarnings: number;
}

export interface PipelineRow {
  id: string; candidate_code: string; q_token: string | null; full_name: string; mobile: string; email: string | null;
  status: string; stage: string; branch: string; process: string | null; source: string | null; recruiter: string | null;
  experience: string | null; education: string | null; created_at: string; updated_at: string;
}
export interface PipelineResult { rows: PipelineRow[]; total: number; page: number; limit: number; statuses: { name: string; n: number }[]; stages: { name: string; n: number }[] }
export interface PipelineFilters { from: string; to: string; branch: string; process: string; status: string; stage: string; search: string; includeLeads: boolean; page: number }

export interface CandidateJourney {
  candidate: (Omit<PipelineRow, "q_token"> & { q_token: string | null; gender: string | null }) | null;
  stageLogs: { from_stage: string | null; to_stage: string; at: string; remarks: string | null }[];
  submission: Record<string, string | number | null> | null;
  offer: { status: string; offered_ctc: number; gross: number; date_of_joining: string | null; approved_at: string | null } | null;
  bgv: { overall_status: string; bgv_score: number | null; completed_at: string | null } | null;
  queueToken: { token_number: string | null; status: string; arrival_time: string; interview_started_at: string | null; interview_completed_at: string | null } | null;
}

const opts = { placeholderData: keepPreviousData, staleTime: 60_000, refetchOnWindowFocus: false } as const;

export const useAtsInsights = (period: OverviewPeriod, branch: string, enabled = true) =>
  useQuery({
    queryKey: ["ats-insights", period, branch], enabled, ...opts,
    queryFn: async () => (await hrmsApi.get<{ data: AtsInsights }>(`/api/ats/dashboard/insights?${new URLSearchParams({ period, ...(branch ? { branch } : {}) })}`)).data,
  });

export const useAtsSourcing = (period: OverviewPeriod, enabled = true) =>
  useQuery({
    queryKey: ["ats-sourcing", period], enabled, ...opts,
    queryFn: async () => (await hrmsApi.get<{ data: AtsSourcing }>(`/api/ats/dashboard/sourcing?period=${period}`)).data,
  });

export const usePipeline = (f: PipelineFilters) =>
  useQuery({
    queryKey: ["ats-pipeline", f], placeholderData: keepPreviousData, staleTime: 20_000, refetchOnWindowFocus: false,
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(f.page), limit: "25" });
      (["from", "to", "branch", "process", "status", "stage", "search"] as const).forEach((k) => { if (f[k]) qs.set(k, f[k]); });
      if (f.includeLeads) qs.set("includeLeads", "1");
      return (await hrmsApi.get<{ data: PipelineResult }>(`/api/ats/dashboard/candidates?${qs}`)).data;
    },
  });

export const useCandidateJourney = (id: string | null) =>
  useQuery({
    queryKey: ["ats-journey", id], enabled: !!id, staleTime: 30_000,
    queryFn: async () => (await hrmsApi.get<{ data: CandidateJourney }>(`/api/ats/dashboard/candidates/${id}/journey`)).data,
  });

export interface AtsOperations {
  generatedAt: string; slaMinutes: number;
  today: { arrived: number; selected: number; rejected: number; noShow: number; waiting: number; breach: number };
  queue: { id: string; code: string; name: string; status: string; stage: string; process: string | null; branch: string; recruiter: string; arrival: string; waitMin: number; token: string | null }[];
  waitBuckets: { label: string; n: number }[];
  hourly: { hour: number; today: number; yesterday: number }[];
  branches: { name: string; arrived: number; waiting: number; breach: number; selected: number }[];
  roster: { name: string; branch: string; capacity: number; assigned: number; available: boolean }[];
  sla: { daily: { date: string; events: number; avgBreach: number }[]; recent: { token: string; minutes: number; threshold: number; status: string; at: string }[] };
  recoverable: { noShow30: number; hold30: number; list: { id: string; name: string; mobile: string; status: string; stage: string; process: string | null; at: string }[] };
}

export const useAtsOperations = (enabled = true) =>
  useQuery({
    queryKey: ["ats-operations"], enabled, placeholderData: keepPreviousData, staleTime: 15_000, refetchInterval: 30_000, refetchIntervalInBackground: false,
    queryFn: async () => (await hrmsApi.get<{ data: AtsOperations }>("/api/ats/dashboard/operations")).data,
  });

/* ───────────── Drill-down ───────────── */
export type DrillFilters = {
  from?: string; to?: string; branch?: string; process?: string; source?: string; recruiter?: string; status?: string; stage?: string; outcome?: string;
  gender?: string; idle?: string; hour?: number; dow?: number; experience?: string; education?: string; shift?: string; age?: string; voc?: string; interviewer?: string; search?: string;
};

export interface DrillSplit {
  name: string; total: number; selected: number; rejected: number; selRate: number;
  /** Added with the Command Center upgrade; absent on an older backend, so treat as optional. */
  noShow?: number; hold?: number; waiting?: number; joined?: number; rejRate?: number; noShowRate?: number; joinRate?: number;
}
export interface DrillData {
  total: number;
  kpis: { total: number; selected: number; rejected: number; noShow: number; hold: number; waiting: number; joined: number; selRate: number; rejRate: number; noShowRate: number; joinRate: number };
  trend: { date: string; total: number; selected: number; rejected: number }[]; weekly: boolean;
  weekday: { dow: number; total: number; selRate: number }[];
  splits: Record<"branch" | "process" | "source" | "recruiter" | "stage" | "status", DrillSplit[]>;
  /** Arrival grid for the slice (dow 1=Sun..7=Sat, hour 0-23). Absent on an older backend. */
  hourDow?: { dow: number; hour: number; total: number; selected: number }[];
}

const drillQs = (f: DrillFilters, extra: Record<string, string> = {}) => {
  const qs = new URLSearchParams(extra);
  Object.entries(f).forEach(([k, v]) => { if (v !== undefined && v !== "") qs.set(k, String(v)); });
  return qs.toString();
};

export const useDrill = (f: DrillFilters | null) =>
  useQuery({
    queryKey: ["ats-drill", f], enabled: !!f, placeholderData: keepPreviousData, staleTime: 60_000, refetchOnWindowFocus: false,
    queryFn: async () => (await hrmsApi.get<{ data: DrillData }>(`/api/ats/dashboard/drill?${drillQs(f!)}`)).data,
  });

export const useDrillList = (f: DrillFilters | null, page: number) =>
  useQuery({
    queryKey: ["ats-drill-list", f, page], enabled: !!f, placeholderData: keepPreviousData, staleTime: 60_000, refetchOnWindowFocus: false,
    queryFn: async () => (await hrmsApi.get<{ data: PipelineResult }>(`/api/ats/dashboard/candidates?${drillQs(f!, { page: String(page), limit: "10" })}`)).data,
  });

export type LeadFilters = { notSource?: string; source?: string; recruiter?: string; stage?: string; month?: string; reason?: string };
export interface LeadsResult { rows: { name: string; mobile: string; source: string; recruiter: string; status: string | null; joining: string | null; at: string; branch: string | null; process: string | null; position: string | null }[]; total: number; page: number; limit: number; statuses: { name: string; n: number }[] }
export const useLeads = (f: LeadFilters | null, page: number) =>
  useQuery({
    queryKey: ["ats-leads", f, page], enabled: !!f, placeholderData: keepPreviousData, staleTime: 60_000, refetchOnWindowFocus: false,
    queryFn: async () => (await hrmsApi.get<{ data: LeadsResult }>(`/api/ats/dashboard/sourcing/leads?${drillQs(f as DrillFilters, { page: String(page), limit: "12" })}`)).data,
  });

/* ───────────── Existing analytics endpoints (ats-analytics.routes.ts) surfaced on the Sourcing page ───────────── */
export interface SourceRoiRow { source_channel: string; total_candidates: number; total_hired: number; conversion_rate: number; avg_time_to_hire_days: number | null }
export interface TimeToHire { overall_avg_days: number | null; by_role: { role: string; avg_days: number }[]; by_source: { source: string; avg_days: number }[]; fastest_hire_days: number | null; slowest_hire_days: number | null }
export interface HiringTrendPoint { month: string; registrations: number; interviews: number; selections: number }

const analyticsOpts = { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 0 } as const;
export const useSourceRoi = (enabled = true) => useQuery({ queryKey: ["ats-roi"], enabled, ...analyticsOpts, queryFn: async () => (await hrmsApi.get<{ data: SourceRoiRow[] }>("/api/ats/analytics/source-channel-roi")).data });
export const useTimeToHire = (enabled = true) => useQuery({ queryKey: ["ats-tth"], enabled, ...analyticsOpts, queryFn: async () => (await hrmsApi.get<{ data: TimeToHire }>("/api/ats/analytics/time-to-hire")).data });
export const useHiringTrend = (months = 6, enabled = true) => useQuery({ queryKey: ["ats-trend", months], enabled, ...analyticsOpts, queryFn: async () => (await hrmsApi.get<{ data: HiringTrendPoint[] }>(`/api/ats/analytics/hiring-trends?months=${months}`)).data });
