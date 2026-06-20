/**
 * useAgentQualityData Hook
 * Fetches agent quality data in parallel with staggered cache TTLs
 * Uses React Query for state management and caching
 */
import { useQuery, useQueries } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { useCallback } from "react";

export interface CQScoreData {
  cq_score_current: number;
  cq_score_7day_avg: number;
  cq_score_30day_avg: number;
  cq_score_clean: number;
  rank: { position: number; total_agents: number };
  peer_avg: number;
  target: number;
  gap_pct: number;
  trend_7day: { direction: string; change_pct: number };
  trend_30day: { direction: string; change_pct: number };
  weekly: Array<{ day: string; avg: number; calls: number }>;
  status: "On Track" | "Below Target" | "Risk";
  last_updated: Date;
}

export interface WeaknessArea {
  category: string;
  score: number;
  peer_avg: number;
  gap: number;
  sub_metrics: Array<{ name: string; score: number; peer_avg: number; calls_weak: number }>;
  related_calls: Array<{ call_id: string; date: string; cq_pct: number }>;
}

export interface CallsReviewData {
  total_calls: number;
  page: { limit: number; offset: number; has_next: boolean };
  calls: Array<{
    call_id: string;
    date: string;
    lead_id: string;
    lead_name: string;
    scenario: string;
    cq_pct: number;
    has_fatal: boolean;
    fatal_reason?: string;
    duration_sec: number;
  }>;
  last_updated: Date;
}

export interface CallDetailData {
  call_id: string;
  date: string;
  lead: { id: string; name: string };
  scenario: string;
  cq_pct: number;
  has_fatal: boolean;
  duration_sec: number;
  sub_scores: {
    opening: number;
    soft_skills: number;
    hold_procedure: number;
    resolution: number;
    closing: number;
  };
  recording: { url: string; duration_sec: number };
  transcript: string;
  feedback: string;
  peer_comparison: {
    same_scenario_avg: number;
    your_score: number;
    gap: number;
  };
}

