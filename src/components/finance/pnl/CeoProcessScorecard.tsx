import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BpoPnlRow } from "@/hooks/useBpoProcessPnl";

function compact(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

function pct(value: number | null | undefined) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

const STATUS_RANK: Record<BpoPnlRow["processStatus"], number> = {
  "loss-making": 0,
  "at-risk": 1,
  profitable: 2,
};

const STATUS_PILL: Record<BpoPnlRow["processStatus"], string> = {
  profitable: "bg-emerald-100 text-emerald-700",
  "at-risk": "bg-amber-100 text-amber-800",
  "loss-making": "bg-rose-100 text-rose-700",
};

const STATUS_LABEL: Record<BpoPnlRow["processStatus"], string> = {
  profitable: "Profitable",
  "at-risk": "At risk",
  "loss-making": "Loss making",
};

function BudgetBar({ pct: utilPct }: { pct: number | null }) {
  const val = utilPct ?? 0;
  const barColor = val > 95 ? "bg-rose-500" : val > 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={val > 95 ? "text-rose-700" : val > 80 ? "text-amber-700" : "text-slate-700"}>
        {pct(utilPct)}
      </span>
      <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(val, 100)}%` }} />
      </div>
    </div>
  );
}

export function CeoProcessScorecard({
  rows,
  period,
  onViewAll,
}: {
  rows: BpoPnlRow[];
  period: string;
  onViewAll: () => void;
}) {
  const sorted = [...rows].sort((a, b) => {
    const rankDiff = STATUS_RANK[a.processStatus] - STATUS_RANK[b.processStatus];
    if (rankDiff !== 0) return rankDiff;
    return (b.ebitda ?? 0) - (a.ebitda ?? 0);
  });
  const display = sorted.slice(0, 8);
  const hasMore = sorted.length > 8;

  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-950">
          Process scorecard
          <span className="ml-2 text-xs font-normal text-slate-400">
            Loss-making · At risk · Profitable, by EBITDA
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-hidden rounded-b-3xl">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                <th className="px-4 py-2 text-left">Process</th>
                <th className="w-28 px-3 py-2 text-left">Status</th>
                <th className="w-[120px] px-3 py-2 text-right">Revenue</th>
                <th className="w-20 px-3 py-2 text-right">Salary %</th>
                <th className="w-[120px] px-3 py-2 text-right">EBITDA</th>
                <th className="w-20 px-3 py-2 text-right">EBITDA %</th>
                <th className="w-24 px-3 py-2 text-right">Budget</th>
                <th className="w-9 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {display.map((row) => {
                const ebitdaPositive = (row.ebitda ?? 0) >= 0;
                const salaryHigh = (row.agentSalaryPctRevenue ?? 0) > 50;
                return (
                  <tr
                    key={row.processId}
                    className="group hover:bg-slate-50/70 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/finance/process-pnl/${row.processId}?period=${period}`}
                        className="font-semibold text-slate-900 hover:text-emerald-700 transition-colors"
                      >
                        {row.processName}
                      </Link>
                      {row.clientName && (
                        <div className="text-[10px] text-slate-400 mt-0.5">{row.clientName}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_PILL[row.processStatus]}`}>
                        {STATUS_LABEL[row.processStatus]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-700">
                      {compact(row.recognizedRevenue)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-medium ${salaryHigh ? "text-rose-600" : "text-slate-700"}`}>
                      {pct(row.agentSalaryPctRevenue)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-bold ${ebitdaPositive ? "text-emerald-700" : "text-rose-700"}`}>
                      {compact(row.ebitda)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-semibold ${ebitdaPositive ? "text-emerald-600" : "text-rose-600"}`}>
                      {pct(row.ebitdaMarginPct)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <BudgetBar pct={row.budgetUtilizationPct} />
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <Link
                        to={`/finance/process-pnl/${row.processId}?period=${period}`}
                        className="text-slate-300 group-hover:text-emerald-600 transition-colors"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {hasMore && (
              <tfoot>
                <tr>
                  <td colSpan={8} className="px-4 py-3 text-center text-xs text-slate-400">
                    {sorted.length - 8} more processes —{" "}
                    <button
                      onClick={onViewAll}
                      className="text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
                    >
                      View all in Process Matrix
                    </button>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
