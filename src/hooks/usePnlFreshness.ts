import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * The small, shared staleness/freshness signal every P&L view mounts a badge from. A thin
 * projection of the same getPnlReconciliation() call the "Live P&L" tab already renders in full
 * (PnlReconciliationPanel.tsx / usePnlLiveReconciliation.ts) — same backend function, so this can
 * never disagree with what that tab shows, and it stays cheap for the other six views that don't
 * need the full row-level breakdown.
 */
export type PnlFreshnessMode = "FINAL" | "LIVE_MTD" | "BLOCKED";
export type PnlSourceStatus = "ACTUAL" | "ACCRUAL" | "MISSING" | "PARTIAL";

export interface PnlSourceFreshness {
  source: string;
  table: string;
  rows: number;
  latestSyncedAt: string | null;
  status: PnlSourceStatus;
}

export interface PnlFreshnessSummary {
  mode: PnlFreshnessMode;
  generatedAt: string;
  blockers: string[];
  freshness: PnlSourceFreshness[];
  exceptions: Array<{ code: string; label: string; amount: number; count: number }>;
}

export function usePnlFreshness(period: string, filters: { branchId?: string; branchIds?: string[] } = {}) {
  const branchIds = filters.branchIds ?? (filters.branchId ? [filters.branchId] : []);
  const branchKey = [...branchIds].sort().join(",");
  return useQuery({
    queryKey: ["pnl-freshness", period, branchKey],
    enabled: Boolean(period),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (branchIds.length) params.set("branchIds", branchIds.join(","));
      const response = await hrmsApi.get<{ success: boolean; data: PnlFreshnessSummary }>(
        `/api/finance/pnl/freshness?${params.toString()}`,
      );
      return response.data;
    },
  });
}
