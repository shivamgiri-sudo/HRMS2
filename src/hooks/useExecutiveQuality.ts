/**
 * useExecutiveQuality — React Query hooks for org-wide executive quality data.
 * Wraps GET /api/executive/quality-summary and the process-breakdown sub-endpoint.
 * Only enabled for executive-level roles (super_admin, admin, ceo, coo).
 *
 * Field names match ExecutiveSummaryResponse returned by quality-executive.service.ts.
 */
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useUserRole } from "./useUserRole";

// ─── Types (aligned with backend ExecutiveSummaryResponse) ────────────────────

export interface ExecutiveQualityMetrics {
  overall_quality_score: number;
  target_quality_score: number;
  gap_pct: number;
  status: "On Track" | "At Risk" | "Critical";
  trend_7day: { direction: string; change_pct: number };
  trend_30day: { direction: string; change_pct: number };
}

export interface PerformerRank {
  rank: number;
  agent_code: string;
  agent_name: string;
  quality_score: number;
  calls_handled: number;
  process: string;
}

export interface ProcessPerformanceRow {
  process: string;
  avg_quality: number;
  agent_count: number;
  calls_handled: number;
  status: "On Track" | "At Risk" | "Critical";
}

export interface ExecutiveSummaryResponse {
  metrics: ExecutiveQualityMetrics;
  top_performers: PerformerRank[];
  bottom_performers: PerformerRank[];
  process_performance: ProcessPerformanceRow[];
  risk_summary: {
    critical_agents_count: number;
    at_risk_agents_count: number;
    coaching_priority_count: number;
  };
  org_benchmarks: {
    avg_quality: number;
    median_quality: number;
    std_deviation: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EXEC_ROLES = new Set(["super_admin", "admin", "ceo", "coo"]);
const STALE = 5 * 60 * 1000;
const GC = 10 * 60 * 1000;

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Fetch org-level quality summary for the Executive / CEO view.
 * Role-gated: only enabled when the current user holds an executive role.
 *
 * @param daysBack - Lookback window in days (7 | 30 | 90; default: 30)
 */
export function useExecutiveQualitySummary(daysBack: 7 | 30 | 90 = 30) {
  const { data: roleData } = useUserRole();
  const isAllowed =
    roleData?.roleKeys?.some((r: string) => EXEC_ROLES.has(r)) ?? false;

  return useQuery<ExecutiveSummaryResponse, Error>({
    queryKey: ["executive-quality-summary", daysBack],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: ExecutiveSummaryResponse }>(
        `/api/executive/quality-summary?daysBack=${daysBack}`
      );
      return (res as { success: boolean; data: ExecutiveSummaryResponse }).data;
    },
    enabled: isAllowed,
    staleTime: STALE,
    gcTime: GC,
    retry: 2,
  });
}

/**
 * Fetch process-level quality breakdown for the Executive / CEO view.
 * Role-gated: only enabled when the current user holds an executive role.
 *
 * @param daysBack - Lookback window in days (7 | 30 | 90; default: 30)
 */
export function useExecutiveProcessBreakdown(daysBack: 7 | 30 | 90 = 30) {
  const { data: roleData } = useUserRole();
  const isAllowed =
    roleData?.roleKeys?.some((r: string) => EXEC_ROLES.has(r)) ?? false;

  return useQuery<ProcessPerformanceRow[], Error>({
    queryKey: ["executive-quality-process-breakdown", daysBack],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: ProcessPerformanceRow[] }>(
        `/api/executive/quality-summary/process-breakdown?daysBack=${daysBack}`
      );
      return (res as { success: boolean; data: ProcessPerformanceRow[] }).data ?? [];
    },
    enabled: isAllowed,
    staleTime: STALE,
    gcTime: GC,
    retry: 2,
  });
}
