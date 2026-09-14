import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * The row-level detail behind one P&L cell.
 *
 * Backed by GET /api/finance/pnl/drilldown, which wraps the drilldown service the P&L has always
 * had but never exposed. Scope is exactly one of branchId / processId / costCentreId — the same
 * three kinds the summary cells themselves are keyed by — and the server refuses any other
 * combination rather than quietly picking one.
 */

export type PnlDrilldownMetric = "revenue" | "people" | "indirect" | "budget";

export interface PnlDrilldownRow {
  id: string;
  label: string;
  detail: string | null;
  amount: number;
  date: string | null;
}

export interface PnlDrilldownResult {
  metric: PnlDrilldownMetric;
  scope: Record<string, string | undefined>;
  rows: PnlDrilldownRow[];
  total: number;
  /** Some rows came from an estimate (a provision standing in for an unraised invoice, or an
   *  earned-to-date accrual before payroll has run) rather than a posted document. */
  hasEstimatedRows: boolean;
  /** People cost was returned grouped by designation because the caller is entitled to the P&L
   *  but not to payroll. Not an error — the total is the same, only the grain differs. */
  peopleAggregated?: boolean;
}

export type PnlPeopleBucket = "agent_salary" | "dsc_people" | "bmc_people";

export interface PnlDrilldownParams {
  metric: PnlDrilldownMetric;
  period: string;
  branchId?: string;
  processId?: string;
  costCentreId?: string;
  /** Narrows people cost to one statement line (Agent Salary / DSC People / BMC People) so the
   *  drilldown total matches the cell clicked rather than the sum of all three. */
  peopleBucket?: PnlPeopleBucket;
}

export function usePnlDrilldown(params: PnlDrilldownParams | null) {
  const scopeKeys = params
    ? [params.branchId, params.processId, params.costCentreId].filter(Boolean).length
    : 0;
  // The server rejects anything but exactly one scope key; not asking is better than a
  // guaranteed 400 while a drawer is opening.
  const enabled = Boolean(params?.period) && scopeKeys === 1;

  return useQuery({
    queryKey: ["pnl-drilldown", params],
    enabled,
    queryFn: async () => {
      const search = new URLSearchParams({ metric: params!.metric, period: params!.period });
      if (params!.branchId) search.set("branchId", params!.branchId);
      if (params!.processId) search.set("processId", params!.processId);
      if (params!.costCentreId) search.set("costCentreId", params!.costCentreId);
      if (params!.peopleBucket) search.set("peopleBucket", params!.peopleBucket);
      const response = await hrmsApi.get<{ success: boolean; data: PnlDrilldownResult }>(
        `/api/finance/pnl/drilldown?${search.toString()}`
      );
      return response.data;
    },
    staleTime: 30_000,
  });
}
