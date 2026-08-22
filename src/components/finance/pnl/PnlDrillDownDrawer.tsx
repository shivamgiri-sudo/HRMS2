import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, XCircle, Info } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatCurrency } from "@/lib/currency";

export type PnlDrillMetric = "revenue" | "people" | "indirect" | "budget";

/** Exactly one of branchId/processId/costCentreId — a cell is scoped one way or the other,
 *  never both (the branch comparison table scopes by branch; the Focus panel, shown when a
 *  filter narrows to a single process or cost centre, scopes by whichever that is). */
export interface PnlDrillDescriptor {
  metric: PnlDrillMetric;
  period: string;
  branchId?: string;
  processId?: string;
  costCentreId?: string;
  /** Shown in the header, e.g. "NOIDA-2" or "Onfido". */
  scopeLabel: string;
}

export interface PnlDrillDownDrawerProps {
  open: boolean;
  onClose: () => void;
  descriptor: PnlDrillDescriptor | null;
  /** The exact number shown in the summary cell that was clicked — the reconciliation strip
   *  compares the drilldown's own row sum against this, live, every time a user opens it. */
  summaryCellValue: number;
}

interface DrilldownRow {
  id: string;
  label: string;
  detail: string | null;
  amount: number;
  date: string | null;
}

interface DrilldownData {
  metric: string;
  scope: Record<string, string | undefined>;
  rows: DrilldownRow[];
  total: number;
  hasEstimatedRows: boolean;
}

const METRIC_LABEL: Record<PnlDrillMetric, string> = {
  revenue: "Revenue",
  people: "People cost",
  indirect: "Indirect / GRN cost",
  budget: "Budget",
};

const METRIC_COLUMN_LABEL: Record<PnlDrillMetric, string> = {
  revenue: "Cost centre / client",
  people: "Employee",
  indirect: "Vendor / particular",
  budget: "Head",
};

export function PnlDrillDownDrawer({ open, onClose, descriptor, summaryCellValue }: PnlDrillDownDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DrilldownData | null>(null);

  useEffect(() => {
    if (!open || !descriptor) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    const params = new URLSearchParams({ metric: descriptor.metric, period: descriptor.period });
    if (descriptor.branchId) params.set("branchId", descriptor.branchId);
    else if (descriptor.processId) params.set("processId", descriptor.processId);
    else if (descriptor.costCentreId) params.set("costCentreId", descriptor.costCentreId);
    hrmsApi
      .get<{ success: boolean; data: DrilldownData }>(`/api/finance/pnl/drilldown?${params.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Failed to load drilldown detail.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, descriptor?.metric, descriptor?.period, descriptor?.branchId, descriptor?.processId, descriptor?.costCentreId]);

  if (!descriptor) return null;
  const drillTotal = data?.total ?? 0;
  const matches = Math.abs(drillTotal - summaryCellValue) <= 1;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden sm:max-w-xl">
        <SheetHeader className="shrink-0">
          <SheetTitle className="text-base font-semibold">
            {METRIC_LABEL[descriptor.metric]} — {descriptor.scopeLabel}
          </SheetTitle>
          <SheetDescription className="text-xs uppercase tracking-wide text-slate-400">
            {descriptor.period}
          </SheetDescription>
        </SheetHeader>

        {/* Reconciliation proof strip — always visible, never just asserted */}
        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900/40">
          <span>
            Summary cell: <strong className="tabular-nums">{formatCurrency(summaryCellValue, true)}</strong>
          </span>
          <span>
            Drill-down total: <strong className="tabular-nums">{loading ? "…" : formatCurrency(drillTotal, true)}</strong>
          </span>
          {!loading && !error && (
            matches ? (
              <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                <CheckCircle2 className="h-3 w-3" /> Match
              </Badge>
            ) : (
              <Badge className="gap-1 bg-rose-600 hover:bg-rose-600">
                <XCircle className="h-3 w-3" /> Mismatch (Δ {formatCurrency(drillTotal - summaryCellValue, true)})
              </Badge>
            )
          )}
        </div>

        {data?.hasEstimatedRows && (
          <div className="mt-2 flex shrink-0 items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Includes a provision estimate for a cost centre with no invoice raised yet this period.
          </div>
        )}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md border">
          {loading && (
            <div className="space-y-2 p-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center gap-2 p-4 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {!loading && !error && data && (
            data.rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">No underlying rows for this cell.</p>
            ) : (
              <table className="hrms-table" data-density="compact">
                <thead>
                  <tr>
                    <th>{METRIC_COLUMN_LABEL[descriptor.metric]}</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="font-medium text-slate-900 dark:text-slate-100">{row.label}</div>
                        {row.detail && <div className="text-xs text-slate-500">{row.detail}</div>}
                      </td>
                      <td className="num tabular-nums">{formatCurrency(row.amount, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>

        {!loading && !error && data && data.rows.length > 0 && (
          <p className="mt-2 shrink-0 text-right text-xs text-slate-400">{data.rows.length} row{data.rows.length === 1 ? "" : "s"}</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
