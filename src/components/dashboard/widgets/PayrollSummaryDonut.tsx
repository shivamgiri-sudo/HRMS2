import { useQuery } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

// Segment colours only. Values are derived from the API — never hardcoded.
// /api/management/ceo-metrics returns total_gross, total_net and employer_statutory;
// it does NOT break gross into basic vs allowances, so this widget must not claim to.
const SEGMENT_COLORS = {
  net: "#1B6AB5",
  deductions: "#F59E0B",
  employer: "#8B5CF6",
} as const;

function fmt(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export function PayrollSummaryDonut({ runMonth }: { runMonth?: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["ceo-metrics-payroll"],
    queryFn: () => hrmsApi.get("/api/management/ceo-metrics"),
    staleTime: 1000 * 60 * 5,
  });

  const payroll = data?.data?.payroll_liability ?? {};
  const gross = Number(payroll.total_gross) || 0;
  const net = Number(payroll.total_net) || 0;
  const employerStatutory = Number(payroll.employer_statutory) || 0;
  const month = payroll.run_month ?? runMonth ?? "Latest";

  // Employee deductions are the gross-to-net delta. Clamped at 0 because a
  // snapshot with net > gross (or gross missing entirely) is a known data defect
  // and must not render as a negative slice.
  const deductions = Math.max(0, gross - net);
  // Total employer cost = what employees are paid gross, plus employer-side statutory.
  const totalCost = gross + employerStatutory;

  const chartData = [
    { key: "net", label: "Net Pay", value: net, color: SEGMENT_COLORS.net },
    { key: "deductions", label: "Employee Deductions", value: deductions, color: SEGMENT_COLORS.deductions },
    { key: "employer", label: "Employer Statutory", value: employerStatutory, color: SEGMENT_COLORS.employer },
  ].filter((s) => s.value > 0);

  const hasData = chartData.length > 0;

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
        <CardTitle className="text-sm font-bold text-slate-900">
          Payroll Summary{" "}
          <span className="text-[#1B6AB5] font-normal">({month})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        {isLoading ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : !hasData ? (
          <div className="flex h-40 flex-col items-center justify-center text-center">
            <span className="text-xs font-medium text-slate-500">
              No payroll figures published for this period
            </span>
            <span className="mt-1 text-[11px] text-slate-400">
              This card shows values only once a payroll run reports gross and net.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={62}
                    paddingAngle={2}
                  >
                    {chartData.map((e, i) => (
                      <Cell key={i} fill={e.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      border: "none",
                      borderRadius: "8px",
                      color: "#f1f5f9",
                      fontSize: 11,
                    }}
                    formatter={(v: any) => fmt(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span
                  className="text-xs font-bold text-slate-900"
                  style={{ fontFamily: "'Fira Code', monospace" }}
                >
                  {fmt(totalCost)}
                </span>
                <span className="text-[8px] text-slate-500">Total Cost</span>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              {chartData.map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-xs text-slate-600">{s.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-bold text-slate-800"
                      style={{ fontFamily: "'Fira Code', monospace" }}
                    >
                      {fmt(s.value)}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      ({totalCost > 0 ? ((s.value / totalCost) * 100).toFixed(1) : "0.0"}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
