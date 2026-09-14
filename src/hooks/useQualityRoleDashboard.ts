/**
 * useQualityRoleDashboard Hooks
 * Role-scoped quality data hooks for Manager, QA, and Executive dashboards.
 * Uses React Query for caching and state management.
 */
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ManagerQualityData {
  team_summary: {
    avg_quality: number;
    agent_count: number;
    calls_handled: number;
    top_performer: { agent_code: string; agent_name: string; quality: number };
    bottom_performer: { agent_code: string; agent_name: string; quality: number };
    quality_distribution: { excellent: number; good: number; average: number; poor: number };
  };
  agent_breakdown: Array<{
    agent_code: string;
    agent_name: string;
    quality_pct: number;
    calls_handled: number;
    weak_areas: string[];
    coaching_needed: boolean;
    risk_score: number;
  }>;
  last_updated: string;
}

export interface QAQualityData {
  overall: { avg_quality: number; total_calls: number; compliance_rate: number };
  risk_matrix: { critical: number; at_risk: number; coaching_priority: number };
  process_breakdown: Array<{
    process: string;
    avg_quality: number;
    total_calls: number;
    compliance_rate: number;
    risk_level: string;
  }>;
  anomalies: Array<{
    agent_code: string;
    agent_name: string;
    anomaly_type: string;
    description: string;
    severity: string;
  }>;
}

export interface ExecutiveQualityData {
  org_kpis: { overall_quality: number; target: number; gap: number; status: string };
  trends: {
    trend_7d: { direction: string; change_pct: number };
    trend_30d: { direction: string; change_pct: number };
  };
  top_performers: Array<{ rank: number; agent_code: string; agent_name: string; quality_pct: number }>;
  bottom_performers: Array<{ rank: number; agent_code: string; agent_name: string; quality_pct: number }>;
  process_scorecard: Array<{ process: string; avg_quality: number; status: string }>;
  benchmarks: { mean: number; median: number; std_dev: number };
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Fetch team quality data for the Operations/Process Manager view.
 * @param daysBack - Lookback window in days (default: 7)
 * @param process  - Optional process/LOB filter
 */
export function useManagerQuality(daysBack: number = 7, process?: string) {
  const params = new URLSearchParams({ daysBack: String(daysBack) });
  if (process) params.set("process", process);

  return useQuery<ManagerQualityData>({
    queryKey: ["manager-quality", daysBack, process ?? null],
    queryFn: () =>
      hrmsApi.get<ManagerQualityData>(`/api/manager/team-quality?${params.toString()}`),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
  });
}

/**
 * Fetch QA audit data for the Quality Analyst view.
 * @param daysBack - Lookback window in days (default: 7)
 */
export function useQAQuality(daysBack: number = 7) {
  return useQuery<QAQualityData>({
    queryKey: ["qa-quality-audit", daysBack],
    queryFn: () =>
      hrmsApi.get<QAQualityData>(`/api/qa/quality-audit?daysBack=${daysBack}`),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
  });
}

/**
 * Fetch org-level quality summary for the Executive / CEO view.
 * @param daysBack - Lookback window in days (default: 30)
 */
export function useExecutiveQuality(daysBack: number = 30) {
  return useQuery<ExecutiveQualityData>({
    queryKey: ["executive-quality-summary", daysBack],
    queryFn: () =>
      hrmsApi.get<ExecutiveQualityData>(`/api/executive/quality-summary?daysBack=${daysBack}`),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
  });
}
