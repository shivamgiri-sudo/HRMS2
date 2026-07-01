import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, FileText, RefreshCcw, ShieldCheck, UserMinus } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { AIInsightPanel } from "@/components/ai";

type ExitRow = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  branch_name?: string;
  process_name?: string;
  exit_type: string;
  exit_sub_type?: string;
  status: string;
  last_working_day_proposed?: string;
  created_at?: string;
  engagement_score?: number;
  regrettable_exit?: number;
  risk_label?: string;
  clearance_total?: number;
  clearance_cleared?: number;
};

type CenterData = {
  summary: Record<string, number>;
  requests: ExitRow[];
  clearance: Array<{ clearance_area: string; status: string; count: number }>;
};

const statusFlow = ["submitted", "manager_review", "hr_review", "accepted", "notice_serving", "exited"];

function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const cls = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    blue: "bg-blue-50 text-blue-700",
  }[tone];
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${cls}`}>{children}</span>;
}

function StatCard({ title, value, icon, note }: { title: string; value: number; icon: React.ReactNode; note: string }) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value ?? 0}</p>
          <p className="mt-1 text-xs text-slate-500">{note}</p>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

export default function NativeExitCommandCenter() {
  const [data, setData] = useState<CenterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("all");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: CenterData }>("/api/exit/command-center");
      setData(res.data);
    } catch (err: any) {
      setMessage(err?.message || "Unable to load exit command center");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const rows = data?.requests ?? [];
    return status === "all" ? rows : rows.filter((r) => r.status === status);
  }, [data, status]);

  const moveStatus = async (id: string, nextStatus: string) => {
    try {
      await hrmsApi.patch(`/api/exit/${id}/status`, { status: nextStatus, remarks: `Moved to ${nextStatus}` });
      setMessage(`Moved to ${nextStatus.replace(/_/g, " ")}`);
      await load();
    } catch (err: any) {
      setMessage(err?.message || "Status update failed");
    }
  };

  const generateClearance = async (id: string) => {
    try {
      await hrmsApi.post(`/api/exit/${id}/clearance/generate`, {});
      setMessage("Clearance tasks generated");
      await load();
    } catch (err: any) {
      setMessage(err?.message || "Unable to generate clearance");
    }
  };

  return (
    <DashboardLayout>
      <main className="space-y-6 p-6 lg:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-rose-600">Employee Lifecycle</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Exit Command Center</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Manage resignation, retention, clearance, F&F readiness, and final exit closure from one controlled journey.
            </p>
          </div>
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
            <RefreshCcw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard title="Total exits" value={Number(data?.summary?.total ?? 0)} icon={<UserMinus className="h-5 w-5" />} note="All exit records" />
          <StatCard title="Pending review" value={Number(data?.summary?.pending_review ?? 0)} icon={<Clock className="h-5 w-5" />} note="Manager/HR/Admin" />
          <StatCard title="Active notice" value={Number(data?.summary?.active_notice ?? 0)} icon={<FileText className="h-5 w-5" />} note="Accepted or notice serving" />
          <StatCard title="Completed" value={Number(data?.summary?.completed ?? 0)} icon={<CheckCircle2 className="h-5 w-5" />} note="Exit confirmed" />
          <StatCard title="Regrettable" value={Number(data?.summary?.regrettable ?? 0)} icon={<AlertTriangle className="h-5 w-5" />} note="Retention attention" />
        </div>

        {/* AI Exit Risk Briefing */}
        <AIInsightPanel
          contextType="exit_risk"
          role="hr"
          title="Exit Risk AI Brief"
          enabled={data !== null && !loading}
          data={{
            total_exits: Number(data?.summary?.total ?? 0),
            pending_offboarding: Number(data?.summary?.pending_review ?? 0),
            regrettable_exits: Number(data?.summary?.regrettable ?? 0),
            active_notice: Number(data?.summary?.active_notice ?? 0),
            completed: Number(data?.summary?.completed ?? 0),
            kt_incomplete: data?.requests?.filter((r) => r.status !== "exited" && r.status !== "exit_confirmed").length ?? 0,
            clearance_pending: data?.clearance?.filter((c) => c.status === "pending").reduce((s, c) => s + c.count, 0) ?? 0,
          }}
        />

        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {["all", ...statusFlow, "rejected", "revoked"].map((s) => (
              <button key={s} onClick={() => setStatus(s)} className={`rounded-xl px-3 py-1.5 text-xs font-bold capitalize ${status === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {s.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Exit journey board</h2>
            <p className="text-sm text-slate-500">{filtered.length} records</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {['Employee','Branch / Process','LWD','Status','Health','Clearance','Risk','Actions'].map((h) => <th key={h} className="p-4 font-bold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const currentIndex = statusFlow.indexOf(r.status === "exit_confirmed" ? "exited" : r.status);
                  const nextStatus = currentIndex >= 0 && currentIndex < statusFlow.length - 1 ? statusFlow[currentIndex + 1] : null;
                  const total = Number(r.clearance_total ?? 0);
                  const cleared = Number(r.clearance_cleared ?? 0);
                  return (
                    <tr key={r.id} className="border-t hover:bg-slate-50/80">
                      <td className="p-4">
                        <div className="font-black text-slate-950">{r.employee_name ?? r.employee_id}</div>
                        <div className="font-mono text-xs text-slate-500">{r.employee_code ?? r.employee_id?.slice(0, 8)}</div>
                      </td>
                      <td className="p-4 text-slate-600"><div>{r.branch_name ?? '—'}</div><div className="text-xs">{r.process_name ?? '—'}</div></td>
                      <td className="p-4 font-mono text-xs text-slate-600">{r.last_working_day_proposed ?? '—'}</td>
                      <td className="p-4"><Pill tone="blue">{r.status?.replace(/_/g, ' ')}</Pill></td>
                      <td className="p-4"><div className="font-black">{Math.round(Number(r.engagement_score ?? 0))}%</div><div className="text-xs text-slate-500">Engagement</div></td>
                      <td className="p-4"><div className="font-black">{cleared}/{total}</div><div className="text-xs text-slate-500">Cleared</div></td>
                      <td className="p-4">{r.regrettable_exit ? <Pill tone="red">Regrettable</Pill> : <Pill tone={r.risk_label === 'high' || r.risk_label === 'critical' ? 'amber' : 'green'}>{r.risk_label ?? 'low'}</Pill>}</td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-2">
                          {nextStatus && <button onClick={() => moveStatus(r.id, nextStatus)} className="rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-bold text-white">Move to {nextStatus.replace(/_/g, ' ')}</button>}
                          {total === 0 && <button onClick={() => generateClearance(r.id)} className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold text-slate-700"><ShieldCheck className="h-3 w-3" /> Generate clearance</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!filtered.length && <div className="p-10 text-center text-sm text-slate-500">No exit records found.</div>}
        </div>
      </main>
    </DashboardLayout>
  );
}
