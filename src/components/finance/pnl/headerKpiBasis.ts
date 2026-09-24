/**
 * The Process P&L page header (KPI strip + CEO Overview cost-mix panel) reads ONE engine at a time.
 *
 * Audit item 7: the header used to take revenue from the Live P&L while Agent salary / DSC / BMC /
 * Operating Profit still came from the process (bpo) or Statement engine, so the cost-mix panel
 * divided one engine's profit by another engine's revenue, and Live revenue could be set against
 * Statement total cost. In Live mode the "Vendor (GRN) cost" tile was GRN consumed only while the
 * Operating Profit beside it also subtracted reserved GRN, so the tiles did not add up.
 *
 * Every basis built here is internally consistent and additive by construction:
 *
 *     revenue − Σ costLines = operatingProfit
 *
 * GRN cost on every basis = GRN Consumed + GRN Committed (reserved), both ex-GST, shown as two lines
 * (owner rule 2026-09-24: "Reserved + Consumed should be there in P&L"), so on every basis
 *
 *     Revenue − People Cost − GRN Consumed − GRN Committed = Operating Profit.
 *
 * An older backend that publishes no split falls back to one "indirect" line.
 *
 * If an engine's own Operating Profit does not equal revenue minus the cost lines it publishes, the
 * difference is shown as its own "Other cost (engine residual)" line rather than silently absorbed,
 * so the arithmetic on screen is always auditable.
 */
import type { PnlLiveReconciliation } from "@/hooks/usePnlLiveReconciliation";
import type { BpoPnlSummary } from "@/hooks/useBpoProcessPnl";

export type HeaderBasisSource = "process" | "statement" | "live";

export type HeaderCostLineKey = "people" | "indirect" | "grnConsumed" | "grnCommitted" | "other";

export interface HeaderCostLine {
  key: HeaderCostLineKey;
  value: number;
}

export interface HeaderPeopleSplit {
  agentSalary: number;
  dsc: number;
  bmc: number;
}

export interface HeaderKpiBasis {
  source: HeaderBasisSource;
  revenue: number;
  /** Subtracted from revenue, in display order. revenue − Σ value = operatingProfit, always. */
  costLines: HeaderCostLine[];
  operatingProfit: number;
  /** Null when the engine says a margin is not meaningful (no people cost / no overhead data yet). */
  marginPct: number | null;
  /** Agent / DSC / BMC split of People Cost, where the engine publishes one (not Live P&L). */
  peopleSplit: HeaderPeopleSplit | null;
  /** Live only: the month has no people cost yet, so Operating Profit excludes it. */
  peopleCostMissing: boolean;
}

/** Below this many rupees an engine residual is float noise, not a missing cost. */
const RESIDUAL_TOLERANCE = 0.5;

export function pctOf(part: number | null | undefined, whole: number | null | undefined): number {
  if (part == null || whole == null || whole === 0) return 0;
  return (part / whole) * 100;
}

function withResidual(revenue: number, lines: HeaderCostLine[], operatingProfit: number): HeaderCostLine[] {
  const residual = revenue - lines.reduce((total, line) => total + line.value, 0) - operatingProfit;
  return Math.abs(residual) > RESIDUAL_TOLERANCE ? [...lines, { key: "other", value: residual }] : lines;
}

type LiveTotals = PnlLiveReconciliation["totals"];

/** Every figure from the Live P&L payload. Its OP already subtracts GRN consumed AND committed. */
export function buildLiveBasis(totals: LiveTotals): HeaderKpiBasis {
  const revenue = totals.revenue ?? 0;
  const operatingProfit = totals.operatingProfit ?? 0;
  const lines: HeaderCostLine[] = [
    { key: "people", value: totals.payrollCost ?? 0 },
    { key: "grnConsumed", value: totals.grnActual ?? 0 },
    // Always shown in Live mode, even at zero, so the OP subtraction is visible line by line.
    { key: "grnCommitted", value: totals.grnEstimated ?? 0 },
  ];
  return {
    source: "live",
    revenue,
    costLines: withResidual(revenue, lines, operatingProfit),
    operatingProfit,
    marginPct: totals.marginPct ?? null,
    peopleSplit: null,
    peopleCostMissing: (totals.payrollCost ?? 0) === 0,
  };
}

/**
 * Every figure from the P&L Statement's company-level (branch view) totals. Its Total Cost is
 * People (Agent + DSC + BMC salary) + Indirect Cost, and Operating Profit = Revenue − Total Cost.
 */
export function buildStatementBasis(total: (componentKey: string) => number | null): HeaderKpiBasis {
  const revenue = total("recognized_revenue") ?? 0;
  const agentSalary = total("agent_salary") ?? 0;
  const dsc = total("dsc_salary") ?? total("total_dsc") ?? 0;
  const bmc = total("bmc_salary") ?? total("total_bmc") ?? 0;
  const indirect = total("total_idc") ?? 0;
  const totalCost = total("total_cost");
  const people = totalCost !== null ? totalCost - indirect : agentSalary + dsc + bmc;
  const operatingProfit = revenue - (totalCost ?? people + indirect);
  // Total Indirect Cost = GRN Consumed + GRN Committed (reserved) — the Statement publishes both as
  // breakdown rows under total_idc. Consumed is taken as the remainder so the two always sum to it.
  const committed = total("grn_committed");
  const hasSplit = committed !== null || total("grn_consumed") !== null;
  const lines: HeaderCostLine[] = hasSplit
    ? [
        { key: "people", value: people },
        { key: "grnConsumed", value: indirect - (committed ?? 0) },
        { key: "grnCommitted", value: committed ?? 0 },
      ]
    : [
        { key: "people", value: people },
        { key: "indirect", value: indirect },
      ];
  return {
    source: "statement",
    revenue,
    costLines: withResidual(revenue, lines, operatingProfit),
    operatingProfit,
    marginPct: revenue !== 0 ? pctOf(operatingProfit, revenue) : null,
    peopleSplit: { agentSalary, dsc, bmc },
    peopleCostMissing: false,
  };
}

/** Every figure from the process (bpo) engine's KPI block. */
export function buildProcessBasis(kpis: BpoPnlSummary["kpis"]): HeaderKpiBasis {
  const revenue = kpis.recognizedRevenue ?? 0;
  const operatingProfit = kpis.operatingProfit ?? 0;
  // grnVendorActual already includes GRN Committed (reserved) — the allocation overlay folds it in
  // and publishes that part as grnCommitted — so the consumed line is the remainder.
  const grnTotal = kpis.grnVendorActual ?? 0;
  const committed = kpis.grnCommitted;
  const lines: HeaderCostLine[] = committed !== undefined && committed !== null
    ? [
        { key: "people", value: kpis.totalPeopleCost ?? 0 },
        { key: "grnConsumed", value: grnTotal - committed },
        { key: "grnCommitted", value: committed },
      ]
    : [
        { key: "people", value: kpis.totalPeopleCost ?? 0 },
        { key: "indirect", value: grnTotal },
      ];
  return {
    source: "process",
    revenue,
    costLines: withResidual(revenue, lines, operatingProfit),
    operatingProfit,
    // Derived from the two tiles beside it rather than read back, so it can never disagree with them.
    marginPct: revenue !== 0 ? pctOf(operatingProfit, revenue) : null,
    peopleSplit: { agentSalary: kpis.agentSalary ?? 0, dsc: kpis.dsc ?? 0, bmc: kpis.bmc ?? 0 },
    peopleCostMissing: false,
  };
}
