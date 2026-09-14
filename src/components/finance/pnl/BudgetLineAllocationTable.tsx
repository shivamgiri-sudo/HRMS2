import type { BranchBudgetAllocationRecord } from "@/hooks/useBranchBudget";

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

/** Shared by the Plan Builder card's inline "computed allocation" panel and the Grid Matrix's
 *  drill-down drawer — a branch-common line's per-cost-centre split, computed server-side by
 *  computeLineAllocations (branch-budget-allocation.service.ts). */
export function BudgetLineAllocationTable({ allocations }: { allocations: BranchBudgetAllocationRecord[] }) {
  if (!allocations.length) return null;
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2">Cost centre</th>
            <th className="px-3 py-2">Share %</th>
            <th className="px-3 py-2">With tax</th>
            <th className="px-3 py-2">P&amp;L cost</th>
          </tr>
        </thead>
        <tbody>
          {allocations.map((row) => (
            <tr key={row.id} className="border-b border-slate-100 last:border-0">
              <td className="px-3 py-2">{row.cost_centre_name}</td>
              <td className="px-3 py-2">{Number(row.allocation_percentage).toFixed(2)}%</td>
              <td className="px-3 py-2">{money(Number(row.gross_amount))}</td>
              <td className="px-3 py-2">{money(Number(row.pnl_cost_amount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
