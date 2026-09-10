import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface AgeingBucketAmounts {
  "0-30": number;
  "31-60": number;
  "61-90": number;
  "90+": number;
}

export interface PnlReceivablesAgeingProcessRow {
  processId: string | null;
  processName: string | null;
  buckets: AgeingBucketAmounts;
  total: number;
  invoiceCount: number;
}

export interface PnlReceivablesAgeingData {
  asOfDate: string;
  totals: AgeingBucketAmounts;
  grandTotal: number;
  byProcess: PnlReceivablesAgeingProcessRow[];
  dataStatus: "approximate";
  caveat: string;
}

export interface PnlReceivablesAgeingFilters {
  branchId?: string;
  processId?: string;
}

/**
 * Unpaid receivables by days-since-invoice bucket (not "days overdue" — no due_date exists).
 * Always render `data.caveat` as a visible warning badge; ~99% of the unpaid amount is in the
 * 90+ bucket, which looks like a stale payment_status flag rather than a live AR position.
 */
export function usePnlReceivablesAgeing(filters: PnlReceivablesAgeingFilters = {}) {
  const params = new URLSearchParams();
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.processId) params.set("processId", filters.processId);
  const qs = params.toString();

  return useQuery({
    queryKey: ["pnl-receivables-ageing", filters.branchId ?? "", filters.processId ?? ""],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: PnlReceivablesAgeingData }>(
        `/api/finance/pnl/receivables-ageing${qs ? `?${qs}` : ""}`
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
