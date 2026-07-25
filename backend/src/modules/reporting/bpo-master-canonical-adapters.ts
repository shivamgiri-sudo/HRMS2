import { bpoPnlAllocationOverlayService } from "../process-pnl/bpo-pnl-allocation-overlay.service.js";
import { getBpoMasterReport } from "./bpo-master-report-catalog.js";

export interface CanonicalAdapterFilters {
  month?: string;
  branchId?: string;
  processId?: string;
  clientId?: string;
  limit: number;
  offset: number;
}

export interface CanonicalAdapterResult {
  rows: Record<string, unknown>[];
  totalCount: number;
  sourceTable: string;
  availableKeys: string[];
}

const CANONICAL_CODES = new Set([
  "bpo-client-sla-delivery-master",
  "bpo-finance-pnl-profitability-master",
  "bpo-management-executive-master",
]);

function periodOrCurrent(value?: string) {
  return /^\d{4}-\d{2}$/.test(String(value ?? ""))
    ? String(value)
    : new Date().toISOString().slice(0, 7);
}

function monthEnd(period: string) {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).replace(/ /g, "-").toUpperCase();
}

function monthLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1))
    .toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })
    .replace(/ /g, "-")
    .toUpperCase();
}

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function common(row: any, period: string) {
  return {
    EMPLOYEE_CODE: "AGGREGATE",
    REPORT_DATE: monthEnd(period),
    REPORT_MONTH: monthLabel(period),
    FINANCE_MONTH: monthLabel(period),
    BRANCH: row.branchName ?? null,
    CLIENT: row.clientName ?? null,
    CLIENT_CODE: row.clientId ?? null,
    PROCESS: row.processName ?? null,
    PROCESS_CODE: row.processId ?? null,
    LOB: null,
    LOB_CODE: null,
    COST_CENTRE: row.costCentreCode ?? null,
    BILLING_MODEL: row.primaryBillingModel ?? row.billingModels?.join(" + ") ?? null,
    DATA_SOURCE: "CANONICAL_BPO_PNL_SERVICE",
  };
}

function clientRow(row: any, period: string) {
  return {
    ...common(row, period),
    CONTRACT_STATUS: row.revenueDataStatus === "configured" ? "ACTIVE" : row.revenueDataStatus,
    PLANNED_HEADCOUNT: nullableNumber(row.requiredRosterHc),
    ROSTERED_HEADCOUNT: nullableNumber(row.requiredRosterHc),
    PRESENT_HEADCOUNT: nullableNumber(row.activeHc),
    PRODUCTIVE_FTE: nullableNumber(row.billableHc ?? row.agentHeadcount),
    CAPACITY_UTILISATION_PERCENTAGE: nullableNumber(row.billableSeatUtilizationPct),
    FORECAST_VOLUME: nullableNumber(row.plannedDeliveryUnits),
    ACTUAL_VOLUME_RECEIVED: nullableNumber(row.deliveredUnits),
    VOLUME_VARIANCE: n(row.deliveredUnits) - n(row.plannedDeliveryUnits),
    VOLUME_VARIANCE_PERCENTAGE: n(row.plannedDeliveryUnits) > 0
      ? ((n(row.deliveredUnits) - n(row.plannedDeliveryUnits)) / n(row.plannedDeliveryUnits)) * 100
      : null,
    TASKS_COMPLETED: nullableNumber(row.acceptedUnits ?? row.billableUnits),
    TASKS_REJECTED: nullableNumber(row.rejectedUnits),
    REWORK_VOLUME: nullableNumber(row.rejectedUnits),
    SLA_ACHIEVED_PERCENTAGE: nullableNumber(row.slaScore),
    TAT_ACHIEVED_MINUTES: null,
    AHT_ACHIEVED_SECONDS: n(row.deliveredUnits) > 0 && n(row.productiveHours) > 0
      ? (n(row.productiveHours) * 3600) / n(row.deliveredUnits)
      : null,
    QUALITY_SCORE_PERCENTAGE: nullableNumber(row.qualityScore),
    REVENUE_RECOGNISED: nullableNumber(row.recognizedRevenue),
    SERVICE_CREDIT_OR_PENALTY: n(row.penalty) + n(row.slaDeduction) + n(row.creditNote) + n(row.otherRevenueDecrease),
    DIRECT_COST: n(row.agentSalary) + n(row.dsc),
    GROSS_MARGIN: nullableNumber(row.ebitda),
    GROSS_MARGIN_PERCENTAGE: nullableNumber(row.ebitdaMarginPct),
    INVOICE_STATUS: n(row.invoicedRevenue) > 0 ? "INVOICED" : "NOT INVOICED",
    COLLECTION_STATUS: n(row.outstandingReceivable) <= 0 && n(row.invoicedRevenue) > 0
      ? "COLLECTED"
      : n(row.collectedRevenue) > 0 ? "PARTIALLY COLLECTED" : "PENDING",
    GOVERNANCE_STATUS: row.processStatus,
    RED_FLAG_COUNT: row.processStatus === "loss-making" ? 1 : row.processStatus === "at-risk" ? 1 : 0,
  };
}

