import { useEffect, useMemo, useState } from "react";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  Clock,
  HeartHandshake,
  MessageSquareWarning,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  TicketCheck,
  Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { hrmsApi } from "@/lib/hrmsApi";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Button } from "@/components/ui/button";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Input } from "@/components/ui/input";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

type Summary = {
  employees_scanned: number;
  average_engagement_score: number;
  highly_engaged_count: number;
  watchlist_count: number;
  attrition_risk_count: number;
  open_support_tickets: number;
  sla_breached_tickets: number;
  open_grievances?: number;
  critical_grievances?: number;
  pending_manager_actions: number;
  pulse_participation_rate: number;
  enps_score: number;
  kudos_given_this_month: number;
  recognition_coverage_percentage: number;
};

type WatchRow = {
  employee_id: string;
  employee_name: string;
  employee_code?: string;
  branch_name?: string;
  process_name?: string;
  department_name?: string;
  manager_name?: string;
  tenure_days?: number | null;
  engagement_score: number;
  data_confidence_score: number;
  risk_label: string;
  risk_reason: string;
  support_open_count: number;
  grievance_flag?: boolean;
  recommended_action: string;
  owner: string;
  due_date: string;
  action_status: string;
};

type Bucket = { label: string; value?: number; count?: number; total?: number; healthy?: number; watchlist?: number; risk?: number };

type CommandCenterData = {
  generated_at: string;
  scope: { kind: string; label: string };
  executive_summary: Summary;
  heatmap: { branch: Bucket[]; process: Bucket[]; manager: Bucket[] };
  watchlist: WatchRow[];
  support_health: { total_open: number; sla_breached: number; by_category: Bucket[]; by_priority: Bucket[]; by_status: Bucket[] };
  grievance_health: { restricted?: boolean; open?: number; anonymous?: number; critical?: number; by_category?: Bucket[] };
  recognition_health: { kudos_given: number; kudos_received: number; zero_recognition_90d: number };
  pulse_health: { response_rate: number; average_mood_score: number; enps_score: number };
  action_queue: Array<{ id: string; employee_name: string; employee_code?: string; source_type: string; action_type: string; priority: string; due_date?: string; status: string; notes?: string }>;
};

const RISK_CLASS: Record<string, string> = {
  highly_engaged: "bg-emerald-50 text-emerald-700 border-emerald-200",
  stable: "bg-blue-50 text-blue-700 border-blue-200",
  watchlist: "bg-amber-50 text-amber-700 border-amber-200",
  attrition_risk: "bg-red-50 text-red-700 border-red-200",
  critical_people_risk: "bg-rose-100 text-rose-800 border-rose-300",
};

