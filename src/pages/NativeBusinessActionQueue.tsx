import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Filter, RefreshCcw, ShieldAlert, TrendingUp, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";

type ActionRow = {
  id: string;
  source_module: string;
  risk_type: string;
  severity: string;
  title: string;
  description?: string;
  owner_name?: string;
  owner_role?: string;
  due_date?: string;
  status: string;
  escalation_level?: number;
  is_overdue?: number;
};

type Summary = {
  total: number;
  open_count: number;
  critical_open: number;
  due_today: number;
  overdue: number;
  escalated: number;
  completed_7d: number;
  by_source: Array<{ label: string; value: number }>;
  by_owner: Array<{ label: string; value: number }>;
  generated_at: string;
};

const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export default function NativeBusinessActionQueue() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState({ source_module: "all", severity: "all", status: "all", due: "all", search: "" });

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== "all" && key !== "search") params.set(key, value);
      });
      const [summaryRes, listRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: Summary }>(`/api/business-actions/summary?${params.toString()}`),
        hrmsApi.get<{ success: boolean; data: ActionRow[] }>(`/api/business-actions?${params.toString()}`),
      ]);
      setSummary(summaryRes.data);
      setRows(listRes.data ?? []);
    } catch (error: any) {
      setMessage(error?.message || "Unable to load Business Action Queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const visibleRows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => [row.title, row.description, row.risk_type, row.source_module, row.owner_name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q)));
  }, [rows, filters.search]);

  return (
    <DashboardLayout>
      <main className="space-y-6 p-5 lg:p-8">
        <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-900 p-7 text-white shadow-2xl">
          <div className="absolute -right-16 -top-16 h-72 w-72 rounded-full bg-blue-400/20 blur-3xl" />
          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold backdrop-blur">
                <ShieldAlert className="h-3.5 w-3.5" />
                Business Action Queue
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight lg:text-4xl">
                Every business risk needs an owner, due date, and closure.
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-100">
                Central command queue for people risk, SLA breach, roster shortage, payroll readiness, quality fatal, client escalation, security and data-sync issues.
              </p>
            </div>
            <Button onClick={load} disabled={loading} className="bg-white text-slate-950 hover:bg-blue-50">
              <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </section>

        {message ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">{message}</div> : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <Metric title="Open" value={summary?.open_count ?? 0} icon={<TrendingUp />} />
          <Metric title="Critical" value={summary?.critical_open ?? 0} icon={<AlertTriangle />} intent="danger" />
          <Metric title="Overdue" value={summary?.overdue ?? 0} icon={<Clock />} intent="danger" />
          <Metric title="Due today" value={summary?.due_today ?? 0} icon={<Clock />} intent="warning" />
          <Metric title="Escalated" value={summary?.escalated ?? 0} icon={<ShieldAlert />} intent="warning" />
          <Metric title="Completed 7d" value={summary?.completed_7d ?? 0} icon={<CheckCircle2 />} intent="success" />
        </section>

        <section className="rounded-[1.5rem] border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-600"><Filter className="h-4 w-4" /> Filters</div>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Select value={filters.source_module} onValueChange={(v) => setFilters((p) => ({ ...p, source_module: v }))}>
              <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                {['all','people_experience','support','grievance','attendance','roster','payroll','quality','operations','client','revenue','security','cosec','manual'].map((v) => <SelectItem key={v} value={v}>{v.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.severity} onValueChange={(v) => setFilters((p) => ({ ...p, severity: v }))}>
              <SelectTrigger><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                {['all','critical','high','medium','low'].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => setFilters((p) => ({ ...p, status: v }))}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                {['all','open','in_progress','blocked','escalated','completed','cancelled','overdue'].map((v) => <SelectItem key={v} value={v}>{v.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.due} onValueChange={(v) => setFilters((p) => ({ ...p, due: v }))}>
              <SelectTrigger><SelectValue placeholder="Due" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All due dates</SelectItem>
                <SelectItem value="today">Due today</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Search action, owner, risk" value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} />
            <Button onClick={load} disabled={loading}>Apply</Button>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
          <Panel title="Business Actions" subtitle="Prioritized risk ownership queue">
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>{["Risk", "Title", "Source", "Owner", "Due", "Status", "Esc"].map((h) => <th key={h} className="px-4 py-3 font-black">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3"><Pill label={row.severity} /></td>
                      <td className="px-4 py-3">
                        <div className="font-black text-slate-950">{row.title}</div>
                        <div className="mt-1 max-w-[360px] truncate text-xs text-slate-500">{row.description || row.risk_type?.replace(/_/g, " ")}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-600">
                        <div>{row.source_module?.replace(/_/g, " ")}</div>
                        <div className="text-slate-400">{row.risk_type?.replace(/_/g, " ")}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.owner_name || row.owner_role || "Unassigned"}</td>
                      <td className="px-4 py-3 text-xs font-semibold">
                        <span className={row.is_overdue ? "text-red-700" : "text-slate-600"}>{row.due_date || "No due date"}</span>
                      </td>
                      <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">{row.status?.replace(/_/g, " ")}</span></td>
                      <td className="px-4 py-3 text-center font-black text-slate-500">{row.escalation_level ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && visibleRows.length === 0 ? <EmptyPanel /> : null}
            </div>
          </Panel>

          <div className="space-y-5">
            <Panel title="By Source" subtitle="Open actions by module">
              <Breakdown rows={summary?.by_source ?? []} />
            </Panel>
            <Panel title="By Owner" subtitle="Open actions by accountable owner">
              <Breakdown rows={summary?.by_owner ?? []} icon={<Users className="h-4 w-4" />} />
            </Panel>
          </div>
        </section>

        {summary?.generated_at ? <div className="text-xs font-semibold text-slate-400">Generated: {new Date(summary.generated_at).toLocaleString()}</div> : null}
      </main>
    </DashboardLayout>
  );
}

function Metric({ title, value, icon, intent = "default" }: { title: string; value: number; icon: React.ReactNode; intent?: "default" | "danger" | "warning" | "success" }) {
  const cls = intent === "danger" ? "from-red-500 to-rose-600" : intent === "warning" ? "from-amber-500 to-orange-500" : intent === "success" ? "from-emerald-500 to-teal-500" : "from-blue-500 to-indigo-600";
  return <div className="rounded-[1.5rem] border bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-sm font-bold text-slate-500">{title}</p><div className="mt-2 text-3xl font-black text-slate-950">{value}</div></div><div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${cls} text-white`}>{icon}</div></div></div>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="rounded-[1.5rem] border bg-white p-5 shadow-sm"><div className="mb-4"><h2 className="text-xl font-black text-slate-950">{title}</h2><p className="text-sm text-slate-500">{subtitle}</p></div>{children}</section>;
}

function Pill({ label }: { label: string }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black capitalize ${SEVERITY_CLASS[label] ?? "bg-slate-50 text-slate-700 border-slate-200"}`}>{label}</span>;
}

function Breakdown({ rows, icon }: { rows: Array<{ label: string; value: number }>; icon?: React.ReactNode }) {
  return <div className="space-y-2">{rows.slice(0, 10).map((row) => <div key={row.label} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm"><span className="flex items-center gap-2 font-semibold text-slate-600">{icon}{row.label?.replace(/_/g, " ") || "Unassigned"}</span><span className="font-black text-slate-950">{row.value}</span></div>)}{rows.length === 0 ? <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No data</div> : null}</div>;
}

function EmptyPanel() {
  return <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">No actions match the current filters.</div>;
}
