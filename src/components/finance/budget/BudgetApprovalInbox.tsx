import { useQuery } from "@tanstack/react-query";
import { Inbox, Loader2, AlertTriangle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PendingBudget {
  id: string;
  budget_number: string;
  period_code: string;
  status: string;
  gross_budget: number | null;
  pnl_budget: number | null;
  revision_number: number;
  updated_at: string;
  branch_name: string | null;
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value ?? 0));
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(String(dateStr).replace(" ", "T")).getTime()) / 86_400_000);
}

function waitingBadge(days: number) {
  if (days > 3) return <span className="font-semibold text-rose-700">{days}d</span>;
  if (days > 1) return <span className="font-semibold text-amber-700">{days}d</span>;
  return <span className="text-slate-500">{days}d</span>;
}

const STATUS_LABELS: Record<string, string> = {
  submitted: "Awaiting Branch Head",
  branch_head_approved: "Awaiting Finance Head",
  finance_head_approved: "Awaiting Accounts Head",
};

export function BudgetApprovalInbox({
  onViewBudget,
}: {
  onViewBudget: (id: string) => void;
}) {
  const query = useQuery({
    queryKey: ["budget-pending-my-review"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: PendingBudget[] }>(
        "/api/finance/pnl/budgets/pending-my-review"
      );
      return response.data.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (query.isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertTriangle className="h-8 w-8 text-rose-400" />
        <p className="text-sm text-slate-600">Failed to load pending budgets</p>
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button>
      </div>
    );
  }

  const rows = query.data ?? [];

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-center">
        <Inbox className="h-10 w-10 text-slate-300" />
        <p className="text-sm font-semibold text-slate-700">Inbox is empty</p>
        <p className="text-xs text-slate-500">No budgets are currently awaiting your review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {rows.length} budget{rows.length !== 1 ? "s" : ""} pending your approval · sorted oldest first
      </p>
      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Branch</th>
              <th className="px-4 py-2 text-left">Period</th>
              <th className="px-4 py-2 text-left">Budget no.</th>
              <th className="px-4 py-2 text-left">Stage</th>
              <th className="px-4 py-2 text-right">Gross budget</th>
              <th className="px-4 py-2 text-right">P&amp;L budget</th>
              <th className="px-4 py-2 text-right">Waiting</th>
              <th className="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-2 font-medium text-slate-800">{row.branch_name ?? "—"}</td>
                <td className="px-4 py-2 tabular-nums text-slate-700">{row.period_code}</td>
                <td className="px-4 py-2 text-slate-600">
                  {row.budget_number}
                  {row.revision_number > 0 && (
                    <Badge variant="outline" className="ml-1.5 text-[10px]">Rev {row.revision_number}</Badge>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-600">{STATUS_LABELS[row.status] ?? row.status}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {row.gross_budget != null ? money(row.gross_budget) : "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {row.pnl_budget != null ? money(row.pnl_budget) : "—"}
                </td>
                <td className="px-4 py-2 text-right">{waitingBadge(daysSince(row.updated_at))}</td>
                <td className="px-4 py-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => onViewBudget(row.id)}>
                    Review
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
