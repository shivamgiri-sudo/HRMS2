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

  const save = <T extends Record<string, unknown>>(endpoint: string) => useMutation({
    mutationFn: async (payload: T) => {
      const response = await hrmsApi.post<{ success: boolean; data: { id: string } }>(endpoint, payload);
      return response.data;
    },
    onSuccess: invalidate,
  });

  const saveRevenueRule = save<RevenueRulePayload & Record<string, unknown>>("/api/finance/pnl/bpo/revenue-rules");
  const saveDeliveryActual = save<DeliveryActualPayload & Record<string, unknown>>("/api/finance/pnl/bpo/delivery-actuals");
  const saveRevenueComponent = save<RevenueComponentPayload & Record<string, unknown>>("/api/finance/pnl/bpo/revenue-components");
  const saveCostComponent = save<CostComponentPayload & Record<string, unknown>>("/api/finance/pnl/bpo/cost-components");
  const saveAllocationPolicy = save<AllocationPolicyPayload & Record<string, unknown>>("/api/finance/pnl/bpo/allocation-policies");
  const saveClassificationRule = save<ClassificationRulePayload & Record<string, unknown>>("/api/finance/pnl/bpo/classification-rules");

  return {
    revenueRulesQuery,
    deliveryActualsQuery,
    revenueComponentsQuery,
    costComponentsQuery,
    allocationPoliciesQuery,
    classificationRulesQuery,
    saveRevenueRule,
    saveDeliveryActual,
    saveRevenueComponent,
    saveCostComponent,
    saveAllocationPolicy,
    saveClassificationRule,
  };
}
