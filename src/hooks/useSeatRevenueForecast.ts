import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * Seat-count x seat-rate revenue forecast.
 *
 * Informational only — it suggests a figure for the existing Projected Revenue manual adjustment
 * and never enters recognised revenue, operating profit or EBITDA.
 */

export interface SeatForecastProcess {
  processId: string;
  processName: string | null;
  billableSeats: number;
  projectedMonthEnd: number;
  earnedToDate: number;
}

export interface SeatForecastCostCentre {
  costCentreId: string;
  costCentreName: string;
  processId: string | null;
  processName: string | null;
  branchName: string | null;
  seatRateMonthly: number;
  activeHeadcount: number;
  billableSeats: number;
  unclassifiedHeadcount: number;
  projectedMonthEnd: number;
  earnedToDate: number;
}

export interface SeatRevenueForecast {
  period: string;
  asOfDate: string;
  daysElapsed: number;
  daysInMonth: number;
  classificationPeriod: string | null;
  costCentres: SeatForecastCostCentre[];
  byProcess: SeatForecastProcess[];
  projectedMonthEnd: number;
  earnedToDate: number;
  billableSeats: number;
  unclassifiedHeadcount: number;
  coverage: {
    seatBilledCostCentres: number;
    notSeatBilledCostCentres: number;
    activeCostCentresWithStaff: number;
    coveragePct: number;
  };
  method: "seat_rate_run_rate";
}

export function useSeatRevenueForecast(period: string, branchId?: string) {
  return useQuery({
    queryKey: ["pnl-seat-revenue-forecast", period, branchId ?? null],
    enabled: Boolean(period),
    queryFn: async () => {
      const search = new URLSearchParams({ period });
      if (branchId) search.set("branchId", branchId);
      const response = await hrmsApi.get<{ success: boolean; data: SeatRevenueForecast }>(
        `/api/finance/pnl/seat-revenue-forecast?${search.toString()}`
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
