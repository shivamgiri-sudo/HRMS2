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

export interface CeoTrendPoint {
  period: string;
  revenue: number;
  operatingProfit: number;
  marginPct: number | null;
}

export interface CeoFocus {
  kind: "process" | "cost_centre";
  label: string;
  revenue: number;
  invoiceLines: number;
  peopleCost: number;
  staffPaid: number;
  staffZeroPaid: number;
  indirectCost: number;
  budget: number;
  operatingProfit: number;
  marginPct: number | null;
  revenuePerHead: number | null;
  costPerHead: number | null;
  /** What a reader must know before trusting the margin. Empty when nothing is amiss. */
  notes: string[];
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
  trend: CeoTrendPoint[];
  /** Only values that have data behind them — an option leading to an empty page reads as broken. */
  options: { processes: { id: string; name: string }[]; costCentres: { id: string; code: string }[] };
  /** Present only when a process or cost centre filter is active. */
  focus: CeoFocus | null;
}

export interface CeoOverviewFilters {
  branchId?: string;
  processId?: string;
  costCentreId?: string;
}

export function useCeoOverview(period: string, filters: CeoOverviewFilters = {}) {
  const { branchId, processId, costCentreId } = filters;
  return useQuery({
    queryKey: ["ceo-overview", period, branchId ?? "", processId ?? "", costCentreId ?? ""],
    enabled: Boolean(period),
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (branchId) params.set("branchId", branchId);
      if (processId) params.set("processId", processId);
      if (costCentreId) params.set("costCentreId", costCentreId);
      const response = await hrmsApi.get<{ success: boolean; data: CeoOverview }>(
        `/api/finance/pnl/ceo-overview?${params.toString()}`,
      );
      return response.data;
    },
  });
}
