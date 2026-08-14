import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface RevenueRulePayload {
  id?: string;
  processId: string;
  contractId?: string | null;
  ruleName: string;
  billingModel: string;
  metricKey: string;
  rateAmount: number;
  currencyCode?: string;
  fxToInr?: number;
  monthlyMinimumCommitment?: number;
  includedUnits?: number;
  overageRate?: number;
  mandatedSeats?: number | null;
  qualityGatePct?: number | null;
  slaGatePct?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status?: string;
  approvalReference?: string | null;
}

export interface DeliveryActualPayload {
  id?: string;
  processId: string;
  periodCode: string;
  activityDate?: string | null;
  metricKey: string;
  plannedUnits?: number;
  deliveredUnits?: number;
  acceptedUnits?: number;
  rejectedUnits?: number;
  billableUnits?: number;
  productiveHours?: number;
  loginHours?: number;
  talkMinutes?: number;
  qualityScore?: number | null;
  slaScore?: number | null;
  dataSource?: string;
  sourceReference?: string;
  status?: string;
}

export interface RevenueComponentPayload {
  id?: string;
  processId: string;
  periodCode: string;
  componentType: string;
  direction: "increase" | "decrease";
  description: string;
  units?: number | null;
  rate?: number | null;
  amountInr: number;
  recognitionDate?: string | null;
  invoiceReference?: string | null;
  sourceReference?: string | null;
  status?: string;
}

export interface CostComponentPayload {
  id?: string;
  processId?: string | null;
  branchId?: string | null;
  periodCode: string;
  costType: string;
  description: string;
  amountInr: number;
  allocationDriver?: string;
  manualAllocationPct?: number | null;
  sourceReference?: string | null;
  status?: string;
}

export interface AllocationPolicyPayload {
  id?: string;
  branchId: string;
  processId?: string | null;
  poolType: string;
  allocationDriver: string;
  manualAllocationPct?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status?: string;
}

export interface ClassificationRulePayload {
  id?: string;
  ruleName: string;
  scopeType: string;
  scopeKey: string;
  processId?: string | null;
  branchId?: string | null;
  pnlBucket: string;
  priority?: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  activeStatus?: boolean;
}

