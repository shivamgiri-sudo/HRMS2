import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  /**
   * Manual Adjustments: APPROVED Projected Revenue / Penalty / Reward entries for this process,
   * folded into a figure shown ALONGSIDE the system-calculated revenue — never in place of it.
   * Absent for a branch/LOB column (adjustments are process-scoped) or when none exist.
   */
  manualAdjustment?: {
    approvedProjectedRevenue: number;
    approvedRewards: number;
    approvedPenalties: number;
    adjustedTotal: number;
    pendingAdjustmentCount: number;
  };
}

export interface PnlStatementRow {
  componentKey: string;
  displayName: string;
  section: "headcount" | "revenue" | "cost" | "profitability";
  format: "CURRENCY" | "PERCENTAGE" | "COUNT";
  isSubtotal: boolean;
  /** Set when this line explains the one above it rather than adding to it. */
  parentComponentKey?: string | null;
  values: Record<string, number | null>;
}

export interface PnlStatement {
  viewBy: PnlStatementViewBy;
  calculationEngine?: string;
  generatedAt: string;
  /** Date the running-month people cost was computed up to. Null when no snapshot exists. */
  peopleCostAsOf?: string | null;
  /** "invoiced" once the month has closed, "planned" while it is still running. */
  revenueBasis?: "invoiced" | "planned";
  periodOpen?: boolean;
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

/** What a refresh actually did, so the caller can report coverage rather than just "done". */
export interface RunningSalarySnapshotResult {
  periodCode: string;
  asOfDate: string;
  employeesConsidered: number;
  snapshotted: number;
  skipped: number;
  failed: number;
  totalEarned: number;
}

/**
 * The statement's Agent/DSC/BMC people cost is read from pnl_running_salary_snapshot,
 * a stored snapshot — never computed live, because it costs one computeRunningSalary()
 * call per employee. Nothing in the app triggered a refresh, so the figure was as old
 * as whoever last called the endpoint by hand, while the statement presented it beside
 * live revenue as though both were current.
 *
 * Deliberately a manual action rather than an on-read refresh: a few hundred employees
 * take minutes, which is not something to hang a statement load on. The generous
 * timeout reflects that — the backend runs six employees at a time and a large branch
 * genuinely can take several minutes.
 */
export function useRefreshRunningSalarySnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { period: string; branchId?: string }) => {
      const response = await hrmsApi.post<{ success: boolean; data: RunningSalarySnapshotResult }>(
        "/api/finance/pnl/running-salary/refresh",
        { period: vars.period, branchId: vars.branchId },
        10 * 60 * 1000,
      );
      return response.data;
    },
    onSuccess: () => {
      // The statement reads the snapshot this just rewrote, as does the summary.
      void queryClient.invalidateQueries({ queryKey: ["pnl-statement"] });
      void queryClient.invalidateQueries({ queryKey: ["pnl-summary"] });
    },
  });
}
