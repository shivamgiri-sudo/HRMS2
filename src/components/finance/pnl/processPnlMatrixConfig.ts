import type React from "react";

import type { BpoPnlRow } from "@/hooks/useBpoProcessPnl";

export type ProcessPnlMatrixPreset =
  | "summary"
  | "revenue"
  | "cost"
  | "profitability"
  | "budget-risk"
  | "full";

export type ProcessPnlStatusFilter = "all" | BpoPnlRow["processStatus"];

export type ProcessPnlIssueFilter =
  | "all"
  | "revenue-at-risk"
  | "delivery-missing"
  | "budget-exceeded"
  | "high-receivable"
  | "accounting-fallback";

export type ProcessPnlDensity = "comfortable" | "compact";
export type ProcessPnlSortDirection = "asc" | "desc";

export type ProcessPnlColumnKey =
  | "processName"
  | "clientName"
  | "branchName"
  | "costCentreCode"
  | "processStatus"
  | "revenueDataStatus"
  | "recognizedRevenue"
  | "agentSalaryPctRevenue"
  | "dscPctRevenue"
  | "bmcPctRevenue"
  | "ebitda"
  | "ebitdaMarginPct"
  | "budgetUtilizationPct"
  | "revenueAtRisk"
  | "billingModels"
  | "mandatedSeats"
  | "activeHc"
  | "agentHeadcount"
  | "billableHc"
  | "seatFillPct"
  | "plannedDeliveryUnits"
  | "deliveredUnits"
  | "billableUnits"
  | "deliveryAttainmentPct"
  | "acceptancePct"
  | "grossPotentialRevenue"
  | "baseEarnedRevenue"
  | "minimumCommitmentTopUp"
  | "incentiveRevenue"
  | "penalty"
  | "creditNote"
  | "earnedRevenue"
  | "invoicedRevenue"
  | "collectedRevenue"
  | "outstandingReceivable"
  | "unbilledRevenue"
  | "revenueVariance"
  | "agentSalary"
  | "averageAgentSalary"
  | "dscPeople"
  | "dscNonPeople"
  | "dsc"
  | "bmcPeople"
  | "bmcNonPeople"
  | "bmc"
  | "grnVendorActual"
  | "peopleCostPctRevenue"
  | "contribution"
  | "contributionMarginPct"
  | "ebit"
  | "operatingProfitPct"
  | "pbt"
  | "pat"
  | "approvedBudget"
  | "reservedBudget"
  | "consumedBudget"
  | "availableBudget";

export interface ProcessPnlColumnDefinition {
  key: ProcessPnlColumnKey;
  label: string;
  align?: "left" | "right";
  sticky?: boolean;
  widthClass?: string;
  render: (row: BpoPnlRow) => React.ReactNode;
  total?: (rows: BpoPnlRow[]) => React.ReactNode;
  sortValue?: (row: BpoPnlRow) => number | string;
}

export interface ProcessPnlViewState {
  preset: ProcessPnlMatrixPreset;
  status: ProcessPnlStatusFilter;
  issue: ProcessPnlIssueFilter;
  density: ProcessPnlDensity;
  sortKey: ProcessPnlColumnKey;
  sortDirection: ProcessPnlSortDirection;
  search: string;
}

type ColumnValue = number | string | string[] | null | undefined;

function labelize(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (match) => match.toLocaleUpperCase());
}

const displayLabels: Partial<Record<ProcessPnlColumnKey, Record<string, string>>> = {
  processStatus: {
    profitable: "Profitable",
    "at-risk": "At Risk",
    "loss-making": "Loss Making",
  },
  revenueDataStatus: {
    configured: "Live Delivery",
    configured_no_delivery: "Delivery Missing",
    accounting_fallback: "Accounting Fallback",
  },
};

const currencyColumnKeys = new Set<ProcessPnlColumnKey>([
  "grossPotentialRevenue",
  "baseEarnedRevenue",
  "minimumCommitmentTopUp",
  "incentiveRevenue",
  "penalty",
  "creditNote",
  "recognizedRevenue",
  "earnedRevenue",
  "invoicedRevenue",
  "collectedRevenue",
  "outstandingReceivable",
  "unbilledRevenue",
  "revenueVariance",
  "revenueAtRisk",
  "agentSalary",
  "averageAgentSalary",
  "dscPeople",
  "dscNonPeople",
  "dsc",
  "bmcPeople",
  "bmcNonPeople",
  "bmc",
  "grnVendorActual",
  "contribution",
  "ebitda",
  "ebit",
  "pbt",
  "pat",
  "approvedBudget",
  "reservedBudget",
  "consumedBudget",
  "availableBudget",
]);

