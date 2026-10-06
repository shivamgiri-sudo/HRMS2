import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * Close a budget per cost centre (owner accounting rule 2026-10-06, migration 2118). While a cost
 * centre's lines are OPEN, Live P&L counts them at full budget (actual GRN + unspent headroom);
 * once CLOSED, at actual only — and the cost centre refuses new GRNs. Closing is Branch Admin or
 * Finance Head; reopening is Finance Head only. Backend: /pnl/budgets/:id/cost-centre-closure.
 */
interface CostCentreClosureRow {
  costCentreId: string;
  costCentreCode: string | null;
  costCentreName: string | null;
  budgetAmount: number;
  usedAmount: number;
  status: "open" | "closed";
  closedAt: string | null;
}

const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

export function BudgetCostCentreClosurePanel({ budgetId, canClose, canReopen }: { budgetId: string; canClose: boolean; canReopen: boolean }) {
  const qc = useQueryClient();
  const key = ["budget-cost-centre-closure", budgetId];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: CostCentreClosureRow[] }>(`/api/finance/pnl/budgets/${budgetId}/cost-centre-closure`)).data ?? [],
  });
  const onDone = (msg: string) => {
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["pnl-live-reconciliation"] });
  };
  const close = useMutation({
    mutationFn: (costCentreId: string) => hrmsApi.post(`/api/finance/pnl/budgets/${budgetId}/cost-centre-closure/close`, { costCentreId }),
    onSuccess: () => onDone("Cost centre closed — Live P&L now counts its actual spend only"),
    onError: (e: Error) => toast.error(e.message || "Could not close"),
  });
  const reopen = useMutation({
    mutationFn: (costCentreId: string) => hrmsApi.post(`/api/finance/pnl/budgets/${budgetId}/cost-centre-closure/reopen`, { costCentreId }),
    onSuccess: () => onDone("Cost centre reopened"),
    onError: (e: Error) => toast.error(e.message || "Could not reopen"),
  });
  const rows = query.data ?? [];
  if (query.isLoading) return <p className="flex items-center gap-2 py-3 text-xs text-slate-600"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading cost centres…</p>;
  if (query.isError) return <p className="py-3 text-xs text-rose-700">Could not load cost-centre closure: {(query.error as Error)?.message}</p>;
  if (!rows.length) return null;

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="border-b bg-slate-50/70 px-3 py-2">
        <p className="text-xs font-semibold text-slate-800">Close by cost centre</p>
        <p className="text-[11px] text-slate-600">An open cost centre counts in Live P&amp;L at its full budget; closing it counts actual spend only and stops new GRNs against it.</p>
      </div>
      <table className="w-full text-xs">
        <caption className="sr-only">Budget closure per cost centre</caption>
        <thead className="text-left text-slate-600">
          <tr>
            <th className="px-3 py-2">Cost centre</th>
            <th className="px-3 py-2 text-right">Budget</th>
            <th className="px-3 py-2 text-right">Spent (reserved + consumed)</th>
            <th className="px-3 py-2 text-right">Unspent</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2"><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const unspent = Math.max(0, r.budgetAmount - r.usedAmount);
            const pending = (close.isPending && close.variables === r.costCentreId) || (reopen.isPending && reopen.variables === r.costCentreId);
            return (
              <tr key={r.costCentreId} className="border-t">
                <td className="px-3 py-2"><span className="font-medium text-slate-900">{r.costCentreCode ?? r.costCentreId}</span> <span className="text-slate-600">{r.costCentreName}</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.budgetAmount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.usedAmount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(unspent)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${r.status === "closed" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-blue-300 bg-blue-50 text-blue-800"}`}>
                    {r.status === "closed" ? "Closed · actual" : "Open · full budget"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {r.status === "open" && canClose ? (
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pending}
                      onClick={() => { if (window.confirm(`Close ${r.costCentreCode ?? "this cost centre"}? Live P&L will count ${money(r.usedAmount)} instead of ${money(r.budgetAmount)}, and no new GRN can be raised against it.`)) close.mutate(r.costCentreId); }}>
                      Close
                    </Button>
                  ) : null}
                  {r.status === "closed" && canReopen ? (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={pending} onClick={() => reopen.mutate(r.costCentreId)}>Reopen</Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
