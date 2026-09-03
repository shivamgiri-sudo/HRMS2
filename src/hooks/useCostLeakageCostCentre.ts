import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { PnlDrilldownRow } from "@/hooks/usePnlDrilldown";

/**
 * The GRNs behind one staffless cost centre, for the financial year to date.
 *
 * Separate from usePnlDrilldown because the Cost Leakage bucket totals a year from grn_request
 * while the drilldown answers one period from the snapshot mirror; opening the row through the
 * latter shows nothing whenever the spend fell in an earlier month.
 */
export function useCostLeakageCostCentre(period: string, costCentreId: string | null) {
  return useQuery({
    queryKey: ["pnl-cost-leakage-cc", period, costCentreId],
    enabled: Boolean(period && costCentreId),
    queryFn: async () => {
      const search = new URLSearchParams({ period, costCentreId: costCentreId! });
      const response = await hrmsApi.get<{ success: boolean; data: { rows: PnlDrilldownRow[]; total: number } }>(
        `/api/finance/pnl/cost-leakage/cost-centre?${search.toString()}`
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
