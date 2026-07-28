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
  | "deliveredUnits"
  | "billableUnits"
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

function formatValue(value: ColumnValue): React.ReactNode {
  if (value == null || value === "") return "-";
  return Array.isArray(value) ? value.join(" + ") : value;
}

function sumColumn(rows: BpoPnlRow[], key: ProcessPnlColumnKey) {
  return rows.reduce((total, row) => {
    const value = row[key as keyof BpoPnlRow];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

function column(
  key: ProcessPnlColumnKey,
  label: string,
  options: Pick<ProcessPnlColumnDefinition, "align" | "sticky" | "widthClass"> = {},
): ProcessPnlColumnDefinition {
  return {
    key,
    label,
    align: options.align ?? "right",
    ...options,
    render: (row) => formatValue(row[key as keyof BpoPnlRow] as ColumnValue),
    total: (rows) => formatValue(sumColumn(rows, key)),
    sortValue: (row) => {
      const value = row[key as keyof BpoPnlRow] as ColumnValue;
      return Array.isArray(value) ? value.join(" + ") : value ?? "";
    },
  };
}

const identityColumns: ProcessPnlColumnDefinition[] = [
  column("processName", "Process", { align: "left", sticky: true, widthClass: "min-w-[220px]" }),
  column("clientName", "Client", { align: "left", sticky: true, widthClass: "min-w-[150px]" }),
  column("branchName", "Branch", { align: "left", sticky: true, widthClass: "min-w-[130px]" }),
  column("processStatus", "Status", { align: "left" }),
];

const revenueColumns: ProcessPnlColumnDefinition[] = [
  column("recognizedRevenue", "Recognized revenue"),
  column("earnedRevenue", "Earned revenue"),
  column("invoicedRevenue", "Invoiced revenue"),
  column("collectedRevenue", "Collected revenue"),
  column("outstandingReceivable", "Outstanding receivable"),
  column("unbilledRevenue", "Unbilled revenue"),
  column("revenueVariance", "Revenue variance"),
  column("revenueAtRisk", "Revenue at risk"),
  column("billingModels", "Billing models", { align: "left" }),
  column("mandatedSeats", "Mandated seats"),
  column("deliveredUnits", "Delivered units"),
  column("billableUnits", "Billable units"),
  column("revenueDataStatus", "Revenue data", { align: "left" }),
];

const costColumns: ProcessPnlColumnDefinition[] = [
  column("agentSalary", "Agent salary"),
  column("averageAgentSalary", "Average agent salary"),
  column("agentSalaryPctRevenue", "Agent salary % revenue"),
  column("dscPeople", "DSC people"),
  column("dscNonPeople", "DSC non-people"),
  column("dsc", "DSC"),
  column("dscPctRevenue", "DSC % revenue"),
  column("bmcPeople", "BMC people"),
  column("bmcNonPeople", "BMC non-people"),
  column("bmc", "BMC"),
  column("bmcPctRevenue", "BMC % revenue"),
  column("grnVendorActual", "GRN/vendor actual"),
  column("peopleCostPctRevenue", "People cost % revenue"),
];

const profitabilityColumns: ProcessPnlColumnDefinition[] = [
  column("contribution", "Contribution"),
  column("contributionMarginPct", "Contribution margin %"),
  column("ebitda", "EBITDA"),
  column("ebitdaMarginPct", "EBITDA margin %"),
  column("ebit", "EBIT"),
  column("operatingProfitPct", "Operating profit %"),
  column("pbt", "PBT"),
  column("pat", "PAT"),
];

const budgetColumns: ProcessPnlColumnDefinition[] = [
  column("approvedBudget", "Approved budget"),
  column("reservedBudget", "Reserved budget"),
  column("consumedBudget", "Consumed budget"),
  column("availableBudget", "Available budget"),
  column("budgetUtilizationPct", "Budget utilization %"),
];

const summaryColumns: ProcessPnlColumnDefinition[] = [
  identityColumns[0],
  identityColumns[1],
  identityColumns[2],
  identityColumns[3],
  revenueColumns[0],
  costColumns[2],
  costColumns[6],
  costColumns[10],
  profitabilityColumns[2],
  profitabilityColumns[3],
  budgetColumns[4],
  revenueColumns[7],
  revenueColumns[12],
];

const presetColumns: Record<ProcessPnlMatrixPreset, ProcessPnlColumnDefinition[]> = {
  summary: summaryColumns,
  revenue: [...identityColumns, ...revenueColumns],
  cost: [...identityColumns, ...costColumns],
  profitability: [...identityColumns, ...profitabilityColumns],
  "budget-risk": [...identityColumns, ...budgetColumns, revenueColumns[7], revenueColumns[12]],
  full: [
    ...identityColumns,
    ...revenueColumns,
    ...costColumns,
    ...profitabilityColumns,
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
  if (preset === "revenue") return { sortKey: "recognizedRevenue", sortDirection: "desc" };
  if (preset === "cost") return { sortKey: "agentSalary", sortDirection: "desc" };
  if (preset === "profitability") return { sortKey: "ebitda", sortDirection: "desc" };
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
