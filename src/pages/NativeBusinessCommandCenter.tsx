import { useEffect, useState } from "react";
import { AlertTriangle, BarChart3, BriefcaseBusiness, CheckCircle2, Clock, IndianRupee, RefreshCcw, ShieldAlert, TicketCheck, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";

type Overview = {
  generated_at: string;
  executive_summary: {
    active_employees: number;
    open_actions: number;
    critical_actions: number;
    overdue_actions: number;
    support_sla_breached: number;
    people_attrition_risk: number;
    open_grievances: number;
    latest_payroll_gross_inr: number;
  };
  attendance: { present: number; absent: number; late: number };
  support: { open: number; breached: number; urgent: number };
  people_risk: { watchlist: number; attrition_risk: number; average_score: number };
  grievances: { open: number; critical: number };
  payroll: { latest_gross: number; latest_net: number };
  action_summary: { by_source: Array<{ label: string; value: number }>; by_owner: Array<{ label: string; value: number }> };
  health_signals: Array<{ label: string; value: number; status: string }>;
  data_confidence: Record<string, number>;
};

export default function NativeBusinessCommandCenter() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Overview }>("/api/business-command/overview");
      setData(res.data);
    } catch (error: any) {
      setMessage(error?.message || "Unable to load Business Command Center");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const summary = data?.executive_summary;

  return (
    <DashboardLayout>
      <main className="space-y-6 p-5 lg:p-8">
        <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-emerald-950 to-blue-950 p-7 text-white shadow-2xl">
          <div className="absolute -right-16 -top-16 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold backdrop-blur">
                <BriefcaseBusiness className="h-3.5 w-3.5" />
                BPO Business Command Center
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight lg:text-4xl">
                Where are we losing money, manpower, quality, or people stability today?
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-emerald-100">
                CEO-level operating cockpit connecting employees, attendance, support SLA, people risk, grievance risk, payroll exposure and action ownership.
              </p>
            </div>
            <Button onClick={load} disabled={loading} className="bg-white text-slate-950 hover:bg-emerald-50">
              <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </section>

        {message ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">{message}</div> : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric title="Active employees" value={summary?.active_employees ?? 0} icon={<Users />} />
          <Metric title="Open business actions" value={summary?.open_actions ?? 0} icon={<ShieldAlert />} intent={(summary?.critical_actions ?? 0) > 0 ? "danger" : "default"} />
          <Metric title="Overdue actions" value={summary?.overdue_actions ?? 0} icon={<Clock />} intent={(summary?.overdue_actions ?? 0) > 0 ? "danger" : "default"} />
          <Metric title="Payroll gross INR" value={formatInr(summary?.latest_payroll_gross_inr ?? 0)} icon={<IndianRupee />} />
          <Metric title="Support SLA breached" value={summary?.support_sla_breached ?? 0} icon={<TicketCheck />} intent={(summary?.support_sla_breached ?? 0) > 0 ? "danger" : "success"} />
          <Metric title="People attrition risk" value={summary?.people_attrition_risk ?? 0} icon={<AlertTriangle />} intent={(summary?.people_attrition_risk ?? 0) > 0 ? "warning" : "success"} />
          <Metric title="Open grievances" value={summary?.open_grievances ?? 0} icon={<ShieldAlert />} intent={(data?.grievances?.critical ?? 0) > 0 ? "danger" : "default"} />
          <Metric title="Critical actions" value={summary?.critical_actions ?? 0} icon={<AlertTriangle />} intent={(summary?.critical_actions ?? 0) > 0 ? "danger" : "success"} />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <Panel title="Business Health Signals" subtitle="Red/amber/green operating signals from live modules">
            <div className="grid gap-3 md:grid-cols-2">
              {(data?.health_signals ?? []).map((signal) => <Signal key={signal.label} {...signal} />)}
              {!loading && !data?.health_signals?.length ? <Empty /> : null}
            </div>
          </Panel>
          <Panel title="Data Confidence" subtitle="Decision confidence by module">
            <div className="space-y-3">
              {Object.entries(data?.data_confidence ?? {}).map(([label, value]) => <Confidence key={label} label={label} value={Number(value)} />)}
            </div>
          </Panel>
        </section>

        <section className="grid gap-5 xl:grid-cols-3">
          <Panel title="Attendance Today" subtitle="Present, absent and late counts">
            <Mini label="Present" value={data?.attendance?.present ?? 0} />
            <Mini label="Absent" value={data?.attendance?.absent ?? 0} intent="danger" />
            <Mini label="Late" value={data?.attendance?.late ?? 0} intent="warning" />
          </Panel>
          <Panel title="Support Risk" subtitle="Ticket pressure and SLA breach">
            <Mini label="Open tickets" value={data?.support?.open ?? 0} />
            <Mini label="Urgent" value={data?.support?.urgent ?? 0} intent="warning" />
            <Mini label="Breached" value={data?.support?.breached ?? 0} intent="danger" />
          </Panel>
          <Panel title="People Risk" subtitle="Engagement and attrition signal">
            <Mini label="Average score" value={`${Math.round(data?.people_risk?.average_score ?? 0)}%`} />
            <Mini label="Watchlist" value={data?.people_risk?.watchlist ?? 0} intent="warning" />
            <Mini label="Attrition risk" value={data?.people_risk?.attrition_risk ?? 0} intent="danger" />
          </Panel>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <Panel title="Open Actions by Source" subtitle="Which modules are producing risk ownership items">
            <Breakdown rows={data?.action_summary?.by_source ?? []} />
          </Panel>
          <Panel title="Open Actions by Owner" subtitle="Who owns the operating risk">
            <Breakdown rows={data?.action_summary?.by_owner ?? []} />
          </Panel>
        </section>

        {data?.generated_at ? <div className="text-xs font-semibold text-slate-400">Generated: {new Date(data.generated_at).toLocaleString()}</div> : null}
      </main>
    </DashboardLayout>
  );
}

function Metric({ title, value, icon, intent = "default" }: { title: string; value: React.ReactNode; icon: React.ReactNode; intent?: "default" | "danger" | "warning" | "success" }) {
  const cls = intent === "danger" ? "from-red-500 to-rose-600" : intent === "warning" ? "from-amber-500 to-orange-500" : intent === "success" ? "from-emerald-500 to-teal-500" : "from-blue-500 to-indigo-600";
  return <div className="rounded-[1.5rem] border bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-500">{title}</p><div className="mt-2 text-3xl font-black text-slate-950">{value}</div></div><div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${cls} text-white`}>{icon}</div></div></div>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="rounded-[1.5rem] border bg-white p-5 shadow-sm"><div className="mb-4"><h2 className="text-xl font-black text-slate-950">{title}</h2><p className="text-sm text-slate-500">{subtitle}</p></div>{children}</section>;
}

function Signal({ label, value, status }: { label: string; value: number; status: string }) {
  const cls = status === "critical" ? "bg-red-50 text-red-800" : status === "warning" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800";
  const icon = status === "critical" ? <AlertTriangle className="h-4 w-4" /> : status === "warning" ? <ShieldAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />;
  return <div className={`flex items-center justify-between rounded-2xl p-4 ${cls}`}><div className="flex items-center gap-2 font-black">{icon}{label}</div><div className="text-2xl font-black">{value}</div></div>;
}

function Mini({ label, value, intent = "default" }: { label: string; value: React.ReactNode; intent?: "default" | "danger" | "warning" }) {
  const cls = intent === "danger" ? "bg-red-50 text-red-800" : intent === "warning" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-800";
  return <div className={`mb-2 flex items-center justify-between rounded-xl px-3 py-2 ${cls}`}><span className="text-sm font-bold">{label}</span><span className="text-lg font-black">{value}</span></div>;
}

function Confidence({ label, value }: { label: string; value: number }) {
  const cls = value >= 80 ? "bg-emerald-500" : value >= 60 ? "bg-amber-500" : "bg-red-500";
  return <div><div className="mb-1 flex justify-between text-sm font-bold text-slate-600"><span>{label.replace(/_/g, " ")}</span><span>{value}%</span></div><div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${cls}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div></div>;
}

function Breakdown({ rows }: { rows: Array<{ label: string; value: number }> }) {
  return <div className="space-y-2">{rows.slice(0, 12).map((row) => <div key={row.label} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm"><span className="font-semibold text-slate-600">{row.label?.replace(/_/g, " ") || "Unassigned"}</span><span className="font-black text-slate-950">{row.value}</span></div>)}{rows.length === 0 ? <Empty /> : null}</div>;
}

function Empty() {
  return <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No data available yet.</div>;
}

function formatInr(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0));
}
