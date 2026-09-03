import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { money, dateTimeLabel } from "@/components/finance/grn/grn-format";
import {
  usePnlDrilldown,
  type PnlDrilldownMetric,
  type PnlDrilldownParams,
  type PnlDrilldownRow,
} from "@/hooks/usePnlDrilldown";

/**
 * The rows behind one P&L cell — right-side slide-over, per the Drill-Down Mandate.
 *
 * One drawer serves every P&L surface (statement line, process row, reconciliation cost centre)
 * because they all resolve to the same four metrics and the same three scope kinds. The header
 * carries the scope and the drilldown's own total, so a reader can check it against the cell they
 * clicked without leaving the drawer.
 *
 * Estimated rows are labelled, never hidden: a provision standing in for an unraised invoice, or
 * an earned-to-date salary accrual for a month payroll has not run for, is a real number with a
 * different standing than a posted document, and the difference has to be visible.
 */

const METRIC_LABEL: Record<PnlDrilldownMetric, string> = {
  revenue: "Revenue",
  people: "People cost",
  indirect: "Indirect / GRN spend",
  budget: "Budget",
};

const SECTION_LABEL = "text-xs font-bold uppercase tracking-wide text-slate-400";

export function PnlDrilldownDrawer({
  params,
  scopeLabel,
  open,
  onOpenChange,
  supplied,
  title,
}: {
  /** Null while nothing is selected — the query stays idle until a cell is clicked. */
  params: PnlDrilldownParams | null;
  /** What the user clicked, in their words ("NOIDA-2 · Agent Salary"), for the drawer header. */
  scopeLabel?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Rows the caller already holds, for a figure this drawer's own endpoint cannot reproduce.
   *
   * The Cost Leakage report needs this: its rows total a financial year from grn_request, while
   * getPnlDrilldown answers one period from the snapshot mirror. Fetching by params there would
   * open an empty drawer under a populated row whenever the spend fell in an earlier month. When
   * `supplied` is given it wins outright and no request is made.
   */
  supplied?: { rows: PnlDrilldownRow[]; total: number; isLoading?: boolean; note?: string } | null;
  /** Overrides the metric-derived heading when the caller knows better. */
  title?: string;
}) {
  const query = usePnlDrilldown(open && !supplied ? params : null);
  const data = supplied
    ? { rows: supplied.rows, total: supplied.total, hasEstimatedRows: false, peopleAggregated: false }
    : query.data;
  const isLoading = supplied ? Boolean(supplied.isLoading) : query.isLoading;
  const isError = supplied ? false : query.isError;
  const error = supplied ? null : query.error;
  const rows = data?.rows ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl"
      >
        <SheetHeader className="space-y-2 border-b border-slate-100 bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-5 text-white">
          <SheetTitle className="text-base font-semibold text-white">
            {title ?? (params ? METRIC_LABEL[params.metric] : "Detail")}
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs text-blue-50">
            {scopeLabel ? <span className="font-medium">{scopeLabel}</span> : null}
            {supplied?.note ? <span>{supplied.note}</span> : null}
            {params?.period ? (
              <Badge className="border-white/30 bg-white/15 text-white hover:bg-white/15">
                {params.period}
              </Badge>
            ) : null}
            {data?.peopleAggregated ? (
              <Badge className="border-white/30 bg-white/15 text-white hover:bg-white/15">
                Grouped by designation
              </Badge>
            ) : null}
          </div>
          {data ? (
            <div className="pt-1 text-sm text-blue-50">
              <span className="text-2xl font-bold text-white">₹{money(data.total, 0)}</span>
              <span className="ml-2">
                across {rows.length} {rows.length === 1 ? "row" : "rows"}
              </span>
            </div>
          ) : null}
        </SheetHeader>

        <div className="flex-1 space-y-6 px-6 py-5">
          {data?.peopleAggregated ? (
            <p className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs text-blue-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Shown grouped by designation. Per-employee salary detail is restricted to payroll
                and finance roles — the total above is the same either way.
              </span>
            </p>
          ) : null}

          {data?.hasEstimatedRows ? (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Some rows are estimates, not posted documents — a provision standing in for an
                invoice not yet raised, or salary earned to date for a month payroll has not run
                for. Each is marked below.
              </span>
            </p>
          ) : null}

          <section className="space-y-3">
            <h3 className={SECTION_LABEL}>Transactions</h3>

            {isLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading detail…
              </div>
            ) : isError ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                {(error as Error)?.message || "Could not load the detail behind this figure."}
              </p>
            ) : rows.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                None — no underlying rows for this selection.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left">
                      <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Particulars
                      </th>
                      <th className="py-2 pl-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const estimated = row.id.startsWith("prov-") || row.id.startsWith("snap-");
                      return (
                        <tr key={row.id} className="border-b border-slate-100 align-top last:border-0">
                          <td className="py-2.5 pr-3">
                            <div className="font-semibold text-gray-800">{row.label}</div>
                            {row.detail ? (
                              <div className="text-xs text-slate-500">{row.detail}</div>
                            ) : null}
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              {row.date ? (
                                <span className="text-[11px] text-slate-400">
                                  {dateTimeLabel(row.date) ?? row.date}
                                </span>
                              ) : null}
                              {estimated ? (
                                <Badge
                                  variant="outline"
                                  className="border-amber-300 bg-amber-50 text-[10px] font-bold uppercase tracking-wide text-amber-700"
                                >
                                  Estimated
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                          <td
                            className={`py-2.5 pl-3 text-right font-bold tabular-nums ${
                              row.amount < 0 ? "text-rose-700" : "text-gray-900"
                            }`}
                          >
                            ₹{money(row.amount, 0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300">
                      <td className="py-2.5 pr-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                        Total
                      </td>
                      <td className="py-2.5 pl-3 text-right text-base font-bold tabular-nums text-gray-900">
                        ₹{money(data?.total ?? 0, 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
