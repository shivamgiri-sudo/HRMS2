import type { RowDataPacket } from "mysql2";
import { queryRows, tableExists } from "../../shared/dbHelpers.js";
import { canonicalPnlService } from "./canonical-pnl.service.js";
import { getDriverRevenueActuals, getIndirectCostActuals, type ActualsByKey } from "./pnl-actuals.service.js";
import { processLobService } from "./process-lob.service.js";
import type { BpoPnlRow } from "./bpo-pnl.service.js";
import type { PnlQueryFilters } from "./process-pnl.types.js";

/**
 * P&L redesign (PR 3): transposed statement — components as rows, entities as dynamic columns.
 * Read-only composition over the existing canonical engine (canonicalPnlService.getSummary /
 * processLobService.getProcessSummary) — no calculation logic lives here. Row ordering/labels
 * come from finance_pnl_component_master (sql/426_pnl_component_master.sql).
 */

export type StatementViewBy = "process" | "branch" | "lob";

export interface ComponentDefinition extends RowDataPacket {
  component_key: string;
  display_name: string;
  section_key: "headcount" | "revenue" | "cost" | "profitability";
  parent_component_key: string | null;
  display_order: number;
  component_type: "SOURCE_ACTUAL" | "SUM" | "SUBTOTAL" | "RATIO";
  source_field: string;
  format_type: "CURRENCY" | "PERCENTAGE" | "COUNT";
  sign_convention: "+" | "-";
  is_subtotal: number;
}

export interface StatementColumn {
  id: string;
  code: string;
  name: string;
  branchName: string | null;
  processName: string | null;
  status: string | null;
}

export interface StatementRow {
  componentKey: string;
  displayName: string;
  section: string;
  format: string;
  isSubtotal: boolean;
  values: Record<string, number | null>;
}

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

async function getComponents(): Promise<ComponentDefinition[]> {
  if (!(await tableExists("finance_pnl_component_master"))) {
    throw new Error("Run the P&L component master migration first (sql/426_pnl_component_master.sql).");
  }
  return queryRows<ComponentDefinition>(
    `SELECT * FROM finance_pnl_component_master WHERE active_status = 1 ORDER BY display_order`
  );
}

/** Derives a component value from a generic row object, handling the few subtotal fields
 *  (dsc/bmc) that Process/Branch rows carry pre-summed but LOB rows do not. */
function resolveValue(row: Record<string, unknown>, component: ComponentDefinition): number | null {
  const field = component.source_field;
  if (row[field] !== undefined && row[field] !== null) return n(row[field]);
  if (field === "dsc") return n(row.dscPeople) + n(row.dscNonPeople);
  if (field === "bmc") return n(row.bmcPeople) + n(row.bmcNonPeople);
  if (field === "contributionMarginPct") return pct(n(row.contribution), n(row.recognizedRevenue));
  if (field === "ebitdaMarginPct") return pct(n(row.ebitda), n(row.recognizedRevenue));
  return null;
}

function sumField(rows: Record<string, unknown>[], field: string): number {
  return rows.reduce((total, row) => total + n(row[field]), 0);
}

const ADDITIVE_FIELDS: (keyof BpoPnlRow)[] = [
  "contractedSeats", "activeHc", "agentHeadcount", "billableHc",
  "grossPotentialRevenue", "baseEarnedRevenue", "minimumCommitmentTopUp", "incentiveRevenue",
  "penalty", "slaDeduction", "creditNote", "recognizedRevenue",
  "agentSalary", "dscPeople", "dscNonPeople", "dsc", "bmcPeople", "bmcNonPeople", "bmc",
  "contribution", "ebitda", "depreciation", "amortization", "ebit", "financeCost", "pbt", "tax", "pat",
];

function aggregateByBranch(rows: BpoPnlRow[]): { column: StatementColumn; data: Record<string, unknown> }[] {
  const byBranch = new Map<string, BpoPnlRow[]>();
  for (const row of rows) {
    const key = row.branchId ?? "unassigned";
    const bucket = byBranch.get(key) ?? [];
    bucket.push(row);
    byBranch.set(key, bucket);
  }
  return [...byBranch.entries()].map(([branchId, bucket]) => {
    const data: Record<string, unknown> = {};
    for (const field of ADDITIVE_FIELDS) data[field] = sumField(bucket as unknown as Record<string, unknown>[], field);
    return {
      column: {
        id: branchId,
        code: branchId,
        name: bucket[0]?.branchName ?? "Unassigned",
        branchName: bucket[0]?.branchName ?? null,
        processName: null,
        status: null,
      },
      data,
    };
  });
}

async function buildLobColumns(
  rows: BpoPnlRow[],
  period: string,
  deps: Pick<StatementDependencies, "getProcessSummary">
) {
  const results: { column: StatementColumn; data: Record<string, unknown> }[] = [];
  for (const row of rows) {
    const summary = await deps.getProcessSummary(row.processId, period).catch(() => null);
    const lobRows = (summary?.rows ?? []) as Array<Record<string, unknown> & { rowType: string; lobName?: string; processLobId?: string | null }>;
    for (const lobRow of lobRows) {
      const id = lobRow.processLobId ? `${row.processId}:${lobRow.processLobId}` : `${row.processId}:unallocated`;
      results.push({
        column: {
          id,
          code: id,
          name: lobRow.rowType === "unallocated" ? `${row.processName} — Unallocated` : `${row.processName} — ${lobRow.lobName ?? "LOB"}`,
          branchName: row.branchName,
          processName: row.processName,
          status: null,
        },
        data: lobRow,
      });
    }
  }
  return results;
}

