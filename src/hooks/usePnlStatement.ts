import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { BpoPnlFilters } from "@/hooks/useBpoProcessPnl";

export type PnlStatementViewBy = "process" | "branch" | "lob";

export interface PnlStatementColumn {
  id: string;
  code: string;
  name: string;
  branchName: string | null;
  processName: string | null;
  status: string | null;
  /**
   * Share of this column's active headcount that the people cost actually accounts for. Below 100
   * the Operating Profit is overstated by whatever the uncovered staff would have cost, so the
   * shortfall must be shown rather than left for the reader to discover. Absent until a running
   * salary snapshot has been taken for the period.
   */
  peopleCostCoveragePct?: number;
  peopleCostActiveEmployees?: number;
  peopleCostCoveredEmployees?: number;
}

export interface PnlStatementRow {
  componentKey: string;
  displayName: string;
  section: "headcount" | "revenue" | "cost" | "profitability";
  format: "CURRENCY" | "PERCENTAGE" | "COUNT";
  isSubtotal: boolean;
  values: Record<string, number | null>;
}

export interface PnlStatement {
  viewBy: PnlStatementViewBy;
  calculationEngine?: string;
  generatedAt: string;
  /** Date the running-month people cost was computed up to. Null when no snapshot exists. */
  peopleCostAsOf?: string | null;
  columns: PnlStatementColumn[];
  rows: PnlStatementRow[];
}

function queryString(filters: BpoPnlFilters, viewBy: PnlStatementViewBy) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value as string);
  });
  params.set("viewBy", viewBy);
  return `?${params.toString()}`;
}

export function usePnlStatement(filters: BpoPnlFilters, viewBy: PnlStatementViewBy) {
  return useQuery({
    queryKey: ["pnl-statement", filters, viewBy],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: PnlStatement }>(
        `/api/finance/pnl/statement${queryString(filters, viewBy)}`
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
