// src/pages/payroll/SalaryDisputeManagerView.tsx
import { useQuery } from "@tanstack/react-query";
import { FileText, Clock, CheckCircle2, XCircle, Users } from "lucide-react";
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
  closed:               <CheckCircle2 className="w-3 h-3" />,
};
const STATUS_COLORS: Record<string, string> = {
  pending_wfm: "bg-amber-100 text-amber-800 border-amber-200",
  pending_payroll_head: "bg-blue-100 text-blue-800 border-blue-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
};
const STATUS_LABEL: Record<string, string> = {
  pending_wfm: "WFM Review",
  pending_payroll_head: "Payroll Review",
  approved: "Approved",
  rejected: "Rejected",
  closed: "Closed",
};

export default function SalaryDisputeManagerView() {
  const { data: raw, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["manager-salary-disputes"],
    queryFn: () => hrmsApi.get("/api/salary-disputes/queue/manager"),
    staleTime: 60_000,
  });
  const disputes = unwrap<any[]>(raw) ?? [];

  // Stats
  const open = disputes.filter(d => !["approved", "rejected", "closed"].includes(d.status));
  const approved = disputes.filter(d => d.status === "approved");
  const rejected = disputes.filter(d => d.status === "rejected");

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-r from-slate-700 to-slate-900 p-5 text-white flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">Team Salary Disputes</h1>
            <p className="text-slate-300 text-sm mt-0.5">
              Read-only view of your team's disputes — for your awareness
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
            <Users className="w-5 h-5 text-white/80" />
          </div>
        </div>

        {/* Stat chips */}
        {!isLoading && (
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm p-3 flex flex-col items-center">
              <p className="text-xl font-bold text-slate-800">{disputes.length}</p>
              <p className="text-[10px] text-slate-500 font-medium">Total</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 shadow-sm p-3 flex flex-col items-center">
              <p className="text-xl font-bold text-amber-700">{open.length}</p>
              <p className="text-[10px] text-amber-600 font-medium">Open</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 shadow-sm p-3 flex flex-col items-center">
              <p className="text-xl font-bold text-emerald-700">{approved.length}</p>
              <p className="text-[10px] text-emerald-600 font-medium">Approved</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50/80 shadow-sm p-3 flex flex-col items-center">
              <p className="text-xl font-bold text-red-700">{rejected.length}</p>
              <p className="text-[10px] text-red-600 font-medium">Rejected</p>
            </div>
          </div>
        )}

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />)}</div>
        ) : disputes.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-slate-400">
            <FileText className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No salary disputes from your team.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {disputes.map((d: any) => {
              const statusColor = STATUS_COLORS[d.status] ?? STATUS_COLORS.closed;
              const statusIcon = STATUS_ICONS[d.status] ?? STATUS_ICONS.closed;
              const statusLabel = STATUS_LABEL[d.status] ?? d.status.replace(/_/g, " ");
              return (
                <Card key={d.id} className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{d.employee_code} — {d.employee_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{d.dispute_type.replace(/_/g, " ")} · {d.run_month}</p>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{d.description}</p>
                      </div>
                      <Badge className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${statusColor}`}>
                        {statusIcon}{statusLabel}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2">
                      Raised {new Date(d.created_at).toLocaleDateString("en-IN")}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Last updated footer */}
        {lastUpdated && !isLoading && (
          <p className="text-[10px] text-slate-400 text-center">Last updated: {lastUpdated}</p>
        )}
      </div>
    </DashboardLayout>
  );
}
