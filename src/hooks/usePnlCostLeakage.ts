import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * Cost Leakage Review — spend that reaches no process P&L line.
 *
 * Scoped to the financial year containing `period`, and for the actionable buckets only up to that
 * period, so future-dated records that have deliberately not been budgeted yet do not read as a gap.
 */

export type LeakageSeverity = "critical" | "warning" | "info";

export interface LeakageRow {
  id: string;
  label: string;
  detail: string | null;
  count: number;
  amount: number;
}

export interface LeakageBucket {
  code: string;
  title: string;
  detail: string;
  severity: LeakageSeverity;
  /** False for context buckets that are correct as they stand and need no action. */
  actionable: boolean;
  count: number;
  amount: number;
  rows: LeakageRow[];
}

export interface CostLeakageReview {
  financeYear: string;
  periodFrom: string;
  periodTo: string;
  generatedAt: string;
  buckets: LeakageBucket[];
  actionableAmount: number;
}

export function usePnlCostLeakage(period: string) {
  return useQuery({
    queryKey: ["pnl-cost-leakage", period],
    enabled: Boolean(period),
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: CostLeakageReview }>(
        `/api/finance/pnl/cost-leakage?period=${encodeURIComponent(period)}`
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