/**
 * Fills the lines the raw P&L row does not carry, then derives the real waterfall:
 *   DC Total = Agent Salary + DSC + BMC
 *   Total Cost = DC Total + IDC
 *   Operating Profit = Revenue - Total Cost
 * Percentages are all of revenue, matching the workbook.
 */
function enrichColumn(
  data: Record<string, unknown>,
  key: { branchId?: string | null; processId?: string | null },
  idc: ActualsByKey,
  revenue: ActualsByKey
): Record<string, unknown> {
  const pick = (source: ActualsByKey) =>
    (key.processId ? source.byProcess.get(key.processId) : undefined)
    ?? (key.branchId ? source.byBranch.get(key.branchId) : undefined)
    ?? 0;

  const out = { ...data };
  // Revenue comes from the drivers unless the row already carries a recognised figure.
  const existingRevenue = n(out.recognizedRevenue);
  const recognizedRevenue = existingRevenue > 0 ? existingRevenue : pick(revenue);
  out.recognizedRevenue = recognizedRevenue;

  const agentSalary = n(out.agentSalary);
  const dscSalary = n(out.dscSalary ?? out.dscPeople);
  const bmcSalary = n(out.bmcSalary ?? out.bmcPeople);
  const indirectCostTotal = pick(idc);

  const directCostTotal = agentSalary + dscSalary + bmcSalary;
  const totalCost = directCostTotal + indirectCostTotal;

  out.dscSalary = dscSalary;
  out.bmcSalary = bmcSalary;
  out.indirectCostTotal = indirectCostTotal;
  out.directCostTotal = directCostTotal;
  out.totalCost = totalCost;
  out.operatingProfit = recognizedRevenue - totalCost;

  out.agentSalaryPct = pct(agentSalary, recognizedRevenue);
  out.dscPct = pct(dscSalary, recognizedRevenue);
  out.bmcPct = pct(bmcSalary, recognizedRevenue);
  out.directCostPct = pct(directCostTotal, recognizedRevenue);
  out.indirectCostPct = pct(indirectCostTotal, recognizedRevenue);
  out.totalCostPct = pct(totalCost, recognizedRevenue);
  out.operatingProfitPct = pct(n(out.operatingProfit), recognizedRevenue);
  return out;
}

export interface StatementDependencies {
  getComponents: () => Promise<ComponentDefinition[]>;
  getSummary: (filters: Partial<PnlQueryFilters>) => Promise<{ rows: BpoPnlRow[]; generatedAt: string; calculationEngine?: string }>;
  getProcessSummary: (processId: string, period: string) => Promise<{ rows?: unknown[] } | null>;
  /** Optional so an existing caller or test injecting only the original three keeps working —
   *  they fall back to the live readers. */
  getIndirectCost?: (period: string) => Promise<ActualsByKey>;
  getDriverRevenue?: (period: string) => Promise<ActualsByKey>;
}

const defaultDependencies: StatementDependencies = {
  getComponents,
  getSummary: (filters) => canonicalPnlService.getSummary(filters),
  getProcessSummary: (processId, period) => processLobService.getProcessSummary(processId, period),
  getIndirectCost: (period) => getIndirectCostActuals(period),
  getDriverRevenue: (period) => getDriverRevenueActuals(period),
};

export async function getStatement(
  filters: Partial<PnlQueryFilters>,
  viewBy: StatementViewBy = "process",
  deps: StatementDependencies = defaultDependencies
) {
  if ((viewBy as string) === "cost_centre" || (viewBy as string) === "company") {
    throw new Error(
      `View by "${viewBy}" is not yet supported — cost centre and company are not independent P&L grains in this ` +
      `data model today (cost centre resolves via a fallback join to process; company is not modelled at all). ` +
      `Supported: process, branch, lob.`
    );
  }

  const [components, summary] = await Promise.all([deps.getComponents(), deps.getSummary(filters)]);
  const rows = summary.rows as BpoPnlRow[];

  let columnData: { column: StatementColumn; data: Record<string, unknown> }[];
  if (viewBy === "branch") {
    columnData = aggregateByBranch(rows);
  } else if (viewBy === "lob") {
    columnData = await buildLobColumns(rows, String(filters.period ?? summary.generatedAt).slice(0, 7), deps);
  } else {
    columnData = rows.map((row) => ({
      column: {
        id: row.processId,
        code: row.processId,
        name: row.processName,
        branchName: row.branchName,
        processName: row.processName,
        status: row.processStatus,
      },
      data: row as unknown as Record<string, unknown>,
    }));
  }

  // Indirect cost and driver revenue are keyed by cost centre at source; resolve them per column.
  const periodCode = String(filters.period ?? summary.generatedAt).slice(0, 7);
  const [idc, revenue] = await Promise.all([
    (deps.getIndirectCost ?? getIndirectCostActuals)(periodCode),
    (deps.getDriverRevenue ?? getDriverRevenueActuals)(periodCode),
  ]);
  columnData = columnData.map((item) => ({
    column: item.column,
    data: enrichColumn(
      item.data,
      {
        branchId: viewBy === "branch" ? item.column.id : (item.data.branchId as string | undefined),
        processId: viewBy === "process" ? item.column.id : (item.data.processId as string | undefined),
      },
      idc,
      revenue
    ),
  }));

  const statementRows: StatementRow[] = components.map((component) => ({
    componentKey: component.component_key,
    displayName: component.display_name,
    section: component.section_key,
    format: component.format_type,
    isSubtotal: Boolean(component.is_subtotal),
    values: Object.fromEntries(
      columnData.map(({ column, data }) => [column.id, resolveValue(data, component)])
    ),
  }));

  return {
    viewBy,
    calculationEngine: summary.calculationEngine,
    generatedAt: summary.generatedAt,
    columns: columnData.map((item) => item.column),
    rows: statementRows,
  };
}

export const pnlStatementService = { getStatement };