export default function NativePeopleExperienceCommandCenter() {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState({
    dateRange: "30",
    branch_id: "",
    process_id: "",
    department_id: "",
    risk: "all",
    support_category: "all",
  });

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== "all") params.set(key, value);
      });
      const res = await hrmsApi.get<{ success: boolean; data: CommandCenterData }>(
        `/api/people-experience/command-center?${params.toString()}`
      );
      setData(res.data);
    } catch (error: any) {
      setMessage(error?.message || "Unable to load People Experience Command Center");
    } finally {
      setLoading(false);
    }
  };

  const scan = async () => {
    setLoading(true);
    try {
      await hrmsApi.post("/api/people-experience/scan", { limit: 500, filters });
      setMessage("People Experience scan completed and snapshots refreshed.");
      await load();
    } catch (error: any) {
      setMessage(error?.message || "People Experience scan failed");
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const summary = data?.executive_summary;
  const filteredWatchlist = useMemo(() => {
    const rows = data?.watchlist ?? [];
    if (filters.risk === "all") return rows;
    return rows.filter((row) => row.risk_label === filters.risk);
  }, [data, filters.risk]);

  return (
    <DashboardLayout>
      <main className="space-y-6 p-5 lg:p-8">
        <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-indigo-950 to-fuchsia-900 p-7 text-white shadow-2xl">
          <div className="absolute -right-16 -top-16 h-72 w-72 rounded-full bg-fuchsia-400/20 blur-3xl" />
          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold backdrop-blur">
                <HeartHandshake className="h-3.5 w-3.5" />
                People Experience Command Center
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight lg:text-4xl">
                Who is unhappy, unsupported, at risk, or waiting for action today?
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-indigo-100">
                Scoped cockpit for engagement risk, support friction, grievance health, recognition coverage, pulse/eNPS, and accountable action closure.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ScopeBadge label={data?.scope?.label ?? "Loading scope"} />
              <Button onClick={load} disabled={loading} className="bg-white/15 text-white hover:bg-white/25">
                <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button onClick={scan} disabled={loading} className="bg-white text-indigo-900 hover:bg-indigo-50">
                Run Health Scan
              </Button>
            </div>
          </div>
        </section>

        {message ? <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div> : null}

        <section className="rounded-[1.5rem] border bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
            <Select value={filters.dateRange} onValueChange={(v) => setFilters((prev) => ({ ...prev, dateRange: v }))}>
              <SelectTrigger><SelectValue placeholder="Date range" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Branch ID" value={filters.branch_id} onChange={(e) => setFilters((prev) => ({ ...prev, branch_id: e.target.value }))} />
            <Input placeholder="Process ID" value={filters.process_id} onChange={(e) => setFilters((prev) => ({ ...prev, process_id: e.target.value }))} />
            <Input placeholder="Department ID" value={filters.department_id} onChange={(e) => setFilters((prev) => ({ ...prev, department_id: e.target.value }))} />
            <Select value={filters.risk} onValueChange={(v) => setFilters((prev) => ({ ...prev, risk: v }))}>
              <SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All risk</SelectItem>
                <SelectItem value="watchlist">Watchlist</SelectItem>
                <SelectItem value="attrition_risk">Attrition risk</SelectItem>
                <SelectItem value="critical_people_risk">Critical</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.support_category} onValueChange={(v) => setFilters((prev) => ({ ...prev, support_category: v }))}>
              <SelectTrigger><SelectValue placeholder="Support category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All support</SelectItem>
                <SelectItem value="it">IT</SelectItem>
                <SelectItem value="payroll">Payroll</SelectItem>
                <SelectItem value="attendance">Attendance</SelectItem>
                <SelectItem value="hr">HR</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={load} disabled={loading}>Apply</Button>
          </div>
        </section>

        {loading && !data ? (
          <LoadingGrid />
        ) : !data || !summary ? (
          <EmptyPanel title="No People Experience data" text="Run a health scan or adjust filters to populate the command center." />
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <Metric title="Employees scanned" value={summary.employees_scanned} icon={<Users />} color="from-indigo-500 to-blue-500" />
              <Metric title="Avg engagement" value={`${summary.average_engagement_score}%`} icon={<Sparkles />} color="from-fuchsia-500 to-purple-500" />
              <Metric title="Watchlist" value={summary.watchlist_count} icon={<ShieldAlert />} color="from-amber-500 to-orange-500" />
              <Metric title="Attrition risk" value={summary.attrition_risk_count} icon={<AlertTriangle />} color="from-red-500 to-rose-500" />
              <Metric title="SLA breached" value={summary.sla_breached_tickets} icon={<Clock />} color="from-slate-700 to-slate-950" />
              <Metric title="Open support" value={summary.open_support_tickets} icon={<TicketCheck />} color="from-cyan-500 to-sky-500" />
              <Metric title="Open grievances" value={summary.open_grievances ?? "Restricted"} icon={<MessageSquareWarning />} color="from-rose-500 to-pink-500" />
              <Metric title="Pending actions" value={summary.pending_manager_actions} icon={<CheckCircle2 />} color="from-violet-500 to-indigo-500" />
              <Metric title="Pulse participation" value={`${summary.pulse_participation_rate}%`} icon={<Activity />} color="from-emerald-500 to-teal-500" />
              <Metric title="eNPS" value={summary.enps_score} icon={<BarChart3 />} color="from-blue-500 to-indigo-500" />
            </section>

            <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
              <Panel title="People Risk Heatmap" subtitle="Branch, process and manager risk density">
                <div className="grid gap-4 lg:grid-cols-3">
                  <HeatmapColumn title="Branch" rows={data.heatmap.branch} />
                  <HeatmapColumn title="Process" rows={data.heatmap.process} />
                  <HeatmapColumn title="Manager" rows={data.heatmap.manager} />
                </div>
              </Panel>
              <Panel title="Support Health" subtitle="Open issues, SLA risk and category mix">
                <MiniStat label="Open tickets" value={data.support_health.total_open} />
                <MiniStat label="SLA breached" value={data.support_health.sla_breached} intent="danger" />
                <Breakdown rows={data.support_health.by_category} />
              </Panel>
            </section>

            <section className="grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
              <Panel title="Engagement Watchlist" subtitle="Scoped employee risks requiring manager or HR action">
                <div className="max-h-[620px] overflow-auto">
                  <table className="w-full min-w-[1100px] text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        {["Employee", "Org", "Manager", "Score", "Risk", "Drivers", "Support", "Action", "Owner / Due"].map((h) => (
                          <th key={h} className="px-4 py-3 font-black">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredWatchlist.map((row) => (
                        <tr key={row.employee_id} className="border-t hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="font-black text-slate-950">{row.employee_name}</div>
                            <div className="font-mono text-xs text-slate-500">{row.employee_code}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div>{row.branch_name ?? "No branch"}</div>
                            <div className="text-xs">{row.process_name ?? "No process"}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{row.manager_name ?? "Unassigned"}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-black text-white">{row.engagement_score}%</span>
                            <div className="mt-1 text-[11px] text-slate-400">confidence {row.data_confidence_score}%</div>
                          </td>
                          <td className="px-4 py-3"><RiskPill label={row.risk_label} /></td>
                          <td className="max-w-[220px] px-4 py-3 text-xs text-slate-600">{row.risk_reason}</td>
                          <td className="px-4 py-3 text-xs">
                            <div>{row.support_open_count} open</div>
                            {row.grievance_flag ? <div className="font-bold text-rose-700">Grievance flag</div> : null}
                          </td>
                          <td className="max-w-[220px] px-4 py-3 text-xs font-semibold text-slate-700">{row.recommended_action}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            <div>{row.owner}</div>
                            <div>{row.due_date}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredWatchlist.length === 0 ? <EmptyPanel title="No scoped watchlist" text="No employees match the selected risk filters." /> : null}
                </div>
              </Panel>

              <div className="space-y-5">
                <Panel title="Grievance Health" subtitle={data.grievance_health.restricted ? "Identity and detail restricted" : "Confidential HR case overview"}>
                  {data.grievance_health.restricted ? (
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                      Managers see aggregate team concern only. Anonymous grievance identity is protected.
                    </div>
                  ) : (
                    <>
                      <MiniStat label="Open" value={data.grievance_health.open ?? 0} intent="danger" />
                      <MiniStat label="Anonymous" value={data.grievance_health.anonymous ?? 0} />
                      <MiniStat label="Critical" value={data.grievance_health.critical ?? 0} intent="danger" />
                      <Breakdown rows={data.grievance_health.by_category ?? []} />
                    </>
                  )}
                </Panel>

                <Panel title="Recognition + Pulse" subtitle="Coverage, kudos, mood, eNPS">
                  <MiniStat label="Kudos given" value={data.recognition_health.kudos_given} />
                  <MiniStat label="Kudos received" value={data.recognition_health.kudos_received} />
                  <MiniStat label="Zero recognition 90d" value={data.recognition_health.zero_recognition_90d} intent="warning" />
                  <MiniStat label="Pulse response" value={`${data.pulse_health.response_rate}%`} />
                  <MiniStat label="Mood avg" value={Number(data.pulse_health.average_mood_score ?? 0).toFixed(1)} />
                </Panel>
              </div>
            </section>

            <Panel title="Action Queue" subtitle="Every risk should convert into owned action">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(data.action_queue ?? []).slice(0, 12).map((action) => (
                  <div key={action.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-black text-slate-950">{action.employee_name}</div>
                        <div className="text-xs text-slate-500">{action.employee_code} • {action.source_type}</div>
                      </div>
                      <RiskPill label={action.priority} />
                    </div>
                    <div className="mt-3 text-sm font-semibold text-slate-700">{action.action_type.replace(/_/g, " ")}</div>
                    <div className="mt-1 text-xs text-slate-500">Due {action.due_date ?? "not set"} • {action.status}</div>
                  </div>
                ))}
                {(data.action_queue ?? []).length === 0 ? <EmptyPanel title="No action items" text="Generated actions will appear here after health scans or HR/manager assignment." /> : null}
              </div>
            </Panel>

            <div className="text-xs font-semibold text-slate-400">
              Generated: {formatIST(data.generated_at)} • Scope: {data.scope.label}
            </div>
          </>
        )}
      </main>
    </DashboardLayout>
  );
}

function ScopeBadge({ label }: { label: string }) {
  return <span className="inline-flex items-center rounded-full bg-white/15 px-4 py-2 text-sm font-black text-white">{label}</span>;
}

function Metric({ title, value, icon, color }: { title: string; value: React.ReactNode; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-[1.5rem] border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-500">{title}</p>
          <div className="mt-2 text-3xl font-black text-slate-950">{value}</div>
        </div>
        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${color} text-white`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.5rem] border bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-xl font-black text-slate-950">{title}</h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function RiskPill({ label }: { label: string }) {
  const cls = RISK_CLASS[label] ?? (label === "critical" || label === "high" ? "bg-red-50 text-red-700 border-red-200" : "bg-slate-50 text-slate-700 border-slate-200");
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black capitalize ${cls}`}>{String(label).replace(/_/g, " ")}</span>;
}

function HeatmapColumn({ title, rows }: { title: string; rows: Bucket[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">{title}</h3>
      {rows.length === 0 ? <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No data</div> : rows.map((row) => {
        const risk = Number(row.risk ?? 0);
        const watch = Number(row.watchlist ?? 0);
        const cls = risk > 0 ? "bg-red-50 text-red-800" : watch > 0 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800";
        return (
          <div key={row.label} className={`rounded-xl p-3 ${cls}`}>
            <div className="flex justify-between gap-3">
              <span className="truncate font-bold">{row.label}</span>
              <span className="font-black">{risk + watch}</span>
            </div>
            <div className="mt-1 text-xs">Risk {risk} • Watch {watch} • Total {row.total ?? 0}</div>
          </div>
        );
      })}
    </div>
  );
}

function MiniStat({ label, value, intent = "default" }: { label: string; value: React.ReactNode; intent?: "default" | "danger" | "warning" }) {
  const cls = intent === "danger" ? "bg-red-50 text-red-800" : intent === "warning" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-800";
  return (
    <div className={`mb-2 flex items-center justify-between rounded-xl px-3 py-2 ${cls}`}>
      <span className="text-sm font-bold">{label}</span>
      <span className="text-lg font-black">{value}</span>
    </div>
  );
}

function Breakdown({ rows }: { rows: Bucket[] }) {
  return (
    <div className="mt-3 space-y-2">
      {rows.slice(0, 8).map((row) => (
        <div key={row.label} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm">
          <span className="font-semibold text-slate-600">{row.label ?? "Unassigned"}</span>
          <span className="font-black text-slate-950">{row.value ?? row.count ?? 0}</span>
        </div>
      ))}
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index} className="h-32 animate-pulse rounded-[1.5rem] bg-slate-100" />
      ))}
    </div>
  );
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
      <div className="font-black text-slate-700">{title}</div>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
    </div>
  );
}