const percentageColumnKeys = new Set<ProcessPnlColumnKey>([
  "agentSalaryPctRevenue",
  "dscPctRevenue",
  "bmcPctRevenue",
  "ebitdaMarginPct",
  "budgetUtilizationPct",
  "seatFillPct",
  "deliveryAttainmentPct",
  "acceptancePct",
  "peopleCostPctRevenue",
  "contributionMarginPct",
  "operatingProfitPct",
]);

const numberColumnKeys = new Set<ProcessPnlColumnKey>([
  "mandatedSeats",
  "activeHc",
  "agentHeadcount",
  "billableHc",
  "plannedDeliveryUnits",
  "deliveredUnits",
  "billableUnits",
]);

function formatValue(key: ProcessPnlColumnKey, value: ColumnValue): React.ReactNode {
  if (value == null || value === "") return "-";
  if (Array.isArray(value)) return value.map(labelize).join(" + ");
  if (typeof value !== "number") return displayLabels[key]?.[value] ?? value;
  if (currencyColumnKeys.has(key)) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
  if (percentageColumnKeys.has(key)) return `${value.toFixed(1)}%`;
  if (numberColumnKeys.has(key)) return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value);
  return value;
}

function sumColumn(rows: BpoPnlRow[], key: keyof BpoPnlRow) {
  return rows.reduce((total, row) => {
    const value = row[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

function ratioTotal(rows: BpoPnlRow[], numerator: keyof BpoPnlRow, denominator: keyof BpoPnlRow) {
  const denominatorTotal = sumColumn(rows, denominator);
  return denominatorTotal === 0 ? null : (sumColumn(rows, numerator) / denominatorTotal) * 100;
}

function averageTotal(rows: BpoPnlRow[], numerator: keyof BpoPnlRow, denominator: keyof BpoPnlRow) {
  const denominatorTotal = sumColumn(rows, denominator);
  return denominatorTotal === 0 ? null : sumColumn(rows, numerator) / denominatorTotal;
}

type ColumnOptions = Pick<ProcessPnlColumnDefinition, "align" | "sticky" | "widthClass"> & {
  total?: (rows: BpoPnlRow[]) => React.ReactNode;
};

function column(
  key: ProcessPnlColumnKey,
  label: string,
  options: ColumnOptions = {},
): ProcessPnlColumnDefinition {
  return {
    key,
    label,
    align: options.align ?? "right",
    ...options,
    render: (row) => formatValue(key, row[key as keyof BpoPnlRow] as ColumnValue),
    sortValue: (row) => {
      const value = row[key as keyof BpoPnlRow] as ColumnValue;
      return Array.isArray(value) ? value.join(" + ") : value ?? "";
    },
  };
}

function additiveColumn(key: ProcessPnlColumnKey, label: string, options: ColumnOptions = {}) {
  return column(key, label, {
    ...options,
    total: (rows) => formatValue(key, sumColumn(rows, key as keyof BpoPnlRow)),
  });
}

function compositeColumn(
  key: ProcessPnlColumnKey,
  label: string,
  getValue: (row: BpoPnlRow) => number,
  options: ColumnOptions = {},
) {
  return {
    ...column(key, label, options),
    render: (row: BpoPnlRow) => formatValue(key, getValue(row)),
    total: (rows: BpoPnlRow[]) => formatValue(key, rows.reduce((total, row) => total + getValue(row), 0)),
    sortValue: getValue,
  };
}

function weightedColumn(
  key: ProcessPnlColumnKey,
  label: string,
  numerator: keyof BpoPnlRow,
  denominator: keyof BpoPnlRow,
  options: ColumnOptions = {},
) {
  return column(key, label, {
    ...options,
    total: (rows) => formatValue(key, ratioTotal(rows, numerator, denominator)),
  });
}

function averageColumn(
  key: ProcessPnlColumnKey,
  label: string,
  numerator: keyof BpoPnlRow,
  denominator: keyof BpoPnlRow,
  options: ColumnOptions = {},
) {
  return column(key, label, {
    ...options,
    total: (rows) => formatValue(key, averageTotal(rows, numerator, denominator)),
  });
}

const identityColumns: ProcessPnlColumnDefinition[] = [
  column("processName", "Process", { align: "left", sticky: true, widthClass: "min-w-[220px]" }),
  column("clientName", "Client", { align: "left", sticky: true, widthClass: "min-w-[150px]" }),
  column("branchName", "Branch", { align: "left", sticky: true, widthClass: "min-w-[130px]" }),
  column("processStatus", "Status", { align: "left", sticky: true, widthClass: "min-w-[128px]" }),
];

const fullIdentityColumns: ProcessPnlColumnDefinition[] = [
  identityColumns[0],
  identityColumns[1],
  identityColumns[2],
  identityColumns[3],
  column("costCentreCode", "Cost centre", { align: "left", widthClass: "min-w-[130px]" }),
];

const commercialColumns: ProcessPnlColumnDefinition[] = [
  column("billingModels", "Billing models", { align: "left" }),
  column("revenueDataStatus", "Revenue data", { align: "left" }),
  additiveColumn("mandatedSeats", "Mandated seats"),
  additiveColumn("activeHc", "Active HC"),
  additiveColumn("agentHeadcount", "Agent HC"),
  additiveColumn("billableHc", "Billable HC"),
  weightedColumn("seatFillPct", "Seat fill %", "activeHc", "mandatedSeats"),
  additiveColumn("plannedDeliveryUnits", "Planned units"),
  additiveColumn("deliveredUnits", "Delivered units"),
  additiveColumn("billableUnits", "Billable units"),
  weightedColumn("deliveryAttainmentPct", "Delivery %", "deliveredUnits", "plannedDeliveryUnits"),
  weightedColumn("acceptancePct", "Acceptance %", "billableUnits", "deliveredUnits"),
];

const revenueColumns: ProcessPnlColumnDefinition[] = [
  additiveColumn("grossPotentialRevenue", "Potential revenue"),
  additiveColumn("baseEarnedRevenue", "Base earned"),
  additiveColumn("minimumCommitmentTopUp", "Min. commitment"),
  compositeColumn("incentiveRevenue", "Incentive/reward", (row) => row.incentiveRevenue + row.rewardRevenue),
  compositeColumn("penalty", "Penalty/SLA", (row) => row.penalty + row.slaDeduction),
  additiveColumn("creditNote", "Credit note"),
  additiveColumn("recognizedRevenue", "Recognized revenue"),
  additiveColumn("earnedRevenue", "Earned revenue"),
  additiveColumn("invoicedRevenue", "Invoiced revenue"),
  additiveColumn("collectedRevenue", "Collected revenue"),
  additiveColumn("outstandingReceivable", "Outstanding receivable"),
  additiveColumn("unbilledRevenue", "Unbilled revenue"),
  additiveColumn("revenueVariance", "Revenue variance"),
  additiveColumn("revenueAtRisk", "Revenue at risk"),
  column("revenueDataStatus", "Revenue data", { align: "left" }),
];

const costColumns: ProcessPnlColumnDefinition[] = [
  additiveColumn("agentSalary", "Agent salary"),
  averageColumn("averageAgentSalary", "Average agent salary", "agentSalary", "agentHeadcount"),
  weightedColumn("agentSalaryPctRevenue", "Agent salary % revenue", "agentSalary", "recognizedRevenue"),
  additiveColumn("dscPeople", "DSC people"),
  additiveColumn("dscNonPeople", "DSC non-people"),
  additiveColumn("dsc", "DSC"),
  weightedColumn("dscPctRevenue", "DSC % revenue", "dsc", "recognizedRevenue"),
  additiveColumn("bmcPeople", "BMC people"),
  additiveColumn("bmcNonPeople", "BMC non-people"),
  additiveColumn("bmc", "BMC"),
  weightedColumn("bmcPctRevenue", "BMC % revenue", "bmc", "recognizedRevenue"),
  additiveColumn("grnVendorActual", "GRN/vendor actual"),
  weightedColumn("peopleCostPctRevenue", "People cost % revenue", "totalPeopleCost", "recognizedRevenue"),
];

const profitabilityColumns: ProcessPnlColumnDefinition[] = [
  additiveColumn("recognizedRevenue", "Recognized revenue"),
  additiveColumn("contribution", "Contribution"),
  weightedColumn("contributionMarginPct", "Contribution margin %", "contribution", "recognizedRevenue"),
  additiveColumn("ebitda", "EBITDA"),
  weightedColumn("ebitdaMarginPct", "EBITDA margin %", "ebitda", "recognizedRevenue"),
  additiveColumn("ebit", "EBIT"),
  weightedColumn("operatingProfitPct", "Operating profit %", "operatingProfit", "recognizedRevenue"),
  additiveColumn("pbt", "PBT"),
  additiveColumn("pat", "PAT"),
];

const budgetColumns: ProcessPnlColumnDefinition[] = [
  additiveColumn("approvedBudget", "Approved budget"),
  additiveColumn("reservedBudget", "Reserved budget"),
  additiveColumn("consumedBudget", "Consumed budget"),
  additiveColumn("availableBudget", "Available budget"),
  weightedColumn("budgetUtilizationPct", "Budget utilization %", "consumedBudget", "approvedBudget"),
];

function pickColumn(columns: ProcessPnlColumnDefinition[], key: ProcessPnlColumnKey) {
  const definition = columns.find((column) => column.key === key);
  if (!definition) throw new Error(`Missing Process P&L matrix column: ${key}`);
  return definition;
}

const summaryColumns: ProcessPnlColumnDefinition[] = [
  pickColumn(identityColumns, "processName"),
  pickColumn(identityColumns, "clientName"),
  pickColumn(identityColumns, "branchName"),
  pickColumn(identityColumns, "processStatus"),
  pickColumn(revenueColumns, "recognizedRevenue"),
  pickColumn(costColumns, "agentSalaryPctRevenue"),
  pickColumn(costColumns, "dscPctRevenue"),
  pickColumn(costColumns, "bmcPctRevenue"),
  pickColumn(profitabilityColumns, "ebitda"),
  pickColumn(profitabilityColumns, "ebitdaMarginPct"),
  pickColumn(budgetColumns, "budgetUtilizationPct"),
  pickColumn(revenueColumns, "revenueAtRisk"),
  pickColumn(revenueColumns, "revenueDataStatus"),
];

const presetColumns: Record<ProcessPnlMatrixPreset, ProcessPnlColumnDefinition[]> = {
  summary: summaryColumns,
  revenue: [
    ...identityColumns,
    pickColumn(commercialColumns, "billingModels"),
    pickColumn(commercialColumns, "mandatedSeats"),
    pickColumn(commercialColumns, "deliveredUnits"),
    pickColumn(commercialColumns, "billableUnits"),
    pickColumn(revenueColumns, "earnedRevenue"),
    pickColumn(revenueColumns, "recognizedRevenue"),
    pickColumn(revenueColumns, "invoicedRevenue"),
    pickColumn(revenueColumns, "collectedRevenue"),
    pickColumn(revenueColumns, "outstandingReceivable"),
    pickColumn(revenueColumns, "unbilledRevenue"),
    pickColumn(revenueColumns, "revenueAtRisk"),
    pickColumn(revenueColumns, "revenueVariance"),
  ],
  cost: [
    ...identityColumns,
    pickColumn(costColumns, "agentSalary"),
    pickColumn(costColumns, "averageAgentSalary"),
    pickColumn(costColumns, "agentSalaryPctRevenue"),
    pickColumn(costColumns, "dscPeople"),
    pickColumn(costColumns, "dscNonPeople"),
    pickColumn(costColumns, "dsc"),
    pickColumn(costColumns, "bmcPeople"),
    pickColumn(costColumns, "bmcNonPeople"),
    pickColumn(costColumns, "bmc"),
    pickColumn(costColumns, "grnVendorActual"),
    pickColumn(costColumns, "peopleCostPctRevenue"),
  ],
  profitability: [...identityColumns, ...profitabilityColumns],
  "budget-risk": [
    ...identityColumns,
    ...budgetColumns,
    pickColumn(revenueColumns, "revenueAtRisk"),
    pickColumn(revenueColumns, "outstandingReceivable"),
    pickColumn(revenueColumns, "unbilledRevenue"),
    pickColumn(revenueColumns, "revenueDataStatus"),
  ],
  full: [
    ...fullIdentityColumns,
    ...commercialColumns,
    ...revenueColumns.filter((column) => column.key !== "revenueDataStatus"),
    ...costColumns,
    ...profitabilityColumns.filter((column) => column.key !== "recognizedRevenue"),
    ...budgetColumns,
  ],
};

const issuePredicates: Record<Exclude<ProcessPnlIssueFilter, "all">, (row: BpoPnlRow) => boolean> = {
  "revenue-at-risk": (row) => row.revenueAtRisk > 0,
  "delivery-missing": (row) => row.revenueDataStatus === "configured_no_delivery",
  "budget-exceeded": (row) => (row.budgetUtilizationPct ?? 0) > 100,
  "high-receivable": (row) => row.outstandingReceivable > 0,
  "accounting-fallback": (row) => row.revenueDataStatus === "accounting_fallback",
};

const searchableFields: Array<keyof BpoPnlRow> = [
  "processName",
  "clientName",
  "branchName",
  "costCentreCode",
];

export function getPresetColumns(preset: ProcessPnlMatrixPreset): ProcessPnlColumnDefinition[] {
  return presetColumns[preset];
}

export function getDefaultSort(
  preset: ProcessPnlMatrixPreset,
): { sortKey: ProcessPnlColumnKey; sortDirection: ProcessPnlSortDirection } {
  if (preset === "summary") return { sortKey: "ebitda", sortDirection: "asc" };
  if (preset === "revenue") return { sortKey: "revenueAtRisk", sortDirection: "desc" };
  if (preset === "cost") return { sortKey: "agentSalaryPctRevenue", sortDirection: "desc" };
  if (preset === "profitability") return { sortKey: "ebitda", sortDirection: "asc" };
  if (preset === "budget-risk") return { sortKey: "budgetUtilizationPct", sortDirection: "desc" };
  return { sortKey: "processName", sortDirection: "asc" };
}

export function filterMatrixRows(rows: BpoPnlRow[], state: ProcessPnlViewState): BpoPnlRow[] {
  const search = state.search.trim().toLocaleLowerCase();

  return rows.filter((row) => {
    const matchesStatus = state.status === "all" || row.processStatus === state.status;
    const matchesIssue = state.issue === "all" || issuePredicates[state.issue](row);
    const matchesSearch =
      !search ||
      searchableFields.some((field) => String(row[field] ?? "").toLocaleLowerCase().includes(search));

    return matchesStatus && matchesIssue && matchesSearch;
  });
}

export function sortMatrixRows(rows: BpoPnlRow[], state: ProcessPnlViewState): BpoPnlRow[] {
  const definition = getPresetColumns(state.preset).find((column) => column.key === state.sortKey);
  const getValue = definition?.sortValue ?? ((row: BpoPnlRow) => {
    const value = row[state.sortKey as keyof BpoPnlRow] as ColumnValue;
    return Array.isArray(value) ? value.join(" + ") : value ?? "";
  });
  const direction = state.sortDirection === "asc" ? 1 : -1;

  return rows
    .map((row, index) => ({ row, index, value: getValue(row) }))
    .sort((a, b) => {
      if (a.value === b.value) return a.index - b.index;
      if (a.value === "") return 1;
      if (b.value === "") return -1;
      if (typeof a.value === "number" && typeof b.value === "number") {
        return (a.value - b.value) * direction;
      }
      return String(a.value).localeCompare(String(b.value)) * direction;
    })
    .map(({ row }) => row);
}

export function getIssueCounts(rows: BpoPnlRow[]): Record<ProcessPnlIssueFilter, number> {
  const counts: Record<ProcessPnlIssueFilter, number> = {
    all: rows.length,
    "revenue-at-risk": 0,
    "delivery-missing": 0,
    "budget-exceeded": 0,
    "high-receivable": 0,
    "accounting-fallback": 0,
  };

  for (const row of rows) {
    for (const issue of Object.keys(issuePredicates) as Array<Exclude<ProcessPnlIssueFilter, "all">>) {
      if (issuePredicates[issue](row)) counts[issue] += 1;
    }
  }

  return counts;
}