function financeRow(row: any, period: string) {
  const directCost = n(row.agentSalary) + n(row.dsc);
  const totalCost = n(row.totalOperatingCost) + n(row.depreciation) + n(row.amortization) + n(row.financeCost) + n(row.tax);
  return {
    ...common(row, period),
    FINANCE_PERIOD_STATUS: row.freshness ? "CURRENT" : "UNVERIFIED",
    CURRENCY: "INR",
    PLANNED_BILLING_UNITS: nullableNumber(row.plannedDeliveryUnits),
    ACTUAL_BILLING_UNITS: nullableNumber(row.billableUnits),
    BILLING_UNIT_VARIANCE: n(row.billableUnits) - n(row.plannedDeliveryUnits),
    PLANNED_REVENUE: nullableNumber(row.grossPotentialRevenue),
    REVENUE_RECOGNISED: nullableNumber(row.recognizedRevenue),
    UNBILLED_REVENUE: nullableNumber(row.unbilledRevenue),
    DEFERRED_REVENUE: nullableNumber(row.deferredRevenue),
    INVOICE_AMOUNT: nullableNumber(row.invoicedRevenue),
    INVOICE_STATUS: n(row.invoicedRevenue) > 0 ? "INVOICED" : "NOT INVOICED",
    COLLECTION_AMOUNT: nullableNumber(row.collectedRevenue),
    OUTSTANDING_RECEIVABLE: nullableNumber(row.outstandingReceivable),
    PRODUCTIVE_HEADCOUNT: nullableNumber(row.agentHeadcount),
    BILLED_FTE: nullableNumber(row.billableHc),
    SEAT_UTILISATION_PERCENTAGE: nullableNumber(row.billableSeatUtilizationPct),
    PAYROLL_COST: nullableNumber(row.agentSalary),
    VENDOR_COST: nullableNumber(row.grnVendorActual),
    OTHER_DIRECT_COST: nullableNumber(row.dscNonPeople),
    DIRECT_COST_TOTAL: directCost,
    OVERHEAD_ALLOCATION: nullableNumber(row.bmc),
    TOTAL_COST: totalCost,
    GROSS_PROFIT: nullableNumber(row.contribution),
    GROSS_MARGIN_PERCENTAGE: nullableNumber(row.contributionMarginPct),
    EBITDA_CONTRIBUTION: nullableNumber(row.ebitda),
    EBITDA_MARGIN_PERCENTAGE: nullableNumber(row.ebitdaMarginPct),
    BUDGET_AMOUNT: nullableNumber(row.approvedBudget),
    BUDGET_VARIANCE: nullableNumber(row.ebitdaVariance),
    BUDGET_VARIANCE_PERCENTAGE: n(row.ebitdaBudget) !== 0 && row.ebitdaBudget != null
      ? (n(row.ebitdaVariance) / Math.abs(n(row.ebitdaBudget))) * 100
      : null,
    GRN_GROSS_AMOUNT: null,
    PNL_RECOGNISED_COST: nullableNumber(row.grnVendorActual),
    VENDOR_PAYABLE: null,
    CASH_PAID: null,
    OUTSTANDING_PAYABLE: null,
    SERVICE_CREDIT_OR_PENALTY: n(row.penalty) + n(row.slaDeduction) + n(row.creditNote) + n(row.otherRevenueDecrease),
    PROFITABILITY_RAG: row.processStatus,
    PERIOD_CLOSE_BLOCKER_COUNT: row.processStatus === "loss-making" ? 1 : 0,
    DATA_SOURCE: "CANONICAL_BPO_PNL_ALLOCATION_ENGINE",
  };
}

