import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface PnlSeatBillabilityRow {
  costCentreId: string;
  costCentreName: string;
  processId: string | null;
  processName: string | null;
  branchId: string | null;
  mandatedSeats: number | null;
  actualHeadcount: number;
  billabilityPct: number | null;
  seatConfigStatus: "configured" | "not_configured";
  approvedSeatRateMonthly: number | null;
}

export interface PnlSeatBillabilityData {
  costCentres: PnlSeatBillabilityRow[];
  coverage: {
    totalActiveCostCentres: number;
    configuredCount: number;
    notConfiguredCount: number;
  };
}

export interface PnlSeatBillabilityFilters {
  branchId?: string;
  processId?: string;
}

/**
 * Per-cost-centre mandated seats vs live headcount vs billability%.
 * `seatConfigStatus === "not_configured"` (mandated_seats NULL/0) must render as "Not configured",
 * never as a fabricated 0%.
 */
export function usePnlSeatBillability(filters: PnlSeatBillabilityFilters = {}) {
  const params = new URLSearchParams();
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.processId) params.set("processId", filters.processId);
  const qs = params.toString();

  return useQuery({
    queryKey: ["pnl-seat-billability", filters.branchId ?? "", filters.processId ?? ""],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: PnlSeatBillabilityData }>(
        `/api/finance/pnl/seat-billability${qs ? `?${qs}` : ""}`
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
