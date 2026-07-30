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

export type AllocationDriverMode = "weighted" | "equal" | "manual_percentage";

export interface AllocationShare {
  key: string;
  /** Driver value for "weighted"/"equal" mode; configured percentage (0-100) for "manual_percentage". */
  weight: number;
}

export interface ManualAllocationWarning {
  branchId: string;
  poolType: string;
  percentTotal: number;
}

export interface AllocationOutcome {
  /** key -> allocated amount, rounded to paise. For "weighted"/"equal" mode the amounts always
   *  sum exactly to poolAmount (largest-remainder method on integer paise — no float drift). */
  amounts: Map<string, number>;
  /** For "manual_percentage" mode: whether the configured weights summed to 100 (+/- 0.01).
   *  Always true for "weighted"/"equal" mode, since those always reconcile by construction. */
  balanced: boolean;
  /** For "manual_percentage" mode: the actual sum of configured weights. Null otherwise. */
  percentTotal: number | null;
}

/**
 * Single shared allocation primitive for splitting a branch/shared cost pool across processes
 * (or any other keyed set). Replaces two independently-maintained, float-based copies of this
 * logic that used to live in bpo-pnl.service.ts and bpo-pnl-allocation-overlay.service.ts.
 *
 * Manual-percentage mode intentionally does NOT renormalize configured percentages to force a
 * 100% sum — that would silently change already-approved allocation policy data. It only reports
 * whether the pool is balanced so callers can surface a data-quality signal.
 */
export function allocatePoolAmount(
  poolAmount: number,
  shares: AllocationShare[],
  mode: AllocationDriverMode,
  /**
   * Smallest unit the split may land on. "paise" is exact to the last paisa and is the default for
   * actuals. "rupee" is for planning figures shown as whole rupees: allocating in paise yields
   * shares like 1428.57, each of which displays as 1,429, so a column of seven reads 10,003
   * against a 10,000 total — a finance sheet whose column does not add up. Rupee granularity is
   * ignored unless the pool really is a whole number of rupees, because otherwise the shares could
   * not sum back to it, and reconciling exactly matters more than round numbers.
   */
  granularity: "paise" | "rupee" = "paise"
): AllocationOutcome {
  const unitsPerRupee = granularity === "rupee" && Number.isInteger(n(poolAmount)) ? 1 : 100;
  const amounts = new Map<string, number>();
  if (shares.length === 0) {
    return { amounts, balanced: true, percentTotal: null };
  }

  if (mode === "manual_percentage") {
    const percentTotal = shares.reduce((sum, share) => sum + n(share.weight), 0);
    const balanced = Math.abs(percentTotal - 100) <= 0.01;
    for (const share of shares) {
      amounts.set(share.key, Math.round(poolAmount * (n(share.weight) / 100) * 100) / 100);
    }
    return { amounts, balanced, percentTotal };
  }

  const totalUnits = Math.round(n(poolAmount) * unitsPerRupee);
  const weights = mode === "equal" ? shares.map(() => 1) : shares.map((share) => Math.max(0, n(share.weight)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0) {
    // Equal-split fallback (matches prior behaviour when driver totals are zero), still exact.
    const evenUnits = Math.floor(totalUnits / shares.length);
    const remainder = totalUnits - evenUnits * shares.length;
    shares.forEach((share, index) => {
      amounts.set(share.key, (evenUnits + (index < remainder ? 1 : 0)) / unitsPerRupee);
    });
    return { amounts, balanced: true, percentTotal: null };
  }

  // Largest-remainder method: floor each share's exact paise value, then hand out the leftover
  // units one at a time to the shares with the biggest fractional remainder. Guarantees the
  // allocated amounts always sum to exactly totalUnits, unlike naive per-share rounding.
  const raw = weights.map((weight) => (totalUnits * weight) / totalWeight);
  const floors = raw.map((value) => Math.floor(value));
  const allocatedUnits = floors.reduce((sum, value) => sum + value, 0);
  const remainderUnits = totalUnits - allocatedUnits;
  const order = raw
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder);
  const finalUnits = [...floors];
  for (let i = 0; i < remainderUnits; i++) {
    finalUnits[order[i % order.length].index] += 1;
  }
  shares.forEach((share, index) => {
    amounts.set(share.key, finalUnits[index] / unitsPerRupee);
  });
  return { amounts, balanced: true, percentTotal: null };
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
