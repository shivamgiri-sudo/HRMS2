import { useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PnlDrilldownDrawer } from "@/components/finance/pnl/PnlDrilldownDrawer";
import type { PnlDrilldownMetric, PnlDrilldownParams } from "@/hooks/usePnlDrilldown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePnlLiveReconciliation, type PnlReconciliationRow } from "@/hooks/usePnlLiveReconciliation";

function money(value: number | null | undefined, compact = true) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value ?? 0);
}

function percent(value: number | null | undefined) {
  return value == null ? "NA" : `${value.toFixed(1)}%`;
}

function issueLabel(issue: string) {
  return issue
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusTone(status: string) {
  if (status === "ACTUAL") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "ACCRUAL" || status === "PARTIAL") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function sortRows(rows: PnlReconciliationRow[]) {
  return [...rows].sort((a, b) => {
    if (b.recognisedRevenue !== a.recognisedRevenue) return b.recognisedRevenue - a.recognisedRevenue;
    return a.costCentreCode.localeCompare(b.costCentreCode);
  });
}

/**
 * This table is named "Drilldown" but had no row click until now — every figure was a dead end.
 *
 * Each of these four columns is a whole transaction set for one cost centre, so each ties to its
 * drilldown by construction. Operating Profit is deliberately absent: the reconciliation computes
 * it as revenue - payroll - GRN (its own header calls it indicative and simplified), so there is
 * no single set of rows that adds up to it.
 */
const CELL_METRIC: Record<string, PnlDrilldownMetric> = {
  recognisedRevenue: "revenue",
  payrollCost: "people",
  grnActual: "indirect",
  allocatedBudget: "budget",
};

export function PnlReconciliationPanel({
  period,
  branchId,
}: {
  period: string;
  branchId?: string;
}) {
  const query = usePnlLiveReconciliation(period, { branchIds: branchId ? [branchId] : [] });
  const data = query.data;

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-md" />
        <Skeleton className="h-72 rounded-md" />
      </div>
    );
  }

  if (query.isError || !data) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Could not load live P&amp;L reconciliation for {period}.{" "}
        <button type="button" className="underline" onClick={() => void query.refetch()}>Retry</button>
      </div>
    );
  }

  const metricCards = [
    { label: "Recognised revenue", value: money(data.totals.revenue) },
    { label: "Invoice revenue", value: money(data.totals.revenueInvoice) },
    { label: "Accrued top-up", value: money(data.totals.revenueAccrual) },
    { label: "Payroll cost", value: money(data.totals.payrollCost) },
    { label: "GRN actual", value: money(data.totals.grnActual) },
    {
      // BUG-7: this reconciliation view computes OP as recognisedRevenue - payrollCost - grnActual,
      // a simplified 3-line check with no DSC/BMC/overhead split or allocation layer. It is a
      // quick sanity check, not the full waterfall the Statement tab produces — label it as such
      // so it isn't mistaken for the authoritative Operating Profit figure.
      label: "Indicative OP (simplified)",
      value: money(data.totals.operatingProfit),
      danger: data.totals.operatingProfit < 0,
    },
    { label: "Margin", value: percent(data.totals.marginPct), danger: (data.totals.marginPct ?? 0) < 0 },
    { label: "Active cost centres", value: String(data.totals.activeCostCentres) },
  ];
  const topRows = sortRows(data.rows).slice(0, 80);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={data.mode === "FINAL" ? "bg-emerald-600" : "bg-amber-600"}>
            {data.mode === "FINAL" ? "Final month" : "Live MTD"}
          </Badge>
          <span className="text-sm font-medium text-slate-700">{data.company}</span>
          <span className="text-xs text-slate-500">Generated {new Date(data.generatedAt).toLocaleString()}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {data.blockers.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Live blockers
          </div>
          <div className="grid gap-1 text-xs text-amber-800 md:grid-cols-2">
            {data.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
          </div>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {metricCards.map((item) => (
          <div key={item.label} className="rounded-md border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-medium uppercase text-slate-500">{item.label}</p>
            <p className={`mt-1 text-lg font-semibold tabular-nums ${item.danger ? "text-rose-700" : "text-slate-900"}`}>{item.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold text-slate-800">Source Freshness</h2>
          <span className="text-xs text-slate-500">Rows are for {period}</span>
        </div>
        <div className="grid gap-2 p-3 md:grid-cols-3 xl:grid-cols-6">
          {data.freshness.map((source) => (
            <div key={source.source} className={`rounded-md border p-2 ${statusTone(source.status)}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">{source.source}</span>
                {source.status === "ACTUAL" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              </div>
              <p className="mt-1 text-xs tabular-nums">{source.rows.toLocaleString("en-IN")} rows</p>
              <p className="truncate text-[11px] opacity-80">{source.latestSyncedAt ?? "No sync row"}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <div className="rounded-md border border-slate-200 bg-white">
          <div className="border-b px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-800">Branch Rollup</h2>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Branch</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-right">Payroll</th>
                  <th className="px-3 py-2 text-right">GRN</th>
                  <th className="px-3 py-2 text-right" title="Indicative OP (simplified) — Revenue minus payroll minus GRN only; no DSC/BMC/overhead split">OP*</th>
                </tr>
              </thead>
              <tbody>
                {data.branches.map((branch) => (
                  <tr key={branch.branchId ?? branch.branchName} className="border-t">
                    <td className="px-3 py-2 font-medium text-slate-800">{branch.branchName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(branch.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(branch.payrollCost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(branch.grnActual)}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${branch.operatingProfit < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                      {money(branch.operatingProfit)}
                      <span className="ml-1 text-[11px] font-normal text-slate-500">{percent(branch.marginPct)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-md border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-800">Active Cost Centre Drilldown</h2>
            <span className="text-xs text-slate-500">Top {topRows.length} of {data.rows.length}</span>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[980px] text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Cost centre</th>
                  <th className="px-3 py-2">Branch</th>
                  <th className="px-3 py-2 text-right">Invoice</th>
                  <th className="px-3 py-2 text-right">Accrual</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-right">Payroll</th>
                  <th className="px-3 py-2 text-right">GRN</th>
                  <th className="px-3 py-2 text-right">Budget</th>
                  <th className="px-3 py-2 text-right" title="Indicative OP (simplified) — Revenue minus payroll minus GRN only; no DSC/BMC/overhead split">OP*</th>
                  <th className="px-3 py-2">Issues</th>
                </tr>
              </thead>
              <tbody>
                {topRows.map((row) => (
                  <tr key={row.costCentreId} className="border-t align-top">
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{row.costCentreCode}</p>
                      <p className="truncate text-[11px] text-slate-500">{row.costCentreName}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{row.branchName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(row.revenueInvoice)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(row.revenueAccrual)}</td>
                    <td
                      className="cursor-pointer px-3 py-2 text-right font-medium tabular-nums transition-colors duration-200 hover:bg-blue-50 hover:text-blue-700"
                      onClick={() => setDrilldown({
                        params: { metric: CELL_METRIC.recognisedRevenue, period, costCentreId: row.costCentreId },
                        label: `${row.costCentreCode} - ${row.costCentreName}`,
                      })}
                      title="View the underlying rows"
                    >{money(row.recognisedRevenue)}</td>
                    <td
                      className="cursor-pointer px-3 py-2 text-right tabular-nums transition-colors duration-200 hover:bg-blue-50 hover:text-blue-700"
                      onClick={() => setDrilldown({
                        params: { metric: CELL_METRIC.payrollCost, period, costCentreId: row.costCentreId },
                        label: `${row.costCentreCode} - ${row.costCentreName}`,
                      })}
                      title="View the underlying rows"
                    >{money(row.payrollCost)}</td>
                    <td
                      className="cursor-pointer px-3 py-2 text-right tabular-nums transition-colors duration-200 hover:bg-blue-50 hover:text-blue-700"
                      onClick={() => setDrilldown({
                        params: { metric: CELL_METRIC.grnActual, period, costCentreId: row.costCentreId },
                        label: `${row.costCentreCode} - ${row.costCentreName}`,
                      })}
                      title="View the underlying rows"
                    >{money(row.grnActual)}</td>
                    <td
                      className="cursor-pointer px-3 py-2 text-right tabular-nums transition-colors duration-200 hover:bg-blue-50 hover:text-blue-700"
                      onClick={() => setDrilldown({
                        params: { metric: CELL_METRIC.allocatedBudget, period, costCentreId: row.costCentreId },
                        label: `${row.costCentreCode} - ${row.costCentreName}`,
                      })}
                      title="View the underlying rows"
                    >{money(row.allocatedBudget)}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${row.operatingProfit < 0 ? "text-rose-700" : "text-emerald-700"}`}>{money(row.operatingProfit)}</td>
                    <td className="px-3 py-2">
                      <div className="flex max-w-64 flex-wrap gap-1">
                        <Badge variant="outline" className={statusTone(row.sourceStatus)}>{row.sourceStatus}</Badge>
                        {row.issues.slice(0, 2).map((issue) => (
                          <Badge key={issue} variant="outline" className="border-slate-200 text-[10px] text-slate-600">{issueLabel(issue)}</Badge>
                        ))}
                        {row.issues.length > 2 && <Badge variant="outline" className="text-[10px]">+{row.issues.length - 2}</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {data.exceptions.length > 0 && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <p className="mb-2 text-sm font-semibold">Unmapped Items</p>
          {data.exceptions.map((item) => (
            <p key={item.code}>{item.label}: {item.count.toLocaleString("en-IN")} rows, {money(item.amount)}</p>
          ))}
        </div>
      )}

      <PnlDrilldownDrawer
        params={drilldown?.params ?? null}
        scopeLabel={drilldown?.label}
        open={Boolean(drilldown)}
        onOpenChange={(next) => { if (!next) setDrilldown(null); }}
      />
    </div>
  );
}
