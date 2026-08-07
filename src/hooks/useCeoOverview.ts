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

/** A branch that billed steadily in the baseline months and has almost nothing in this one. */
export interface CeoBillingGap {
  branchName: string;
  baselineRevenue: number;
  currentRevenue: number;
}

/**
 * Whether this month's invoicing is finished or still being raised.
 *
 * MAS bills in arrears — a large part of any month is invoiced during the next one — so a month
 * read too early is not a bad month, it is an unfinished one. The figures are never adjusted for
 * this; only labelled, so a reader knows which of the two they are looking at.
 */
export interface CeoBillingCompleteness {
  lines: number;
  baselineLines: number;
  pctOfBaseline: number | null;
  incomplete: boolean;
  gaps: CeoBillingGap[];
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
  /**
   * Only values that have data behind them — an option leading to an empty page reads as broken.
   *
   * `options.branches` is every branch that traded this period, NOT the filtered `branches` array:
   * the dropdown must keep offering the others once one is ticked.
   */
  options: {
    processes: { id: string; name: string }[];
    costCentres: { id: string; code: string }[];
    branches: { id: string; name: string }[];
  };
  /** Present only when exactly one process or cost centre is selected. */
  focus: CeoFocus | null;
  billing: CeoBillingCompleteness;
  /** Closed branches left out of `branches` because every money column was zero. */
  closedBranchesHidden: { branchName: string; staffPaid: number }[];
}

export interface CeoOverviewFilters {
  /** Empty means all. Kept as lists so the page can compare several at once. */
  branchIds?: string[];
  processIds?: string[];
  costCentreIds?: string[];
}

export function useCeoOverview(period: string, filters: CeoOverviewFilters = {}) {
  const branchIds = filters.branchIds ?? [];
  const processIds = filters.processIds ?? [];
  const costCentreIds = filters.costCentreIds ?? [];
  /* Sorted in the key so ticking A then B and B then A are one cached query rather than two. The
   * server treats the list as a set, so the order genuinely carries no meaning. */
  const key = (ids: string[]) => [...ids].sort().join(",");
  return useQuery({
    queryKey: ["ceo-overview", period, key(branchIds), key(processIds), key(costCentreIds)],
    enabled: Boolean(period),
    /*
     * Keep the previous month's data on screen while the next one loads.
     *
     * Without this, ticking a branch changes the query key, isLoading flips back to true, and
     * CeoOverviewPanel returns its spinner instead of the panel — which unmounts the filter
     * dropdown mid-use and closes it. With a single-select that was invisible, because choosing one
     * option ends the interaction anyway. With checkboxes it makes multi-select impossible: the
     * panel shuts after every tick, so a second branch can never be added without reopening.
     *
     * Confirmed in the browser before and after: NOIDA then NOIDA-2 in one interaction.
     */
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (branchIds.length) params.set("branchIds", branchIds.join(","));
      if (processIds.length) params.set("processIds", processIds.join(","));
      if (costCentreIds.length) params.set("costCentreIds", costCentreIds.join(","));
      const response = await hrmsApi.get<{ success: boolean; data: CeoOverview }>(
        `/api/finance/pnl/ceo-overview?${params.toString()}`,
      );
      return response.data;
    },
  });
}
