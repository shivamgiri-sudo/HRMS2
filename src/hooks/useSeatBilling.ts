import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * Seat billing — revenue per day from seat rate x seats, per cost centre and LOB line.
 * Mirrors backend/src/modules/process-pnl/pnl-seat-billing.service.ts; keep the two in step
 * (the frontend typecheck runs strict:false and cannot catch a misnamed key).
 */

export type SeatLineKind = "seat" | "fixed";

export interface SeatBillingLine {
  id: string | null;
  lineLabel: string;
  lineKind: SeatLineKind;
  rateMonthly: number;
  seats: number;
  monthlyValue: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  notes: string | null;
  sourceBillId: number | null;
}

export interface ExcludedInvoiceLine {
  lineLabel: string;
  amount: number;
  reason: "incentive" | "one_time" | "usage" | "revenue_share" | "zero_value";
  sourceBillId: number | null;
}

export interface CostCentreSeatBilling {
  costCentreId: string;
  costCentreCode: string;
  costCentreName: string;
  /** Mapped process, else billing process name; null when unknown. */
  processName?: string | null;
  branchId: string | null;
  branchName: string | null;
  source: "configured" | "invoice" | "none";
  sourcePeriod: string | null;
  lines: SeatBillingLine[];
  excludedLines: ExcludedInvoiceLine[];
  seats: number;
  monthlyValue: number;
  perDay: number;
  toDate: number;
}

export interface SeatBillingEstimate {
  period: string;
  asOfDate: string;
  daysInMonth: number;
  daysElapsed: number;
  configurationAvailable: boolean;
  costCentres: CostCentreSeatBilling[];
  totals: {
    costCentres: number;
    configured: number;
    fromInvoice: number;
    withoutRate: number;
    seats: number;
    monthlyValue: number;
    perDay: number;
    toDate: number;
  };
}

export interface SeatBillingHistoryRow {
  id: string;
  lineLabel: string;
  lineKind: SeatLineKind;
  rateMonthly: number;
  seats: number;
  monthlyValue: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: "manual" | "invoice";
  sourcePeriod: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SeatBillingCostCentreDetail {
  period: string;
  asOfDate: string;
  daysInMonth: number;
  daysElapsed: number;
  configurationAvailable: boolean;
  costCentre: CostCentreSeatBilling;
  history: SeatBillingHistoryRow[];
  invoiceHistory: Array<{
    period: string;
    billSourceId: number | null;
    lineLabel: string;
    rate: number;
    qty: number;
    amount: number;
    classification: string;
  }>;
  auditTrail: Array<{
    at: string;
    action: string;
    lineId: string;
    actor: string | null;
    change: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; reason?: string | null } | null;
  }>;
}

export interface SeatBillingLinePayload {
  costCentreId?: string;
  lineLabel: string;
  lineKind: SeatLineKind;
  rateMonthly?: number;
  seats?: number;
  monthlyAmount?: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  notes?: string | null;
}

export function useSeatBilling(period: string, branchId?: string) {
  return useQuery({
    queryKey: ["pnl-seat-billing", period, branchId ?? null],
    enabled: /^\d{4}-\d{2}$/.test(period),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (branchId) params.set("branchId", branchId);
      const response = await hrmsApi.get<{ success: boolean; data: SeatBillingEstimate }>(
        `/api/finance/pnl/seat-billing?${params.toString()}`,
      );
      return response.data;
    },
  });
}

export function useSeatBillingCostCentre(costCentreId: string | null, period: string) {
  return useQuery({
    queryKey: ["pnl-seat-billing-cc", costCentreId, period],
    enabled: Boolean(costCentreId) && /^\d{4}-\d{2}$/.test(period),
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: SeatBillingCostCentreDetail }>(
        `/api/finance/pnl/seat-billing/cost-centres/${encodeURIComponent(costCentreId ?? "")}?period=${period}`,
      );
      return response.data;
    },
  });
}

/**
 * Every write moves Live P&L revenue for the months it covers, so the reconciliation cache goes
 * with the seat-billing caches — otherwise the Live P&L tab keeps a pre-edit figure for a minute.
 */
export function useSeatBillingMutations() {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pnl-seat-billing"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-seat-billing-cc"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-live-reconciliation"] }),
    ]);
  };

  const createLine = useMutation({
    mutationFn: async (payload: SeatBillingLinePayload) =>
      (await hrmsApi.post<{ success: boolean; data: unknown }>("/api/finance/pnl/seat-billing/lines", payload)).data,
    onSuccess: invalidate,
  });

  const updateLine = useMutation({
    mutationFn: async ({ id, ...payload }: SeatBillingLinePayload & { id: string }) =>
      (await hrmsApi.patch<{ success: boolean; data: unknown }>(`/api/finance/pnl/seat-billing/lines/${encodeURIComponent(id)}`, payload)).data,
    onSuccess: invalidate,
  });

  const deactivateLine = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      (await hrmsApi.post<{ success: boolean; data: unknown }>(`/api/finance/pnl/seat-billing/lines/${encodeURIComponent(id)}/deactivate`, { reason })).data,
    onSuccess: invalidate,
  });

  const importFromInvoice = useMutation({
    mutationFn: async ({ costCentreId, period }: { costCentreId: string; period: string }) =>
      (await hrmsApi.post<{ success: boolean; data: { imported: number; sourcePeriod: string } }>(
        "/api/finance/pnl/seat-billing/import",
        { costCentreId, period },
      )).data,
    onSuccess: invalidate,
  });

  return { createLine, updateLine, deactivateLine, importFromInvoice };
}
