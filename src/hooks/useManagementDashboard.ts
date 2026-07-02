/**
 * useManagementDashboard — React Query hooks for the Management Dashboard page.
 * Fetches from /api/management/* endpoints with 5-minute stale time.
 */
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TeamOverview {
  headcount: number;
  utilization_pct: number;
  avg_quality_score: number;
  monthly_cost: number;
}

export interface AgentPerformance {
  agent_id: string;
  agent_name: string;
  quality_pct: number;
  calls: number;
  risk_score: number;
  coaching_needed: boolean;
}

export interface PayrollProjectionDay {
  date: string;
  projected_cost: number;
  actual_cost?: number;
}

export interface PayrollProjection {
  period_start: string;
  period_end: string;
  days: PayrollProjectionDay[];
  total_projected: number;
}

export interface TrainingNeed {
  agent_id: string;
  agent_name: string;
  skill_gap: string;
  current_score: number;
  target_score: number;
  priority: "high" | "medium" | "low";
}

// ── Fetch helpers ──────────────────────────────────────────────────────────

const STALE = 5 * 60 * 1000; // 5 minutes
const GC    = 10 * 60 * 1000; // 10 minutes

async function fetchTeamOverview(): Promise<TeamOverview> {
  const res = await hrmsApi.get<{ success: boolean; data: TeamOverview }>("/api/management/team-overview");
  return (res as { success: boolean; data: TeamOverview }).data;
}

async function fetchAgentPerformance(sortBy?: string): Promise<AgentPerformance[]> {
  const qs = sortBy ? `?sort_by=${encodeURIComponent(sortBy)}` : "";
  const res = await hrmsApi.get<{ success: boolean; data: AgentPerformance[] }>(`/api/management/agent-performance${qs}`);
  return (res as { success: boolean; data: AgentPerformance[] }).data ?? [];
}

async function fetchPayrollProjection(): Promise<PayrollProjection> {
  const res = await hrmsApi.get<{ success: boolean; data: PayrollProjection }>("/api/management/payroll-projection");
  return (res as { success: boolean; data: PayrollProjection }).data;
}

async function fetchTrainingNeeds(): Promise<TrainingNeed[]> {
  const res = await hrmsApi.get<{ success: boolean; data: TrainingNeed[] }>("/api/management/training-needs");
  return (res as { success: boolean; data: TrainingNeed[] }).data ?? [];
}

// ── Hooks ──────────────────────────────────────────────────────────────────

export function useTeamOverview() {
  return useQuery<TeamOverview, Error>({
    queryKey: ["management", "team-overview"],
    queryFn: fetchTeamOverview,
    staleTime: STALE,
    gcTime: GC,
    retry: 2,
  });
}

export function useAgentPerformance(sortBy?: string) {
  return useQuery<AgentPerformance[], Error>({
    queryKey: ["management", "agent-performance", sortBy ?? ""],
    queryFn: () => fetchAgentPerformance(sortBy),
    staleTime: STALE,
    gcTime: GC,
    retry: 2,
  });
}

export function usePayrollProjection() {
  return useQuery<PayrollProjection, Error>({
    queryKey: ["management", "payroll-projection"],
    queryFn: fetchPayrollProjection,
    staleTime: STALE,
    gcTime: GC,
    retry: 2,
  });
}

export function useTrainingNeeds() {
  return useQuery<TrainingNeed[], Error>({
    queryKey: ["management", "training-needs"],
    queryFn: fetchTrainingNeeds,
    staleTime: STALE,
    gcTime: GC,
    retry: 2,
  });
}
