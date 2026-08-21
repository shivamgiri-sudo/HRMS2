import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { money, dateLabel, labelStatus, grnStatusTone } from "@/components/finance/grn/grn-format";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";

export type GrnDrillDownContext = {
  costCentreId: string | null;
  costCentreName: string;
  head: string;
  subHead: string | null;
};

type GrnRow = {
  id: string;
  grn_number: string;
  vendor_name: string | null;
  bill_date: string | null;
  amount_with_tax: number | null;
  status: string;
};

/**
 * Read-only GRN list for one (branch, period, cost centre, head, sub-head) combination — the
 * drill-down target from the Variance tab (click a head/sub-head row, pick a cost centre) and
 * the Cost Centre tab (click a head/sub-head row directly, cost centre already known).
 *
 * Deliberately a small local table rather than reusing GrnSearchWorkspace.tsx, which is a whole
 * page component with its own filter/pagination state — the wrong footprint for a modal that
 * exists only to answer "which GRNs make up this number."
 */
export function BudgetGrnDrillDownDialog({
  context,
  onOpenChange,
  branchId,
  period,
}: {
  context: GrnDrillDownContext | null;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  period: string;
}) {
  const query = useQuery({
    queryKey: ["budget-grn-drilldown", branchId, period, context],
    queryFn: async () => {
      if (!context) return { data: [], total: 0 };
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      if (period) params.set("accountingPeriod", period);
      if (context.costCentreId) params.set("costCentreId", context.costCentreId);
      if (context.head) params.set("head", context.head);
      if (context.subHead) params.set("subHead", context.subHead);
      params.set("limit", "100");
      const response = await hrmsApi.get<{ data: GrnRow[]; total: number }>(
        `/api/finance/grns?${params.toString()}`
      );
      return { data: response.data ?? [], total: response.total ?? 0 };
    },
    enabled: Boolean(context),
  });

  const rows = query.data?.data ?? [];

  return (
    <Dialog open={Boolean(context)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            GRNs — {context?.head}
            {context?.subHead ? ` / ${context.subHead}` : ""}
            {context?.costCentreName ? ` · ${context.costCentreName}` : ""}
          </DialogTitle>
        </DialogHeader>
        {query.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : query.isError ? (
          <p className="py-6 text-center text-sm text-rose-600">
            {(query.error as Error)?.message || "Could not load GRNs for this selection."}
          </p>
        ) : !rows.length ? (
          <p className="py-6 text-center text-sm text-slate-500">No GRNs raised against this head/sub-head yet.</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b text-left text-slate-500">
                  <th className="h-8 px-3 font-medium">GRN Number</th>
                  <th className="h-8 px-3 font-medium">Vendor</th>
                  <th className="h-8 px-3 font-medium">Bill Date</th>
                  <th className="h-8 px-3 text-right font-medium">Amount</th>
                  <th className="h-8 px-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((grn) => (
                  <tr key={grn.id} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2 font-medium text-slate-800">{grn.grn_number}</td>
                    <td className="px-3 py-2 text-slate-600">{grn.vendor_name ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{dateLabel(grn.bill_date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(grn.amount_with_tax)}</td>
                    <td className="px-3 py-2">
                      <StatusStamp tone={grnStatusTone(grn.status)}>{labelStatus(grn.status)}</StatusStamp>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
