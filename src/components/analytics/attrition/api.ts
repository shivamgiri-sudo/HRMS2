/** React-query hooks for /api/analytics/attrition-hub/*. Contract: ./types.ts */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type {
  AlertLink, DrillQuery, FactorGroup, Followup, FollowupKind, FollowupOutcome, HubAlerts, HubBatches, HubDrill,
  HubEmployeeRisk, HubFollowupEffect, HubInsights, HubModel, HubOutlook, HubOverview, HubPulse, HubRisk, HubScorecard,
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
  group?: FactorGroup;
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
  if (f.group) p.set("group", f.group);
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

/* ═══════════════ Round 2 ═══════════════ */

export const DRILL_PAGE = 50;

/** Flat query string for GET /drill. `title`, `limit` and `offset` are never part of the slice itself. */
export function drillQueryString(q: DrillQuery, extra?: { limit?: number; offset?: number }): string {
  const p = new URLSearchParams();
  (Object.keys(q) as (keyof DrillQuery)[]).sort().forEach(k => {
    if (k === "title" || k === "limit" || k === "offset") return;
    const v = q[k];
    if (v === undefined || v === null || v === "" || v === false) return;
    p.set(k, String(v));
  });
  if (extra?.limit !== undefined) p.set("limit", String(extra.limit));
  if (extra?.offset !== undefined) p.set("offset", String(extra.offset));
  return p.toString();
}

/** One page of a drill slice. Used directly by the absconding watch (limit 8). */
export const useHubDrillPage = (q: DrillQuery | null, limit: number) => {
  const key = q ? drillQueryString(q, { limit, offset: 0 }) : "";
  return useQuery({
    queryKey: ["attrition-hub", "drill-page", key],
    queryFn: () => fetchHub<HubDrill>(`/drill?${key}`),
    enabled: !!q,
    ...opts,
  });
};

/** Paged drill: "Load more" fetches the next DRILL_PAGE rows. */
export const useHubDrill = (q: DrillQuery | null) => {
  const slice = q ? drillQueryString(q) : "";
  return useInfiniteQuery({
    queryKey: ["attrition-hub", "drill", slice],
    queryFn: ({ pageParam }) => fetchHub<HubDrill>(`/drill?${drillQueryString(q as DrillQuery, { limit: DRILL_PAGE, offset: pageParam })}`),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((s, p) => s + p.rows.length, 0);
      return last.rows.length > 0 && loaded < last.total ? loaded : undefined;
    },
    enabled: !!q,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
};

export const useHubFollowups = (employeeId: string | null) =>
  useQuery({
    queryKey: ["attrition-hub", "followups", employeeId],
    queryFn: () => fetchHub<Followup[]>(`/followups?employeeId=${encodeURIComponent(employeeId as string)}`),
    enabled: !!employeeId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

export function useLogFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: { employeeId: string; kind: FollowupKind; outcome: FollowupOutcome; note?: string }) => {
      const res = await hrmsApi.post<{ success: boolean; data: Followup }>(`${BASE}/followups`, b);
      return res?.data;
    },
    onSuccess: () => {
      for (const k of ["drill", "drill-page", "risk", "followups", "alerts", "employee", "effectiveness", "pulse"]) {
        qc.invalidateQueries({ queryKey: ["attrition-hub", k] });
      }
    },
  });
}

export const useHubEffectiveness = () =>
  useQuery({ queryKey: ["attrition-hub", "effectiveness"], queryFn: () => fetchHub<HubFollowupEffect>("/followups/effectiveness"), ...opts });

export const useHubBatches = () =>
  useQuery({ queryKey: ["attrition-hub", "batches"], queryFn: () => fetchHub<HubBatches>("/batches"), ...opts });

export type ScorecardBy = HubScorecard["by"];
export const useHubScorecard = (by: ScorecardBy) =>
  useQuery({
    queryKey: ["attrition-hub", "scorecard", by],
    queryFn: () => fetchHub<HubScorecard>(`/scorecard?by=${by}`),
    placeholderData: keepPreviousData,
    ...opts,
  });

export const useHubOutlook = () =>
  useQuery({ queryKey: ["attrition-hub", "outlook"], queryFn: () => fetchHub<HubOutlook>("/outlook"), ...opts });

export const useHubPulse = () =>
  useQuery({ queryKey: ["attrition-hub", "pulse"], queryFn: () => fetchHub<HubPulse>("/pulse"), retry: false, ...opts });
