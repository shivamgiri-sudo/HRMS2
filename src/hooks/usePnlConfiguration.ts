import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface PnlReferenceData {
  processes: Array<{
    id: string;
    process_name: string;
    client_id: string | null;
    client_name: string | null;
    branch_id: string | null;
    branch_name: string | null;
  }>;
  clients: Array<{
    id: string;
    client_name: string;
  }>;
  branches: Array<{
    id: string;
    branch_name: string;
  }>;
}

export interface PnlContractRow {
  id: string;
  client_id: string | null;
  client_name?: string | null;
  process_id: string | null;
  process_name?: string | null;
  branch_name?: string | null;
  contract_name: string;
  billing_type: string;
  billing_rate: number;
  currency: string;
  monthly_minimum_commitment: number;
  effective_from: string;
  effective_to: string | null;
  status: string;
}

export interface PnlBillingRateRow {
  id: string;
  process_id: string;
  process_name?: string | null;
  contract_id: string | null;
  contract_name?: string | null;
  rate_type: string;
  rate_amount: number;
  unit: string;
  effective_from: string;
  effective_to: string | null;
  approval_reference?: string | null;
}

export interface PnlMonthlyPlanRow {
  id: string;
  process_id: string;
  process_name?: string | null;
  client_name?: string | null;
  branch_name?: string | null;
  period_code: string;
  contracted_seats: number | null;
  required_productive_hc: number | null;
  planned_shrinkage_pct: number | null;
  required_roster_hc: number | null;
  buffer_target_pct: number | null;
  revenue_budget: number | null;
  direct_cost_budget: number | null;
  indirect_cost_budget: number | null;
  profit_budget: number | null;
  status: string;
}

export interface PnlAdjustmentRow {
  id: string;
  process_id: string;
  process_name?: string | null;
  client_name?: string | null;
  period_code: string;
  metric_key: string;
  previous_value: number;
  adjustment_amount: number;
  revised_value: number;
  reason: string;
  approval_status: string;
  created_at: string;
}

export interface FinancePeriodRow {
  id: string;
  period_code: string;
  status: string;
  start_date?: string;
  end_date?: string;
  locked_at?: string | null;
  virtual?: boolean;
}

export interface SaveContractPayload {
  id?: string;
  client_id?: string | null;
  process_id?: string | null;
  contract_name: string;
  billing_type?: string;
  billing_rate?: number;
  currency?: string;
  monthly_minimum_commitment?: number;
  effective_from?: string;
  effective_to?: string | null;
  status?: string;
}

export interface SaveRatePayload {
  id?: string;
  process_id: string;
  contract_id?: string | null;
  rate_type: string;
  rate_amount: number;
  unit?: string;
  effective_from: string;
  effective_to?: string | null;
  approval_reference?: string | null;
}

export interface SaveMonthlyPlanPayload {
  id?: string;
  process_id: string;
  period_code: string;
  contracted_seats?: number | null;
  required_productive_hc?: number | null;
  planned_shrinkage_pct?: number | null;
  required_roster_hc?: number | null;
  buffer_target_pct?: number | null;
  revenue_budget?: number | null;
  direct_cost_budget?: number | null;
  indirect_cost_budget?: number | null;
  profit_budget?: number | null;
  status?: string;
}

export interface CreateAdjustmentPayload {
  process_id: string;
  period_code: string;
  metric_key: string;
  previous_value: number;
  adjustment_amount: number;
  reason: string;
}

function querySuffix(period?: string, processId?: string) {
  const params = new URLSearchParams();
  if (period) params.set("period", period);
  if (processId) params.set("processId", processId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function usePnlConfiguration(period?: string, processId?: string) {
  const queryClient = useQueryClient();
  const suffix = querySuffix(period, processId);

  const referenceQuery = useQuery({
    queryKey: ["pnl-reference-data"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: PnlReferenceData }>("/api/finance/pnl/config/reference-data");
      return response.data;
    },
    staleTime: 300_000,
  });

  const contractsQuery = useQuery({
    queryKey: ["pnl-contracts"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: PnlContractRow[] }>("/api/finance/pnl/config/contracts");
      return response.data;
    },
    staleTime: 60_000,
  });

  const ratesQuery = useQuery({
    queryKey: ["pnl-rates"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: PnlBillingRateRow[] }>("/api/finance/pnl/config/rates");
      return response.data;
    },
    staleTime: 60_000,
  });

  const monthlyPlansQuery = useQuery({
    queryKey: ["pnl-monthly-plans", period],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: PnlMonthlyPlanRow[] }>(`/api/finance/pnl/config/monthly-plan${querySuffix(period)}`);
      return response.data;
    },
    staleTime: 60_000,
  });

  const periodsQuery = useQuery({
    queryKey: ["pnl-periods"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: FinancePeriodRow[] }>("/api/finance/pnl/config/periods");
      return response.data;
    },
    staleTime: 60_000,
  });

  const adjustmentsQuery = useQuery({
    queryKey: ["pnl-adjustments", period, processId],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: PnlAdjustmentRow[] }>(`/api/finance/pnl/config/adjustments${suffix}`);
      return response.data;
    },
    staleTime: 60_000,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pnl-contracts"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-rates"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-monthly-plans"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-adjustments"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-period-close"] }),
      queryClient.invalidateQueries({ queryKey: ["process-pnl-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["process-pnl-processes"] }),
    ]);
  };

  const saveContract = useMutation({
    mutationFn: async (payload: SaveContractPayload) => {
      const response = await hrmsApi.post<{ success: boolean; data: { id: string } }>("/api/finance/pnl/contracts", payload);
      return response.data;
    },
    onSuccess: invalidate,
  });

  const saveRate = useMutation({
    mutationFn: async (payload: SaveRatePayload) => {
      const response = await hrmsApi.post<{ success: boolean; data: { id: string } }>("/api/finance/pnl/rates", payload);
      return response.data;
    },
    onSuccess: invalidate,
  });

  const saveMonthlyPlan = useMutation({
    mutationFn: async (payload: SaveMonthlyPlanPayload) => {
      const response = await hrmsApi.post<{ success: boolean; data: { id: string } }>("/api/finance/pnl/monthly-plan", payload);
      return response.data;
    },
    onSuccess: invalidate,
  });

  const createAdjustment = useMutation({
    mutationFn: async (payload: CreateAdjustmentPayload) => {
      const response = await hrmsApi.post<{ success: boolean; data: { id: string; revised_value: number } }>(
        "/api/finance/pnl/adjustments",
        payload
      );
      return response.data;
    },
    onSuccess: invalidate,
  });

  return {
    referenceQuery,
    contractsQuery,
    ratesQuery,
    monthlyPlansQuery,
    periodsQuery,
    adjustmentsQuery,
    saveContract,
    saveRate,
    saveMonthlyPlan,
    createAdjustment,
  };
}
