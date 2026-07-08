import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Download, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

export function RecentPayslipWidget() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["my-payslip"],
    queryFn: () => hrmsApi.get("/api/payroll/payslip/my"),
    staleTime: 1000 * 60 * 10,
  });
  const slips: any[] = Array.isArray(data?.data) ? data.data : [];
  const latest = slips[0] ?? null;
  const netPay = latest?.net_pay ?? latest?.total_net ?? latest?.components?.reduce((s: number, c: any) => c.component_type === "earning" ? s + (c.amount ?? 0) : s - (c.amount ?? 0), 0) ?? 0;

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
        <CardTitle className="text-sm font-bold text-slate-900">Recent Payslip</CardTitle>
        <Link to="/payslip" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View All →</Link>
      </CardHeader>
      <CardContent className="p-5">
        {isLoading ? <Skeleton className="h-20 w-full rounded-xl" /> : !latest ? (
          <div className="flex items-center justify-center py-6 text-sm text-slate-400">No payslip available</div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0">
              <FileText className="w-6 h-6 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{latest.run_month ?? latest.month ?? "Latest"}</span>
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Latest</span>
              </div>
              <p className="text-2xl font-bold text-slate-900 mt-1" style={{ fontFamily: "'Fira Code', monospace" }}>
                ₹{Number(netPay).toLocaleString("en-IN")}
              </p>
              <p className="text-xs text-slate-500">Take Home</p>
            </div>
            <Link to="/payslip" className="flex items-center gap-1.5 text-xs font-semibold text-[#1B6AB5] hover:underline flex-shrink-0">
              <Download className="w-3.5 h-3.5" /> Download
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
