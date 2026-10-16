import { getCachedAllocationSummary } from "../process-pnl/canonical-pnl.service.js";
import type { BpoPnlRow } from "../process-pnl/bpo-pnl.service.js";
import type { HeadBranch } from "./scope.js";
import type { ProcessPnlData, ProcessPnlRow, SectionResult } from "./types.js";

// DialDesk, I-Spark and Dataconnect are not part of the branch process P&L.
const EXCLUDED = ["dialdesk", "ispark", "dataconnect"];
const norm = (v: unknown) => String(v ?? "").toLowerCase().split(" ").join("").split("-").join("");
const isExcluded = (r: Pick<BpoPnlRow, "processName" | "clientName" | "costCentreCode">) => {
  const text = [r.processName, r.clientName, r.costCentreCode].map(norm).join("|");
  return EXCLUDED.some((x) => text.includes(x));
};
const num = (v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function toRow(r: BpoPnlRow): ProcessPnlRow {
  const revenue = num(r.recognizedRevenue);
  const operatingProfit = num(r.operatingProfit);
  const peopleCost = num(r.totalPeopleCost);
  return {
    processId: String(r.processId), processName: r.processName, clientName: r.clientName ?? null,
    revenue, peopleCost, otherCost: num(r.totalOperatingCost) - peopleCost, ebitda: num(r.ebitda),
    operatingProfit, opPct: numOrNull(r.operatingProfitPct),
    status: r.processStatus,
    seatFillPct: numOrNull(r.seatFillPct), mandatedSeats: numOrNull(r.mandatedSeats), activeHc: num(r.activeHc),
    outstandingReceivable: num(r.outstandingReceivable), revenueVsBudget: numOrNull(r.revenueVariance),
  };
}

/** Process-wise P&L for one branch and month, from the same summary the P&L pages use. */
export async function buildProcessPnl(branch: HeadBranch, date: string): Promise<SectionResult<ProcessPnlData>> {
  const period = date.slice(0, 7);
  try {
    const summary = await getCachedAllocationSummary({ period, branchId: branch.branchId });
    const source = ((summary as { rows?: BpoPnlRow[] } | null)?.rows ?? []) as BpoPnlRow[];
    const kept = source.filter((r) => !isExcluded(r));
    if (kept.length === 0) return { status: "empty", data: null, asOf: date, message: "No process P&L for this branch and month" };
    const rows = kept.map(toRow).sort((a, b) => a.operatingProfit - b.operatingProfit);
    const sum = (f: (r: ProcessPnlRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    const revenue = sum((r) => r.revenue);
    const operatingProfit = sum((r) => r.operatingProfit);
    const count = (s: ProcessPnlRow["status"]) => rows.filter((r) => r.status === s).length;
    return {
      status: "ok", asOf: date,
      data: {
        period,
        totals: {
          revenue, totalCost: sum((r) => r.peopleCost + r.otherCost), operatingProfit,
          opPct: revenue > 0 ? (operatingProfit / revenue) * 100 : null,
          loss: count("loss-making"), atRisk: count("at-risk"), profitable: count("profitable"),
          outstandingReceivable: sum((r) => r.outstandingReceivable),
        },
        rows,
      },
    };
  } catch (err) {
    console.error("[branch-head-health] process P&L failed", branch.branchId, err);
    return { status: "error", data: null, asOf: date, message: "P&L could not be loaded" };
  }
}
