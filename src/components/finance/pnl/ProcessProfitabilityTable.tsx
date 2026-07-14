import { Link } from "react-router-dom";
import type { ProcessPnlRecord } from "@/hooks/useProcessPnl";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function formatNumber(value: number | null | undefined) {
  return value == null ? "Not calculated" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

function statusTone(status: ProcessPnlRecord["processStatus"]) {
  if (status === "profitable") return "bg-emerald-100 text-emerald-700";
  if (status === "loss-making") return "bg-rose-100 text-rose-700";
  return "bg-amber-100 text-amber-800";
}

export function ProcessProfitabilityTable({
  rows,
  period,
}: {
  rows: ProcessPnlRecord[];
  period: string;
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-950">Process profitability</h2>
        <p className="text-sm text-slate-500">Live view across revenue, people cost, non-people cost and allocated overhead.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1560px] w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-[0.18em] text-slate-500">
            <tr>
              <th className="sticky left-0 bg-slate-50 px-4 py-3 text-left">Process</th>
              <th className="px-4 py-3 text-left">Client</th>
              <th className="px-4 py-3 text-left">Branch</th>
              <th className="px-4 py-3 text-left">Rate source</th>
              <th className="px-4 py-3 text-right">Contracted seats</th>
              <th className="px-4 py-3 text-right">Billable HC</th>
              <th className="px-4 py-3 text-right">Active HC</th>
              <th className="px-4 py-3 text-right">Revenue MTD</th>
              <th className="px-4 py-3 text-right">Direct cost</th>
              <th className="px-4 py-3 text-right">Indirect cost</th>
              <th className="px-4 py-3 text-right">Operating profit</th>
              <th className="px-4 py-3 text-right">Profit variance</th>
              <th className="px-4 py-3 text-right">OP margin</th>
              <th className="px-4 py-3 text-right">Revenue leakage</th>
              <th className="px-4 py-3 text-right">Receivable risk</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.processId} className="hover:bg-slate-50/70">
                <td className="sticky left-0 bg-white px-4 py-3 font-semibold text-slate-950">
                  <Link className="hover:text-emerald-700" to={`/finance/process-pnl/${row.processId}?period=${period}`}>
                    {row.processName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{row.clientName ?? "Unmapped"}</td>
                <td className="px-4 py-3 text-slate-600">{row.branchName ?? "Unassigned"}</td>
                <td className="px-4 py-3 text-slate-600">{row.rateSource.replaceAll("_", " ")}</td>
                <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.contractedSeats)}</td>
                <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.billableHc)}</td>
                <td className="px-4 py-3 text-right text-slate-700">{row.activeHc}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-950">{formatCurrency(row.revenueMtd)}</td>
                <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.directCost)}</td>
                <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.indirectCost)}</td>
                <td className={`px-4 py-3 text-right font-semibold ${row.operatingProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {formatCurrency(row.operatingProfit)}
                </td>
                <td className="px-4 py-3 text-right text-slate-700">
                  {row.operatingProfitVariance == null ? "No budget" : formatCurrency(row.operatingProfitVariance)}
                </td>
                <td className={`px-4 py-3 text-right font-semibold ${(row.operatingMarginPct ?? 0) >= 0 ? "text-slate-900" : "text-rose-700"}`}>
                  {row.operatingMarginPct?.toFixed(1) ?? "0.0"}%
                </td>
                <td className="px-4 py-3 text-right text-amber-700">{formatCurrency(row.revenueAtRisk)}</td>
                <td className="px-4 py-3 text-right text-rose-700">{formatCurrency(row.receivableRisk)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(row.processStatus)}`}>
                    {row.processStatus}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={16} className="px-4 py-10 text-center text-slate-500">
                  No process financial data is available for the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
