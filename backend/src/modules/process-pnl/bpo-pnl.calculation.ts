export type BpoBillingModel =
  | "per_seat"
  | "per_fte"
  | "per_productive_hour"
  | "per_login_hour"
  | "per_talk_minute"
  | "per_transaction"
  | "per_mandate"
  | "per_case"
  | "fixed_monthly"
  | "outcome_based";

export interface RevenueRuleInput {
  billingModel: BpoBillingModel;
  metricKey: string;
  rateAmount: number;
  fxToInr?: number | null;
  monthlyMinimumCommitment?: number | null;
  includedUnits?: number | null;
  overageRate?: number | null;
  mandatedSeats?: number | null;
}

export interface DeliveryMetricInput {
  metricKey: string;
  plannedUnits?: number | null;
  deliveredUnits?: number | null;
  acceptedUnits?: number | null;
  rejectedUnits?: number | null;
  billableUnits?: number | null;
  productiveHours?: number | null;
  loginHours?: number | null;
  talkMinutes?: number | null;
  qualityScore?: number | null;
  slaScore?: number | null;
}

export interface RevenueComponentInput {
  type: string;
  direction: "increase" | "decrease";
  amountInr: number;
}

export interface RevenueRuleResult {
  metricKey: string;
  billingModel: BpoBillingModel;
  plannedUnits: number;
  deliveredUnits: number;
  acceptedUnits: number;
  billableUnits: number;
  rejectedUnits: number;
  rateInr: number;
  calculatedAmount: number;
  minimumCommitmentTopUp: number;
  earnedRevenue: number;
  deliveryAttainmentPct: number | null;
  acceptancePct: number | null;
}

export interface RevenueCalculationResult {
  rules: RevenueRuleResult[];
  baseRevenue: number;
  minimumCommitmentTopUp: number;
  positiveAdjustments: number;
  negativeAdjustments: number;
  earnedRevenue: number;
  plannedUnits: number;
  deliveredUnits: number;
  acceptedUnits: number;
  rejectedUnits: number;
  billableUnits: number;
  deliveryAttainmentPct: number | null;
  acceptancePct: number | null;
}

export interface BpoCostInput {
  revenue: number;
  agentSalary: number;
  dscPeople: number;
  dscNonPeople: number;
  bmcPeople: number;
  bmcNonPeople: number;
  otherOperatingCost?: number;
  otherOperatingIncome?: number;
  depreciation?: number;
  amortization?: number;
  financeCost?: number;
  nonOperatingIncome?: number;
  tax?: number;
  exceptionalCost?: number;
  exceptionalIncome?: number;
  agentHeadcount?: number;
  activeHeadcount?: number;
  contractedSeats?: number | null;
  billableSeats?: number | null;
}

export interface BpoCostResult {
  agentSalary: number;
  dscPeople: number;
  dscNonPeople: number;
  dsc: number;
  bmcPeople: number;
  bmcNonPeople: number;
  bmc: number;
  directServiceCost: number;
  totalPeopleCost: number;
  totalOperatingCostBeforeDa: number;
  contribution: number;
  contributionMarginPct: number | null;
  ebitda: number;
  ebitdaMarginPct: number | null;
  ebit: number;
  operatingProfit: number;
  operatingProfitPct: number | null;
  pbt: number;
  pat: number;
  agentSalaryPctRevenue: number | null;
  dscPctRevenue: number | null;
  bmcPctRevenue: number | null;
  peopleCostPctRevenue: number | null;
  totalCostPctRevenue: number | null;
  averageAgentSalary: number | null;
  revenuePerAgent: number | null;
  revenuePerActiveEmployee: number | null;
  revenuePerContractedSeat: number | null;
  loadedCostPerBillableSeat: number | null;
}