function executiveRow(row: any, period: string) {
  return {
    ...common(row, period),
    ACTIVE_HEADCOUNT: nullableNumber(row.activeHc),
    BUDGETED_HEADCOUNT: nullableNumber(row.requiredRosterHc),
    VACANCY_COUNT: Math.max(0, n(row.requiredRosterHc) - n(row.activeHc)),
    PRODUCTIVITY_TARGET: nullableNumber(row.plannedDeliveryUnits),
    PRODUCTIVITY_ACHIEVED: nullableNumber(row.deliveredUnits),
    PRODUCTIVITY_PERCENTAGE: nullableNumber(row.deliveryAttainmentPct),
    SLA_ACHIEVED_PERCENTAGE: nullableNumber(row.slaScore),
    QUALITY_SCORE_PERCENTAGE: nullableNumber(row.qualityScore),
    PAYROLL_COST: nullableNumber(row.agentSalary),
    REVENUE_RECOGNISED: nullableNumber(row.recognizedRevenue),
    TOTAL_COST: nullableNumber(row.totalOperatingCost),
    GROSS_PROFIT: nullableNumber(row.contribution),
    GROSS_MARGIN_PERCENTAGE: nullableNumber(row.contributionMarginPct),
    EBITDA_CONTRIBUTION: nullableNumber(row.ebitda),
    BUDGET_VARIANCE: nullableNumber(row.ebitdaVariance),
    RECEIVABLE_OUTSTANDING: nullableNumber(row.outstandingReceivable),
    OVERALL_BUSINESS_HEALTH_SCORE: row.processStatus === "profitable" ? 100 : row.processStatus === "at-risk" ? 60 : 20,
    OVERALL_RAG: row.processStatus,
    PRIMARY_RISK: row.processStatus === "loss-making"
      ? "NEGATIVE EBITDA"
      : n(row.revenueAtRisk) > 0 ? "REVENUE AT RISK" : null,
    MANAGEMENT_DECISION_REQUIRED: row.processStatus === "profitable" ? "NO" : "YES",
    DATA_SOURCE: "CANONICAL_BPO_PNL_ALLOCATION_ENGINE",
  };
}

function normalizeRow(code: string, raw: Record<string, unknown>) {
  const definition = getBpoMasterReport(code);
  if (!definition) return raw;
  return Object.fromEntries(definition.columns.map((column) => [column.key, raw[column.key] ?? null]));
}

export async function runCanonicalBpoMasterAdapter(
  code: string,
  filters: CanonicalAdapterFilters
): Promise<CanonicalAdapterResult | null> {
  if (!CANONICAL_CODES.has(code)) return null;
  const period = periodOrCurrent(filters.month);
  const summary = await bpoPnlAllocationOverlayService.getSummary({
    period,
    branchId: filters.branchId,
    processId: filters.processId,
    clientId: filters.clientId,
  });
  const mapped = summary.rows.map((row) => {
    if (code === "bpo-client-sla-delivery-master") return clientRow(row, period);
    if (code === "bpo-finance-pnl-profitability-master") return financeRow(row, period);
    return executiveRow(row, period);
  });
  const rows = mapped
    .slice(filters.offset, filters.offset + filters.limit)
    .map((row) => normalizeRow(code, row));
  const availableKeys = [...new Set(mapped.flatMap((row) =>
    Object.entries(row).filter(([, value]) => value !== null && value !== undefined).map(([key]) => key)
  ))];
  return {
    rows,
    totalCount: mapped.length,
    sourceTable: "CANONICAL_BPO_PNL_ALLOCATION_ENGINE",
    availableKeys,
  };
}