function queryString(values: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

function useSaveMutation<T extends Record<string, unknown>>(
  endpoint: string,
  invalidate: () => Promise<unknown>
) {
  return useMutation({
    mutationFn: async (payload: T) => {
      const response = await hrmsApi.post<{ success: boolean; data: { id: string } }>(endpoint, payload);
      return response.data;
    },
    onSuccess: invalidate,
  });
}

export interface RewardPenaltyPayload {
  cost_centre_id: string;
  period_code: string;
  entry_type: "reward" | "penalty";
  description: string;
  amount_inr: number;
  client_reference?: string | null;
}

export function useBpoPnlConfiguration(period?: string, processId?: string, branchId?: string) {
  const queryClient = useQueryClient();
  const periodProcessQuery = queryString({ period, processId });
  const branchQuery = queryString({ branchId });
  const classificationQuery = queryString({ processId, branchId });

  const revenueRulesQuery = useQuery({
    queryKey: ["bpo-pnl-revenue-rules", processId],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: Array<Record<string, any>> }>(
        `/api/finance/pnl/bpo/revenue-rules${queryString({ processId })}`
      );
      return response.data;
    },
    staleTime: 30_000,
  });

  const deliveryActualsQuery = useQuery({
    queryKey: ["bpo-pnl-delivery-actuals", period, processId],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: Array<Record<string, any>> }>(
        `/api/finance/pnl/bpo/delivery-actuals${periodProcessQuery}`
      );
      return response.data;
    },
    staleTime: 30_000,
  });

  const revenueComponentsQuery = useQuery({
    queryKey: ["bpo-pnl-revenue-components", period, processId],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: Array<Record<string, any>> }>(
        `/api/finance/pnl/bpo/revenue-components${periodProcessQuery}`
      );
      return response.data;
    },
    staleTime: 30_000,
  });

  const costComponentsQuery = useQuery({
    queryKey: ["bpo-pnl-cost-components", period, processId],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: Array<Record<string, any>> }>(
        `/api/finance/pnl/bpo/cost-components${periodProcessQuery}`
      );
      return response.data;
    },
    staleTime: 30_000,
  });

  const allocationPoliciesQuery = useQuery({
    queryKey: ["bpo-pnl-allocation-policies", branchId],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: Array<Record<string, any>> }>(
        `/api/finance/pnl/bpo/allocation-policies${branchQuery}`
      );
      return response.data;
    },
    staleTime: 30_000,
  });

  const classificationRulesQuery = useQuery({
    queryKey: ["bpo-pnl-classification-rules", processId, branchId],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: Array<Record<string, any>> }>(
        `/api/finance/pnl/bpo/classification-rules${classificationQuery}`
      );
      return response.data;
    },
    staleTime: 30_000,
  });

  const rewardPenaltyQuery = useQuery({
    queryKey: ["pnl-reward-penalty", period],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: Array<Record<string, any>> }>(
        `/api/finance/pnl/reward-penalty${queryString({ period })}`
      );
      return response.data;
    },
    staleTime: 30_000,
    enabled: !!period,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["bpo-pnl-revenue-rules"] }),
      queryClient.invalidateQueries({ queryKey: ["bpo-pnl-delivery-actuals"] }),
      queryClient.invalidateQueries({ queryKey: ["bpo-pnl-revenue-components"] }),
      queryClient.invalidateQueries({ queryKey: ["bpo-pnl-cost-components"] }),
      queryClient.invalidateQueries({ queryKey: ["bpo-pnl-allocation-policies"] }),
      queryClient.invalidateQueries({ queryKey: ["bpo-pnl-classification-rules"] }),
      queryClient.invalidateQueries({ queryKey: ["bpo-process-pnl"] }),
      queryClient.invalidateQueries({ queryKey: ["bpo-process-pnl-detail"] }),
    ]);
  };

  const invalidateRp = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pnl-reward-penalty"] }),
      queryClient.invalidateQueries({ queryKey: ["bpo-process-pnl"] }),
      queryClient.invalidateQueries({ queryKey: ["bpo-process-pnl-detail"] }),
    ]);
  };

  const createRewardPenalty = useMutation({
    mutationFn: async (payload: RewardPenaltyPayload) => {
      const response = await hrmsApi.post<{ success: boolean; data: Record<string, any> }>(
        "/api/finance/pnl/reward-penalty",
        payload
      );
      return response.data;
    },
    onSuccess: invalidateRp,
  });

  const approveRewardPenalty = useMutation({
    mutationFn: async (id: string) => {
      const response = await hrmsApi.put<{ success: boolean }>(
        `/api/finance/pnl/reward-penalty/${id}/approve`,
        {}
      );
      return response.data;
    },
    onSuccess: invalidateRp,
  });

  const rejectRewardPenalty = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const response = await hrmsApi.put<{ success: boolean }>(
        `/api/finance/pnl/reward-penalty/${id}/reject`,
        { reason }
      );
      return response.data;
    },
    onSuccess: invalidateRp,
  });

  const saveRevenueRule = useSaveMutation<RevenueRulePayload & Record<string, unknown>>(
    "/api/finance/pnl/bpo/revenue-rules",
    invalidate
  );
  const saveDeliveryActual = useSaveMutation<DeliveryActualPayload & Record<string, unknown>>(
    "/api/finance/pnl/bpo/delivery-actuals",
    invalidate
  );
  const saveRevenueComponent = useSaveMutation<RevenueComponentPayload & Record<string, unknown>>(
    "/api/finance/pnl/bpo/revenue-components",
    invalidate
  );
  const saveCostComponent = useSaveMutation<CostComponentPayload & Record<string, unknown>>(
    "/api/finance/pnl/bpo/cost-components",
    invalidate
  );
  const saveAllocationPolicy = useSaveMutation<AllocationPolicyPayload & Record<string, unknown>>(
    "/api/finance/pnl/bpo/allocation-policies",
    invalidate
  );
  const saveClassificationRule = useSaveMutation<ClassificationRulePayload & Record<string, unknown>>(
    "/api/finance/pnl/bpo/classification-rules",
    invalidate
  );

  return {
    revenueRulesQuery,
    deliveryActualsQuery,
    revenueComponentsQuery,
    costComponentsQuery,
    allocationPoliciesQuery,
    classificationRulesQuery,
    rewardPenaltyQuery,
    saveRevenueRule,
    saveDeliveryActual,
    saveRevenueComponent,
    saveCostComponent,
    saveAllocationPolicy,
    saveClassificationRule,
    createRewardPenalty,
    approveRewardPenalty,
    rejectRewardPenalty,
  };
}
