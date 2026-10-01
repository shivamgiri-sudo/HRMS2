/** React-query hooks for /api/analytics/attrition-hub/*. Contract: ./types.ts */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type {
  AlertLink, HubAlerts, HubEmployeeRisk, HubInsights, HubModel, HubOverview, HubRisk,
} from "./types";

const BASE = "/api/analytics/attrition-hub";
const STALE = 5 * 60 * 1000;

async function fetchHub<T>(path: string): Promise<T> {
  const res = await hrmsApi.get<{ success: boolean; data: T }>(`${BASE}${path}`);
  if (!res || res.data === undefined || res.data === null) throw new Error("The attrition service returned no data.");
  return res.data;
}

/** Filters on the Prediction tab. Alert links are applied as-is. */
export interface PredictionFilters extends AlertLink {
  q?: string;
  sort?: "score" | "aon" | "name";
  offset?: number;
}
export const PAGE_SIZE = 25;

export function riskQueryString(f: PredictionFilters): string {
  const p = new URLSearchParams();
  if (f.tier) p.set("tier", f.tier);
  if (f.branchId) p.set("branchId", f.branchId);
  if (f.processId) p.set("processId", f.processId);
  if (f.managerId) p.set("managerId", f.managerId);
  if (f.q?.trim()) p.set("q", f.q.trim());
  if (f.absentOnly) p.set("absentOnly", "true");
  if (f.newJoinerOnly) p.set("newJoinerOnly", "true");
  p.set("sort", f.sort ?? "score");
  p.set("limit", String(PAGE_SIZE));
  p.set("offset", String(f.offset ?? 0));
  return p.toString();
}

const opts = { staleTime: STALE, refetchOnWindowFocus: false } as const;

export const useHubOverview = () =>
  useQuery({ queryKey: ["attrition-hub", "overview"], queryFn: () => fetchHub<HubOverview>("/overview"), ...opts });

export const useHubInsights = () =>
  useQuery({ queryKey: ["attrition-hub", "insights"], queryFn: () => fetchHub<HubInsights>("/insights"), ...opts });

export const useHubAlerts = () =>
  useQuery({ queryKey: ["attrition-hub", "alerts"], queryFn: () => fetchHub<HubAlerts>("/alerts"), ...opts });

export const useHubModel = () =>
  useQuery({ queryKey: ["attrition-hub", "model"], queryFn: () => fetchHub<HubModel>("/model"), ...opts });

export const useHubRisk = (filters: PredictionFilters) => {
  const qs = riskQueryString(filters);
  return useQuery({
    queryKey: ["attrition-hub", "risk", qs],
    queryFn: () => fetchHub<HubRisk>(`/risk?${qs}`),
    placeholderData: keepPreviousData,
    ...opts,
  });
};

export const useHubEmployee = (id: string | null) =>
  useQuery({
    queryKey: ["attrition-hub", "employee", id],
    queryFn: () => fetchHub<HubEmployeeRisk>(`/employee/${encodeURIComponent(id as string)}`),
    enabled: !!id,
    ...opts,
  });
