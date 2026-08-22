// src/pages/payroll/SalaryDisputeManagerView.tsx
import { useQuery } from "@tanstack/react-query";
import { FileText, Clock, CheckCircle2, XCircle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { hrmsApi } from "@/lib/hrmsApi";

function unwrap<T>(r: unknown): T {
  return ((r as any)?.data?.data ?? (r as any)?.data ?? r) as T;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending_wfm:          <Clock className="w-3 h-3" />,
  pending_payroll_head: <Clock className="w-3 h-3" />,
  approved:             <CheckCircle2 className="w-3 h-3" />,
  rejected:             <XCircle className="w-3 h-3" />,
};
const STATUS_COLORS: Record<string, string> = {
  pending_wfm: "bg-amber-100 text-amber-800 border-amber-200",
  pending_payroll_head: "bg-blue-100 text-blue-800 border-blue-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function SalaryDisputeManagerView() {
  const { data: raw, isLoading } = useQuery({
    queryKey: ["manager-salary-disputes"],
    queryFn: () => hrmsApi.get("/api/salary-disputes/queue/manager"),
    staleTime: 60_000,
  });
  const disputes = unwrap<any[]>(raw) ?? [];
  const open = disputes.filter(d => d.status !== "approved" && d.status !== "rejected" && d.status !== "closed");

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
        <div className="rounded-2xl bg-gradient-to-r from-slate-700 to-slate-900 p-5 text-white">
          <h1 className="text-xl font-bold">Team Salary Disputes</h1>
          <p className="text-slate-300 text-sm mt-0.5">
            {open.length} open dispute{open.length !== 1 ? "s" : ""} from your team — for your awareness
          </p>
        </div>
        {isLoading ? (
          <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />)}</div>
        ) : disputes.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-slate-400">
            <FileText className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No salary disputes from your team.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {disputes.map((d: any) => (
              <Card key={d.id} className="rounded-2xl">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{d.employee_code} — {d.employee_name}</p>
                    <p className="text-xs text-slate-500">{d.dispute_type.replace(/_/g, " ")} · {d.run_month}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{new Date(d.created_at).toLocaleDateString("en-IN")}</p>
                  </div>
                  <Badge className={`text-[10px] font-bold border flex items-center gap-1 ${STATUS_COLORS[d.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {STATUS_ICONS[d.status]}{d.status.replace(/_/g, " ")}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
