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

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * The interfaces above say `number`, but the API does not always send one.
 *
 * quality-executive.service.ts passes several fields straight out of MySQL —
 * `ROUND(AVG(quality_percentage), 2)`, `ROUND(STDDEV(...), 2)` — and mysql2 hands DECIMALs
 * back as *strings* ("73.45"). React renders a string fine, so this stayed invisible until
 * a `.toFixed(1)` call site: `p.quality_score.toFixed(1)` throws "toFixed is not a function"
 * and takes the whole page down. That is the same defect that blanked /quality-dashboard
 * (see FailRatesBars and src/tests/quality-fail-rates.contract.test.tsx).
 *
 * Only the fields the service computes in JS (metrics.*, median_quality) are genuinely
 * numbers. Rather than guard each of the five render sites, coerce once here so the rest of
 * the page can trust the type it was already given.
 */
export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeExecutiveSummary(raw: ExecutiveSummaryResponse): ExecutiveSummaryResponse {
  const rank = (p: PerformerRank): PerformerRank => ({
    ...p,
    quality_score: num(p.quality_score),
    calls_handled: num(p.calls_handled),
  });

  return {
    ...raw,
    top_performers: (raw.top_performers ?? []).map(rank),
    bottom_performers: (raw.bottom_performers ?? []).map(rank),
    process_performance: (raw.process_performance ?? []).map((r) => ({
      ...r,
      avg_quality: num(r.avg_quality),
      agent_count: num(r.agent_count),
      calls_handled: num(r.calls_handled),
    })),
    org_benchmarks: {
      avg_quality: num(raw.org_benchmarks?.avg_quality),
      median_quality: num(raw.org_benchmarks?.median_quality),
      std_deviation: num(raw.org_benchmarks?.std_deviation),
    },
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
export function useExecutiveQualitySummary(daysBack: 7 | 30 | 90 = 30, enabled = true) {
  const { data: roleData } = useUserRole();
  const isAllowed =
    roleData?.roleKeys?.some((r: string) => EXEC_ROLES.has(r)) ?? false;

  return useQuery<ExecutiveSummaryResponse, Error>({
    queryKey: ["executive-quality-summary", daysBack],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: ExecutiveSummaryResponse }>(
        `/api/executive/quality-summary?daysBack=${daysBack}`
      );
      return normalizeExecutiveSummary(
        (res as { success: boolean; data: ExecutiveSummaryResponse }).data,
      );
    },
    enabled: enabled && isAllowed,
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
      const rows = (res as { success: boolean; data: ProcessPerformanceRow[] }).data ?? [];
      return rows.map((r) => ({
        ...r,
        avg_quality: num(r.avg_quality),
        agent_count: num(r.agent_count),
        calls_handled: num(r.calls_handled),
      }));
    },
    enabled: isAllowed,
    staleTime: STALE,
    gcTime: GC,
    retry: 2,
  });
}
