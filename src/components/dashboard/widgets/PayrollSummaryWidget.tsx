import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, IndianRupee } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

function formatINR(val: number): string {
  if (val >= 10_000_000) return `₹${(val / 10_000_000).toFixed(1)}Cr`;
  if (val >= 100_000) return `₹${(val / 100_000).toFixed(1)}L`;
  if (val >= 1_000) return `₹${(val / 1_000).toFixed(1)}K`;
  return `₹${val}`;
}

export function PayrollSummaryWidget() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-ceo-payroll"],
    queryFn: () => hrmsApi.get("/api/management/ceo-metrics"),
    staleTime: 1000 * 60 * 5,
  });

  const p = data?.data?.payroll_liability;

  const rows = [
    { label: "Net Pay", value: p?.total_net ?? 0, color: "text-emerald-600" },
    { label: "Gross Pay", value: p?.total_gross ?? 0, color: "text-slate-800" },
    { label: "Employer Statutory", value: p?.employer_statutory ?? 0, color: "text-amber-600" },
  ];

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
            <IndianRupee className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">Payroll Liability</CardTitle>
            <p className="text-[10px] text-slate-500">{p?.run_month ?? "Latest run"}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ) : (
          <>
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between">
                <span className="text-xs text-slate-500">{row.label}</span>
                <span className={`text-sm font-black tabular-nums ${row.color}`} style={{ fontFamily: "'Fira Code', monospace" }}>
                  {formatINR(row.value)}
                </span>
              </div>
            ))}
            <div className="pt-2 border-t border-slate-100">
              <p className="text-[10px] text-slate-400">{p?.employee_count ?? 0} employees in this run</p>
            </div>
            <Link
              to="/payroll"
              className="flex items-center justify-center gap-2 rounded-xl bg-violet-50 border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition"
            >
              Open Payroll <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
