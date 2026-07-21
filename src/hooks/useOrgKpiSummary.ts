/**
 * useOrgKpiSummary — React Query hook for org-wide KPI performance data.
 * Wraps GET /api/kpi/org-summary?period=YYYY-MM.
 * Only enabled for executive-level roles (super_admin, admin, ceo, coo).
 *
 * Field names match OrgKpiSummary / ProcessKpiSummary returned by
 * kpi-org-summary.service.ts.
 */
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useUserRole } from "./useUserRole";

// ─── Types (aligned with backend OrgKpiSummary) ───────────────────────────────

export interface ProcessKpiSummary {
  processId: string;
  processName: string;
  branchName: string;
  agentCount: number;
  avgScore: number;
  topScore: number;
  bottomScore: number;
  /** Agents with score ≥ 100 */
  sRating: number;
  /** Agents with score 90–99 */
  aRating: number;
  /** Agents with score 75–89 */
  bRating: number;
  /** Agents with score 60–74 */
  cRating: number;
  /** Agents with score < 60 */
  dRating: number;
}

export interface OrgKpiSummary {
  orgAvgScore: number;
  totalAgentsScored: number;
  /** Normalised period string in YYYY-MM format */
  periodLabel: string;
  processSummaries: ProcessKpiSummary[];
  topProcess: { processName: string; avgScore: number } | null;
  bottomProcess: { processName: string; avgScore: number } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EXEC_ROLES = new Set(["super_admin", "admin", "ceo", "coo", "manager"]);
const STALE = 5 * 60 * 1000;
const GC = 10 * 60 * 1000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetch aggregated KPI performance across all processes for a given month.
 * Role-gated: only enabled when the current user holds an executive role.
 *
 * @param period - Month string in YYYY-MM format. Defaults to the current month.
 */
export function useOrgKpiSummary(period?: string, enabled = true) {
  const { data: roleData } = useUserRole();
  const isAllowed =
    roleData?.roleKeys?.some((r: string) => EXEC_ROLES.has(r)) ?? false;

  const defaultPeriod = new Date().toISOString().substring(0, 7);
  const activePeriod = period ?? defaultPeriod;

  return useQuery<OrgKpiSummary, Error>({
    queryKey: ["org-kpi-summary", activePeriod],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: OrgKpiSummary }>(
        `/api/kpi/org-summary?period=${encodeURIComponent(activePeriod)}`
      );
      return (res as { success: boolean; data: OrgKpiSummary }).data;
    },
    enabled: enabled && isAllowed,
    staleTime: STALE,
    gcTime: GC,
    retry: 2,
  });
}