const n = (value: number | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

function metricUnits(rule: RevenueRuleInput, delivery: DeliveryMetricInput | undefined): number {
  if (rule.billingModel === "fixed_monthly") return 1;
  if (rule.billingModel === "per_productive_hour") return n(delivery?.productiveHours || delivery?.billableUnits);
  if (rule.billingModel === "per_login_hour") return n(delivery?.loginHours || delivery?.billableUnits);
  if (rule.billingModel === "per_talk_minute") return n(delivery?.talkMinutes || delivery?.billableUnits);
  if (rule.billingModel === "per_seat" || rule.billingModel === "per_fte") {
    return n(delivery?.billableUnits || delivery?.acceptedUnits || rule.mandatedSeats);
  }
  return n(delivery?.billableUnits || delivery?.acceptedUnits || delivery?.deliveredUnits);
}

function tieredAmount(units: number, rule: RevenueRuleInput, rateInr: number): number {
  const included = n(rule.includedUnits);
  if (included <= 0 || units <= included) return units * rateInr;
  const overageRate = n(rule.overageRate) > 0 ? n(rule.overageRate) * n(rule.fxToInr || 1) : rateInr;
  return included * rateInr + (units - included) * overageRate;
}

export function calculateRevenue(
  rules: RevenueRuleInput[],
  deliveries: DeliveryMetricInput[],
  components: RevenueComponentInput[] = []
): RevenueCalculationResult {
  const deliveryMap = new Map(deliveries.map((item) => [item.metricKey, item]));
  const ruleResults = rules.map<RevenueRuleResult>((rule) => {
    const delivery = deliveryMap.get(rule.metricKey);
    const fxToInr = n(rule.fxToInr) > 0 ? n(rule.fxToInr) : 1;
    const rateInr = n(rule.rateAmount) * fxToInr;
    const units = metricUnits(rule, delivery);
    const rawAmount = rule.billingModel === "fixed_monthly"
      ? rateInr
      : tieredAmount(units, rule, rateInr);
    const minimumCommitment = n(rule.monthlyMinimumCommitment) * fxToInr;
    const topUp = Math.max(0, minimumCommitment - rawAmount);
    const plannedUnits = n(delivery?.plannedUnits);
    const deliveredUnits = n(delivery?.deliveredUnits);
    const acceptedUnits = n(delivery?.acceptedUnits);
    const rejectedUnits = n(delivery?.rejectedUnits);

    return {
      metricKey: rule.metricKey,
      billingModel: rule.billingModel,
      plannedUnits,
      deliveredUnits,
      acceptedUnits,
      rejectedUnits,
      billableUnits: units,
      rateInr,
      calculatedAmount: rawAmount,
      minimumCommitmentTopUp: topUp,
      earnedRevenue: rawAmount + topUp,
      deliveryAttainmentPct: pct(deliveredUnits, plannedUnits),
      acceptancePct: pct(acceptedUnits, deliveredUnits),
    };
  });

  const positiveAdjustments = components
    .filter((item) => item.direction === "increase")
    .reduce((sum, item) => sum + n(item.amountInr), 0);
  const negativeAdjustments = components
    .filter((item) => item.direction === "decrease")
    .reduce((sum, item) => sum + Math.abs(n(item.amountInr)), 0);
  const baseRevenue = ruleResults.reduce((sum, item) => sum + item.calculatedAmount, 0);
  const minimumCommitmentTopUp = ruleResults.reduce((sum, item) => sum + item.minimumCommitmentTopUp, 0);
  const plannedUnits = deliveries.reduce((sum, item) => sum + n(item.plannedUnits), 0);
  const deliveredUnits = deliveries.reduce((sum, item) => sum + n(item.deliveredUnits), 0);
  const acceptedUnits = deliveries.reduce((sum, item) => sum + n(item.acceptedUnits), 0);
  const rejectedUnits = deliveries.reduce((sum, item) => sum + n(item.rejectedUnits), 0);
  const billableUnits = ruleResults.reduce((sum, item) => sum + item.billableUnits, 0);

  return {
    rules: ruleResults,
    baseRevenue,
    minimumCommitmentTopUp,
    positiveAdjustments,
    negativeAdjustments,
    earnedRevenue: baseRevenue + minimumCommitmentTopUp + positiveAdjustments - negativeAdjustments,
    plannedUnits,
    deliveredUnits,
    acceptedUnits,
    rejectedUnits,
    billableUnits,
    deliveryAttainmentPct: pct(deliveredUnits, plannedUnits),
    acceptancePct: pct(acceptedUnits, deliveredUnits),
  };
}

export function calculateBpoCostWaterfall(input: BpoCostInput): BpoCostResult {
  const revenue = n(input.revenue);
  const agentSalary = n(input.agentSalary);
  const dscPeople = n(input.dscPeople);
  const dscNonPeople = n(input.dscNonPeople);
  const bmcPeople = n(input.bmcPeople);
  const bmcNonPeople = n(input.bmcNonPeople);
  const dsc = dscPeople + dscNonPeople;
  const bmc = bmcPeople + bmcNonPeople;
  const directServiceCost = agentSalary + dsc;
  const totalPeopleCost = agentSalary + dscPeople + bmcPeople;
  const totalOperatingCostBeforeDa =
    directServiceCost + bmc + n(input.otherOperatingCost) - n(input.otherOperatingIncome);
  const contribution = revenue - directServiceCost;
  const ebitda = revenue - totalOperatingCostBeforeDa;
  const ebit = ebitda - n(input.depreciation) - n(input.amortization);
  const pbt =
    ebit - n(input.financeCost) + n(input.nonOperatingIncome)
    - n(input.exceptionalCost) + n(input.exceptionalIncome);
  const pat = pbt - n(input.tax);
  const agentHeadcount = n(input.agentHeadcount);
  const activeHeadcount = n(input.activeHeadcount);
  const contractedSeats = n(input.contractedSeats);
  const billableSeats = n(input.billableSeats);

  return {
    agentSalary,
    dscPeople,
    dscNonPeople,
    dsc,
    bmcPeople,
    bmcNonPeople,
    bmc,
    directServiceCost,
    totalPeopleCost,
    totalOperatingCostBeforeDa,
    contribution,
    contributionMarginPct: pct(contribution, revenue),
    ebitda,
    ebitdaMarginPct: pct(ebitda, revenue),
    ebit,
    operatingProfit: ebit,
    operatingProfitPct: pct(ebit, revenue),
    pbt,
    pat,
    agentSalaryPctRevenue: pct(agentSalary, revenue),
    dscPctRevenue: pct(dsc, revenue),
    bmcPctRevenue: pct(bmc, revenue),
    peopleCostPctRevenue: pct(totalPeopleCost, revenue),
    totalCostPctRevenue: pct(totalOperatingCostBeforeDa + n(input.depreciation) + n(input.amortization), revenue),
    averageAgentSalary: agentHeadcount > 0 ? agentSalary / agentHeadcount : null,
    revenuePerAgent: agentHeadcount > 0 ? revenue / agentHeadcount : null,
    revenuePerActiveEmployee: activeHeadcount > 0 ? revenue / activeHeadcount : null,
    revenuePerContractedSeat: contractedSeats > 0 ? revenue / contractedSeats : null,
    loadedCostPerBillableSeat: billableSeats > 0 ? totalOperatingCostBeforeDa / billableSeats : null,
  };
}