export interface AgentQualityDataState {
  cqScore: CQScoreData | null;
  weakness: { weakness_areas: WeaknessArea[] } | null;
  callsReview: CallsReviewData | null;
  callDetail: CallDetailData | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetch CQ score data
 * Cache: 5 minutes
 */
async function fetchCQScore(employeeId: string): Promise<CQScoreData> {
  try {
    const res = await hrmsApi.get<CQScoreData>(`/api/quality-dashboard/cq-score/${employeeId}`);
    return res || getEmptyCQScore();
  } catch (err) {
    console.error("Failed to fetch CQ score:", err);
    return getEmptyCQScore();
  }
}

/**
 * Fetch weakness details
 * Cache: 10 minutes
 */
async function fetchWeaknessDetail(employeeId: string): Promise<{ weakness_areas: WeaknessArea[] }> {
  try {
    const res = await hrmsApi.get<{ weakness_areas: WeaknessArea[] }>(`/api/quality-dashboard/weakness/${employeeId}`);
    return res || { weakness_areas: [] };
  } catch (err) {
    console.error("Failed to fetch weakness details:", err);
    return { weakness_areas: [] };
  }
}

/**
 * Fetch calls review list (first 10 calls)
 * Cache: 2 minutes
 */
async function fetchCallsReview(employeeId: string, limit = 10, offset = 0): Promise<CallsReviewData> {
  try {
    const res = await hrmsApi.get<CallsReviewData>(
      `/api/quality-dashboard/calls/${employeeId}?limit=${limit}&offset=${offset}&sort=date`
    );
    return res || { total_calls: 0, page: { limit, offset, has_next: false }, calls: [] };
  } catch (err) {
    console.error("Failed to fetch calls review:", err);
    return { total_calls: 0, page: { limit, offset, has_next: false }, calls: [] };
  }
}

/**
 * Fetch single call detail
 * Cache: none (always fresh)
 */
async function fetchCallDetail(callId: string): Promise<CallDetailData | null> {
  try {
    const res = await hrmsApi.get<CallDetailData>(`/api/quality-dashboard/call/${callId}`);
    return res || null;
  } catch (err) {
    console.error("Failed to fetch call detail:", err);
    return null;
  }
}

function getEmptyCQScore(): CQScoreData {
  return {
    cq_score_current: 0,
    cq_score_7day_avg: 0,
    cq_score_30day_avg: 0,
    cq_score_clean: 0,
    rank: { position: 0, total_agents: 0 },
    peer_avg: 0,
    target: 90,
    gap_pct: 90,
    trend_7day: { direction: "→", change_pct: 0 },
    trend_30day: { direction: "→", change_pct: 0 },
    weekly: [],
    status: "Risk" as const,
    last_updated: new Date(),
  };
}

/**
 * Main hook: Fetch all 4 quality data points in parallel
 * Returns combined state + individual query states
 */
export function useAgentQualityData(employeeId?: string, callIdToLoad?: string) {
  const { user } = useAuth();
  const effectiveEmployeeId = employeeId || user?.id || "";
  const isEnabled = !!effectiveEmployeeId;

  // Use useQueries to fetch 4 endpoints in parallel with different cache times
  const queries = useQueries({
    queries: [
      {
        queryKey: ["quality-dashboard", "cq-score", effectiveEmployeeId],
        queryFn: () => fetchCQScore(effectiveEmployeeId),
        staleTime: 5 * 60 * 1000, // 5 minutes
        gcTime: 10 * 60 * 1000, // 10 minutes
        enabled: isEnabled && !callIdToLoad,
        retry: 2,
      },
      {
        queryKey: ["quality-dashboard", "weakness", effectiveEmployeeId],
        queryFn: () => fetchWeaknessDetail(effectiveEmployeeId),
        staleTime: 10 * 60 * 1000, // 10 minutes
        gcTime: 15 * 60 * 1000, // 15 minutes
        enabled: isEnabled && !callIdToLoad,
        retry: 2,
      },
      {
        queryKey: ["quality-dashboard", "calls-review", effectiveEmployeeId],
        queryFn: () => fetchCallsReview(effectiveEmployeeId),
        staleTime: 2 * 60 * 1000, // 2 minutes
        gcTime: 5 * 60 * 1000, // 5 minutes
        enabled: isEnabled && !callIdToLoad,
        retry: 2,
      },
      {
        queryKey: ["quality-dashboard", "call-detail", callIdToLoad],
        queryFn: () => (callIdToLoad ? fetchCallDetail(callIdToLoad) : null),
        staleTime: 0, // No cache - always fresh
        enabled: isEnabled && !!callIdToLoad,
        retry: 1,
      },
    ],
  });

  const [cqScoreQuery, weaknessQuery, callsReviewQuery, callDetailQuery] = queries;

  // Combined loading state: true if any query is loading
  const isLoading = queries.some((q) => q.isLoading);

  // Combined error state: first non-null error
  const error = queries
    .find((q) => q.error)
    ?.error?.message || null;

  const refetch = useCallback(() => {
    Promise.all([
      cqScoreQuery.refetch(),
      weaknessQuery.refetch(),
      callsReviewQuery.refetch(),
      callDetailQuery.refetch(),
    ]);
  }, [cqScoreQuery, weaknessQuery, callsReviewQuery, callDetailQuery]);

  return {
    cqScore: cqScoreQuery.data || null,
    weakness: weaknessQuery.data || null,
    callsReview: callsReviewQuery.data || null,
    callDetail: callDetailQuery.data || null,
    isLoading,
    error,
    refetch,
    // Individual query states for granular loading/error states
    cqScoreLoading: cqScoreQuery.isLoading,
    cqScoreError: cqScoreQuery.error?.message || null,
    weaknessLoading: weaknessQuery.isLoading,
    weaknessError: weaknessQuery.error?.message || null,
    callsLoading: callsReviewQuery.isLoading,
    callsError: callsReviewQuery.error?.message || null,
    callDetailLoading: callDetailQuery.isLoading,
    callDetailError: callDetailQuery.error?.message || null,
  };
}

/**
 * Hook to load individual call detail (lazy loaded on modal open)
 */
export function useCallDetail(callId: string | null) {
  return useQuery({
    queryKey: ["quality-dashboard", "call-detail", callId],
    queryFn: () => (callId ? fetchCallDetail(callId) : null),
    staleTime: 0, // Always fresh
    enabled: !!callId,
    retry: 1,
  });
}
