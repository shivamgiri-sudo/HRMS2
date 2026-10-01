import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { DrillFilters } from "./useAtsDashboards";

/** Hooks for the Command Center endpoints added next to /api/ats/dashboard/drill (same filters, same row scope). */
const opts = { placeholderData: keepPreviousData, staleTime: 60_000, refetchOnWindowFocus: false } as const;
const qs = (f: DrillFilters, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams(extra);
  Object.entries(f).forEach(([k, v]) => { if (v !== undefined && v !== "") p.set(k, String(v)); });
  return p.toString();
};

export interface StageDwellRow { stage: string; n: number; medianHours: number; p90Hours: number; avgHours: number; stuckOver72h: number }
export interface StageDwell { generatedAt: string; stages: StageDwellRow[]; bottleneck: string | null }
export const useStageDwell = (f: DrillFilters) =>
  useQuery({ queryKey: ["ats-cc-dwell", f], ...opts, queryFn: async () => (await hrmsApi.get<{ data: StageDwell }>(`/api/ats/dashboard/stage-dwell?${qs(f)}`)).data });

export interface CohortRow { week: string; total: number; selected: number; rejected: number; noShow: number; open: number; joined: number; selRate: number; rejRate: number; noShowRate: number; joinRate: number; medianDaysToDecision: number | null }
export interface Cohorts { generatedAt: string; cohorts: CohortRow[] }
export const useCohorts = (weeks: number, f: DrillFilters) =>
  useQuery({ queryKey: ["ats-cc-cohorts", weeks, f], ...opts, queryFn: async () => (await hrmsApi.get<{ data: Cohorts }>(`/api/ats/dashboard/cohorts?${qs(f, { weeks: String(weeks) })}`)).data });

export interface Leakage { generatedAt: string; stages: { key: string; label: string; n: number }[]; losses: { from: string; to: string; reason: string; n: number }[] }
export const useLeakage = (f: DrillFilters) =>
  useQuery({ queryKey: ["ats-cc-leakage", f], ...opts, queryFn: async () => (await hrmsApi.get<{ data: Leakage }>(`/api/ats/dashboard/leakage?${qs(f)}`)).data });
