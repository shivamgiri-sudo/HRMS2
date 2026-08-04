import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * The CEO view: branch comparison plus a ranked list of where operating profit is recoverable.
 *
 * Separate from usePnlStatement because it answers a different question. The statement says what
 * the numbers were; this says where to act, which needs comparisons the statement does not make —
 * branch against branch, cost ratio against the best performer, revenue against the people who
 * earned it.
 */

export interface CeoBranchRow {
  branchId: string | null;
  branchName: string;
  revenue: number;
  peopleCost: number;
  staffPaid: number;
  indirectCost: number;
  budget: number;
  operatingProfit: number;
  /** Null where a margin is meaningless — a cost centre with no client revenue, or a closed branch. */
  marginPct: number | null;
  revenuePerHead: number | null;
  /** Set when the row cannot be read at face value, e.g. revenue with nobody posted to it. */
  flag: string | null;
  isCostCentre: boolean;
  isClosed: boolean;
}

export interface CeoOpportunity {
  id: string;
  severity: "critical" | "warning" | "settled";
  value: string;
  valueUnit: string;
  title: string;
  detail: string;
  action: string;
}

export interface CeoOverview {
  period: string;
  revenue: number;
  peopleCost: number;
  indirectCost: number;
  operatingProfit: number;
  marginPct: number | null;
  staffPaid: number;
  revenuePerHead: number | null;
  branches: CeoBranchRow[];
  opportunities: CeoOpportunity[];
}

export function useCeoOverview(period: string, branchId?: string) {
  return useQuery({
    queryKey: ["ceo-overview", period, branchId ?? ""],
    enabled: Boolean(period),
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (branchId) params.set("branchId", branchId);
      const response = await hrmsApi.get<{ success: boolean; data: CeoOverview }>(
        `/api/finance/pnl/ceo-overview?${params.toString()}`,
      );
      return response.data;
    },
  });
}
