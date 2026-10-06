import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/** Client for /api/finance/revenue-forecasts (backend revenue-forecast.routes.ts). */

export type ForecastLineType = "seat" | "metric" | "fixed" | "reward" | "penalty";
export type ForecastStatus = "missing" | "draft" | "submitted" | "approved" | "rejected" | "closed";
export type ApprovalState = "pending" | "approved" | "rejected";

export interface ForecastListRow {
  costCentreId: string;
  costCentreCode: string | null;
  costCentreName: string | null;
  branchId: string | null;
  branchName: string | null;
  forecastId: string | null;
  status: ForecastStatus;
  forecastAmount: number | null;
  closedAmount: number | null;
  variance: number | null;
  financeHeadStatus: ApprovalState | null;
  payrollHeadStatus: ApprovalState | null;
  lineCount: number;
  overdue: boolean;
  pnlBasis: "OPEN" | "CLOSED" | null;
}

export interface ForecastList {
  period: string;
  dueDate: string;
  rows: ForecastListRow[];
}

export interface ForecastLine {
  id: string;
  line_no: number;
  line_type: ForecastLineType;
  description: string;
  metric_key: string | null;
  quantity: number | string | null;
  rate: number | string | null;
  amount: number | string;
  actual_quantity: number | string | null;
  actual_rate: number | string | null;
  actual_amount: number | string | null;
}

export interface ForecastDetail {
  id: string;
  branch_id: string;
  cost_centre_id: string;
  cost_centre_code: string | null;
  cost_centre_name: string | null;
  branch_name: string | null;
  period_code: string;
  status: Exclude<ForecastStatus, "missing">;
  forecast_amount: number | string;
  closed_amount: number | string | null;
  notes: string | null;
  finance_head_status: ApprovalState;
  finance_head_at: string | null;
  finance_head_note: string | null;
  payroll_head_status: ApprovalState;
  payroll_head_at: string | null;
  payroll_head_note: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  closed_at: string | null;
  close_note: string | null;
  reopen_reason: string | null;
  lines: ForecastLine[];
}

export interface LineInput {
  lineType: ForecastLineType;
  description: string;
  metricKey?: string | null;
  quantity?: number | null;
  rate?: number | null;
  amount?: number | null;
}

export interface ActualInput {
  lineId: string;
  actualQuantity?: number | null;
  actualRate?: number | null;
  actualAmount?: number | null;
}

const BASE = "/api/finance/revenue-forecasts";

export function useRevenueForecastList(period: string) {
  return useQuery({
    queryKey: ["revenue-forecasts", period],
    enabled: /^\d{4}-\d{2}$/.test(period),
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: ForecastList }>(`${BASE}?period=${period}`)).data,
  });
}

export function useRevenueForecast(id: string | null) {
  return useQuery({
    queryKey: ["revenue-forecast", id],
    enabled: Boolean(id),
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: ForecastDetail }>(`${BASE}/${id}`)).data,
  });
}

/** Every write refreshes the list, the open forecast, and the P&L views that read forecasts. */
function useForecastMutation<TInput>(fn: (input: TInput) => Promise<{ data: ForecastDetail | unknown }>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TInput) => (await fn(input)).data as ForecastDetail,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["revenue-forecasts"] });
      void queryClient.invalidateQueries({ queryKey: ["revenue-forecast"] });
      void queryClient.invalidateQueries({ queryKey: ["pnl-live-reconciliation"] });
      void queryClient.invalidateQueries({ queryKey: ["ceo-overview"] });
    },
  });
}

export function useSaveForecastDraft() {
  return useForecastMutation((input: { costCentreId: string; period: string; notes?: string | null; lines: LineInput[] }) =>
    hrmsApi.put(BASE, input) as Promise<{ data: ForecastDetail }>);
}

export function useSubmitForecast() {
  return useForecastMutation((id: string) => hrmsApi.post(`${BASE}/${id}/submit`, {}) as Promise<{ data: ForecastDetail }>);
}

export function useReviewForecast() {
  return useForecastMutation((input: { id: string; decision: "approved" | "rejected"; note?: string }) =>
    hrmsApi.post(`${BASE}/${input.id}/review`, { decision: input.decision, note: input.note ?? null }) as Promise<{ data: ForecastDetail }>);
}

export function useCloseForecast() {
  return useForecastMutation((input: { id: string; actuals: ActualInput[]; note?: string }) =>
    hrmsApi.post(`${BASE}/${input.id}/close`, { actuals: input.actuals, note: input.note ?? null }) as Promise<{ data: ForecastDetail }>);
}

export function useReopenForecast() {
  return useForecastMutation((input: { id: string; reason: string }) =>
    hrmsApi.post(`${BASE}/${input.id}/reopen`, { reason: input.reason }) as Promise<{ data: ForecastDetail }>);
}

export function useDiscardForecast() {
  return useForecastMutation((id: string) => hrmsApi.delete(`${BASE}/${id}`) as Promise<{ data: unknown }>);
}

/** Same arithmetic as the backend's lineAmount(): seat/metric = qty x rate, penalty always negative. */
export function computeLineAmount(line: { lineType: ForecastLineType; quantity?: number | null; rate?: number | null; amount?: number | null }): number | null {
  const q = line.quantity ?? null;
  const r = line.rate ?? null;
  let value: number | null;
  if (line.lineType === "seat" || line.lineType === "metric") value = q !== null && r !== null ? q * r : null;
  else if (q !== null && r !== null) value = Math.abs(q * r);
  else value = line.amount !== null && line.amount !== undefined ? Math.abs(line.amount) : null;
  if (value === null || !Number.isFinite(value)) return null;
  value = Math.round(value * 100) / 100;
  return line.lineType === "penalty" ? -value : value;
}

export const METRIC_OPTIONS = [
  { value: "talk_minutes", label: "Talk-time minutes" },
  { value: "login_hours", label: "Login hours" },
  { value: "productive_hours", label: "Productive hours" },
  { value: "calls", label: "Calls handled" },
  { value: "transactions", label: "Transactions" },
  { value: "cases", label: "Cases" },
  { value: "other", label: "Other metric" },
];

export const LINE_TYPE_LABEL: Record<ForecastLineType, string> = {
  seat: "Seats × rate",
  metric: "Metric × rate",
  fixed: "Fixed amount",
  reward: "Reward (+)",
  penalty: "Penalty (−)",
};
